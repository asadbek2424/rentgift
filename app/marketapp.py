"""Async Marketapp API client.

Based on gift-rent-check's read-only client (src/marketapp_rent/api.py): raw token in the
``Authorization`` header (no "Bearer"), sequential pacing, retries with exponential backoff and
``Retry-After`` for GET requests, and the token is never echoed in errors. This version adds the
rent endpoints the shop needs: ``/pay/``, ``/tonconnect/``, ``/my-rented/`` and ``/nfts/{address}/``.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import re
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
LISTING_SORTS = ("price_per_day", "min_price", "duration_asc", "duration_desc", "item_num_asc", "item_num_desc", "recently_touch")
_SAFE_ADDRESS = re.compile(r"[A-Za-z0-9_:\-]{48,80}\Z")


class MarketappError(Exception):
    def __init__(self, message: str, status: int | None = None, detail: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.detail = detail


class MarketappAuthError(MarketappError):
    pass


@dataclass
class _Cache:
    ttl: float
    items: dict = field(default_factory=dict)

    def get(self, key):
        hit = self.items.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
        return None

    def put(self, key, value):
        if len(self.items) > 500:
            self.items.clear()
        self.items[key] = (time.monotonic() + self.ttl, value)


class MarketappClient:
    def __init__(self, token: str, base_url: str = "https://api.marketapp.org", rps: float = 1.0,
                 transport: httpx.AsyncBaseTransport | None = None, timeout: float = 30) -> None:
        if not token:
            raise ValueError("MARKETAPP_API_TOKEN is empty: Railway → service → Variables → add MARKETAPP_API_TOKEN")
        bad = [i for i, c in enumerate(token) if ord(c) < 32 or ord(c) > 126]
        if bad:
            raise ValueError(
                f"MARKETAPP_API_TOKEN has {len(bad)} invalid character(s) (length {len(token)}, first at position "
                f"{bad[0] + 1}): it must be the plain token from marketapp.ws — no spaces, line breaks or quotes")
        self._token = token
        self._interval = 1 / max(rps, 0.1)
        self._lock = asyncio.Lock()
        self._next_at = 0.0
        self._http = httpx.AsyncClient(base_url=base_url, timeout=timeout, transport=transport, follow_redirects=False,
                                       headers={"Authorization": token, "Accept": "application/json"})
        self._listing_cache = _Cache(ttl=45)
        self._collections_cache = _Cache(ttl=3600)
        self.seen: dict[str, dict] = {}     # canonical address -> last listing seen (free plan has no /nfts/{a}/)

    async def close(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ transport
    def _safe(self, text: str) -> str:
        return text.replace(self._token, "[REDACTED]")

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if value is None:
            return None
        try:
            seconds = float(value)
            return max(0.0, seconds) if math.isfinite(seconds) else None
        except ValueError:
            pass
        try:
            when = parsedate_to_datetime(value)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None

    async def _pace(self) -> None:
        async with self._lock:
            delay = self._next_at - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_at = time.monotonic() + self._interval

    async def _request(self, method: str, path: str, *, params: dict | None = None, json: dict | None = None,
                       retries: int = 4, retry_post_503: bool = False) -> Any:
        query = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        for attempt in range(retries):
            await self._pace()
            try:
                response = await self._http.request(method, path, params=query or None, json=json)
            except httpx.TransportError as exc:
                if method != "GET" or attempt + 1 >= retries:
                    raise MarketappError("Marketapp network error") from exc
                await asyncio.sleep(2 ** attempt + random.random())
                continue
            status = response.status_code
            if 200 <= status < 300:
                try:
                    return response.json()
                except ValueError:
                    raise MarketappError("Marketapp returned invalid JSON", status) from None
            if status in (401, 403):
                raise MarketappAuthError("Marketapp authentication failed; check MARKETAPP_API_TOKEN", status)
            # 429 means the request was not processed, so it is safe to repeat even for POST.
            retryable = (status == 429 or (status in RETRY_STATUSES and method == "GET")
                         or (status == 503 and retry_post_503))
            if retryable and attempt + 1 < retries:
                wait = self._retry_after(response)
                await asyncio.sleep(max(wait or 0, 2 ** attempt + random.random()))
                continue
            try:
                detail = response.json()
            except ValueError:
                detail = self._safe(response.text[:500])
            raise MarketappError(f"Marketapp HTTP {status}", status, detail)
        raise MarketappError("Marketapp retries exhausted")

    @staticmethod
    def _address(value: str) -> str:
        if not isinstance(value, str) or not _SAFE_ADDRESS.fullmatch(value):
            raise MarketappError("Invalid NFT address")
        return value

    # ------------------------------------------------------------------ catalogue
    async def rent_gifts(self, *, cursor: str | None = None, collection_address: str | None = None,
                         sort_by: str = "recently_touch", model: str | None = None, symbol: str | None = None,
                         backdrop: str | None = None, limit: int = 20) -> dict:
        if sort_by not in LISTING_SORTS:
            sort_by = "recently_touch"
        params = {"cursor": cursor, "collection_address": collection_address, "sort_by": sort_by,
                  "model": model, "symbol": symbol, "backdrop": backdrop, "limit": max(1, min(int(limit), 100))}
        key = tuple(sorted((k, str(v)) for k, v in params.items()))
        cached = self._listing_cache.get(key)
        if cached is not None:
            return cached
        data = await self._request("GET", "/v1/rent/gifts/", params=params)
        self._listing_cache.put(key, data)
        remember_listings(self.seen, data.get("items") or [], collection_address)
        return data

    async def rent_list(self, category: str, *, cursor: str | None = None, sort_by: str = "recently_touch",
                        limit: int = 20) -> dict:
        """Usernames / anonymous numbers for rent (same RentItem shape as gifts)."""
        path = {"username": "/v1/rent/usernames/", "number": "/v1/rent/numbers/"}[category]
        if sort_by not in LISTING_SORTS:
            sort_by = "recently_touch"
        params = {"cursor": cursor, "sort_by": sort_by, "limit": max(1, min(int(limit), 100))}
        key = (category,) + tuple(sorted((k, str(v)) for k, v in params.items()))
        cached = self._listing_cache.get(key)
        if cached is not None:
            return cached
        data = await self._request("GET", path, params=params)
        self._listing_cache.put(key, data)
        remember_listings(self.seen, data.get("items") or [], None, category)
        return data

    # ------------------------------------------------------------------ Fragment: Stars / Premium (free plan)
    async def stars_price(self, quantity: int) -> dict:
        return await self._request("POST", "/v1/fragment/stars/price/", json={"quantity": int(quantity)}, retries=2)

    async def stars_recipient(self, username: str) -> dict:
        return await self._request("POST", "/v1/fragment/stars/recipient/", json={"username": username}, retries=2)

    async def stars_buy(self, username: str, quantity: int) -> dict:
        return await self._request("POST", "/v1/fragment/stars/buy/",
                                   json={"username": username, "quantity": int(quantity), "currency": "GRAM"}, retries=1)

    async def premium_price(self) -> dict:
        return await self._request("POST", "/v1/fragment/premium/price/", retries=2)

    async def premium_recipient(self, username: str) -> dict:
        return await self._request("POST", "/v1/fragment/premium/recipient/", json={"username": username}, retries=2)

    async def premium_buy(self, username: str, months: int) -> dict:
        return await self._request("POST", "/v1/fragment/premium/buy/",
                                   json={"username": username, "months": int(months), "currency": "GRAM"}, retries=1)

    # ------------------------------------------------------------------ anonymous numbers
    async def toggle_login_code(self, nft_address: str, enabled: bool) -> dict:
        return await self._request("POST", f"/v1/rent/{self._address(nft_address)}/toggle-login-code/",
                                   json={"can_receive": 1 if enabled else 0}, retries=1)

    async def login_code(self, nft_address: str) -> dict:
        return await self._request("GET", f"/v1/rent/{self._address(nft_address)}/login-code/", retries=2)

    async def gift_collections(self) -> list[dict]:
        cached = self._collections_cache.get("all")
        if cached is not None:
            return cached
        data = await self._request("GET", "/v1/collections/gifts/")
        self._collections_cache.put("all", data)
        return data

    async def collection_attributes(self, collection_address: str) -> list[dict]:
        key = f"attr:{collection_address}"
        cached = self._collections_cache.get(key)
        if cached is not None:
            return cached
        data = await self._request("GET", f"/v1/collections/{self._address(collection_address)}/attributes/")
        attributes = data.get("attributes") if isinstance(data, dict) else None
        attributes = attributes if isinstance(attributes, list) else []
        self._collections_cache.put(key, attributes)
        return attributes

    async def nft_info(self, nft_address: str) -> dict:
        """PAID endpoint — only used when MARKETAPP_PAID_PLAN=true."""
        return await self._request("GET", f"/v1/nfts/{self._address(nft_address)}/")

    def cached_listing(self, nft_address: str, max_age: float = 1800) -> dict | None:
        return lookup_listing(self.seen, nft_address, max_age)

    # ------------------------------------------------------------------ Telegram display (no fragment.com)
    async def tg_connect(self, customer_id: str) -> dict:
        return await self._request("POST", "/v1/rent/tg/connect/", json={"customer_id": customer_id}, retries=3,
                                   retry_post_503=True)

    async def tg_status(self, customer_id: str) -> dict:
        return await self._request("GET", "/v1/rent/tg/status/", params={"customer_id": customer_id}, retries=1)

    async def tg_disconnect(self, customer_id: str) -> dict:
        return await self._request("POST", "/v1/rent/tg/disconnect/", json={"customer_id": customer_id}, retries=1)

    async def tg_display(self, nft_address: str, customer_id: str) -> dict:
        return await self._request("POST", f"/v1/rent/tg/{self._address(nft_address)}/display/",
                                   json={"customer_id": customer_id}, retries=2, retry_post_503=True)

    # ------------------------------------------------------------------ renting
    async def pay(self, nft_address: str, duration: int, price_per_day_nano: str, sale_during_rent: bool = False) -> dict:
        """Returns ``{"transaction": {"validUntil", "messages": [...]}}`` to sign with the token's wallet.
        ``price_per_day`` and ``sale_during_rent`` must equal the listing, otherwise Marketapp refuses the rent."""
        return await self._request("POST", f"/v1/rent/{self._address(nft_address)}/pay/",
                                   json={"duration": int(duration), "price_per_day": str(price_per_day_nano),
                                         "sale_during_rent": bool(sale_during_rent)})

    async def extend(self, nft_address: str, duration: int, price_per_day_nano: str) -> dict:
        return await self._request("POST", f"/v1/rent/{self._address(nft_address)}/extend/",
                                   json={"duration": int(duration), "price_per_day": str(price_per_day_nano)})

    async def tonconnect(self, nft_address: str, tonconnect_url: str) -> dict:
        """Connect the rental contract to Fragment using the link from the renter's Fragment session."""
        return await self._request("POST", f"/v1/rent/{self._address(nft_address)}/tonconnect/",
                                   json={"tonconnect_url": tonconnect_url}, retries=2)

    async def my_rented(self, cursor: str | None = None, limit: int = 100) -> dict:
        return await self._request("GET", "/v1/rent/my-rented/", params={"cursor": cursor, "limit": limit})

    async def rent_events(self, cursor: str | None = None, types: tuple[str, ...] = ("rented", "cancel"),
                          category: str = "gifts", limit: int = 100) -> dict:
        """Rent status feed, oldest first. An empty page returns the same cursor."""
        params = [("limit", str(max(1, min(limit, 100)))), ("category", category)] + [("type", t) for t in types]
        if cursor:
            params.append(("cursor", cursor))
        for attempt in range(3):
            await self._pace()
            try:
                response = await self._http.get("/v1/rent/events/", params=params)
            except httpx.TransportError as exc:
                if attempt == 2:
                    raise MarketappError("Marketapp network error") from exc
                await asyncio.sleep(2 ** attempt)
                continue
            if response.status_code == 200:
                return response.json()
            if response.status_code in (401, 403):
                raise MarketappAuthError("Marketapp authentication failed", response.status_code)
            if response.status_code in RETRY_STATUSES and attempt < 2:
                await asyncio.sleep(max(self._retry_after(response) or 0, 2 ** attempt))
                continue
            raise MarketappError(f"Marketapp HTTP {response.status_code}", response.status_code)
        raise MarketappError("Marketapp retries exhausted")

    async def find_rented(self, nft_address: str, canonical) -> dict | None:
        """Look for ``nft_address`` among the token wallet's active rentals (max 10 pages)."""
        cursor = None
        target = canonical(nft_address)
        for _ in range(10):
            page = await self.my_rented(cursor)
            for item in page.get("items") or []:
                try:
                    if canonical(item.get("nft_address", "")) == target:
                        return item
                except ValueError:
                    continue
            cursor = page.get("cursor")
            if not cursor:
                return None
        return None


