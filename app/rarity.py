"""Trait rarity for the gift detail screen: "Model  Unicorns [1.5%]", "Symbol  Flower [1.1%]", "Backdrop  Emerald [2%]".

Uses the free Marketapp endpoint ``/v1/collections/{address}/attributes/`` (cached 1 h by the client), whose values
carry ``perc`` — the share of the collection with that trait. When ``perc`` is missing it is computed from ``count``.
Rent listings carry no collection address, so the collection is found by name ("Toy Bear #123" → "Toy Bear") in the
collection list. Every step logs why a percentage could not be found ("Rarity …" lines in the server log).
"""

from __future__ import annotations

import asyncio
import logging
import re
from decimal import Decimal

from .context import AppContext
from .pricing import attr, split_name

log = logging.getLogger(__name__)
TRAITS = ("model", "symbol", "backdrop")
PERC_KEYS = ("perc", "percent", "percentage", "rarity_percent", "rarity")
_logged: set[str] = set()   # log each distinct problem once, not on every tap


def _fmt(p: float) -> str:
    """1.5 → '1.5', 2.0 → '2', 0.123 → '0.12'."""
    d = Decimal(str(round(p, 2 if p < 1 else 1)))
    return format(d.normalize(), "f")


def norm(text: str) -> str:
    """Compare names loosely: case, curly quotes, dashes and extra spaces don't matter."""
    text = str(text or "").lower().replace("’", "'").replace("‘", "'").replace("`", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip()


def _once(key: str, message: str, *args) -> None:
    if key not in _logged:
        _logged.add(key)
        log.warning("Rarity: " + message, *args)


def _perc_of(hit: dict, values: list[dict]) -> float | None:
    for key in PERC_KEYS:
        raw = hit.get(key)
        try:
            value = float(raw) if raw not in (None, "") else 0.0
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    permille = hit.get("rarity_per_mille") or hit.get("rarityPerMille")
    try:
        if permille and float(permille) > 0:
            return float(permille) / 10
    except (TypeError, ValueError):
        pass
    total = sum(int(v.get("count") or 0) for v in values)
    count = int(hit.get("count") or 0)
    return count / total * 100 if total and count else None


async def _with_retry(coro_factory):
    try:
        return await coro_factory()
    except Exception:  # noqa: BLE001 — Marketapp 429 / hiccup: one more try after a pause
        await asyncio.sleep(1.2)
        return await coro_factory()


async def _collection_address(ctx: AppContext, listing: dict) -> str:
    if listing.get("collection_address"):
        return str(listing["collection_address"])
    name, _ = split_name(str(listing.get("name") or ""))
    if not name:
        return ""
    try:
        collections = await _with_retry(ctx.market.gift_collections) or []
    except Exception as exc:  # noqa: BLE001
        _once("cols", "collection list unavailable (%s: %s)", type(exc).__name__, exc)
        return ""
    wanted = norm(name)
    for c in collections:
        if norm(c.get("name")) == wanted:
            return str(c.get("address") or "")
    _once(f"name:{wanted}", "no collection named %r among %d collections (e.g. %s)", name, len(collections),
          ", ".join(repr(c.get("name")) for c in collections[:5]))
    return ""


async def traits(ctx: AppContext, listing: dict) -> list[dict]:
    attributes = listing.get("attributes") or []
    out = [{"trait": t, "value": attr(attributes, t), "perc": None} for t in TRAITS]
    out = [o for o in out if o["value"]]
    if not out:
        return []
    address = await _collection_address(ctx, listing)
    if not address:
        return out
    try:
        groups = await _with_retry(lambda: ctx.market.collection_attributes(address))
    except Exception as exc:  # noqa: BLE001 — rarity is decoration; never fail the sheet
        _once(f"attr:{address}", "attributes of %s unavailable (%s: %s)", address, type(exc).__name__, exc)
        return out
    if not groups:
        _once(f"empty:{address}", "attributes of %s came back empty", address)
    for o in out:
        group = next((g for g in groups if norm(g.get("trait_type")) == o["trait"]), None)
        if not group:
            _once(f"trait:{address}:{o['trait']}", "no %s group for %s (groups: %s)", o["trait"], address,
                  [g.get("trait_type") for g in groups])
            continue
        values = group.get("values") or []
        hit = next((v for v in values if norm(v.get("value")) == norm(o["value"])), None)
        if not hit:
            _once(f"val:{address}:{o['trait']}", "%s %r not in %s values (%d values)", o["trait"], o["value"], address, len(values))
            continue
        perc = _perc_of(hit, values)
        if perc:
            o["perc"] = _fmt(float(perc))
        else:
            _once(f"noperc:{address}", "value has no percentage or count field: %s", sorted(hit.keys()))
    return out
