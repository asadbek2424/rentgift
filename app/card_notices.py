"""Automatic payment confirmation from bank notices (CardXabar / Uzcard).

A CardXabar "money in" notice looks like this:

    🟢 Popolnenie scheta
    ➕ 381 216.00 UZS
    💳 ***4625
    📍 TOSHKENT SH., ORIENT FINANS KHAT BANKI, UZ
    🕓 27.07.26 14:34
    💵 381 810.84 UZS            ← card balance, NOT the payment

Every order has a unique total (+1..99 so'm), so the amount alone tells which order was paid.
Notices arrive either from the userbot (a separate Telegram account that has CardXabar connected) or when
an admin forwards a notice to the bot. Each notice is processed once (``payment_notices.source_key``).
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .context import AppContext
from .db import Order, OrderStatus as S, PaymentNotice, Session, Topup, TopupStatus as T, aware, utcnow

log = logging.getLogger(__name__)

CREDIT_WORDS = ("popolnenie", "пополнение", "zachislenie", "зачисление", "postuplenie", "поступление",
                "to'ldirish", "toʻldirish", "to‘ldirish", "kirim", "perevod na kartu", "перевод на карту",
                "p2p credit", "credit")
DEBIT_WORDS = ("spisanie", "списание", "oplata", "оплата", "pokupka", "покупка", "snyatie", "снятие",
               "yechib olish", "to'lov", "debit")
_NUMBER = r"(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?"
_PLUS_LINE = re.compile(r"(?:➕|\+)\s*" + _NUMBER + r"\s*(?:UZS|so['ʻ‘]?m|сум|sum)?", re.IGNORECASE)
_ANY_AMOUNT = re.compile(_NUMBER + r"\s*(?:UZS|so['ʻ‘]?m|сум|sum)\b", re.IGNORECASE)
_CARD = re.compile(r"\*{2,}\s?(\d{4})")


@dataclass(frozen=True)
class Notice:
    is_credit: bool
    amount: Decimal | None
    card_last4: str = ""


def _to_decimal(whole: str, frac: str | None) -> Decimal | None:
    try:
        return Decimal(re.sub(r"[   ]", "", whole) + ("." + frac if frac else ""))
    except InvalidOperation:
        return None


def parse_notice(text: str, custom_regex: str = "") -> Notice:
    """Read a bank notice. Only the ➕ line counts as the payment amount; the 💵 balance line is ignored."""
    text = text or ""
    low = text.lower()
    card = _CARD.search(text)
    last4 = card.group(1) if card else ""
    if custom_regex:
        match = re.search(custom_regex, text, re.IGNORECASE | re.MULTILINE)
        if match and match.groupdict().get("amount"):
            raw = match.group("amount").replace(",", ".")
            whole, _, frac = raw.partition(".")
            return Notice(True, _to_decimal(whole, frac or None), last4)
        return Notice(False, None, last4)
    plus = _PLUS_LINE.search(text)
    has_credit_word = any(word in low for word in CREDIT_WORDS)
    has_debit_word = any(word in low for word in DEBIT_WORDS) or "➖" in text
    is_credit = bool(plus) or (has_credit_word and not has_debit_word)
    if not is_credit:
        return Notice(False, None, last4)
    if plus:
        return Notice(True, _to_decimal(plus.group(1), plus.group(2)), last4)
    first = _ANY_AMOUNT.search(text)            # first amount, never the trailing balance line
    return Notice(True, _to_decimal(first.group(1), first.group(2)) if first else None, last4)


def forward_key(text: str, when: str = "") -> str:
    return "fwd:" + hashlib.sha256(f"{when}|{text}".encode()).hexdigest()[:40]


async def handle_notice(ctx: AppContext, source_key: str, text: str) -> dict:
    """Store the notice once and confirm the matching order. Returns {"result", "order_id"?, "amount"?}."""
    from . import orders as svc

    notice = parse_notice(text, ctx.settings.card_notify_regex)
    record = PaymentNotice(source_key=source_key[:96], text=(text or "")[:2000], is_credit=notice.is_credit,
                           amount_uzs=int(notice.amount) if notice.amount is not None else 0)
    want_card = ctx.settings.card_last4.strip()
    if not notice.is_credit or notice.amount is None:
        record.result = "ignored"
    elif want_card and notice.card_last4 and notice.card_last4 != want_card:
        record.result = "ignored"                  # another card connected to the same CardXabar
    async with Session() as session:
        session.add(record)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            return {"result": "duplicate"}
        notice_id = record.id
    if record.result == "ignored":
        return {"result": "ignored"}

    amount = notice.amount
    if amount != amount.to_integral_value():       # 3 093.50 can never match a whole-so'm order
        return await _finish(ctx, notice_id, "unmatched", None, int(amount))
    amount_int = int(amount)
    now = utcnow()
    late_from = now - timedelta(minutes=ctx.settings.card_notify_late_minutes)
    async with Session() as session:
        candidates = list((await session.execute(
            select(Order).where(Order.amount_uzs == amount_int, Order.status.in_(S.UNPAID)))).scalars())
        topups = list((await session.execute(
            select(Topup).where(Topup.amount_uzs == amount_int, Topup.status.in_(T.OPEN)))).scalars())
        if not candidates and not topups:
            late_orders = [o for o in (await session.execute(
                select(Order).where(Order.amount_uzs == amount_int, Order.status == S.CANCELLED))).scalars()
                if aware(o.updated_at) and aware(o.updated_at) >= late_from]
            late_topups = [t for t in (await session.execute(
                select(Topup).where(Topup.amount_uzs == amount_int,
                                    Topup.status.in_({T.CANCELLED, T.EXPIRED})))).scalars()
                if aware(t.updated_at) and aware(t.updated_at) >= late_from]
            if late_topups:                         # top-up paid after its window: the admin decides
                return await _finish(ctx, notice_id, "late_topup", late_topups[0].id, amount_int)
            if late_orders:                         # paid after the window closed: let the admin decide
                return await _finish(ctx, notice_id, "late", late_orders[0].id, amount_int)
    if len(candidates) + len(topups) != 1:
        found = candidates or topups
        return await _finish(ctx, notice_id, "ambiguous" if found else "unmatched", None, amount_int)
    if topups:
        from . import wallet
        topup = topups[0]
        if not ctx.settings.auto_confirm_payments:
            return await _finish(ctx, notice_id, "topup_manual", topup.id, amount_int)
        try:
            await wallet.confirm_topup(ctx, topup.id, "auto:notice")
        except wallet.WalletError:
            return await _finish(ctx, notice_id, "unmatched", None, amount_int)
        return await _finish(ctx, notice_id, "topup", topup.id, amount_int)
    order = candidates[0]
    if not ctx.settings.auto_confirm_payments:
        return await _finish(ctx, notice_id, "matched_manual", order.id, amount_int)
    try:
        await svc.confirm_payment(ctx, order.id, 0)
    except svc.ServiceError:
        return await _finish(ctx, notice_id, "unmatched", None, amount_int)
    return await _finish(ctx, notice_id, "matched", order.id, amount_int)


async def _finish(ctx: AppContext, notice_id: int, result: str, order_id: int | None, amount: int) -> dict:
    async with Session() as session:
        record = await session.get(PaymentNotice, notice_id)
        record.result = result
        record.order_id = order_id
        await session.commit()
    from .orders import get_order
    paid = f"{amount:,}".replace(",", " ")
    if result in ("topup", "topup_manual", "late_topup"):
        notify = getattr(ctx.notifier, "admin_topup", None)
        if notify:
            from .wallet import get_topup
            await notify(await get_topup(order_id), {"topup": "topup_auto", "topup_manual": "topup_check",
                                                      "late_topup": "topup_late"}[result], paid=paid)
    elif result == "matched":
        await ctx.notifier.admin(await get_order(order_id), "auto_paid")
    elif result in ("late", "matched_manual"):
        await ctx.notifier.admin(await get_order(order_id), "notice_check", buttons="late" if result == "late" else "review",
                                 paid=f"{amount:,}".replace(",", " "))
    else:
        # Ordinary incoming transfers (not from customers) are only logged; the admin is told only while
        # some order is waiting for payment — then a mismatch probably matters.
        async with Session() as session:
            waiting = (await session.execute(select(Order.id).where(Order.status.in_(S.UNPAID)).limit(1))).first() \
                or (await session.execute(select(Topup.id).where(Topup.status.in_(T.OPEN)).limit(1))).first()
        if waiting:
            await ctx.notifier.admin_text("notice_unmatched", amount=f"{amount:,}".replace(",", " "), reason=result)
    log.info("Card notice %s: %s order=%s amount=%s", notice_id, result, order_id, amount)
    return {"result": result, "order_id": order_id, "amount": amount}
