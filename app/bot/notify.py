"""Sends order notifications to customers and admins in their own language."""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError
from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup

from ..config import get_settings
from ..db import Order, Session, User, aware, utcnow
from ..i18n import t
from ..ton import ton_text
from .common import fmt_dt, fmt_left, fmt_sum, markup, user_lang, webapp_button

log = logging.getLogger(__name__)


def admin_buttons(order: Order, preset: str | None, lang: str) -> InlineKeyboardMarkup | None:
    settings = get_settings()
    hot = settings.wallet_mode == "hot" and bool(settings.hot_wallet_mnemonic)
    cb = lambda key, action: InlineKeyboardButton(text=t(lang, f"admin.{key}"), callback_data=f"a:{action}:{order.id}")
    if preset == "review":
        return markup([cb("btn_confirm", "confirm"), cb("btn_reject", "reject")], [cb("btn_cancel", "cancel")])
    if preset in ("paid", "sign"):
        if hot:
            sign = cb("btn_rent" if preset == "paid" else "btn_sign", "sign")
        else:
            sign = webapp_button(t(lang, "admin.btn_rent" if preset == "paid" else "admin.btn_sign"), admin=1, order=order.id)
        return markup([sign], [cb("btn_cancel", "cancel")] if preset == "paid" else [])
    if preset == "late":
        return markup([cb("btn_late_confirm", "latepay")], [cb("btn_refunded", "refund")])
    if preset == "failed":
        return markup([cb("btn_retry", "retry"), cb("btn_refunded", "refund")], [cb("btn_cancel", "cancel")])
    return None


class BotNotifier:
    def __init__(self, bot: Bot) -> None:
        self.bot = bot

    def _params(self, order: Order, lang: str, extra: dict) -> dict:
        name = order.nft_name + (f" (+{t(lang, 'ext.label')})" if getattr(order, "kind", "rent") == "extend" else "")
        params = {"id": order.id, "name": name, "days": order.days, "amount": fmt_sum(order.amount_uzs),
                  "ton": ton_text(int(order.cost_nano or 0) or order.ton_total_nano), "end": fmt_dt(order.end_time),
                  "profit": fmt_sum(order.profit_uzs or 0)}
        if "left_seconds" in extra:
            params["left"] = fmt_left(extra.pop("left_seconds"), lang)
        if extra.get("kind") in ("rent", "connect"):
            extra["kind"] = t(lang, f"admin.kind_{extra['kind']}")
        params.update(extra)
        return params

    async def user(self, order: Order, key: str, **params) -> None:
        lang = await user_lang(order.user_id)
        text = t(lang, f"notify.{key}", **self._params(order, lang, params))
        target = order.parent_id if key == "extended" and order.parent_id else order.id
        rows = [[webapp_button(t(lang, "notify.open"), order=target)]]
        if key == "expiring":
            rows.insert(0, [webapp_button(t(lang, "ext.btn"), order=order.id, extend=1)])
        keyboard = markup(*rows)
        try:
            await self.bot.send_message(order.user_id, text, reply_markup=keyboard)
        except TelegramForbiddenError:
            async with Session() as session:
                user = await session.get(User, order.user_id)
                if user:
                    user.bot_blocked = True
                    await session.commit()
        except TelegramAPIError as exc:
            log.warning("Cannot message user %s: %s", order.user_id, exc)

    async def admin(self, order: Order, key: str, buttons: str | None = None, **params) -> None:
        if key == "sign_connect_urgent" or key == "sign_needed":
            buttons = buttons or "sign"
        for admin_id in get_settings().admin_ids:
            lang = await user_lang(admin_id)
            text = t(lang, f"admin.{key}", **self._params(order, lang, dict(params)))
            try:
                await self.bot.send_message(admin_id, text, reply_markup=admin_buttons(order, buttons, lang))
            except TelegramAPIError as exc:
                log.warning("Cannot message admin %s: %s", admin_id, exc)

    async def admin_text(self, key: str, **params) -> None:
        for admin_id in get_settings().admin_ids:
            lang = await user_lang(admin_id)
            try:
                await self.bot.send_message(admin_id, t(lang, f"admin.{key}", **params))
            except TelegramAPIError as exc:
                log.warning("Cannot message admin %s: %s", admin_id, exc)

    async def receipt_to_admins(self, order: Order, *, file_id: str | None = None, kind: str = "photo",
                                data: bytes | None = None, filename: str = "receipt.jpg") -> tuple[str, str]:
        async with Session() as session:
            customer = await session.get(User, order.user_id)
        who = f"{customer.first_name} {customer.last_name}".strip() if customer else str(order.user_id)
        if customer and customer.username:
            who += f" (@{customer.username})"
        who += f" · id {order.user_id}"
        admins = get_settings().admin_ids
        if not admins:
            raise RuntimeError("ADMIN_IDS is empty")
        media = file_id or BufferedInputFile(data or b"", filename=filename)
        stored = file_id
        for admin_id in admins:
            lang = await user_lang(admin_id)
            label = order.nft_name + (f" (+{t(lang, 'ext.label')})" if order.kind == "extend" else "")
            caption = t(lang, "admin.new_receipt", id=order.id, user=who, name=label, days=order.days,
                        amount=fmt_sum(order.amount_uzs), ton=ton_text(int(order.cost_nano or 0) or order.ton_total_nano),
                        profit=fmt_sum(order.profit_uzs or 0))
            keyboard = admin_buttons(order, "review", lang)
            try:
                if kind == "photo":
                    message = await self.bot.send_photo(admin_id, stored or media, caption=caption, reply_markup=keyboard)
                    stored = stored or message.photo[-1].file_id
                else:
                    message = await self.bot.send_document(admin_id, stored or media, caption=caption, reply_markup=keyboard)
                    stored = stored or message.document.file_id
            except TelegramAPIError as exc:
                log.warning("Cannot send receipt to admin %s: %s", admin_id, exc)
        if not stored:
            raise RuntimeError("Receipt could not be delivered to any admin")
        return stored, kind
