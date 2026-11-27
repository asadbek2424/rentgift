"""Exchange rate, Marketapp fee, admin profit and quotes. All money maths uses Decimal.

Customer price (same model as other rent shops: rent + one service fee):

    base_ton      = listing price_per_day (what Marketapp shows)
    cost_ton      = base_ton × (1 + marketapp_fee%)          ← what the admin wallet really pays
    per_day_uzs   = round_up(cost_ton × rate × (1 + markup%), UZS_ROUND_TO)
    rent_uzs      = per_day_uzs × days                       ← "Ijara: 450 × 3 kun"
    service_fee   = SERVICE_FEE_TON × rate  (or a fixed SERVICE_FEE_UZS when no TON fee is set)
    total         = rent_uzs + service_fee                   ← "Xizmat haqi", once per order
The rate follows TON/USD live (see RateProvider), so every price moves with the market automatically.
Rentals shorter than MIN_RENT_DAYS are not offered.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, replace
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

import httpx

from .config import get_settings
from .db import Session, get_setting
from .ton import NANO, ton_text

log = logging.getLogger(__name__)
DAY = 86400


class RateUnavailable(RuntimeError):
    pass


class RateProvider:
    """TON/USD from CoinGecko (refreshed every minute) × USD/UZS from the Central Bank of Uzbekistan (hourly;
    CBU publishes once a day). Prices therefore follow the TON market within ~1 minute. CoinGecko's free API
    does not allow per-second polling, and a minute is far below how long a customer looks at a price."""

    TTL = 60            # TON/USD
    USD_TTL = 3600      # USD/UZS

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._http = httpx.AsyncClient(timeout=15, transport=transport)
        self._value: tuple[Decimal, Decimal, Decimal] | None = None   # (uzs per ton, usd per ton, uzs per usd)
        self._at = 0.0
        self._usd: tuple[Decimal, float] | None = None                # (uzs per usd, fetched at)
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self._http.aclose()

    async def _fetch(self) -> tuple[Decimal, Decimal, Decimal]:
        ton = await self._http.get("https://api.coingecko.com/api/v3/simple/price",
                                   params={"ids": "the-open-network", "vs_currencies": "usd"})
        ton.raise_for_status()
        ton_usd = Decimal(str(ton.json()["the-open-network"]["usd"]))
        if self._usd is not None and time.monotonic() - self._usd[1] < self.USD_TTL:
            usd_uzs = self._usd[0]
        else:
            cbu = await self._http.get("https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/")
            cbu.raise_for_status()
            usd_uzs = Decimal(str(cbu.json()[0]["Rate"]))
            self._usd = (usd_uzs, time.monotonic())
        if ton_usd <= 0 or usd_uzs <= 0:
            raise ValueError("non-positive rate")
        return ton_usd * usd_uzs, ton_usd, usd_uzs

    async def rates(self) -> tuple[Decimal, Decimal, Decimal]:
        async with self._lock:
            if self._value is not None and time.monotonic() - self._at < self.TTL:
                return self._value
            try:
                self._value = await self._fetch()
                self._at = time.monotonic()
            except Exception as exc:  # network/provider problem: keep the last good value
                log.warning("Exchange rate refresh failed: %s", type(exc).__name__)
                if self._value is None:
                    raise RateUnavailable("Exchange rate is unavailable") from None
            return self._value

    async def auto_rate(self) -> Decimal:
        return (await self.rates())[0]

    async def usd_rate(self) -> Decimal | None:
        """So'm per dollar (CBU), hourly; last good value on failure, None if never known."""
        if self._usd is not None and time.monotonic() - self._usd[1] < self.USD_TTL:
            return self._usd[0]
        if time.monotonic() - getattr(self, "_usd_failed", -1e9) < 60:      # don't hammer CBU while it is down
            return self._usd[0] if self._usd else (self._value[2] if self._value else None)
        try:
            cbu = await self._http.get("https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/")
            cbu.raise_for_status()
            value = Decimal(str(cbu.json()[0]["Rate"]))
            if value <= 0:
                raise ValueError("non-positive rate")
            self._usd = (value, time.monotonic())
        except Exception as exc:  # noqa: BLE001
            log.warning("USD rate refresh failed: %s", type(exc).__name__)
            self._usd_failed = time.monotonic()
        return self._usd[0] if self._usd else (self._value[2] if self._value else None)

    def cached_usd(self) -> tuple[Decimal, Decimal] | None:
        """(usd per ton, uzs per usd) if known — used only for display."""
        return (self._value[1], self._value[2]) if self._value else None


