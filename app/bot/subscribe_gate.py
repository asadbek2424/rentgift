"""Bot side of mandatory channels: non-subscribed customers get a "join → ✅ check" message instead of the bot."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message, TelegramObject

from .. import subscription
from ..i18n import t
from .common import markup, user_lang

router = Router(name="subscribe")


def gate_keyboard(channels: list[dict], lang: str):
    rows = [[InlineKeyboardButton(text=f"📢 {c['title']}", url=c["url"])] for c in channels if c.get("url")]
    rows.append([InlineKeyboardButton(text=t(lang, "sub.check"), callback_data="sub:check")])
    return markup(*rows)


async def send_gate(message: Message, channels: list[dict]) -> None:
    lang = await user_lang(message.from_user.id)
    await message.answer(f"<b>{t(lang, 'sub.title')}</b>\n\n{t(lang, 'sub.text')}", reply_markup=gate_keyboard(channels, lang))


class SubscriptionGate(BaseMiddleware):
    """Runs before every customer handler. /start still registers the user (and the referral) first."""

    async def __call__(self, handler: Callable[[TelegramObject, dict], Awaitable[Any]], event: TelegramObject, data: dict) -> Any:
        user = getattr(event, "from_user", None)
        if user is None:
            return await handler(event, data)
        if isinstance(event, CallbackQuery) and (event.data or "").startswith("sub:"):
            return await handler(event, data)
        need = await subscription.missing(user.id)
        if not need:
            return await handler(event, data)
        if isinstance(event, Message):
            if (event.text or "").startswith("/start"):
                from .handlers import register_start
                await register_start(event)
            await send_gate(event, need)
        elif isinstance(event, CallbackQuery):
            lang = await user_lang(user.id)
            await event.answer(t(lang, "sub.not_yet"), show_alert=True)
            if event.message:
                await event.message.answer(f"<b>{t(lang, 'sub.title')}</b>\n\n{t(lang, 'sub.text')}",
                                           reply_markup=gate_keyboard(need, lang))
        return None


@router.callback_query(F.data == "sub:check")
async def check(call: CallbackQuery) -> None:
    lang = await user_lang(call.from_user.id)
    need = await subscription.missing(call.from_user.id, fresh=True)
    if need:
        await call.answer(t(lang, "sub.not_yet"), show_alert=True)
        return
    await call.answer(t(lang, "sub.ok"))
    try:
        await call.message.delete()
    except Exception:  # noqa: BLE001 — too old to delete
        pass
    from .handlers import send_welcome
    from ..db import Session, User
    async with Session() as session:
        user = await session.get(User, call.from_user.id)
    await send_welcome(call.message, lang, user.first_name if user else call.from_user.first_name)
