"""Admin bot commands and inline buttons."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, Message
from sqlalchemy import func, select

from .. import orders as svc
from ..config import get_settings
from ..context import get_context
from ..db import Order, OrderStatus as S, Session, get_setting, set_setting
from ..i18n import t
from ..pricing import RateUnavailable, pricing_config
from .common import fmt_sum, markup, user_lang, webapp_button
from .notify import admin_buttons

router = Router(name="admin")


def is_admin(user_id: int) -> bool:
    return user_id in get_settings().admin_ids


router.message.filter(F.from_user.func(lambda u: is_admin(u.id)))
router.callback_query.filter(F.from_user.func(lambda u: is_admin(u.id)))


@router.message(Command("admin"))
async def admin_home(message: Message) -> None:
    lang = await user_lang(message.from_user.id)
    ctx = get_context()
    async with Session() as session:
        counts = dict((await session.execute(select(Order.status, func.count(Order.id)).group_by(Order.status))).all())
    try:
        config = await pricing_config(ctx.rates)
        rate, mode = fmt_sum(int(config.rate_uzs_per_ton)), config.rate_mode
        markup_value = config.markup_percent
    except RateUnavailable:
        rate, mode, markup_value = "—", "?", "—"
    text = t(lang, "admin.summary", review=counts.get(S.PAYMENT_REVIEW, 0), paid=counts.get(S.PAID, 0),
             signing=counts.get(S.CONNECT_SIGNING, 0) + counts.get(S.RENTING, 0),
             active=counts.get(S.ACTIVE, 0) + counts.get(S.AWAITING_LINK, 0), failed=counts.get(S.FAILED, 0),
             rate=rate, mode=mode, markup=markup_value, wallet_mode=ctx.settings.wallet_mode)
    await message.answer(text, reply_markup=markup([webapp_button(t(lang, "admin.btn_panel"), admin=1)]))


@router.message(Command("markup"))
async def set_markup(message: Message, command: CommandObject) -> None:
    lang = await user_lang(message.from_user.id)
    try:
        value = Decimal((command.args or "").strip().replace(",", "."))
        if not 0 <= value <= 500:
            raise InvalidOperation
    except InvalidOperation:
        await message.answer(t(lang, "admin.usage_markup"))
        return
    async with Session() as session:
        await set_setting(session, "markup_percent", str(value))
    await message.answer(t(lang, "admin.saved") + f" {value}%")


@router.message(Command("rate"))
async def set_rate(message: Message, command: CommandObject) -> None:
    lang = await user_lang(message.from_user.id)
    arg = (command.args or "").strip().lower().replace(" ", "")
    async with Session() as session:
        if arg == "auto":
            await set_setting(session, "rate_mode", "auto")
            await message.answer(t(lang, "admin.saved") + " auto")
            return
        try:
            value = Decimal(arg.replace(",", "."))
            if value <= 0:
                raise InvalidOperation
        except InvalidOperation:
            await message.answer(t(lang, "admin.usage_rate"))
            return
        await set_setting(session, "manual_rate", str(value))
        await set_setting(session, "rate_mode", "manual")
    await message.answer(t(lang, "admin.saved") + f" 1 TON = {fmt_sum(int(value))}")


@router.message(Command("card"))
async def set_card(message: Message, command: CommandObject) -> None:
    lang = await user_lang(message.from_user.id)
    parts = (command.args or "").split()
    digits = [p for p in parts if p.isdigit()]
    number = "".join(digits)
    holder = " ".join(p for p in parts if not p.isdigit())
    if not 12 <= len(number) <= 19:
        await message.answer(t(lang, "admin.usage_card"))
        return
    pretty = " ".join(number[i:i + 4] for i in range(0, len(number), 4))
    async with Session() as session:
        await set_setting(session, "card_number", pretty)
        if holder:
            await set_setting(session, "card_holder", holder[:64])
    await message.answer(t(lang, "admin.saved") + f"\n{pretty}\n{holder}")


@router.message(Command("backup"))
async def backup_now(message: Message) -> None:
    from .. import backup
    lang = await user_lang(message.from_user.id)
    await message.answer(t(lang, "bk.started"))
    try:
        path = await backup.make_backup()
    except Exception as exc:  # noqa: BLE001
        await message.answer(t(lang, "bk.failed", error=type(exc).__name__))
        return
    sent = await backup.send_to_admins(message.bot, path)
    if not sent:
        await message.answer(t(lang, "bk.saved_local", file=path.name))


@router.message(Command("parse"))
async def parse_cmd(message: Message, command: CommandObject) -> None:
    """/parse <notice text> — show how a bank notice is read (nothing is confirmed)."""
    from ..card_notices import parse_notice
    lang = await user_lang(message.from_user.id)
    notice = parse_notice(command.args or "", get_settings().card_notify_regex)
    await message.answer(t(lang, "admin.parse_result", credit="✅" if notice.is_credit else "❌",
                           amount=notice.amount if notice.amount is not None else "—", card=notice.card_last4 or "—"))


def _is_card_notice(message: Message) -> bool:
    origin = getattr(message, "forward_origin", None)
    user = getattr(origin, "sender_user", None)
    name = (getattr(user, "username", "") or "").lower()
    return bool(name) and name in get_settings().card_bot_usernames and bool(message.text or message.caption)


@router.message(F.func(_is_card_notice))
async def forwarded_notice(message: Message) -> None:
    """Admin forwards a CardXabar notice → same automatic check as the userbot does."""
    from ..card_notices import forward_key, handle_notice
    lang = await user_lang(message.from_user.id)
    origin_date = getattr(message.forward_origin, "date", None)
    text = message.text or message.caption or ""
    result = await handle_notice(get_context(), forward_key(text, str(origin_date)), text)
    await message.answer(t(lang, f"admin.notice_{result['result']}", id=result.get("order_id") or "—",
                           amount=f"{result.get('amount') or 0:,}".replace(",", " ")))


@router.message(Command("order"))
async def show_order(message: Message, command: CommandObject) -> None:
    lang = await user_lang(message.from_user.id)
    try:
        order = await svc.get_order(int((command.args or "").strip().lstrip("#")))
    except (ValueError, svc.ServiceError):
        await message.answer(t(lang, "error.order_not_found"))
        return
    preset = {S.PAYMENT_REVIEW: "review", S.PAID: "paid", S.CONNECT_SIGNING: "sign", S.FAILED: "failed"}.get(order.status)
    text = (f"#{order.id} · {order.nft_name}\n{t(lang, 'status.' + order.status)}\n"
            f"{order.days} {t(lang, 'common.days')} · {fmt_sum(order.amount_uzs)} {t(lang, 'common.sum')}\n"
            f"user: {order.user_id}" + (f"\n⚠️ {order.error}" if order.error else ""))
    await message.answer(text, reply_markup=admin_buttons(order, preset, lang))


ACTIONS = {
    "confirm": svc.confirm_payment, "reject": svc.reject_payment, "cancel": svc.admin_cancel,
    "refund": svc.mark_refunded, "retry": svc.retry, "latepay": svc.confirm_late,
}


@router.callback_query(F.data.startswith("a:"))
async def admin_action(call: CallbackQuery) -> None:
    lang = await user_lang(call.from_user.id)
    try:
        _, action, raw_id = call.data.split(":", 2)
        order_id = int(raw_id)
    except ValueError:
        await call.answer()
        return
    ctx = get_context()
    try:
        if action == "sign":
            order = await svc.sign_pending_hot(ctx, order_id, f"admin:{call.from_user.id}")
        elif action in ACTIONS:
            order = await ACTIONS[action](ctx, order_id, call.from_user.id)
        else:
            await call.answer()
            return
    except svc.ServiceError as exc:
        status = exc.detail or exc.code
        await call.answer(t(lang, "admin.state_changed", status=status) if exc.code == "bad_state"
                          else t(lang, f"error.{exc.code}") + (f" ({exc.detail})" if exc.detail else ""), show_alert=True)
        return
    done = t(lang, "admin.done", id=order.id, status=t(lang, f"status.{order.status}"))
    await call.answer(done)
    if call.message:
        try:
            if call.message.caption is not None:
                await call.message.edit_caption(caption=f"{call.message.caption}\n\n✔️ {done}", reply_markup=None)
            else:
                await call.message.edit_text(f"{call.message.text}\n\n✔️ {done}", reply_markup=None)
        except Exception:
            pass
