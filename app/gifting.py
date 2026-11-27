"""Rent a gift and send it to a friend.

The payer gets a one-time link (``t.me/<bot>?startapp=gift_<token>``). Whoever opens it first and taps «Qabul qilish»
becomes the order's owner: the rental shows up in the friend's Inventory, the friend connects it to *their* Telegram
profile with the normal «Telegramni ulash» flow, and expiry reminders / extensions go to the friend. The payer keeps
the order in their History (``gift_from``), gets told when the friend accepts, and any refund goes back to the payer.
"""
from __future__ import annotations

import logging
import secrets

from sqlalchemy import select, update

from .context import AppContext
from .db import Order, OrderStatus as S, Session, User, aware, utcnow
from .orders import ServiceError, _locks, _transition, get_order

log = logging.getLogger(__name__)

# a gift can be handed over once the money is in and while the rental is still running
GIFTABLE = frozenset({S.PAID, S.RENTING, S.AWAITING_LINK, S.ACTIVE})
NOTE_MAX = 140


def _check_giftable(order: Order) -> None:
    if (order.kind or "rent") != "rent" or (order.category or "gift") != "gift":
        raise ServiceError("gift_not_giftable", 409)
    if order.gift_from:
        raise ServiceError("gift_already_gift", 409)           # a received gift can't be passed on again
    end = aware(order.end_time)
    if end and end <= utcnow():
        raise ServiceError("gift_expired", 409)


def _clean_note(note: str) -> str:
    return " ".join(str(note or "").split())[:NOTE_MAX]


def link(ctx: AppContext, token: str) -> str:
    return f"https://t.me/{ctx.bot_username}?startapp=gift_{token}" if ctx.bot_username and token else ""


async def make_link(ctx: AppContext, user_id: int, order_id: int, note: str = "") -> Order:
    """Turn a paid rental into a gift (or update its note). The token stays the same until the gift is cancelled."""
    async with _locks[order_id]:
        order = await get_order(order_id, user_id)
        _check_giftable(order)
        if order.status not in GIFTABLE and order.status not in S.UNPAID:
            raise ServiceError("bad_state", 409, order.status)
        if order.status == S.CONNECTING:
            raise ServiceError("gift_busy", 409)
        token = order.gift_token or secrets.token_urlsafe(12)
        async with Session() as session:
            await session.execute(update(Order).where(Order.id == order_id).values(
                gift_state="pending", gift_token=token, gift_note=_clean_note(note), updated_at=utcnow()))
            await session.commit()
        return await get_order(order_id)


async def cancel(ctx: AppContext, user_id: int, order_id: int) -> Order:
    """The payer keeps the gift after all (only while the friend hasn't accepted)."""
    async with _locks[order_id]:
        order = await get_order(order_id, user_id)
        if order.gift_state != "pending":
            raise ServiceError("gift_not_pending", 409)
        async with Session() as session:
            await session.execute(update(Order).where(Order.id == order_id).values(
                gift_state="", gift_token="", gift_note="", updated_at=utcnow()))
            await session.commit()
        return await get_order(order_id)


async def _by_token(token: str) -> Order:
    token = str(token or "").strip()
    if not token or len(token) > 32:
        raise ServiceError("gift_not_found", 404)
    async with Session() as session:
        order = (await session.execute(select(Order).where(Order.gift_token == token))).scalars().first()
    if order is None:
        raise ServiceError("gift_not_found", 404)
    return order


async def _name(user_id: int | None) -> str:
    if not user_id:
        return ""
    async with Session() as session:
        user = await session.get(User, user_id)
    if not user:
        return ""
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or (f"@{user.username}" if user.username else "")


async def preview(token: str, viewer_id: int) -> dict:
    """What the friend sees before accepting. ``state``: ready | own | not_ready | taken | gone."""
    order = await _by_token(token)
    state = "ready"
    if order.gift_state != "pending":
        state = "taken"
    elif order.user_id == viewer_id:
        state = "own"
    elif order.status in S.UNPAID:
        state = "not_ready"
    elif order.status not in GIFTABLE or (aware(order.end_time) and aware(order.end_time) <= utcnow()):
        state = "gone"
    return {"state": state, "name": order.nft_name, "image": order.image_url, "days": order.days,
            "end_time": aware(order.end_time).isoformat() if order.end_time else None,
            "from": await _name(order.user_id), "note": order.gift_note or "", "order_id": order.id
            if state == "own" else None}


async def accept(ctx: AppContext, token: str, friend_id: int) -> Order:
    order = await _by_token(token)
    async with _locks[order.id]:
        order = await get_order(order.id)
        if order.gift_state != "pending" or order.gift_token != token:
            raise ServiceError("gift_taken", 409)
        if order.user_id == friend_id:
            raise ServiceError("gift_own", 409)
        if order.status in S.UNPAID:
            raise ServiceError("gift_not_ready", 409)
        if order.status not in GIFTABLE:
            raise ServiceError("gift_gone", 409)
        _check_giftable(order)
        payer = order.user_id
        values = dict(user_id=friend_id, gift_from=payer, gift_state="accepted", gift_token="", gift_at=utcnow(),
                      tg_allow_other=False, tg_wait_started=None, tg_error="", tg_reminded=False)
        if order.status == S.ACTIVE:
            # it was shown on the payer's profile: the friend connects it to their own account now
            order = await _transition(order.id, {S.ACTIVE}, S.AWAITING_LINK, f"user:{friend_id}",
                                      note=f"gift accepted (from {payer})", connected_at=None, **values)
        else:
            order = await _transition(order.id, {order.status}, order.status, f"user:{friend_id}",
                                      note=f"gift accepted (from {payer})", **values)
        # extensions the payer already bought follow the rental
        async with Session() as session:
            await session.execute(update(Order).where(Order.parent_id == order.id, Order.user_id == payer)
                                  .values(gift_from=payer))
            await session.commit()
    log.info("Order %s handed from %s to %s", order.id, payer, friend_id)
    await ctx.notifier.user_text(payer, "gift_accepted", tab="rentals", name=order.nft_name,
                                 friend=await _name(friend_id) or str(friend_id))
    if order.status == S.AWAITING_LINK:
        await ctx.notifier.user(order, "gift_received")
    return order


async def sent_orders(user_id: int) -> list[Order]:
    """Gifts this user paid for and handed over (shown in the payer's History)."""
    async with Session() as session:
        return list((await session.execute(select(Order).where(Order.gift_from == user_id, Order.user_id != user_id)
                                           .order_by(Order.id.desc()).limit(50))).scalars())


