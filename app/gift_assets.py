"""Backdrop colours for the filter sheet (Model / Backdrop / Symbol pickers).

Telegram gift backdrops are a fixed palette. The public changes.tg dataset publishes them with their colours; we read
it once a day on the server (so the Mini App needs no third-party CORS) and return {name: [center, edge]}. If the
source is unreachable the app falls back to a colour derived from the name, so the picker always shows something.
Model and symbol pictures are loaded by the Mini App straight from the same CDN (cdn.changes.tg), with a fallback.
"""

from __future__ import annotations

import logging
import re
import time

import httpx

log = logging.getLogger(__name__)
SOURCE = "https://cdn.changes.tg/gifts/backdrops.json"
TTL, FAIL_TTL = 86400, 600
_cache: dict = {"at": 0.0, "ok": False, "data": {}}
_HEX = re.compile(r"^#?[0-9a-fA-F]{6}$")


def _color(value) -> str | None:
    if isinstance(value, int):
        return f"#{value & 0xFFFFFF:06x}"
    if isinstance(value, str) and _HEX.match(value.strip()):
        return "#" + value.strip().lstrip("#").lower()
    return None


def parse(payload) -> dict[str, list[str]]:
    """Accepts a list of backdrop objects (or {"backdrops": [...]}) in the shapes the dataset has used."""
    items = payload.get("backdrops", payload) if isinstance(payload, dict) else payload
    if isinstance(items, dict):   # {name: {...}}
        items = [{"name": k, **(v if isinstance(v, dict) else {})} for k, v in items.items()]
    out: dict[str, list[str]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        colors = item.get("hex") if isinstance(item.get("hex"), dict) else item.get("colors") if isinstance(item.get("colors"), dict) else item
        center = _color(colors.get("centerColor") or colors.get("center_color") or colors.get("center"))
        edge = _color(colors.get("edgeColor") or colors.get("edge_color") or colors.get("edge"))
        if center or edge:
            out[str(item["name"])] = [center or edge, edge or center]
    return out


async def backdrops() -> dict[str, list[str]]:
    age = time.monotonic() - _cache["at"]
    if _cache["at"] and age < (TTL if _cache["ok"] else FAIL_TTL):
        return _cache["data"]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(SOURCE)
            r.raise_for_status()
            data = parse(r.json())
        if not data:
            raise ValueError("empty backdrop list")
        _cache.update(at=time.monotonic(), ok=True, data=data)
    except Exception as exc:  # noqa: BLE001 — decoration only
        log.info("Backdrop colours unavailable (%s); using fallback colours", type(exc).__name__)
        _cache.update(at=time.monotonic(), ok=False)
    return _cache["data"]