@dataclass(frozen=True)
class PricingConfig:
    rate_uzs_per_ton: Decimal
    fee_percent: Decimal          # Marketapp commission on top of the listing price
    markup_percent: Decimal       # admin profit, %
    fixed_per_day: Decimal        # admin profit, so'm per rental day
    round_to: int
    rate_mode: str
    uzs_per_usd: Decimal | None = None
    service_fee: Decimal = Decimal(0)     # so'm per order ("Xizmat haqi")
    min_days: int = 1                     # shortest rental the shop offers
    category_markup: tuple = ()           # (("username", Decimal), ("number", Decimal)) — own % where set

    def for_category(self, category: str | None) -> "PricingConfig":
        """Same config with the markup of usernames / anonymous numbers when the admin set one."""
        own = dict(self.category_markup).get(category or "gift")
        return replace(self, markup_percent=own) if own is not None else self

    def cost_nano(self, base_nano: int) -> int:
        return int((Decimal(base_nano) * (1 + self.fee_percent / 100)).to_integral_value(rounding=ROUND_CEILING))

    def cost_uzs(self, base_nano: int) -> Decimal:
        return Decimal(self.cost_nano(base_nano)) / NANO * self.rate_uzs_per_ton

    def price_uzs(self, base_nano: int, days: int = 1) -> Decimal:
        per_day = self.cost_uzs(base_nano) * (1 + self.markup_percent / 100) + self.fixed_per_day
        return per_day * days


async def _num(session, key: str, default) -> Decimal:
    raw = await get_setting(session, key, str(default))
    try:
        return Decimal(raw or "0")
    except Exception:
        return Decimal(str(default))


async def pricing_config(rates: RateProvider) -> PricingConfig:
    settings = get_settings()
    async with Session() as session:
        mode = await get_setting(session, "rate_mode", settings.rate_mode)
        manual = await _num(session, "manual_rate", settings.manual_rate_uzs_per_ton)
        markup = await _num(session, "markup_percent", settings.markup_percent)
        fee = await _num(session, "fee_percent", settings.marketapp_fee_percent)
        fixed = Decimal(0)   # the fixed "so'm per day" add-on was retired: profit is the % markup + service fee
        round_to = int(await _num(session, "round_to", settings.uzs_round_to))
        service_fee = await _num(session, "service_fee_uzs", settings.service_fee_uzs)
        service_fee_ton = await _num(session, "service_fee_ton", settings.service_fee_ton)
        min_days = int(await _num(session, "min_rent_days", settings.min_rent_days))
        category_markup = []
        for cat in ("username", "number"):
            raw = await get_setting(session, f"{cat}_markup_percent", None)
            raw = raw if raw not in (None, "") else getattr(settings, f"{cat}_markup_percent")
            try:
                if raw not in (None, ""):
                    category_markup.append((cat, Decimal(str(raw))))
            except Exception:  # noqa: BLE001
                pass
    uzs_per_usd = None
    if mode == "manual":
        if manual <= 0:
            raise RateUnavailable("Manual rate is not configured")
        rate = manual
        cached = rates.cached_usd()
        uzs_per_usd = cached[1] if cached else None
    else:
        try:
            rate, _, uzs_per_usd = await rates.rates()
        except RateUnavailable:
            if manual > 0:
                rate = manual
            else:
                raise
    if service_fee_ton > 0:   # fee defined in TON follows the live rate, e.g. 0.01 TON ≈ 600 so'm today
        service_fee = Decimal(round_up(service_fee_ton * rate, max(1, round_to)))
    return PricingConfig(rate_uzs_per_ton=rate, fee_percent=fee, markup_percent=markup, fixed_per_day=fixed,
                         round_to=max(1, round_to), rate_mode=mode, uzs_per_usd=uzs_per_usd,
                         service_fee=max(Decimal(0), service_fee), min_days=max(1, min_days),
                         category_markup=tuple(category_markup))


