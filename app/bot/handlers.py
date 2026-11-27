"""Customer-facing bot handlers."""

from __future__ import annotations

import re

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message

from .. import orders as svc
from ..config import get_settings
from ..context import get_context
from ..db import Order, OrderStatus as S, Session, User
from ..i18n import LANGS, guess_lang, t
from .common import lang_keyboard, markup, user_lang, webapp_button
from sqlalchemy import select

router = Router(name="user")
LINK_RE = re.compile(r"(tc://|ton-connect|[?&]v=2&id=)", re.IGNORECASE)
RECEIPT_MIME = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


async def _ensure_user(message: Message) -> tuple[User, bool]:
    tg = message.from_user
    async with Session() as session:
        existing = await session.get(User, tg.id)
        is_new = existing is None or existing.lang is None
    user = await svc.upsert_user(tg.id, tg.first_name or "", tg.last_name or "", tg.username or "")
    if user.bot_blocked:
        async with Session() as session:
            row = await session.get(User, tg.id)
            row.bot_blocked = False
            await session.commit()
    return user, is_new


async def send_welcome(message: Message, lang: str, name: str) -> None:
    settings = get_settings()
    keyboard = markup([webapp_button(t(lang, "bot.open_app"))])
    await message.answer(t(lang, "bot.welcome", name=name or "👋", app=settings.app_name), reply_markup=keyboard)


async def register_start(message: Message) -> tuple[User, bool]:
    """Create/refresh the user, apply a ref_<id> start parameter and set a first language."""
    user, is_new = await _ensure_user(message)
    arg = (message.text or "").partition(" ")[2].strip()
    if arg.startswith("ref_") and arg[4:].isdigit():
        from ..wallet import set_referrer
        if await set_referrer(user.id, int(arg[4:])):
            notify = getattr(get_context().notifier, "user_text", None)
            if notify:
                await notify(int(arg[4:]), "ref_joined", name=message.from_user.first_name or "👤")
    if is_new:
        await svc.set_lang(user.id, guess_lang(message.from_user.language_code, get_settings().default_lang))
    return user, is_new


@router.message(CommandStart())
async def start(message: Message) -> None:
    user, is_new = await register_start(message)
    arg = (message.text or "").partition(" ")[2].strip()
    if arg.startswith("gift_") and 4 < len(arg) <= 40:        # someone sent this user a gift link
        lang = await user_lang(user.id)
        await message.answer(t(lang, "bot.gift_link"), reply_markup=markup([webapp_button(t(lang, "bot.gift_open"),
                                                                                              gift=arg[5:])]))
        return
    if is_new:
        await message.answer(t(await user_lang(user.id), "bot.choose_lang"), reply_markup=lang_keyboard())
        return
    await send_welcome(message, user.lang, user.first_name)


@router.message(Command("lang"))
async def choose_lang(message: Message) -> None:
    await _ensure_user(message)
    await message.answer(t(await user_lang(message.from_user.id), "bot.choose_lang"), reply_markup=lang_keyboard())


@router.callback_query(F.data.startswith("lang:"))
async def set_lang(call: CallbackQuery) -> None:
    lang = call.data.split(":", 1)[1]
    if lang not in LANGS:
        await call.answer()
        return
    await svc.set_lang(call.from_user.id, lang)
    await call.answer(t(lang, "lang.changed"))
    if call.message:
        await call.message.edit_text(t(lang, "lang.changed"))
        await send_welcome(call.message, lang, call.from_user.first_name or "")


@router.message(Command("help"))
async def help_cmd(message: Message) -> None:
    await _ensure_user(message)
    lang = await user_lang(message.from_user.id)
    text = t(lang, "bot.help")
    support = get_settings().support_username
    if support:
        text += "\n\n" + t(lang, "bot.support", support=support)
    await message.answer(text, reply_markup=markup([webapp_button(t(lang, "bot.open_app"))]))


@router.message(Command("orders"))
async def orders_cmd(message: Message) -> None:
    await _ensure_user(message)
    lang = await user_lang(message.from_user.id)
    async with Session() as session:
        rows = list((await session.execute(select(Order).where(Order.user_id == message.from_user.id)
                                           .order_by(Order.id.desc()).limit(10))).scalars())
    if not rows:
        await message.answer(t(lang, "bot.no_orders"), reply_markup=markup([webapp_button(t(lang, "bot.open_app"))]))
        return
    lines = [t(lang, "bot.orders")] + [t(lang, "bot.order_line", id=o.id, name=o.nft_name, days=o.days,
                                         status=t(lang, f"status.{o.status}")) for o in rows]
    await message.answer("\n".join(lines), reply_markup=markup([webapp_button(t(lang, "nav.rentals"), tab="rentals")]))


@router.message(F.photo | F.document)
async def receipt(message: Message) -> None:
    await _ensure_user(message)
    lang = await user_lang(message.from_user.id)
    order = await svc.latest_order(message.from_user.id, {S.AWAITING_PAYMENT})
    if order is None:
        await message.answer(t(lang, "bot.receipt_no_order"))
        return
    if message.photo:
        file_id, kind = message.photo[-1].file_id, "photo"
    else:
        if (message.document.mime_type or "") not in RECEIPT_MIME:
            await message.answer(t(lang, "error.file_type"))
            return
        file_id, kind = message.document.file_id, "document"
    try:
        await svc.attach_receipt(get_context(), message.from_user.id, order.id, file_id=file_id, kind=kind)
    except svc.ServiceError as exc:
        await message.answer(t(lang, f"error.{exc.code}"))
        return
    await message.answer(t(lang, "bot.receipt_received", id=order.id))


@router.message(F.text.regexp(LINK_RE))
async def fragment_link(message: Message) -> None:
    await _ensure_user(message)
    lang = await user_lang(message.from_user.id)
    order = await svc.latest_order(message.from_user.id, {S.AWAITING_LINK})
    if order is None:
        order = await svc.latest_order(message.from_user.id, {S.ACTIVE})
    if order is None:
        await message.answer(t(lang, "bot.link_no_order"))
        return
    await message.answer(t(lang, "bot.link_received"))
    try:
        await svc.submit_link(get_context(), message.from_user.id, order.id, message.text)
    except svc.ServiceError as exc:
        await message.answer(t(lang, f"error.{exc.code}"))
    # success is announced by the notifier ("active" or admin signature pending)


@router.message(F.text)
async def fallback(message: Message) -> None:
    user, _ = await _ensure_user(message)
    lang = await user_lang(user.id)
    await message.answer(t(lang, "bot.help"), reply_markup=markup([webapp_button(t(lang, "bot.open_app"))]))