# ---------------------------------------------------------------------------- listing cache
def _demo_tg_id(customer_id: str) -> int:
    """Demo: the confirmed Telegram account is the customer himself ("tg42" → 42)."""
    digits = "".join(ch for ch in str(customer_id) if ch.isdigit())
    return int(digits) if digits else 1


def remember_listings(store: dict, items: list, collection_address: str | None, category: str = "gift") -> None:
    now = time.monotonic()
    if len(store) > 20000:
        store.clear()
    for item in items:
        key = _canon(str(item.get("nft_address", "")))
        if not key:
            continue
        previous = store.get(key) or {}
        store[key] = {**item, "_seen": now, "_category": category,
                      "_collection": collection_address or previous.get("_collection") or ""}


def lookup_listing(store: dict, nft_address: str, max_age: float) -> dict | None:
    item = store.get(_canon(nft_address))
    if item and time.monotonic() - item["_seen"] <= max_age:
        return item
    return None


# ---------------------------------------------------------------------------- demo
# Collection (plural, as Marketapp names them), gift name, rent floor in TON/day — close to real market values.
_DEMO_COLLECTIONS = [
    ("Plush Pepes", "Plush Pepe", "1.19"), ("Scared Cats", "Scared Cat", "0.1"), ("Resistance Dogs", "Resistance Dog", "0.33"),
    ("Heart Lockets", "Heart Locket", "0.75"), ("Swiss Watches", "Swiss Watch", "0.03"), ("Durov's Caps", "Durov's Cap", "0.22"),
    ("Liberty Figures", "Liberty Figure", "0.01"), ("Faith Amulets", "Faith Amulet", "0.01"), ("Snoop Doggs", "Snoop Dogg", "0.01"),
    ("Vice Creams", "Vice Cream", "0.01"), ("Toy Bears", "Toy Bear", "0.02"),
]
_MODELS = ["Raphael", "Gold Rush", "Midnight", "Pixel", "Royal", "Neon"]
_BACKDROPS = ["Onyx Black", "Midnight Blue", "Pacific Green", "Ruby", "Caramel", "Ice Blue", "Lavender", "Emerald"]
_SYMBOLS = ["Crown", "Star", "Heart", "Key", "Comet", "Diamond", "Moon", "Flower"]