def round_up(value: Decimal, step: int) -> int:
    return int((value / step).to_integral_value(rounding=ROUND_CEILING) * step)


def uzs_for_nano(nano: int, config: PricingConfig) -> int:
    """Customer price in so'm for ``nano`` of listing price (one day)."""
    return round_up(config.price_uzs(int(nano)), config.round_to)


@dataclass(frozen=True)
class Quote:
    days: int
    price_per_day_nano: int
    ton_total_nano: int     # listing price × days (no fee)
    cost_nano: int          # what the admin wallet is expected to pay (with fee)
    cost_uzs: int
    amount_uzs: int         # what the customer pays (rent + service fee)
    per_day_uzs: int
    rate: Decimal
    markup: Decimal
    fee: Decimal
    rent_uzs: int = 0       # per_day_uzs × days
    service_fee_uzs: int = 0

    @property
    def profit_uzs(self) -> int:
        return self.amount_uzs - self.cost_uzs

    def as_dict(self) -> dict:
        return {"days": self.days, "price_per_day_ton": ton_text(self.price_per_day_nano),
                "ton_total": ton_text(self.cost_nano), "amount_uzs": self.amount_uzs, "per_day_uzs": self.per_day_uzs,
                "rent_uzs": self.rent_uzs, "service_fee_uzs": self.service_fee_uzs}


def make_quote(price_per_day_nano: int, days: int, config: PricingConfig) -> Quote:
    base_total = int(price_per_day_nano) * int(days)
    cost_nano = config.cost_nano(base_total)
    cost_uzs = int((Decimal(cost_nano) / NANO * config.rate_uzs_per_ton).to_integral_value(rounding=ROUND_CEILING))
    per_day = uzs_for_nano(int(price_per_day_nano), config)
    rent = per_day * int(days)
    fee = int(config.service_fee)
    return Quote(days=days, price_per_day_nano=int(price_per_day_nano), ton_total_nano=base_total, cost_nano=cost_nano,
                 cost_uzs=cost_uzs, amount_uzs=rent + fee, per_day_uzs=per_day,
                 rate=config.rate_uzs_per_ton, markup=config.markup_percent, fee=config.fee_percent,
                 rent_uzs=rent, service_fee_uzs=fee)


def rentable_days(min_seconds: int, max_seconds: int, config: PricingConfig | None) -> tuple[int, int]:
    """Listing limits narrowed by the shop's minimum (e.g. at least 3 days). low > high → not offered."""
    low, high = duration_days(min_seconds, max_seconds)
    return (max(low, config.min_days) if config else low), high


def uzs_to_base_nano(uzs: Decimal, config: PricingConfig) -> int:
    """Inverse of the per-day formula (for the price filter): customer so'm/day → listing nanoTON/day."""
    cost_uzs = (Decimal(uzs) - config.fixed_per_day) / (1 + config.markup_percent / 100)
    if cost_uzs <= 0:
        return 0
    ton = cost_uzs / config.rate_uzs_per_ton / (1 + config.fee_percent / 100)
    return int((ton * NANO).to_integral_value(rounding=ROUND_FLOOR))


