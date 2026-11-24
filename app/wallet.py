"""Customer balance (so'm): top-ups by card, ledger, paying from the balance, referral rewards, top rating.

Money rules
* Every change goes through ``_move`` — one conditional UPDATE (no negative balances, no lost updates under
  concurrency) plus a Ledger row in the same transaction.
* A top-up is credited exactly once: its status changes with a conditional UPDATE first.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select, update

from .context import AppContext
from .db import (Ledger, Order, OrderStatus as S, Session, Topup, TopupStatus as T, User, aware, get_setting, utcnow)

log = logging.getLogger(__name__)


class WalletError(Exception):
    def __init__(self, code: str, status: int = 400, detail: str = "") -> None:
        super().__init__(code)
        self.code, self.status, self.detail = code, status, detail


# ---------------------------------------------------------------------------- balance
async def balance_of(user_id: int) -> int:
    async with Session() as session:
        user = await session.get(User, user_id)
        return int(user.balance_uzs or 0) if user else 0


async def _move(user_id: int, delta: int, kind: str, ref_id: int | None = None, note: str = "") -> int:
    """Add ``delta`` (may be negative) to the balance. Returns the new balance; raises when it would go < 0."""
    delta = int(delta)
    if delta == 0:
        return await balance_of(user_id)
    async with Session() as session:
        query = update(User).where(User.id == user_id)
        if delta < 0:
            query = query.where(User.balance_uzs >= -delta)
        result = await session.execute(query.values(balance_uzs=User.balance_uzs + delta))
        if result.rowcount != 1:
            await session.rollback()
            raise WalletError("low_balance", 402)
        after = (await session.execute(select(User.balance_uzs).where(User.id == user_id))).scalar_one()
        session.add(Ledger(user_id=user_id, delta_uzs=delta, balance_after=int(after), kind=kind, ref_id=ref_id,
                           note=note[:256]))
        await session.commit()
    return int(after)


async def credit(user_id: int, amount: int, kind: str, ref_id: int | None = None, note: str = "") -> int:
    if amount <= 0:
        raise WalletError("bad_amount")
    return await _move(user_id, amount, kind, ref_id, note)


async def debit(user_id: int, amount: int, kind: str, ref_id: int | None = None, note: str = "") -> int:
    if amount <= 0:
        raise WalletError("bad_amount")
    return await _move(user_id, -amount, kind, ref_id, note)


async def admin_adjust(user_id: int, delta: int, admin_id: int) -> int:
    async with Session() as session:
        if await session.get(User, user_id) is None:
            raise WalletError("user_not_found", 404)
    return await _move(user_id, delta, "admin", None, f"admin:{admin_id}")


# ---------------------------------------------------------------------------- spending, referral, rating
async def _runtime_number(key: str, default: float) -> Decimal:
    async with Session() as session:
        raw = await get_setting(session, key, None)
    try:
        return Decimal(str(raw if raw not in (None, "") else default))
    except Exception:  # noqa: BLE001
        return Decimal(str(default))


async def record_spend(ctx: AppContext, user_id: int, amount: int, kind: str, ref_id: int | None) -> None:
    """Count a paid order/purchase for the rating and reward the inviter (once per paid thing)."""
    if amount <= 0:
        return
    async with Session() as session:
        await session.execute(update(User).where(User.id == user_id).values(spent_uzs=User.spent_uzs + int(amount)))
        user = await session.get(User, user_id)
        referrer = user.referrer_id if user else None
        await session.commit()
    if not referrer:
        return
    percent = await _runtime_number("referral_percent", ctx.settings.referral_percent)
    reward = int(Decimal(amount) * percent / 100)
    if reward <= 0:
        return
    try:
        await credit(referrer, reward, "referral", ref_id, f"{kind}:{ref_id} from {user_id}")
        async with Session() as session:
            await session.execute(update(User).where(User.id == referrer)
                                  .values(ref_earned_uzs=User.ref_earned_uzs + reward))
            await session.commit()
        notify = getattr(ctx.notifier, "user_text", None)
        if notify:
            await notify(referrer, "ref_reward", amount=reward)
    except WalletError:
        pass


async def set_referrer(user_id: int, referrer_id: int) -> bool:
    """Only for a brand-new customer (nothing bought yet) and never yourself or a loop."""
    if not referrer_id or referrer_id == user_id:
        return False
    async with Session() as session:
        user = await session.get(User, user_id)
        inviter = await session.get(User, referrer_id)
        if not user or not inviter or user.referrer_id or (user.spent_uzs or 0) > 0 or inviter.referrer_id == user_id:
            return False
        user.referrer_id = referrer_id
        await session.commit()
    return True


async def referral_info(user_id: int) -> dict:
    async with Session() as session:
        user = await session.get(User, user_id)
        invited = (await session.execute(select(func.count(User.id)).where(User.referrer_id == user_id))).scalar_one()
    return {"invited": int(invited), "earned_uzs": int(user.ref_earned_uzs or 0) if user else 0}


def _mask(first: str, username: str) -> str:
    name = (first or username or "User").strip()
    return name[:2] + "•" * max(2, min(5, len(name) - 2)) if len(name) > 2 else name + "••"


async def top_rating(user_id: int, limit: int = 20) -> dict:
    async with Session() as session:
        rows = (await session.execute(select(User).where(User.spent_uzs > 0)
                                      .order_by(User.spent_uzs.desc(), User.id).limit(limit))).scalars().all()
        me = await session.get(User, user_id)
        my_rank = None
        if me and (me.spent_uzs or 0) > 0:
            my_rank = 1 + (await session.execute(select(func.count(User.id))
                                                 .where(User.spent_uzs > me.spent_uzs))).scalar_one()
    return {"items": [{"rank": i + 1, "name": _mask(u.first_name, u.username), "spent_uzs": int(u.spent_uzs),
                       "photo": u.photo_url, "me": u.id == user_id} for i, u in enumerate(rows)],
            "me": {"rank": my_rank, "spent_uzs": int(me.spent_uzs or 0) if me else 0}}


async def history(user_id: int, limit: int = 30) -> list[dict]:
    async with Session() as session:
        rows = (await session.execute(select(Ledger).where(Ledger.user_id == user_id)
                                      .order_by(Ledger.id.desc()).limit(limit))).scalars().all()
    return [{"id": r.id, "delta_uzs": int(r.delta_uzs), "kind": r.kind, "ref_id": r.ref_id,
             "balance_after": int(r.balance_after), "created_at": aware(r.created_at).isoformat()} for r in rows]


# ---------------------------------------------------------------------------- unique amounts (orders + top-ups)
async def taken_amounts(session) -> set[int]:
    orders = (await session.execute(select(Order.amount_uzs).where(Order.status.in_(S.UNPAID)))).scalars()
    topups = (await session.execute(select(Topup.amount_uzs).where(Topup.status.in_(T.OPEN)))).scalars()
    return set(orders) | set(topups)


# ---------------------------------------------------------------------------- top-ups
def topup_view(topup: Topup) -> dict:
    return {"id": topup.id, "status": topup.status, "amount_uzs": int(topup.amount_uzs), "base_uzs": int(topup.base_uzs),
            "unique_add_uzs": int(topup.unique_add_uzs or 0), "has_receipt": bool(topup.receipt_file_id),
            "expires_at": aware(topup.expires_at).isoformat() if topup.expires_at else None,
            "created_at": aware(topup.created_at).isoformat(), "user_id": topup.user_id}


async def get_topup(topup_id: int, user_id: int | None = None) -> Topup:
    async with Session() as session:
        topup = await session.get(Topup, topup_id)
    if topup is None or (user_id is not None and topup.user_id != user_id):
        raise WalletError("topup_not_found", 404)
    return topup


async def _set_status(topup_id: int, allowed, to: str, **values) -> Topup:
    async with Session() as session:
        result = await session.execute(update(Topup).where(Topup.id == topup_id, Topup.status.in_(set(allowed)))
                                       .values(status=to, updated_at=utcnow(), **values))
        if result.rowcount != 1:
            await session.rollback()
            current = await session.get(Topup, topup_id)
            raise WalletError("bad_state", 409, current.status if current else "missing")
        await session.commit()
        return await session.get(Topup, topup_id)


async def create_topup(ctx: AppContext, user_id: int, amount: int) -> Topup:
    import secrets

    amount = int(amount)
    if amount < ctx.settings.topup_min_uzs or amount > ctx.settings.topup_max_uzs:
        raise WalletError("topup_limits", 400, f"{ctx.settings.topup_min_uzs}-{ctx.settings.topup_max_uzs}")
    async with Session() as session:
        card = await get_setting(session, "card_number", ctx.settings.card_number)
        if not card:
            raise WalletError("no_card", 503)
        # one open top-up per customer: a new request replaces the unpaid one
        await session.execute(update(Topup).where(Topup.user_id == user_id, Topup.status == T.PENDING)
                              .values(status=T.CANCELLED, updated_at=utcnow()))
        add = 0
        if ctx.settings.unique_amount_max > 0:
            taken = await taken_amounts(session)
            free = [a for a in range(1, ctx.settings.unique_amount_max + 1) if amount + a not in taken]
            if not free:
                raise WalletError("too_many_orders", 429)
            add = secrets.choice(free)
        topup = Topup(user_id=user_id, status=T.PENDING, base_uzs=amount, unique_add_uzs=add, amount_uzs=amount + add,
                      expires_at=utcnow() + timedelta(minutes=ctx.settings.payment_window_minutes))
        session.add(topup)
        await session.commit()
        await session.refresh(topup)
    return topup


async def cancel_topup(user_id: int, topup_id: int) -> Topup:
    await get_topup(topup_id, user_id)
    return await _set_status(topup_id, {T.PENDING}, T.CANCELLED, actor=f"user:{user_id}")


async def attach_topup_receipt(ctx: AppContext, user_id: int, topup_id: int, *, file_id: str | None = None,
                               kind: str = "photo", data: bytes | None = None, filename: str = "receipt.jpg") -> Topup:
    topup = await get_topup(topup_id, user_id)
    if topup.status != T.PENDING:
        raise WalletError("bad_state", 409, topup.status)
    sender = getattr(ctx.notifier, "topup_receipt_to_admins", None)
    if sender is None:
        raise WalletError("generic", 502)
    try:
        stored, stored_kind = await sender(topup, file_id=file_id, kind=kind, data=data, filename=filename)
    except Exception as exc:  # noqa: BLE001
        log.error("Top-up receipt %s not delivered: %s", topup_id, exc)
        raise WalletError("generic", 502) from None
    return await _set_status(topup_id, {T.PENDING}, T.REVIEW, receipt_file_id=stored, receipt_kind=stored_kind)


async def confirm_topup(ctx: AppContext, topup_id: int, actor: str, late: bool = False) -> Topup:
    allowed = set(T.OPEN) | ({T.CANCELLED, T.EXPIRED, T.REJECTED} if late else set())
    topup = await _set_status(topup_id, allowed, T.PAID, paid_at=utcnow(), actor=actor[:32])
    balance = await credit(topup.user_id, int(topup.amount_uzs), "topup", topup.id)
    notify = getattr(ctx.notifier, "user_text", None)
    if notify:
        await notify(topup.user_id, "topup_ok", amount=int(topup.amount_uzs), balance=balance, tab="balance")
    return topup


async def reject_topup(ctx: AppContext, topup_id: int, actor: str) -> Topup:
    topup = await _set_status(topup_id, T.OPEN, T.REJECTED, actor=actor[:32])
    notify = getattr(ctx.notifier, "user_text", None)
    if notify:
        await notify(topup.user_id, "topup_rejected", amount=int(topup.amount_uzs), tab="balance")
    return topup


async def expire_topups(now=None) -> int:
    now = now or utcnow()
    expired = 0
    for topup in await list_topups(statuses={T.PENDING}, limit=500):
        if topup.expires_at and aware(topup.expires_at) < now:
            try:
                await _set_status(topup.id, {T.PENDING}, T.EXPIRED)
                expired += 1
            except WalletError:
                pass
    return expired


async def list_topups(user_id: int | None = None, statuses=None, limit: int = 50) -> list[Topup]:
    async with Session() as session:
        query = select(Topup).order_by(Topup.id.desc()).limit(limit)
        if user_id is not None:
            query = query.where(Topup.user_id == user_id)
        if statuses:
            query = query.where(Topup.status.in_(set(statuses)))
        return list((await session.execute(query)).scalars())
