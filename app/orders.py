"""Order lifecycle (the business logic).

    awaiting_payment ──receipt──▶ payment_review ──admin ✅──▶ paid ──admin signs /pay/ tx──▶ renting
          ▲  │                         │ admin ❌                                              │ chain confirms
          │  └──timeout/cancel──▶ cancelled ◀── admin                                         ▼
          └─────────────────────────────┘                                              awaiting_link
                                                                                              │ user sends Fragment link
    active ◀── connect ok ── connecting ◀────────────────────────────────────────────────────┘
      │  ▲                      │ Marketapp asks for a signature
      │  └── admin signs ── connect_signing
      └── end_time ──▶ expired                    any problem ──▶ failed ──▶ (retry | refunded)

Every status change is a conditional UPDATE (``WHERE status IN (...)``) so two admins pressing the
same button, or the worker racing a user, can never process an order twice.
"""

from __future__ import annotations

import asyncio
import json
import time
import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, update

from .context import AppContext
from .db import (Order, OrderEvent, OrderStatus as S, Session, User, aware, count_open_orders, get_setting,
                 set_setting, utcnow)
from .marketapp import MarketappAuthError, MarketappError
from .pricing import DAY, RateUnavailable, attr, duration_days, image_url, make_quote, pricing_config, rentable_days
from .ton import canonical_address, same_address, ton_text, transaction_total_nano, validate_tonconnect_url

log = logging.getLogger(__name__)
_locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)