# ---------------------------------------------------------------------------- gift helpers
def attr(attributes: list, name: str) -> str:
    for item in attributes or []:
        if isinstance(item, dict) and str(item.get("trait_type", "")).lower() == name.lower():
            return str(item.get("value", ""))
    return ""


def split_name(name: str) -> tuple[str, str]:
    collection, _, number = (name or "").rpartition(" #")
    return (collection, number) if collection else (name or "", "")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def image_url(name: str) -> str:
    """Fragment artwork: ``https://nft.fragment.com/gift/<slug>-<number>.webp``."""
    collection, number = split_name(name)
    if not slug(collection) or not number.isdigit():
        return ""
    return f"https://nft.fragment.com/gift/{slug(collection)}-{number}.webp"


def _singular(word: str) -> list[str]:
    lower = word.lower()
    out = []
    if lower.endswith(("ches", "shes", "sses", "xes", "zes")):
        out.append(word[:-2])
    if lower.endswith("ies"):
        out.append(word[:-3] + "y")
    if lower.endswith("s") and not lower.endswith("ss"):
        out.append(word[:-1])
    return out


def collection_images(name: str) -> list[str]:
    """Candidate artwork for a collection (gift #1 of it). Marketapp collection names are plural
    ("Swiss Watches") while gift names are singular ("Swiss Watch"), so try a few forms."""
    words = (name or "").split()
    if not words:
        return []
    forms = [" ".join(words[:-1] + [w]) for w in _singular(words[-1])] + [name]
    seen, urls = set(), []
    for form in forms:
        key = slug(form)
        if key and key not in seen:
            seen.add(key)
            urls.append(f"https://nft.fragment.com/gift/{key}-1.webp")
    return urls


def floor_nano(value) -> int | None:
    """Collection ``rent_floor``: decimal TON ("1.19") or an integer nano string."""
    if value in (None, ""):
        return None
    try:
        text = str(value).strip()
        if text.isdigit() and len(text) >= 7:
            return int(text)
        return int((Decimal(text) * NANO).to_integral_value(rounding=ROUND_CEILING))
    except Exception:
        return None


def duration_days(min_seconds: int, max_seconds: int) -> tuple[int, int]:
    low = max(1, int((Decimal(int(min_seconds)) / DAY).to_integral_value(rounding=ROUND_CEILING)))
    high = int((Decimal(int(max_seconds)) / DAY).to_integral_value(rounding=ROUND_FLOOR))
    return low, high


def _discount(item: dict) -> float:
    """Owner's Marketapp discount, % per day (0–50, 0.1 steps) → shown as a "-0.3%" ribbon."""
    try:
        value = float(item.get("discount_per_day") or item.get("discount_pd") or 0)
    except (TypeError, ValueError):
        return 0
    return round(value, 1) if 0 < value <= 50 else 0


def gift_card(item: dict, config: PricingConfig | None) -> dict:
    """Shape a Marketapp RentItem for the Mini App."""
    name = str(item.get("nft_name") or item.get("name") or "")
    collection, number = split_name(name)
    attributes = item.get("attributes") or []
    ppd = int(item.get("price_per_day") or 0)
    min_days, max_days = rentable_days(item.get("min_duration") or DAY, item.get("max_duration") or DAY, config)
    return {
        "address": item.get("nft_address") or item.get("address"),
        "name": name, "collection": collection, "number": number, "image": image_url(name),
        "model": attr(attributes, "model"), "backdrop": attr(attributes, "backdrop"), "symbol": attr(attributes, "symbol"),
        "price_per_day_ton": ton_text(config.cost_nano(ppd) if config else ppd),
        "per_day_uzs": uzs_for_nano(ppd, config) if config else None,
        "min_days": min_days, "max_days": max_days, "rentable": min_days <= max_days,
        "service_fee_uzs": int(config.service_fee) if config else None,
        "discount": _discount(item),
        "sellable": bool(item.get("is_sellable_during_rent")),
    }
