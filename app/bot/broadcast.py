"""Admin broadcast: /broadcast → send any message (text, photo, video, …) → pick audience → confirm.

Messages are copied with ``copy_message`` (formatting, media and buttons are preserved), ~20 per second
to stay well inside Telegram limits. Users who blocked the bot are remembered and skipped next time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramRetryAfter
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, Message
from sqlalchemy import select, update

from ..config import get_settings
from ..db import Order, OrderStatus as S, Session, User
from ..i18n import t
from .common import fmt_sum, markup, user_lang

log = logging.getLogger(__name__)
router = Router(name="broadcast")
router.message.filter(F.from_user.func(lambda u: u.id in get_settings().admin_ids))
router.callback_query.filter(F.from_user.func(lambda u: u.id in get_settings().admin_ids))

SEGMENTS = ("all", "customers", "active")
DELAY = 0.05


@dataclass
class Draft:
    stage: str = "wait_message"          # wait_message → confirm → running
    chat_id: int = 0
    message_id: int = 0
    segment: str = "all"
    counts: dict = field(default_factory=dict)


DRAFTS: dict[int, Draft] = {}
RUNNING: set[int] = set()


async def audience(segment: str) -> list[int]:
    async with Session() as session:
        if segment == "customers":
            query = select(Order.user_id).distinct().join(User, User.id == Order.user_id).where(User.bot_blocked.is_(False))
        elif segment == "active":
            query = (select(Order.user_id).distinct().join(User, User.id == Order.user_id)
                     .where(User.bot_blocked.is_(False), Order.status.in_({S.ACTIVE, S.AWAITING_LINK})))
        else:
            query = select(User.id).where(User.bot_blocked.is_(False))
        return [int(row[0]) for row in (await session.execute(query)).all()]


def _keyboard(draft: Draft, lang: str):
    seg = lambda key: InlineKeyboardButton(
        text=("● " if draft.segment == key else "") + t(lang, f"bc.seg_{key}") + f" · {draft.counts.get(key, 0)}",
        callback_data=f"bc:seg:{key}")
    return markup([seg("all")], [seg("customers")], [seg("active")],
                  [InlineKeyboardButton(text=t(lang, "bc.send", n=draft.counts.get(draft.segment, 0)), callback_data="bc:send"),
                   InlineKeyboardButton(text=t(lang, "bc.cancel"), callback_data="bc:cancel")])


@router.message(Command("broadcast"))
async def start(message: Message) -> None:
    lang = await user_lang(message.from_user.id)
    if RUNNING:
        await message.answer(t(lang, "bc.busy"))
        return
    DRAFTS[message.from_user.id] = Draft()
    await message.answer(t(lang, "bc.prompt"))


@router.message(Command("cancel"))
async def cancel(message: Message) -> None:
    lang = await user_lang(message.from_user.id)
    DRAFTS.pop(message.from_user.id, None)
    await message.answer(t(lang, "bc.cancelled"))


@router.message(F.func(lambda m: getattr(DRAFTS.get(m.from_user.id), "stage", "") == "wait_message"
                        and not (m.text or "").startswith("/")))
async def capture(message: Message) -> None:
    lang = await user_lang(message.from_user.id)
    draft = DRAFTS[message.from_user.id]
    draft.chat_id, draft.message_id, draft.stage = message.chat.id, message.message_id, "confirm"
    draft.counts = {key: len(await audience(key)) for key in SEGMENTS}
    await message.answer(t(lang, "bc.preview"))
    await message.bot.copy_message(message.chat.id, message.chat.id, message.message_id)
    await message.answer(t(lang, "bc.choose"), reply_markup=_keyboard(draft, lang))


@router.callback_query(F.data.startswith("bc:"))
async def on_button(call: CallbackQuery) -> None:
    lang = await user_lang(call.from_user.id)
    draft = DRAFTS.get(call.from_user.id)
    if draft is None or draft.stage != "confirm":
        await call.answer(t(lang, "bc.expired"), show_alert=True)
        return
    _, action, *rest = call.data.split(":")
    if action == "seg" and rest and rest[0] in SEGMENTS:
        draft.segment = rest[0]
        await call.message.edit_reply_markup(reply_markup=_keyboard(draft, lang))
        await call.answer()
    elif action == "cancel":
        DRAFTS.pop(call.from_user.id, None)
        await call.message.edit_text(t(lang, "bc.cancelled"))
        await call.answer()
    elif action == "send":
        if RUNNING:
            await call.answer(t(lang, "bc.busy"), show_alert=True)
            return
        draft.stage = "running"
        DRAFTS.pop(call.from_user.id, None)
        await call.answer()
        status = await call.message.edit_text(t(lang, "bc.progress", done=0, total=draft.counts.get(draft.segment, 0),
                                                ok=0, fail=0))
        asyncio.create_task(run(call.bot, draft, status, lang))


async def run(bot: Bot, draft: Draft, status: Message, lang: str) -> dict:
    RUNNING.add(1)
    ok = fail = blocked = 0
    try:
        users = await audience(draft.segment)
        for index, user_id in enumerate(users, 1):
            for _ in range(3):
                try:
                    await bot.copy_message(user_id, draft.chat_id, draft.message_id)
                    ok += 1
                    break
                except TelegramRetryAfter as exc:
                    await asyncio.sleep(exc.retry_after + 1)
                except TelegramForbiddenError:
                    blocked += 1
                    fail += 1
                    async with Session() as session:
                        await session.execute(update(User).where(User.id == user_id).values(bot_blocked=True))
                        await session.commit()
                    break
                except TelegramAPIError as exc:
                    log.info("Broadcast to %s failed: %s", user_id, exc)
                    fail += 1
                    break
            await asyncio.sleep(DELAY)
            if index % 100 == 0:
                try:
                    await status.edit_text(t(lang, "bc.progress", done=index, total=len(users), ok=ok, fail=fail))
                except TelegramAPIError:
                    pass
        try:
            await status.edit_text(t(lang, "bc.done", ok=fmt_sum(ok), fail=fmt_sum(fail), blocked=fmt_sum(blocked)))
        except TelegramAPIError:
            pass
        return {"ok": ok, "fail": fail, "blocked": blocked}
    finally:
        RUNNING.discard(1)