class ServiceError(Exception):
    """``code`` matches a key in locales ``error.*``."""

    def __init__(self, code: str, status: int = 400, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------------------- helpers
async def _transition(order_id: int, allowed: set | frozenset, to: str, actor: str, note: str = "", **values) -> Order:
    async with Session() as session:
        current = await session.get(Order, order_id)
        if current is None:
            raise ServiceError("order_not_found", 404)
        if current.status not in allowed:
            raise ServiceError("bad_state", 409, current.status)
        result = await session.execute(
            update(Order).where(Order.id == order_id, Order.status == current.status)
            .values(status=to, updated_at=utcnow(), **values))
        if result.rowcount != 1:
            await session.rollback()
            raise ServiceError("bad_state", 409, "concurrent")
        session.add(OrderEvent(order_id=order_id, from_status=current.status, to_status=to, actor=actor, note=note[:500]))
        await session.commit()
        return await session.get(Order, order_id, populate_existing=True)


async def _update(order_id: int, **values) -> Order:
    async with Session() as session:
        await session.execute(update(Order).where(Order.id == order_id).values(updated_at=utcnow(), **values))
        await session.commit()
        return await session.get(Order, order_id, populate_existing=True)


async def get_order(order_id: int, user_id: int | None = None) -> Order:
    async with Session() as session:
        order = await session.get(Order, order_id)
    if order is None or (user_id is not None and order.user_id != user_id):
        raise ServiceError("order_not_found", 404)
    return order


def _listing_from_info(info: dict) -> dict:
    """Return the for-rent terms from ``/v1/nfts/{address}/`` or raise gift_unavailable."""
    status = info.get("status")
    details = info.get("status_details") or {}
    if status == "for_sale_and_rent":
        details = details.get("for_rent") or {}
    elif status != "for_rent":
        raise ServiceError("gift_unavailable", 409)
    if not str(details.get("price_per_day", "")).isdigit():
        raise ServiceError("gift_unavailable", 409)
    return details


def _check_tx(ctx: AppContext, order: Order, tx: dict) -> int:
    """Refuse to sign when Marketapp asks noticeably more than the quote incl. its fee (+ network fees)."""
    total = transaction_total_nano(tx)
    expected = int(order.cost_nano or 0) or int(order.ton_total_nano)
    limit = Decimal(expected) * (1 + Decimal(str(ctx.settings.max_tx_overpay_percent)) / 100) \
        + Decimal(str(ctx.settings.max_tx_fee_ton)) * 10 ** 9
    if total > limit:
        raise ServiceError("price_changed", 409,
                           f"tx {ton_text(total)} TON > {ton_text(expected)} TON (fee {observed_fee(order, total)}%)")
    return total


def observed_fee(order: Order, total_nano: int) -> str:
    """Real Marketapp commission seen in a /pay/ transaction, in % of the listing price."""
    base = int(order.ton_total_nano or 0)
    if base <= 0:
        return "?"
    return str(((Decimal(total_nano) / base - 1) * 100).quantize(Decimal("0.01")))


def order_view(order: Order, *, admin: bool = False, settings=None) -> dict:
    data = {
        "id": order.id, "status": order.status, "nft_address": order.nft_address, "nft_name": order.nft_name,
        "image": order.image_url, "attributes": json.loads(order.attributes_json or "[]"), "days": order.days,
        "amount_uzs": order.amount_uzs, "ton_total": ton_text(int(order.cost_nano or 0) or order.ton_total_nano),
        "price_per_day_ton": ton_text(order.price_per_day_nano),
        "created_at": aware(order.created_at).isoformat(),
        "payment_expires_at": aware(order.payment_expires_at).isoformat() if order.payment_expires_at else None,
        "end_time": aware(order.end_time).isoformat() if order.end_time else None,
        "has_receipt": bool(order.receipt_file_id), "error": order.error,
        "kind": order.kind or "rent", "parent_id": order.parent_id,
        "category": order.category or "gift", "paid_by": order.paid_by or "card",
        "service_fee_uzs": order.service_fee_uzs or 0,
        "unique_add_uzs": order.unique_add_uzs or 0,
        "rent_uzs": order.amount_uzs - (order.service_fee_uzs or 0) - (order.unique_add_uzs or 0),
        "per_day_uzs": (order.amount_uzs - (order.service_fee_uzs or 0) - (order.unique_add_uzs or 0)) // max(1, order.days),
    }
    if admin:
        data.update({"user_id": order.user_id, "rate": order.rate_uzs_per_ton, "markup": order.markup_percent,
                     "fee": order.fee_percent, "cost_uzs": order.cost_uzs, "profit_uzs": order.profit_uzs,
                     "base_ton": ton_text(order.ton_total_nano),
                     "actual_ton": ton_text(order.actual_cost_nano) if order.actual_cost_nano else None,
                     "pending_tx_kind": order.pending_tx_kind, "admin_note": order.admin_note,
                     "connect_response": order.connect_response[:500],
                     "user": {"id": order.user.id, "name": f"{order.user.first_name} {order.user.last_name}".strip(),
                              "username": order.user.username} if "user" in order.__dict__ and order.user else None})
    return data


# ---------------------------------------------------------------------------- unique payment amounts
async def unique_amount(session, base_uzs: int, max_add: int) -> int:
    """Pick +1..max_add so'm so that no other open order waits for the same total.

    The bank notice (CardXabar) only says "+3 093 so'm"; a unique amount is how we know which order paid."""
    if max_add <= 0:
        return 0
    from .wallet import taken_amounts
    taken = await taken_amounts(session)
    free = [add for add in range(1, max_add + 1) if base_uzs + add not in taken]
    if not free:
        raise ServiceError("too_many_orders", 429)
    return secrets.choice(free)


# ---------------------------------------------------------------------------- listings
async def _listing(ctx: AppContext, nft_address: str) -> dict:
    """Current rent terms of a gift.

    The free Marketapp plan has no per-NFT endpoint (``/v1/nfts/{a}/`` is paid), so the terms come from the
    catalogue pages this server already loaded (``/v1/rent/gifts/``). Marketapp itself re-checks the price and
    ``sale_during_rent`` when ``/pay/`` is called, so a stale cache can never make the admin overpay.
    """
    try:
        canonical_address(nft_address)
    except ValueError:
        raise ServiceError("gift_unavailable", 404) from None
    item = ctx.market.cached_listing(nft_address)
    if item:
        return {"address": item.get("nft_address") or nft_address, "name": str(item.get("nft_name") or ""),
                "collection_address": item.get("_collection") or "", "attributes": item.get("attributes") or [],
                "price_per_day": str(item.get("price_per_day")), "min_duration": int(item.get("min_duration") or DAY),
                "max_duration": int(item.get("max_duration") or DAY),
                "sellable": bool(item.get("is_sellable_during_rent", False)),
                "category": item.get("_category") or "gift"}
    if ctx.settings.marketapp_paid_plan:
        info = await _nft_info(ctx, nft_address)
        details = _listing_from_info(info)
        return {"address": info.get("address") or nft_address, "name": str(info.get("name") or ""),
                "collection_address": info.get("collection_address") or "", "attributes": info.get("attributes") or [],
                "price_per_day": str(details["price_per_day"]), "min_duration": int(details["min_duration"]),
                "max_duration": int(details["max_duration"]), "sellable": False, "category": "gift"}
    raise ServiceError("listing_stale", 409)


# ---------------------------------------------------------------------------- user actions
async def quote_for(ctx: AppContext, nft_address: str, days: int) -> dict:
    listing = await _listing(ctx, nft_address)
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        raise ServiceError("rate_unavailable", 503) from None
    low, high = rentable_days(listing["min_duration"], listing["max_duration"], config)
    if not low <= days <= high:
        raise ServiceError("days_out_of_range")
    return {**make_quote(int(listing["price_per_day"]), days, config).as_dict(), "min_days": low, "max_days": high}


async def _nft_info(ctx: AppContext, nft_address: str) -> dict:
    try:
        canonical_address(nft_address)
        return await ctx.market.nft_info(nft_address)
    except ValueError:
        raise ServiceError("gift_unavailable", 404) from None
    except MarketappError as exc:
        if exc.status == 404:
            raise ServiceError("gift_unavailable", 404) from None
        log.warning("Marketapp nft_info failed: %s", exc)
        raise ServiceError("marketapp", 503) from None


async def create_order(ctx: AppContext, user_id: int, nft_address: str, days: int) -> Order:
    if not isinstance(days, int) or days < 1:
        raise ServiceError("days_out_of_range")
    async with Session() as session:
        card = await get_setting(session, "card_number", ctx.settings.card_number)
        if not card:
            raise ServiceError("no_card", 503)
        if await count_open_orders(session, user_id) >= ctx.settings.max_open_orders_per_user:
            raise ServiceError("too_many_orders", 429)
    listing = await _listing(ctx, nft_address)
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        raise ServiceError("rate_unavailable", 503) from None
    low, high = rentable_days(listing["min_duration"], listing["max_duration"], config)
    if not low <= days <= high:
        raise ServiceError("days_out_of_range")
    quote = make_quote(int(listing["price_per_day"]), days, config)
    name = listing["name"]
    attributes = listing["attributes"]
    order = Order(
        user_id=user_id, status=S.AWAITING_PAYMENT, nft_address=str(listing["address"]), sellable=listing["sellable"],
        category=listing.get("category", "gift"),
        nft_name=name, collection_address=str(listing["collection_address"]),
        image_url=image_url(name) if listing.get("category", "gift") == "gift" else "",
        attributes_json=json.dumps([{"trait_type": k, "value": attr(attributes, k)}
                                    for k in ("Model", "Backdrop", "Symbol") if attr(attributes, k)]),
        days=days, price_per_day_nano=str(quote.price_per_day_nano), ton_total_nano=str(quote.ton_total_nano),
        rate_uzs_per_ton=str(quote.rate), markup_percent=str(quote.markup), amount_uzs=quote.amount_uzs,
        cost_nano=str(quote.cost_nano), fee_percent=str(quote.fee), cost_uzs=quote.cost_uzs, profit_uzs=quote.profit_uzs,
        service_fee_uzs=quote.service_fee_uzs,
        payment_expires_at=utcnow() + timedelta(minutes=ctx.settings.payment_window_minutes))
    async with Session() as session:
        add = await unique_amount(session, order.amount_uzs, ctx.settings.unique_amount_max)
        order.unique_add_uzs = add
        order.amount_uzs += add
        order.profit_uzs += add
        session.add(order)
        await session.flush()
        session.add(OrderEvent(order_id=order.id, from_status="", to_status=S.AWAITING_PAYMENT, actor=f"user:{user_id}"))
        await session.commit()
        await session.refresh(order)
    return order


async def cancel_by_user(ctx: AppContext, user_id: int, order_id: int) -> Order:
    await get_order(order_id, user_id)
    return await _transition(order_id, {S.AWAITING_PAYMENT}, S.CANCELLED, f"user:{user_id}")


async def attach_receipt(ctx: AppContext, user_id: int, order_id: int, *, file_id: str | None = None,
                         kind: str = "photo", data: bytes | None = None, filename: str = "receipt.jpg") -> Order:
    order = await get_order(order_id, user_id)
    if order.status != S.AWAITING_PAYMENT:
        raise ServiceError("bad_state", 409, order.status)
    try:
        stored_id, stored_kind = await ctx.notifier.receipt_to_admins(order, file_id=file_id, kind=kind, data=data,
                                                                      filename=filename)
    except Exception as exc:
        log.error("Receipt for order %s not delivered: %s", order_id, exc)
        raise ServiceError("generic", 502) from None
    return await _transition(order_id, {S.AWAITING_PAYMENT}, S.PAYMENT_REVIEW, f"user:{user_id}",
                             receipt_file_id=stored_id, receipt_kind=stored_kind)


async def latest_order(user_id: int, statuses) -> Order | None:
    async with Session() as session:
        result = await session.execute(select(Order).where(Order.user_id == user_id, Order.status.in_(statuses))
                                       .order_by(Order.id.desc()).limit(1))
        return result.scalar_one_or_none()


async def submit_link(ctx: AppContext, user_id: int, order_id: int, raw_url: str) -> Order:
    """User sends the TonConnect link from Fragment ("Connect TON")."""
    try:
        url = validate_tonconnect_url(raw_url)
    except ValueError as exc:
        raise ServiceError(str(exc)) from None
    order = await get_order(order_id, user_id)
    previous = order.status
    if previous not in (S.AWAITING_LINK, S.ACTIVE):
        raise ServiceError("bad_state", 409, previous)
    async with _locks[order_id]:
        order = await _transition(order_id, {S.AWAITING_LINK, S.ACTIVE}, S.CONNECTING, f"user:{user_id}",
                                  connect_attempts=order.connect_attempts + 1)
        try:
            response = await ctx.market.tonconnect(order.nft_address, url)
        except MarketappError as exc:
            log.info("tonconnect rejected for order %s: %s", order_id, exc)
            back = previous
            await _transition(order_id, {S.CONNECTING}, back, "system", note=f"tonconnect: {exc}",
                              connect_response=json.dumps(exc.detail)[:2000] if exc.detail else str(exc))
            if isinstance(exc, MarketappAuthError):
                await ctx.notifier.admin(order, "failed", error="Marketapp token")
            raise ServiceError("link_rejected", 400) from None
        safe = json.dumps(response, ensure_ascii=False)[:2000] if response is not None else ""
        tx = response.get("transaction") if isinstance(response, dict) else None
        if isinstance(tx, dict) and tx.get("messages"):
            order = await _transition(order_id, {S.CONNECTING}, S.CONNECT_SIGNING, "system",
                                      pending_tx_kind="connect", pending_tx_json=json.dumps(tx), connect_response=safe)
            if ctx.hot_wallet is not None:
                return await _hot_sign(ctx, order_id, "system:hot")
            await ctx.notifier.admin(order, "sign_connect_urgent", buttons="sign")
            return order
        order = await _transition(order_id, {S.CONNECTING}, S.ACTIVE, "system", connect_response=safe, connected_at=utcnow())
    await ctx.notifier.user(order, "active")
    await ctx.notifier.admin(order, "activated")
    return order


# ---------------------------------------------------------------------------- extensions
EXTENSION_OPEN = {S.AWAITING_PAYMENT, S.PAYMENT_REVIEW, S.PAID, S.RENTING}


async def _extension_terms(ctx: AppContext, parent: Order) -> tuple[int, int, int | None]:
    """(max extra days, price per day nano, current end unix) from /v1/rent/my-rented/ (free)."""
    try:
        item = await ctx.market.find_rented(parent.nft_address, canonical_address)
    except MarketappError:
        raise ServiceError("marketapp", 503) from None
    if not item:
        raise ServiceError("extend_unavailable", 409)
    max_days = int(item.get("extend_duration") or 0) // DAY
    if max_days < 1:
        raise ServiceError("extend_unavailable", 409)
    ppd = int(item.get("price_per_day") or parent.price_per_day_nano)
    end = int(item["end_time"]) if item.get("end_time") else None
    return max_days, ppd, end


async def _extendable_parent(user_id: int, parent_id: int) -> Order:
    parent = await get_order(parent_id, user_id)
    if parent.kind != "rent" or parent.status not in (S.ACTIVE, S.AWAITING_LINK):
        raise ServiceError("bad_state", 409, parent.status)
    end = aware(parent.end_time)
    if end and end - utcnow() < timedelta(minutes=30):
        raise ServiceError("extend_unavailable", 409)
    return parent


async def extension_quote(ctx: AppContext, user_id: int, parent_id: int, days: int | None = None) -> dict:
    parent = await _extendable_parent(user_id, parent_id)
    max_days, ppd, _ = await _extension_terms(ctx, parent)
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        raise ServiceError("rate_unavailable", 503) from None
    result = {"max_days": max_days, "per_day_uzs": make_quote(ppd, 1, config).per_day_uzs}
    if days is not None:
        if not 1 <= days <= max_days:
            raise ServiceError("days_out_of_range")
        result.update(make_quote(ppd, days, config).as_dict())
    return result


async def create_extension(ctx: AppContext, user_id: int, parent_id: int, days: int) -> Order:
    parent = await _extendable_parent(user_id, parent_id)
    async with Session() as session:
        if not await get_setting(session, "card_number", ctx.settings.card_number):
            raise ServiceError("no_card", 503)
        if await count_open_orders(session, user_id) >= ctx.settings.max_open_orders_per_user:
            raise ServiceError("too_many_orders", 429)
        busy = (await session.execute(select(Order.id).where(Order.parent_id == parent_id,
                                                             Order.status.in_(EXTENSION_OPEN)))).first()
        if busy:
            raise ServiceError("extend_pending", 409)
    max_days, ppd, end = await _extension_terms(ctx, parent)
    if not 1 <= days <= max_days:
        raise ServiceError("days_out_of_range")
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        raise ServiceError("rate_unavailable", 503) from None
    quote = make_quote(ppd, days, config)
    prev_end = datetime.fromtimestamp(end, timezone.utc) if end else aware(parent.end_time)
    order = Order(
        user_id=user_id, status=S.AWAITING_PAYMENT, kind="extend", parent_id=parent.id, prev_end_time=prev_end,
        nft_address=parent.nft_address, nft_name=parent.nft_name, collection_address=parent.collection_address,
        image_url=parent.image_url, attributes_json=parent.attributes_json, sellable=parent.sellable,
        days=days, price_per_day_nano=str(ppd), ton_total_nano=str(quote.ton_total_nano),
        rate_uzs_per_ton=str(quote.rate), markup_percent=str(quote.markup), amount_uzs=quote.amount_uzs,
        cost_nano=str(quote.cost_nano), fee_percent=str(quote.fee), cost_uzs=quote.cost_uzs, profit_uzs=quote.profit_uzs,
        service_fee_uzs=quote.service_fee_uzs,
        payment_expires_at=utcnow() + timedelta(minutes=ctx.settings.payment_window_minutes))
    async with Session() as session:
        add = await unique_amount(session, order.amount_uzs, ctx.settings.unique_amount_max)
        order.unique_add_uzs = add
        order.amount_uzs += add
        order.profit_uzs += add
        session.add(order)
        await session.flush()
        session.add(OrderEvent(order_id=order.id, from_status="", to_status=S.AWAITING_PAYMENT,
                               actor=f"user:{user_id}", note=f"extend #{parent.id}"))
        await session.commit()
        await session.refresh(order)
    return order


async def _apply_extension(ctx: AppContext, order: Order, item: dict, now: datetime) -> bool:
    """RENTING extension → EXTENDED when Marketapp shows a later end time. Returns True when applied."""
    end = item.get("end_time")
    if not end:
        return False
    new_end = datetime.fromtimestamp(int(end), timezone.utc)
    previous = aware(order.prev_end_time)
    if previous and new_end <= previous + timedelta(seconds=60):
        return False
    try:
        order = await _transition(order.id, {S.RENTING}, S.EXTENDED, "system", end_time=new_end, rented_at=now)
    except ServiceError:
        return False
    if order.parent_id:
        await _update(order.parent_id, end_time=new_end, reminder_sent=False)
    await ctx.notifier.user(order, "extended")
    return True


# ---------------------------------------------------------------------------- Telegram display (main way)
def customer_id(user_id: int) -> str:
    """Our id of the customer for Marketapp's /v1/rent/tg/* endpoints (one Telegram login per id)."""
    return f"tg{int(user_id)}"


def _tg_name(response: dict) -> str:
    account = response.get("telegram") if isinstance(response, dict) else None
    if not isinstance(account, dict):
        return ""
    name = str(account.get("name") or "")
    username = str(account.get("username") or "")
    return (f"{name} (@{username})" if username else name)[:128]


async def _set_tg_ready(user_id: int, ready: bool, name: str = "") -> None:
    async with Session() as session:
        user = await session.get(User, user_id)
        if user:
            user.tg_display_ready = ready
            if name:
                user.tg_display_name = name
            await session.commit()


def _display_error(exc: MarketappError) -> str:
    text = json.dumps(exc.detail) if exc.detail else str(exc)
    if "limit" in text.lower():
        return "display_limit"
    if exc.status == 503 or exc.status is None:
        return "marketapp"
    return "display_failed"


async def _forget_tg_login(ctx: AppContext, user_id: int) -> None:
    """Drop the customer's Telegram login on our side AND on Marketapp's.

    Only clearing our flag is not enough: Marketapp keeps answering `ready` to /tg/connect/ for a login that
    Telegram/Fragment no longer accepts, so the customer would never get a new link and every try fails again."""
    await _set_tg_ready(user_id, False)
    try:
        await ctx.market.tg_disconnect(customer_id(user_id))
    except MarketappError as exc:
        log.warning("tg disconnect for user %s failed: %s %s", user_id, exc, exc.detail)


async def display_gift(ctx: AppContext, order_id: int, actor: str) -> Order:
    """Show the rented gift on the customer's connected Telegram (no fragment.com, no wallet signature)."""
    async with _locks[order_id]:
        order = await get_order(order_id)
        previous = order.status
        order = await _transition(order_id, {S.AWAITING_LINK, S.ACTIVE}, S.CONNECTING, actor,
                                  connect_attempts=order.connect_attempts + 1)
        try:
            response = await ctx.market.tg_display(order.nft_address, customer_id(order.user_id))
        except Exception as exc:          # never leave the order stuck in CONNECTING
            detail = getattr(exc, "detail", None)
            log.warning("tg display of order %s failed: %s %s", order_id, exc, detail)
            await _transition(order_id, {S.CONNECTING}, previous, "system", note=f"display: {exc} {detail or ''}"[:500],
                              connect_response=(json.dumps(detail) if detail else str(exc))[:2000])
            if not isinstance(exc, MarketappError):
                raise
            code = _display_error(exc)
            if code == "display_failed" and exc.status == 400:
                await _forget_tg_login(ctx, order.user_id)   # login expired/refused: next try gets a fresh link
            raise ServiceError(code, 400 if code != "marketapp" else 503) from None
        shown = str(response.get("displayed") or "") if isinstance(response, dict) else ""
        order = await _transition(order_id, {S.CONNECTING}, S.ACTIVE, actor, connected_at=utcnow(),
                                  connect_response=json.dumps(response, ensure_ascii=False)[:2000])
    log.info("Order %s displayed on Telegram account %r", order_id, shown)
    if shown:
        await _set_tg_ready(order.user_id, True, shown)
    await ctx.notifier.user(order, "displayed", account=shown or "Telegram")
    await ctx.notifier.admin(order, "activated")
    return order


def _tg_service_error(exc: MarketappError, where: str, user_id: int) -> ServiceError:
    log.warning("tg %s for user %s failed: %s %s", where, user_id, exc, exc.detail)
    if exc.status in (None, 503):
        return ServiceError("marketapp", 503)
    return ServiceError("display_failed", 400)


async def tg_connect(ctx: AppContext, user_id: int, order_id: int) -> dict:
    """Step 1: start (or reuse) the customer's Telegram login. Returns {status, link?, order?}."""
    order = await get_order(order_id, user_id)
    if order.status not in (S.AWAITING_LINK, S.ACTIVE) or (order.category or "gift") != "gift":
        raise ServiceError("bad_state", 409, order.status)
    try:
        response = await ctx.market.tg_connect(customer_id(user_id))
    except MarketappError as exc:
        raise _tg_service_error(exc, "connect", user_id) from None
    status = str(response.get("status") or "")
    log.info("tg connect for user %s / order %s: %s", user_id, order_id, status)
    if status in ("ready", "confirmed"):
        await _set_tg_ready(user_id, True, _tg_name(response))
        order = await display_gift(ctx, order_id, f"user:{user_id}")
        return {"status": "displayed", "order": order}
    return {"status": status or "waiting", "link": response.get("link")}


async def tg_poll(ctx: AppContext, user_id: int, order_id: int) -> dict:
    """Step 2: called by the Mini App every ~2.5 s while the customer confirms the login in Telegram.

    Works for AWAITING_LINK (first display) and ACTIVE (show the gift again / on another account):
    an ACTIVE order is displayed again only after the customer really confirmed the login."""
    order = await get_order(order_id, user_id)
    if order.status == S.CONNECTING:
        return {"status": "consumed"}                # a display is running right now: keep waiting
    if order.status not in (S.AWAITING_LINK, S.ACTIVE):
        raise ServiceError("bad_state", 409, order.status)
    try:
        response = await ctx.market.tg_status(customer_id(user_id))
    except MarketappError as exc:
        if exc.status in (None, 503):
            return {"status": "consumed"}           # Telegram did not answer: keep polling
        raise _tg_service_error(exc, "status", user_id) from None
    status = str(response.get("status") or "")
    if status in ("ready", "confirmed"):
        log.info("tg login confirmed for user %s / order %s", user_id, order_id)
        await _set_tg_ready(user_id, True, _tg_name(response))
        order = await display_gift(ctx, order_id, f"user:{user_id}")
        return {"status": "displayed", "order": order}
    return {"status": status or "waiting", "link": response.get("link")}


async def login_code(ctx: AppContext, user_id: int, order_id: int) -> dict:
    """Telegram login code for a rented anonymous number (shown in the Mini App)."""
    order = await get_order(order_id, user_id)
    if (order.category or "gift") != "number" or order.status != S.ACTIVE:
        raise ServiceError("bad_state", 409, order.status)
    try:
        response = await ctx.market.login_code(order.nft_address)
    except MarketappError as exc:
        text = json.dumps(exc.detail) if exc.detail else str(exc)
        if "disabled" in text.lower() or "enable" in text.lower():
            try:
                await ctx.market.toggle_login_code(order.nft_address, True)
                response = await ctx.market.login_code(order.nft_address)
            except MarketappError:
                raise ServiceError("no_code", 409) from None
        else:
            raise ServiceError("no_code" if exc.status in (400, 404) else "marketapp", 409) from None
    code = ""
    if isinstance(response, dict):
        for key in ("code", "login_code", "value"):
            if response.get(key):
                code = str(response[key])
                break
    elif response:
        code = str(response)
    if not code:
        raise ServiceError("no_code", 409)
    return {"code": code, "number": order.nft_name}


async def _tg_ready(user_id: int) -> bool:
    async with Session() as session:
        user = await session.get(User, user_id)
        return bool(user and user.tg_display_ready)


# ---------------------------------------------------------------------------- admin actions
async def _after_paid(ctx: AppContext, order: Order) -> Order:
    from .wallet import record_spend
    await record_spend(ctx, order.user_id, int(order.amount_uzs), "order", order.id)
    await ctx.notifier.user(order, "payment_confirmed")
    if ctx.hot_wallet is not None and ctx.settings.auto_rent:
        try:
            return await start_rent_hot(ctx, order.id, "system:auto")
        except ServiceError as exc:
            await ctx.notifier.admin(order, "failed", buttons="paid", error=exc.detail or exc.code)
            return await get_order(order.id)
    await ctx.notifier.admin(order, "paid_ready", buttons="paid")
    return order


async def confirm_payment(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    order = await _transition(order_id, {S.PAYMENT_REVIEW, S.AWAITING_PAYMENT}, S.PAID, f"admin:{admin_id}", paid_at=utcnow())
    return await _after_paid(ctx, order)


async def pay_from_balance(ctx: AppContext, user_id: int, order_id: int) -> Order:
    """Customer pays an unpaid order with his balance (no card transfer, no unique +N so'm)."""
    from .wallet import WalletError, credit, debit
    order = await get_order(order_id, user_id)
    if order.status != S.AWAITING_PAYMENT:
        raise ServiceError("bad_state", 409, order.status)
    price = int(order.amount_uzs) - int(order.unique_add_uzs or 0)
    try:
        await debit(user_id, price, "order", order_id)
    except WalletError as exc:
        raise ServiceError(exc.code, exc.status) from None
    try:
        order = await _transition(order_id, {S.AWAITING_PAYMENT}, S.PAID, f"user:{user_id}", paid_at=utcnow(),
                                  paid_by="balance", amount_uzs=price, profit_uzs=int(order.profit_uzs or 0)
                                  - int(order.unique_add_uzs or 0), unique_add_uzs=0)
    except ServiceError:
        await credit(user_id, price, "refund", order_id, "order state changed")
        raise
    return await _after_paid(ctx, order)


async def confirm_late(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    """Money arrived after the payment window closed: reopen the cancelled order as paid."""
    order = await _transition(order_id, {S.CANCELLED}, S.PAID, f"admin:{admin_id}", paid_at=utcnow(), note="late payment")
    return await _after_paid(ctx, order)


async def reject_payment(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    order = await _transition(order_id, {S.PAYMENT_REVIEW}, S.AWAITING_PAYMENT, f"admin:{admin_id}",
                              receipt_file_id="", receipt_kind="",
                              payment_expires_at=utcnow() + timedelta(minutes=ctx.settings.payment_window_minutes))
    await ctx.notifier.user(order, "payment_rejected")
    return order


async def admin_cancel(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    order = await _transition(order_id, {S.AWAITING_PAYMENT, S.PAYMENT_REVIEW, S.PAID, S.FAILED}, S.CANCELLED,
                              f"admin:{admin_id}", pending_tx_json="", pending_tx_kind="")
    await ctx.notifier.user(order, "cancelled")
    return order


async def mark_refunded(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    """Balance orders are refunded to the balance automatically; card orders are refunded by hand."""
    order = await _transition(order_id, {S.FAILED, S.PAID, S.CANCELLED}, S.REFUNDED, f"admin:{admin_id}")
    if (order.paid_by or "card") == "balance" and order.paid_at:
        from .wallet import credit
        await credit(order.user_id, int(order.amount_uzs), "refund", order_id)
        await ctx.notifier.user(order, "refunded_balance")
    else:
        await ctx.notifier.user(order, "refunded")
    return order


async def refund_to_balance(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    """Card-paid order that failed: give the money back as balance instead of a card transfer."""
    from .wallet import credit
    order = await _transition(order_id, {S.FAILED, S.PAID, S.CANCELLED}, S.REFUNDED, f"admin:{admin_id}",
                              note="refunded to balance")
    if order.paid_at:
        await credit(order.user_id, int(order.amount_uzs), "refund", order_id)
    await ctx.notifier.user(order, "refunded_balance")
    return order


async def retry(ctx: AppContext, order_id: int, admin_id: int) -> Order:
    order = await get_order(order_id)
    target = S.AWAITING_LINK if order.rented_at else S.PAID
    order = await _transition(order_id, {S.FAILED}, target, f"admin:{admin_id}", error="")
    if target == S.AWAITING_LINK:
        await ctx.notifier.user(order, "awaiting_link")
    return order


async def prepare_tx(ctx: AppContext, order_id: int) -> dict:
    """Get the transaction the admin wallet must sign (rent payment or Fragment connection)."""
    async with _locks[order_id]:
        order = await get_order(order_id)
        if order.status == S.CONNECT_SIGNING and order.pending_tx_kind == "connect":
            tx = json.loads(order.pending_tx_json)
            return {"kind": "connect", "transaction": tx, "ton": ton_text(transaction_total_nano(tx)), "order_id": order_id}
        if order.status != S.PAID:
            raise ServiceError("bad_state", 409, order.status)
        if ctx.settings.marketapp_paid_plan and order.kind != "extend":
            listing = _listing_from_info(await _nft_info(ctx, order.nft_address))
            if int(listing["price_per_day"]) > int(order.price_per_day_nano):
                await _transition(order_id, {S.PAID}, S.FAILED, "system", error="price_changed")
                await ctx.notifier.user(order, "failed")
                raise ServiceError("price_changed", 409)
        try:
            # Marketapp refuses the rent if price_per_day / sale_during_rent no longer match the listing.
            if order.kind == "extend":
                response = await ctx.market.extend(order.nft_address, order.days * DAY, order.price_per_day_nano)
            else:
                response = await ctx.market.pay(order.nft_address, order.days * DAY, order.price_per_day_nano,
                                                order.sellable)
        except MarketappError as exc:
            log.warning("Marketapp pay failed for %s: %s %s", order_id, exc, exc.detail)
            detail = json.dumps(exc.detail)[:300] if exc.detail else str(exc)
            if exc.status in (400, 404, 409, 422):
                await _transition(order_id, {S.PAID}, S.FAILED, "system", error="listing_changed", note=detail)
                await ctx.notifier.user(order, "failed")
                await ctx.notifier.admin(order, "failed", buttons="failed", error=f"listing_changed: {detail}")
                raise ServiceError("price_changed", 409, detail) from None
            raise ServiceError("marketapp", 502, detail) from None
        tx = response.get("transaction") if isinstance(response, dict) else None
        if not isinstance(tx, dict):
            raise ServiceError("marketapp", 502, "no transaction in response")
        actual = transaction_total_nano(tx)
        await _remember_fee(order, actual)
        await _update(order_id, actual_cost_nano=str(actual))
        total = _check_tx(ctx, order, tx)
        await _update(order_id, pending_tx_kind="rent", pending_tx_json=json.dumps(tx))
        return {"kind": "rent", "transaction": tx, "ton": ton_text(total), "order_id": order_id}


async def _remember_fee(order: Order, total_nano: int) -> None:
    """Store the commission Marketapp actually charged so the admin can tune ``fee_percent``."""
    fee = observed_fee(order, total_nano)
    if fee != "?":
        async with Session() as session:
            await set_setting(session, "observed_fee_percent", fee)


async def tx_sent(ctx: AppContext, order_id: int, actor: str, boc: str, wallet: str | None) -> Order:
    """Admin wallet broadcast the prepared transaction."""
    if wallet is not None and ctx.settings.admin_wallet_address and not same_address(wallet, ctx.settings.admin_wallet_address):
        raise ServiceError("wallet", 403, "wrong wallet")
    order = await get_order(order_id)
    if order.pending_tx_kind == "rent" and order.status == S.PAID:
        order = await _transition(order_id, {S.PAID}, S.RENTING, actor, rent_tx_boc=boc[:20000], rent_sent_at=utcnow(),
                                  pending_tx_json="", pending_tx_kind="")
        await ctx.notifier.admin(order, "rent_sent")
        return order
    if order.pending_tx_kind == "connect" and order.status == S.CONNECT_SIGNING:
        order = await _transition(order_id, {S.CONNECT_SIGNING}, S.ACTIVE, actor, pending_tx_json="", pending_tx_kind="",
                                  connected_at=utcnow())
        await ctx.notifier.user(order, "active")
        await ctx.notifier.admin(order, "activated")
        return order
    raise ServiceError("bad_state", 409, order.status)


_hot_alerted: dict[int, float] = {}       # order id → last time the admin was told (avoid spamming)
HOT_ALERT_EVERY = 15 * 60


async def _hot_sign(ctx: AppContext, order_id: int, actor: str) -> Order:
    order = await get_order(order_id)
    tx = json.loads(order.pending_tx_json or "{}")
    try:
        boc = await ctx.hot_wallet.send(tx)
    except Exception as exc:  # broadcast failure: leave it for the admin
        log.error("Hot wallet failed for order %s: %s", order_id, exc)
        now_ts = time.monotonic()
        if now_ts - _hot_alerted.get(order_id, -HOT_ALERT_EVERY) >= HOT_ALERT_EVERY:
            _hot_alerted[order_id] = now_ts
            await ctx.notifier.admin(order, "failed", buttons="sign", error=f"hot wallet: {exc}")
        raise ServiceError("wallet", 502, str(exc)) from None
    _hot_alerted.pop(order_id, None)
    return await tx_sent(ctx, order_id, actor, boc, None)


async def start_rent_hot(ctx: AppContext, order_id: int, actor: str) -> Order:
    if ctx.hot_wallet is None:
        raise ServiceError("wallet", 400, "hot wallet disabled")
    await prepare_tx(ctx, order_id)
    return await _hot_sign(ctx, order_id, actor)


async def sign_pending_hot(ctx: AppContext, order_id: int, actor: str) -> Order:
    order = await get_order(order_id)
    if order.status == S.PAID:
        return await start_rent_hot(ctx, order_id, actor)
    if order.status == S.CONNECT_SIGNING and ctx.hot_wallet is not None:
        return await _hot_sign(ctx, order_id, actor)
    raise ServiceError("bad_state", 409, order.status)


# ---------------------------------------------------------------------------- background worker
async def _orders(statuses) -> list[Order]:
    async with Session() as session:
        result = await session.execute(select(Order).where(Order.status.in_(statuses)).order_by(Order.id))
        return list(result.scalars())


async def _confirm_chain(ctx: AppContext, order: Order, item: dict, now: datetime) -> bool:
    """A RENTING order is confirmed by Marketapp (``item`` has ``end_time``). Returns True when handled."""
    if order.kind == "extend":
        return await _apply_extension(ctx, order, item, now)
    end = item.get("end_time")
    end_dt = datetime.fromtimestamp(int(end), timezone.utc) if end else now + timedelta(days=order.days)
    category = order.category or "gift"
    if category == "number":                  # anonymous number: works right away through login codes
        try:
            order = await _transition(order.id, {S.RENTING}, S.ACTIVE, "system", rented_at=now, end_time=end_dt,
                                      connected_at=now)
        except ServiceError:
            return True
        try:
            await ctx.market.toggle_login_code(order.nft_address, True)
        except MarketappError as exc:
            log.warning("toggle-login-code failed for order %s: %s", order.id, exc)
        await ctx.notifier.user(order, "number_ready")
        await ctx.notifier.admin(order, "activated")
        return True
    try:
        order = await _transition(order.id, {S.RENTING}, S.AWAITING_LINK, "system", rented_at=now, end_time=end_dt)
    except ServiceError:
        return True
    if category == "username":                # usernames connect through fragment.com "Connect TON"
        await ctx.notifier.user(order, "awaiting_link_username")
        return True
    if await _tg_ready(order.user_id):
        try:                          # Telegram already connected earlier: show the gift right away
            await display_gift(ctx, order.id, "system:auto")
            return True
        except ServiceError as exc:
            log.info("Auto display of order %s failed: %s", order.id, exc.code)
    await ctx.notifier.user(order, "awaiting_link")
    return True


EVENTS_CURSOR = "rent_events_cursor"
EVENT_PAGES_PER_TICK = 3


async def follow_rent_events(ctx: AppContext, now: datetime) -> int:
    """Read Marketapp's /v1/rent/events/ feed (rented / cancel) from the saved cursor.

    Every response is strictly newer than the cursor and an empty page returns the same cursor, so one
    request per tick is enough when nothing happens. Returns the number of events processed."""
    async with Session() as session:
        cursor = await get_setting(session, EVENTS_CURSOR, None)
    renting = {}
    for order in await _orders({S.RENTING}):
        try:
            renting[canonical_address(order.nft_address)] = order
        except ValueError:
            pass
    live = {}
    for order in await _orders({S.ACTIVE, S.AWAITING_LINK}):
        if order.kind == "rent":
            try:
                live[canonical_address(order.nft_address)] = order
            except ValueError:
                pass
    if not renting and not live:
        return 0          # nothing to watch — don't spend the Marketapp rate limit on the feed backlog
    wallet = ctx.settings.admin_wallet_address
    processed = 0
    for _ in range(EVENT_PAGES_PER_TICK):
        try:
            page = await ctx.market.rent_events(cursor=cursor)
        except MarketappError as exc:
            if exc.status in (400, 404, 410, 422) and cursor:
                log.warning("Rent event cursor rejected (%s); starting over", exc.status)
                async with Session() as session:
                    await set_setting(session, EVENTS_CURSOR, "")
            raise
        items = page.get("items") or []
        for event in items:
            processed += 1
            try:
                address = canonical_address(str(event.get("address", "")))
            except ValueError:
                continue
            data = event.get("type_data") or {}
            if event.get("type") == "rented" and address in renting:
                renter = data.get("rented_by")
                if wallet and renter and not same_address(renter, wallet):
                    continue                     # someone else rented it
                order = renting.pop(address)
                await _confirm_chain(ctx, order, {"end_time": data.get("end_time")}, now)
            elif event.get("type") == "cancel" and address in live:
                order = live.pop(address)
                end = aware(order.end_time)
                if end and end > now + timedelta(minutes=5):
                    await ctx.notifier.admin(order, "failed", error="rent_cancelled_on_chain")
        new_cursor = page.get("cursor")
        if new_cursor and new_cursor != cursor:
            cursor = new_cursor
            async with Session() as session:
                await set_setting(session, EVENTS_CURSOR, cursor)
        if not items:
            break
    return processed


async def worker_tick(ctx: AppContext) -> None:
    now = utcnow()

    # 0. balance top-ups past their window, Stars/Premium waiting for the wallet
    from . import purchases, wallet
    try:
        await wallet.expire_topups(now)
        await purchases.worker_tick(ctx)
    except Exception:
        log.exception("Top-up / purchase tick failed")

    # 1. unpaid orders past their window
    for order in await _orders({S.AWAITING_PAYMENT}):
        if order.payment_expires_at and aware(order.payment_expires_at) < now:
            try:
                order = await _transition(order.id, {S.AWAITING_PAYMENT}, S.CANCELLED, "system", note="payment timeout")
                await ctx.notifier.user(order, "payment_timeout")
            except ServiceError:
                pass

    # 2. rent / extend transactions waiting for the chain
    if ctx.settings.use_rent_events:
        try:
            await follow_rent_events(ctx, now)        # fast path: Marketapp's rent event feed
        except Exception:
            log.exception("Rent event feed failed")
    for order in await _orders({S.RENTING}):
        sent = aware(order.rent_sent_at)
        if ctx.settings.use_rent_events and sent and now - sent < timedelta(seconds=90):
            continue                                  # give the event feed a chance first
        try:
            item = await ctx.market.find_rented(order.nft_address, canonical_address)
        except MarketappError as exc:
            log.warning("my-rented check failed: %s", exc)
            break
        if item and await _confirm_chain(ctx, order, item, now):
            continue
        if sent and sent + timedelta(minutes=ctx.settings.rent_confirm_timeout_minutes) < now:
            error = "extend_not_confirmed" if order.kind == "extend" else "rent_not_confirmed"
            try:
                order = await _transition(order.id, {S.RENTING}, S.FAILED, "system", error=error)
                await ctx.notifier.admin(order, "failed", buttons="failed", error=error)
                await ctx.notifier.user(order, "failed")
            except ServiceError:
                pass

    # 3. connection signatures that expired before the admin approved them
    for order in await _orders({S.CONNECT_SIGNING}):
        try:
            valid_until = int(json.loads(order.pending_tx_json or "{}").get("validUntil") or 0)
        except ValueError:
            valid_until = 0
        if valid_until and valid_until < now.timestamp():
            try:
                order = await _transition(order.id, {S.CONNECT_SIGNING}, S.AWAITING_LINK, "system", note="connect tx expired",
                                          pending_tx_json="", pending_tx_kind="")
                await ctx.notifier.user(order, "link_failed")
            except ServiceError:
                pass

    # 3b. orders stuck in CONNECTING (the app restarted or crashed in the middle of a display / tonconnect)
    for order in await _orders({S.CONNECTING}):
        changed = aware(order.updated_at)
        if changed and now - changed > timedelta(minutes=3):
            back = S.ACTIVE if order.connected_at else S.AWAITING_LINK
            try:
                await _transition(order.id, {S.CONNECTING}, back, "system", note="connecting timed out")
                log.warning("Order %s was stuck in connecting; moved back to %s", order.id, back)
            except ServiceError:
                pass

    # 4. reminders and expiry
    for order in await _orders({S.ACTIVE, S.AWAITING_LINK}):
        if order.kind != "rent":
            continue
        end = aware(order.end_time)
        if not end:
            continue
        if end <= now:
            try:
                order = await _transition(order.id, {S.ACTIVE, S.AWAITING_LINK}, S.EXPIRED, "system")
                await ctx.notifier.user(order, "expired")
            except ServiceError:
                pass
        elif order.status == S.ACTIVE and not order.reminder_sent and end - now <= timedelta(hours=24) and order.days > 1:
            await _update(order.id, reminder_sent=True)
            await ctx.notifier.user(order, "expiring", left_seconds=int((end - now).total_seconds()))

    # 5. fully automatic renting with the hot wallet
    if ctx.hot_wallet is not None and ctx.settings.auto_rent:
        for order in await _orders({S.PAID}):
            try:
                await start_rent_hot(ctx, order.id, "system:auto")
            except ServiceError as exc:
                log.warning("Auto rent %s failed: %s", order.id, exc.code)


async def worker_loop(ctx: AppContext) -> None:
    while True:
        try:
            await worker_tick(ctx)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Worker tick failed")
        await asyncio.sleep(ctx.settings.worker_interval)


# ---------------------------------------------------------------------------- users
async def upsert_user(user_id: int, first_name: str = "", last_name: str = "", username: str = "",
                      photo_url: str = "") -> User:
    async with Session() as session:
        user = await session.get(User, user_id)
        if user is None:
            user = User(id=user_id)
            session.add(user)
        user.first_name = (first_name or "")[:128]
        user.last_name = (last_name or "")[:128]
        user.username = (username or "")[:64]
        if photo_url:
            user.photo_url = photo_url[:512]
        user.last_seen = utcnow()
        await session.commit()
        await session.refresh(user)
        return user


async def set_lang(user_id: int, lang: str) -> None:
    async with Session() as session:
        user = await session.get(User, user_id)
        if user:
            user.lang = lang
            await session.commit()
