"""Telegram Stars and Premium for any @username, bought on Fragment through Marketapp and paid from the balance.

Flow: quote (so'm) → customer pays from his balance → Marketapp returns the transaction → the hot wallet signs it
(or, in TON Connect mode, the admin signs it in the admin panel) → done. Anything that fails before the money
leaves the wallet is refunded to the balance automatically.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import select, update

from . import wallet
from .context import AppContext
from .db import Purchase, PurchaseStatus as P, Session, aware, get_setting, utcnow
from .marketapp import MarketappError
from .pricing import RateUnavailable, pricing_config, round_up
from .ton import ton_text, transaction_total_nano

log = logging.getLogger(__name__)
NANO = Decimal(10) ** 9
USERNAME = re.compile(r"[A-Za-z0-9_]{4,32}")
STARS_MIN, STARS_MAX = 50, 1_000_000
PREMIUM_MONTHS = (3, 6, 12)
STARS_PACKS = (50, 100, 250, 500, 1000, 2500, 5000, 10000)


class PurchaseError(Exception):
    def __init__(self, code: str, status: int = 400, detail: str = "") -> None:
        super().__init__(code)
        self.code, self.status, self.detail = code, status, detail


_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float):
    item = _cache.get(key)
    return item[1] if item and time.monotonic() - item[0] < ttl else None


def _store(key: str, value):
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.monotonic(), value)
    return value


def clean_username(raw: str) -> str:
    name = (raw or "").strip()
    name = re.sub(r"^(https?://)?(t\.me/|telegram\.me/)", "", name, flags=re.I).lstrip("@").strip("/ ")
    if not USERNAME.fullmatch(name):
        raise PurchaseError("bad_username")
    return name


async def _markup(ctx: AppContext, kind: str) -> Decimal:
    key = f"{kind}_markup_percent"
    default = getattr(ctx.settings, key)
    async with Session() as session:
        raw = await get_setting(session, key, None)
    try:
        return Decimal(str(raw if raw not in (None, "") else default))
    except Exception:  # noqa: BLE001
        return Decimal(str(default))


async def _rate(ctx: AppContext):
    try:
        return await pricing_config(ctx.rates)
    except RateUnavailable:
        raise PurchaseError("rate_unavailable", 503) from None


def _gram(value) -> Decimal:
    if isinstance(value, dict):
        value = value.get("gram", value.get("ton"))
    try:
        number = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise PurchaseError("marketapp", 502, "bad price") from None
    if number <= 0:
        raise PurchaseError("marketapp", 502, "bad price")
    return number


def _uzs(gram: Decimal, config, markup: Decimal) -> int:
    return round_up(gram * config.rate_uzs_per_ton * (1 + markup / 100), config.round_to)


# ---------------------------------------------------------------------------- prices
async def stars_quote(ctx: AppContext, quantity: int) -> dict:
    quantity = int(quantity)
    if not STARS_MIN <= quantity <= STARS_MAX:
        raise PurchaseError("bad_quantity")
    gram = _cached(f"stars:{quantity}", 120)
    if gram is None:
        try:
            gram = _store(f"stars:{quantity}", _gram(await ctx.market.stars_price(quantity)))
        except MarketappError:
            raise PurchaseError("marketapp", 503) from None
    config = await _rate(ctx)
    price = _uzs(gram, config, await _markup(ctx, "stars"))
    return {"quantity": quantity, "price_uzs": price, "cost_nano": int((gram * NANO).to_integral_value(ROUND_CEILING)),
            "gram": str(gram.normalize()), "rate": str(config.rate_uzs_per_ton)}


async def stars_info(ctx: AppContext) -> dict:
    """Packages with prices (one Marketapp call for the per-star price, cached)."""
    per_star = _cached("stars:per", 600)
    if per_star is None:
        try:
            per_star = _store("stars:per", _gram(await ctx.market.stars_price(1000)) / 1000)
        except MarketappError:
            raise PurchaseError("marketapp", 503) from None
    config = await _rate(ctx)
    markup = await _markup(ctx, "stars")
    one = per_star * config.rate_uzs_per_ton * (1 + markup / 100)
    return {"per_star_uzs": str(one.quantize(Decimal("0.01"))), "min": STARS_MIN, "max": STARS_MAX,
            "packs": [{"quantity": q, "price_uzs": _uzs(per_star * q, config, markup)} for q in STARS_PACKS]}


async def premium_info(ctx: AppContext) -> dict:
    raw = _cached("premium", 600)
    if raw is None:
        try:
            raw = _store("premium", await ctx.market.premium_price())
        except MarketappError:
            raise PurchaseError("marketapp", 503) from None
    config = await _rate(ctx)
    markup = await _markup(ctx, "premium")
    plans = []
    for months in PREMIUM_MONTHS:
        gram = _gram((raw or {}).get(f"months{months}"))
        plans.append({"months": months, "price_uzs": _uzs(gram, config, markup),
                      "cost_nano": int((gram * NANO).to_integral_value(ROUND_CEILING)), "gram": str(gram.normalize())})
    return {"plans": plans}


async def recipient(ctx: AppContext, kind: str, raw_username: str) -> dict:
    username = clean_username(raw_username)
    key = f"rcp:{kind}:{username.lower()}"
    found = _cached(key, 300)
    if found is None:
        try:
            method = ctx.market.premium_recipient if kind == "premium" else ctx.market.stars_recipient
            response = await method(username)
        except MarketappError as exc:
            if exc.status in (400, 404, 422):
                raise PurchaseError("recipient_not_found", 404) from None
            raise PurchaseError("marketapp", 503) from None
        found = _store(key, {"username": username, "name": str((response or {}).get("name") or username),
                             "photo": str((response or {}).get("photo") or "")})
    return found


# ---------------------------------------------------------------------------- buying
def purchase_view(p: Purchase, admin: bool = False) -> dict:
    data = {"id": p.id, "kind": p.kind, "recipient": p.recipient, "recipient_name": p.recipient_name,
            "quantity": p.quantity, "price_uzs": int(p.price_uzs), "status": p.status,
            "created_at": aware(p.created_at).isoformat()}
    if admin:
        data.update({"user_id": p.user_id, "cost_ton": ton_text(int(p.cost_nano or 0)), "error": p.error})
    return data


async def _set(purchase_id: int, allowed, to: str, **values) -> Purchase:
    async with Session() as session:
        result = await session.execute(update(Purchase).where(Purchase.id == purchase_id,
                                                              Purchase.status.in_(set(allowed)))
                                       .values(status=to, updated_at=utcnow(), **values))
        if result.rowcount != 1:
            await session.rollback()
            current = await session.get(Purchase, purchase_id)
            raise PurchaseError("bad_state", 409, current.status if current else "missing")
        await session.commit()
        return await session.get(Purchase, purchase_id)


async def get_purchase(purchase_id: int, user_id: int | None = None) -> Purchase:
    async with Session() as session:
        p = await session.get(Purchase, purchase_id)
    if p is None or (user_id is not None and p.user_id != user_id):
        raise PurchaseError("not_found", 404)
    return p


async def buy(ctx: AppContext, user_id: int, kind: str, username: str, quantity: int) -> Purchase:
    if kind not in ("stars", "premium"):
        raise PurchaseError("bad_quantity")
    if kind == "premium" and int(quantity) not in PREMIUM_MONTHS:
        raise PurchaseError("bad_quantity")
    who = await recipient(ctx, kind, username)
    if kind == "stars":
        quote = await stars_quote(ctx, quantity)
        price, cost = quote["price_uzs"], quote["cost_nano"]
    else:
        plan = next(p for p in (await premium_info(ctx))["plans"] if p["months"] == int(quantity))
        price, cost = plan["price_uzs"], plan["cost_nano"]
    config = await _rate(ctx)
    async with Session() as session:
        purchase = Purchase(user_id=user_id, kind=kind, recipient=who["username"], recipient_name=who["name"][:128],
                            quantity=int(quantity), price_uzs=price, cost_nano=str(cost),
                            rate_uzs_per_ton=str(config.rate_uzs_per_ton), status=P.PENDING)
        session.add(purchase)
        await session.commit()
        await session.refresh(purchase)
    try:
        await wallet.debit(user_id, price, "purchase", purchase.id, f"{kind} {quantity} @{who['username']}")
    except wallet.WalletError as exc:
        async with Session() as session:              # nothing was paid: forget the attempt
            row = await session.get(Purchase, purchase.id)
            if row is not None:
                await session.delete(row)
                await session.commit()
        raise PurchaseError(exc.code, exc.status) from None
    await wallet.record_spend(ctx, user_id, price, "purchase", purchase.id)
    return await process(ctx, purchase.id)


async def _refund(ctx: AppContext, p: Purchase, error: str) -> Purchase:
    p = await _set(p.id, {P.PENDING, P.SIGNING, P.FAILED}, P.REFUNDED, error=error[:256])
    await wallet.credit(p.user_id, int(p.price_uzs), "refund", p.id, f"{p.kind} #{p.id}")
    await _tell_user(ctx, p, "purchase_refunded")
    return p


async def _tell_user(ctx: AppContext, p: Purchase, key: str) -> None:
    notify = getattr(ctx.notifier, "user_text", None)
    if notify:
        what = f"{p.quantity} ⭐" if p.kind == "stars" else f"Premium {p.quantity}"
        await notify(p.user_id, key, what=what, to=p.recipient, amount=int(p.price_uzs), tab="stars")


async def _tell_admin(ctx: AppContext, p: Purchase, key: str, error: str = "") -> None:
    notify = getattr(ctx.notifier, "admin_purchase", None)
    if notify:
        await notify(p, key, error=error)


async def process(ctx: AppContext, purchase_id: int) -> Purchase:
    """PENDING → get the Fragment transaction → sign (hot) or hand to the admin (TON Connect)."""
    p = await get_purchase(purchase_id)
    if p.status != P.PENDING:
        return p
    try:
        if p.kind == "stars":
            response = await ctx.market.stars_buy(p.recipient, p.quantity)
        else:
            response = await ctx.market.premium_buy(p.recipient, p.quantity)
    except MarketappError as exc:
        detail = json.dumps(exc.detail)[:200] if exc.detail else str(exc)
        log.warning("Fragment %s buy failed for purchase %s: %s", p.kind, p.id, detail)
        if exc.status in (None, 429, 500, 502, 503, 504):
            p = await _set(p.id, {P.PENDING}, P.FAILED, error=f"marketapp: {detail}")
            await _tell_admin(ctx, p, "purchase_failed", f"marketapp: {detail}")
            return p
        return await _refund(ctx, p, f"marketapp: {detail}")
    tx = (response or {}).get("transaction") if isinstance(response, dict) else None
    try:
        total = transaction_total_nano(tx)
    except (ValueError, TypeError):
        return await _refund(ctx, p, "no transaction")
    limit = Decimal(int(p.cost_nano or 0)) * (1 + Decimal(str(ctx.settings.max_tx_overpay_percent)) / 100) \
        + Decimal(str(ctx.settings.max_tx_fee_ton)) * NANO
    if total > limit:
        return await _refund(ctx, p, f"price_changed: {ton_text(total)} > {ton_text(int(p.cost_nano))}")
    if ctx.hot_wallet is None:
        p = await _set(p.id, {P.PENDING}, P.SIGNING, tx_json=json.dumps(tx))
        await _tell_admin(ctx, p, "purchase_sign")
        return p
    p = await _set(p.id, {P.PENDING}, P.SENT, tx_json=json.dumps(tx), sent_at=utcnow())
    try:
        boc = await ctx.hot_wallet.send(tx)
    except Exception as exc:  # noqa: BLE001 — not broadcast: nothing left the wallet
        log.error("Hot wallet failed for purchase %s: %s", p.id, exc)
        p = await _set(p.id, {P.SENT}, P.FAILED, error=f"hot wallet: {exc}"[:256])
        await _tell_admin(ctx, p, "purchase_failed", f"hot wallet: {exc}")
        return p
    values = {"tx_boc": boc[:20000], "seqno_before": int(getattr(ctx.hot_wallet, "last_seqno", -1))}
    if getattr(ctx.hot_wallet, "last_confirmed", False):
        return await _done(ctx, p.id, **values)
    async with Session() as session:
        await session.execute(update(Purchase).where(Purchase.id == p.id).values(**values))
        await session.commit()
    return await get_purchase(p.id)


async def _done(ctx: AppContext, purchase_id: int, **values) -> Purchase:
    p = await _set(purchase_id, {P.SENT, P.SIGNING}, P.DONE, **values)
    await _tell_user(ctx, p, "purchase_done")
    return p


# ---------------------------------------------------------------------------- admin / TON Connect
async def prepare_tx(purchase_id: int) -> dict:
    p = await get_purchase(purchase_id)
    if p.status != P.SIGNING or not p.tx_json:
        raise PurchaseError("bad_state", 409, p.status)
    tx = json.loads(p.tx_json)
    return {"kind": "purchase", "transaction": tx, "ton": ton_text(transaction_total_nano(tx)), "purchase_id": p.id}


async def tx_sent(ctx: AppContext, purchase_id: int, boc: str) -> Purchase:
    return await _done(ctx, purchase_id, tx_boc=(boc or "")[:20000], sent_at=utcnow())


async def admin_retry(ctx: AppContext, purchase_id: int) -> Purchase:
    await _set(purchase_id, {P.FAILED}, P.PENDING, error="")
    return await process(ctx, purchase_id)


async def admin_refund(ctx: AppContext, purchase_id: int) -> Purchase:
    return await _refund(ctx, await get_purchase(purchase_id), "refunded by admin")


async def admin_done(ctx: AppContext, purchase_id: int) -> Purchase:
    """The admin checked on Fragment that it arrived (e.g. after a timeout)."""
    await _set(purchase_id, {P.FAILED}, P.SENT)
    return await _done(ctx, purchase_id)


async def list_purchases(user_id: int | None = None, statuses=None, limit: int = 50) -> list[Purchase]:
    async with Session() as session:
        query = select(Purchase).order_by(Purchase.id.desc()).limit(limit)
        if user_id is not None:
            query = query.where(Purchase.user_id == user_id)
        if statuses:
            query = query.where(Purchase.status.in_(set(statuses)))
        return list((await session.execute(query)).scalars())


async def worker_tick(ctx: AppContext) -> None:
    now = utcnow()
    for p in await list_purchases(statuses={P.SENT, P.PENDING}, limit=100):
        age = now - (aware(p.updated_at) or now)
        if p.status == P.PENDING and age > timedelta(minutes=2):
            try:                                   # the process died between payment and Marketapp
                await process(ctx, p.id)
            except Exception:  # noqa: BLE001
                log.exception("Purchase %s retry failed", p.id)
            continue
        if p.status != P.SENT:
            continue
        if ctx.hot_wallet is not None and p.seqno_before >= 0:
            try:
                if await ctx.hot_wallet.seqno() > p.seqno_before:
                    await _done(ctx, p.id)
                    continue
            except Exception:  # noqa: BLE001
                pass
        if age > timedelta(minutes=ctx.settings.purchase_confirm_minutes):
            try:
                p = await _set(p.id, {P.SENT}, P.FAILED, error="not confirmed — check on Fragment")
                await _tell_admin(ctx, p, "purchase_failed", "not confirmed — check on Fragment")
            except PurchaseError:
                pass
