"""Trait rarity for the gift detail screen: "Model  Unicorns [1.5%]", "Symbol  Flower [1.1%]", "Backdrop  Emerald [2%]".

Uses the free Marketapp endpoint ``/v1/collections/{address}/attributes/`` (cached 1 h by the client), whose values
carry ``perc`` — the share of the collection with that trait. When ``perc`` is missing it is computed from ``count``.
The collection is taken from the listing, or found by name ("Toy Bear #123" → "Toy Bear") in the collection list,
so it works for every gift in the catalogue, including new collections.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from .context import AppContext
from .pricing import attr, split_name

log = logging.getLogger(__name__)
TRAITS = ("model", "symbol", "backdrop")


def _fmt(p: float) -> str:
    """1.5 → '1.5', 2.0 → '2', 0.123 → '0.12'."""
    d = Decimal(str(round(p, 2 if p < 1 else 1)))
    return format(d.normalize(), "f")


async def _collection_address(ctx: AppContext, listing: dict) -> str:
    if listing.get("collection_address"):
        return str(listing["collection_address"])
    name, _ = split_name(str(listing.get("name") or ""))
    if not name:
        return ""
    try:
        for c in await ctx.market.gift_collections() or []:
            if str(c.get("name") or "").strip().lower() == name.strip().lower():
                return str(c.get("address") or "")
    except Exception as exc:  # noqa: BLE001
        log.info("Collections lookup failed: %s", exc)
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
        groups = await ctx.market.collection_attributes(address)
    except Exception as exc:  # noqa: BLE001 — rarity is decoration; never fail the sheet
        log.info("Attributes for %s unavailable: %s", address, exc)
        return out
    for o in out:
        group = next((g for g in groups if str(g.get("trait_type", "")).lower() == o["trait"]), None)
        if not group:
            continue
        values = group.get("values") or []
        hit = next((v for v in values if str(v.get("value", "")).lower() == o["value"].lower()), None)
        if not hit:
            continue
        perc = hit.get("perc")
        if not perc:
            total = sum(int(v.get("count") or 0) for v in values)
            perc = (int(hit.get("count") or 0) / total * 100) if total else None
        if perc:
            o["perc"] = _fmt(float(perc))
    return out