def _demo_address(index: int) -> str:
    from pytoniq_core import Address
    return Address((0, index.to_bytes(2, "big") * 16)).to_str()


class DemoMarketapp:
    """Offline stand-in used when DEMO_MODE=true (no token, no money moves)."""

    def __init__(self) -> None:
        self.items = []
        self.collections = []
        n = 0
        for c_index, (plural, singular, floor) in enumerate(_DEMO_COLLECTIONS):
            caddr = _demo_address(1000 + c_index)
            self.collections.append({"name": plural, "address": caddr,
                                     "extra_data": {"items": 3000 + c_index * 917, "rent_floor": floor,
                                                    "for_rent": 4 + (c_index * 37) % 300}})
            base = int(float(floor) * 10 ** 9)
            for k, factor in enumerate((1, 1.35, 2.1, 3.4)):
                n += 1
                number = 10 + (n * 389) % 9000
                self.items.append({
                    "nft_address": _demo_address(n), "nft_name": f"{singular} #{number}", "owner": _demo_address(5000),
                    "attributes": [{"trait_type": "Model", "value": _MODELS[(n + k) % len(_MODELS)]},
                                   {"trait_type": "Backdrop", "value": _BACKDROPS[n % len(_BACKDROPS)]},
                                   {"trait_type": "Symbol", "value": _SYMBOLS[(n * 3) % len(_SYMBOLS)]}],
                    "min_duration": 86400, "max_duration": (7, 14, 30, 60)[k] * 86400,
                    "price_per_day": str(max(10_000_000, int(base * factor))), "discount_per_day": 0,
                    "listed_at": 1_763_000_000 + n, "_collection": caddr, "_num": number})
        self.rented: dict[str, int] = {}
        self.seen: dict[str, dict] = {}
        self.tg: dict[str, int] = {}          # customer_id -> polls since connect (demo login flow)

    async def close(self) -> None:
        return None

    def cached_listing(self, nft_address: str, max_age: float = 1800) -> dict | None:
        found = lookup_listing(self.seen, nft_address, max_age)
        if found is None and (item := self._item(nft_address)) is not None:   # demo convenience
            found = {**item, "_seen": time.monotonic()}
        return found

    async def tg_connect(self, customer_id: str) -> dict:
        if self.tg.get(customer_id, 0) >= 2:
            return {"status": "ready", "telegram": {"id": _demo_tg_id(customer_id), "name": "Demo User", "username": "demo"}}
        self.tg[customer_id] = 0
        return {"status": "waiting", "link": "https://t.me/oauth?demo=1"}

    async def tg_status(self, customer_id: str) -> dict:
        self.tg[customer_id] = self.tg.get(customer_id, 0) + 1
        if self.tg[customer_id] >= 2:
            return {"status": "confirmed", "telegram": {"id": _demo_tg_id(customer_id), "name": "Demo User", "username": "demo"}}
        return {"status": "consumed"}

    async def tg_disconnect(self, customer_id: str) -> dict:
        self.tg.pop(customer_id, None)
        return {"status": "disconnected"}

    async def tg_display(self, nft_address: str, customer_id: str) -> dict:
        return {"status": "ok", "slug": "demo-1", "displayed": "Demo User", "message": "ok"}

    async def rent_gifts(self, *, cursor=None, collection_address=None, sort_by="recently_touch", limit=20,
                         model=None, symbol=None, backdrop=None, **_) -> dict:
        def ok(item):
            values = {a["trait_type"]: a["value"] for a in item["attributes"]}
            return ((not collection_address or item["_collection"] == collection_address)
                    and (not model or values.get("Model") == model) and (not symbol or values.get("Symbol") == symbol)
                    and (not backdrop or values.get("Backdrop") == backdrop))
        items = [i for i in self.items if ok(i) and i.get("_category", "gift") == "gift"]
        if sort_by in ("price_per_day", "min_price"):
            items.sort(key=lambda i: int(i["price_per_day"]))
        elif sort_by == "item_num_asc":
            items.sort(key=lambda i: i["_num"])
        elif sort_by == "item_num_desc":
            items.sort(key=lambda i: -i["_num"])
        else:
            items.sort(key=lambda i: -i["listed_at"])
        start = int(cursor or 0)
        page = items[start:start + limit]
        next_cursor = str(start + limit) if start + limit < len(items) else None
        out = [{k: v for k, v in i.items() if not k.startswith("_")} for i in page]
        for item, clean in zip(page, out):
            remember_listings(self.seen, [clean], item["_collection"])
        return {"cursor": next_cursor, "items": out}

    async def gift_collections(self) -> list[dict]:
        return self.collections

    async def collection_attributes(self, collection_address: str) -> list[dict]:
        items = [i for i in self.items if i["_collection"] == collection_address] or self.items
        out = []
        for trait in ("Model", "Backdrop", "Symbol"):
            counts: dict[str, int] = {}
            for item in items:
                for a in item["attributes"]:
                    if a["trait_type"] == trait:
                        counts[a["value"]] = counts.get(a["value"], 0) + 1
            pool = {"Model": _MODELS, "Backdrop": _BACKDROPS, "Symbol": _SYMBOLS}[trait]
            out.append({"trait_type": trait, "values": [{"value": v, "count": counts.get(v, 0) * 40 + 7} for v in pool]})
        return out

    def _item(self, nft_address: str):
        for item in self.items:
            if item["nft_address"] == nft_address or _canon(item["nft_address"]) == _canon(nft_address):
                return item
        return None

    async def nft_info(self, nft_address: str) -> dict:
        item = self._item(nft_address)
        if item is None:
            raise MarketappError("Marketapp HTTP 404", 404)
        details = {"price_per_day": item["price_per_day"], "min_duration": item["min_duration"],
                   "max_duration": item["max_duration"], "discount_pd": 0}
        status = "for_rent"
        if item["nft_address"] in self.rented:
            status = "rented"
            details.update({"end_time": self.rented[item["nft_address"]], "duration": 86400, "extend_duration": 0, "rented_by": None})
        return {"address": item["nft_address"], "name": item["nft_name"], "collection_address": item["_collection"],
                "status": status, "attributes": item["attributes"], "real_owner": item["owner"], "status_details": details}

    async def pay(self, nft_address: str, duration: int, price_per_day_nano: str, sale_during_rent: bool = False) -> dict:
        # Demo assumes Marketapp adds a 10% commission on top of the listing price.
        amount = int(int(price_per_day_nano) * (duration // 86400) * 1.10)
        return {"transaction": {"validUntil": int(time.time()) + 300,
                                "messages": [{"address": _demo_address(7777), "amount": str(amount), "payload": None}]}}

    async def extend(self, nft_address: str, duration: int, price_per_day_nano: str) -> dict:
        item = self._item(nft_address)
        if item and item["nft_address"] in self.rented:
            self.rented[item["nft_address"]] += int(duration)      # demo: applied immediately
        return await self.pay(nft_address, duration, price_per_day_nano)

    async def rent_events(self, cursor=None, types=("rented", "cancel"), category="gifts", limit=100) -> dict:
        return {"cursor": cursor or "demo-0", "items": []}

    def _demo_other(self, category: str) -> list[dict]:
        if not hasattr(self, "_others"):
            self._others = {}
        if category not in self._others:
            words = ["crypto", "gift", "rent", "tashkent", "star", "moon", "uzbek", "boss", "king", "shop", "nft", "ton"]
            items = []
            for k in range(24):
                if category == "username":
                    name = f"@{words[k % len(words)]}{'' if k < 12 else k}"
                else:
                    name = f"+888 0{k % 10}{(k * 7) % 10}{(k * 3) % 10} {1000 + k * 37:04d}"
                items.append({"nft_address": _demo_address(9000 + k + (0 if category == "username" else 100)),
                              "nft_name": name, "owner": _demo_address(5000), "attributes": [],
                              "min_duration": 86400, "max_duration": 30 * 86400,
                              "price_per_day": str((8 + k * 3) * 10_000_000), "discount_per_day": 0})
            self._others[category] = items
            for item in items:
                self.items.append({**item, "_collection": "", "_num": 0, "_category": category})
        return self._others[category]

    async def rent_list(self, category, *, cursor=None, sort_by="recently_touch", limit=20) -> dict:
        items = list(self._demo_other(category))
        if sort_by in ("price_per_day", "min_price"):
            items.sort(key=lambda i: int(i["price_per_day"]))
        start = int(cursor or 0)
        page = items[start:start + limit]
        remember_listings(self.seen, page, None, category)
        return {"items": page, "cursor": str(start + limit) if start + limit < len(items) else None}

    async def stars_price(self, quantity: int) -> dict:
        gram = round(int(quantity) * 0.0105, 4)
        return {"ton": gram, "gram": gram, "usd": round(int(quantity) * 0.015, 2)}

    async def stars_recipient(self, username: str) -> dict:
        if username.lower().startswith("nobody"):
            raise MarketappError("Marketapp HTTP 400", 400, {"detail": "not found"})
        return {"name": username.capitalize(), "photo": ""}

    premium_recipient = stars_recipient

    async def premium_price(self) -> dict:
        return {"months3": {"ton": 8.2, "gram": 8.2}, "months6": {"ton": 11.0, "gram": 11.0},
                "months12": {"ton": 19.9, "gram": 19.9}}

    async def _fragment_tx(self, gram: float) -> dict:
        return {"transaction": {"validUntil": int(time.time()) + 300,
                                "messages": [{"address": _demo_address(7778), "amount": str(int(gram * 1e9)), "payload": None}]}}

    async def stars_buy(self, username: str, quantity: int) -> dict:
        return await self._fragment_tx((await self.stars_price(quantity))["gram"])

    async def premium_buy(self, username: str, months: int) -> dict:
        return await self._fragment_tx((await self.premium_price())[f"months{int(months)}"]["gram"])

    async def toggle_login_code(self, nft_address: str, enabled: bool) -> dict:
        return {"ok": True}

    async def login_code(self, nft_address: str) -> dict:
        return {"code": "12345"}

    async def tonconnect(self, nft_address: str, tonconnect_url: str) -> dict:
        return {"status": "ok"}

    def _rented_item(self, address: str) -> dict:
        item = self._item(address)
        return {"nft_address": address, "nft_name": item["nft_name"] if item else "", "duration": 86400,
                "price_per_day": item["price_per_day"] if item else "0", "end_time": self.rented[address],
                "extend_duration": 30 * 86400}

    async def my_rented(self, cursor=None, limit=100) -> dict:
        return {"cursor": None, "items": [self._rented_item(a) for a in self.rented]}

    async def find_rented(self, nft_address: str, canonical) -> dict | None:
        item = self._item(nft_address)
        if item is None:
            return None
        address = item["nft_address"]
        if address not in self.rented:
            self.rented[address] = int(time.time()) + 86400
        return self._rented_item(address)


def _canon(value: str) -> str:
    from .ton import canonical_address
    try:
        return canonical_address(value)
    except ValueError:
        return value
