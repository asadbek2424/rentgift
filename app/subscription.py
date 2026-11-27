"""Mandatory channel subscription.

Admins add channels in the admin panel; the bot must be an administrator there (Telegram only lets admins
check membership). Customers who are not subscribed see a "subscribe → ✅ check" screen in the bot and the
Mini App, and the API refuses other requests with ``{"code": "subscribe"}``. Admins are never gated.
If a check cannot be made (bot was removed from the channel, Telegram error) the user is let through and the
problem is logged — a broken channel must not lock every customer out of the shop.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone

from .context import get_context
from .db import Session, get_setting, set_setting

log = logging.getLogger(__name__)
KEY = "required_channels"
OK_TTL, MISS_TTL = 300, 15            # cache a positive check for 5 min, a negative one for 15 s
_cache: dict[tuple[int, int], tuple[bool, float]] = {}
MEMBER = {"member", "administrator", "creator"}


class ChannelError(ValueError):
    pass


async def load() -> list[dict]:
    async with Session() as session:
        raw = await get_setting(session, KEY, "[]")
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return []
    return [c for c in items if isinstance(c, dict) and c.get("chat_id")]


async def _store(items: list[dict]) -> None:
    async with Session() as session:
        await set_setting(session, KEY, json.dumps(items, ensure_ascii=False))
    _cache.clear()


def public(c: dict) -> dict:
    return {"chat_id": c["chat_id"], "title": c.get("title") or c.get("username") or str(c["chat_id"]), "url": c.get("url", "")}


async def is_member(bot, chat_id: int, user_id: int) -> bool:
    key = (chat_id, user_id)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[1] < (OK_TTL if hit[0] else MISS_TTL):
        return hit[0]
    try:
        m = await bot.get_chat_member(chat_id, user_id)
        status = getattr(m.status, "value", m.status)
        ok = status in MEMBER or (status == "restricted" and bool(getattr(m, "is_member", False)))
    except Exception as exc:  # noqa: BLE001 — bot not admin any more, chat deleted, Telegram hiccup
        log.warning("Subscription check failed for channel %s: %s — letting the user through", chat_id, exc)
        ok = True
    _cache[key] = (ok, time.monotonic())
    return ok


async def missing(user_id: int, fresh: bool = False) -> list[dict]:
    """Channels the user still has to join (empty = allowed)."""
    ctx = get_context()
    if ctx.bot is None or user_id in ctx.settings.admin_ids:
        return []
    channels = [c for c in await load() if c.get("enabled", True)]
    if not channels:
        return []
    if fresh:
        for c in channels:
            _cache.pop((c["chat_id"], user_id), None)
    out = []
    for c in channels:
        if not await is_member(ctx.bot, c["chat_id"], user_id):
            out.append(public(c))
    return out


# ---------------------------------------------------------------------------- admin side
_USERNAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,31}$")


def parse_target(raw: str):
    """'@name', 'name', 'https://t.me/name' → '@name';  '-100123…' → int.  Private '+invite' links need the ID."""
    text = (raw or "").strip()
    m = re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/(.+)$", text, re.IGNORECASE)
    if m:
        text = m.group(1).split("?")[0].strip("/")
        if text.startswith("+") or text.startswith("joinchat"):
            raise ChannelError("Yopiq kanal havolasidan kanalni aniqlab bo'lmaydi. Kanal ID sini (-100… bilan) kiriting, "
                               "havolani esa «Taklif havolasi» maydoniga qo'ying.")
    if re.fullmatch(r"-?\d{6,20}", text):
        return int(text)
    text = text.lstrip("@")
    if not _USERNAME.match(text):
        raise ChannelError("Kanalni @username, https://t.me/username yoki -100… ID ko'rinishida kiriting")
    return "@" + text


async def add(raw: str, invite_link: str = "") -> dict:
    bot = get_context().bot
    if bot is None:
        raise ChannelError("Bot ishlamayapti (BOT_TOKEN / RUN_BOT)")
    target = parse_target(raw)
    try:
        chat = await bot.get_chat(target)
    except Exception:  # noqa: BLE001
        raise ChannelError("Kanal topilmadi. Username/ID to'g'rimi va bot kanalga qo'shilganmi?") from None
    if chat.type not in ("channel", "supergroup"):
        raise ChannelError("Bu kanal yoki guruh emas")
    me = await bot.get_me()
    try:
        bot_member = await bot.get_chat_member(chat.id, me.id)
        bot_status = getattr(bot_member.status, "value", bot_member.status)
    except Exception:  # noqa: BLE001
        bot_status = "left"
    if bot_status not in ("administrator", "creator"):
        raise ChannelError(f"Botni (@{me.username}) kanalga ADMIN qilib qo'shing, keyin qayta urinib ko'ring. "
                           "Obunani tekshirish uchun Telegram bunga faqat adminlarga ruxsat beradi.")
    invite_link = (invite_link or "").strip()
    if invite_link and not re.match(r"^https://t\.me/\S+$", invite_link):
        raise ChannelError("Taklif havolasi https://t.me/... ko'rinishida bo'lsin")
    if chat.username:
        url = f"https://t.me/{chat.username}"
    elif invite_link:
        url = invite_link
    else:
        url = chat.invite_link or ""
        if not url:
            try:
                url = await bot.export_chat_invite_link(chat.id)
            except Exception:  # noqa: BLE001
                raise ChannelError("Yopiq kanal uchun taklif havolasini kiriting (botda «taklif havolasi» huquqi yo'q)") from None
    items = [c for c in await load() if c["chat_id"] != chat.id]
    channel = {"chat_id": chat.id, "username": chat.username or "", "title": chat.title or chat.username or str(chat.id),
               "url": url, "enabled": True, "added_at": datetime.now(timezone.utc).isoformat()}
    items.append(channel)
    await _store(items)
    return channel


async def remove(chat_id: int) -> None:
    await _store([c for c in await load() if c["chat_id"] != chat_id])


async def toggle(chat_id: int, enabled: bool) -> None:
    items = await load()
    for c in items:
        if c["chat_id"] == chat_id:
            c["enabled"] = enabled
    await _store(items)


async def describe() -> list[dict]:
    """For the panel: each channel with live bot-admin status and member count."""
    bot = get_context().bot
    out = []
    me = await bot.get_me() if bot else None
    for c in await load():
        info = {**c, "bot_admin": None, "members": None}
        if bot:
            try:
                st = await bot.get_chat_member(c["chat_id"], me.id)
                info["bot_admin"] = getattr(st.status, "value", st.status) in ("administrator", "creator")
            except Exception:  # noqa: BLE001
                info["bot_admin"] = False
            try:
                info["members"] = await bot.get_chat_member_count(c["chat_id"])
            except Exception:  # noqa: BLE001
                pass
        out.append(info)
    return out
