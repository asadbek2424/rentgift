"""Animated gift artwork: Fragment publishes each gift's Lottie animation next to its picture
(``https://nft.fragment.com/gift/<slug>-<number>.lottie.json``). The Mini App gets it through this server
(same origin → no CORS trouble in Telegram's WebView) and it is cached here, so each animation is downloaded
from Fragment once."""

from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict

import httpx

log = logging.getLogger(__name__)
SOURCE = "https://nft.fragment.com/gift/{key}.lottie.json"
KEY_RE = re.compile(r"^[a-z0-9]{2,40}-\d{1,7}$")
MAX_ITEMS = 300
MAX_BYTES = 3_000_000
TTL = 24 * 3600
MISS_TTL = 1800
_cache: OrderedDict[str, tuple[float, bytes | None]] = OrderedDict()
_client: httpx.AsyncClient | None = None


def valid(key: str) -> bool:
    return bool(KEY_RE.match(key or ""))


async def get(key: str) -> bytes | None:
    """Lottie JSON bytes, or None if Fragment has no animation for this gift (cached either way)."""
    global _client
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < (TTL if hit[1] else MISS_TTL):
        _cache.move_to_end(key)
        return hit[1]
    if _client is None:
        _client = httpx.AsyncClient(timeout=15, follow_redirects=True,
                                    headers={"User-Agent": "Mozilla/5.0 (gift preview)"})
    data: bytes | None = None
    try:
        r = await _client.get(SOURCE.format(key=key))
        if r.status_code == 200 and len(r.content) <= MAX_BYTES and r.content[:1] == b"{":
            data = r.content
        elif r.status_code != 404:
            log.info("Gift animation %s: HTTP %s", key, r.status_code)
    except httpx.HTTPError as exc:
        log.info("Gift animation %s failed: %s", key, type(exc).__name__)
        return None                       # network trouble: don't cache, try again next time
    _cache[key] = (time.monotonic(), data)
    _cache.move_to_end(key)
    while len(_cache) > MAX_ITEMS:
        _cache.popitem(last=False)
    return data
