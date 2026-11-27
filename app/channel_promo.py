"""Channel invite popup shown in the Mini App after the intro animation (CHANNEL_USERNAME + CHANNEL_POPUP).

Title and avatar are read from Telegram through the bot (cached for an hour); if the bot can see membership
(it is an admin of the channel) members don't get the popup at all.
"""

from __future__ import annotations

import logging
import time

from .context import get_context

log = logging.getLogger(__name__)
TTL = 3600
_info: dict = {"key": None, "at": 0.0, "title": "", "photo_id": "", "photo": None}


async def _load(username: str) -> None:
    ctx = get_context()
    if _info["key"] == username and time.monotonic() - _info["at"] < TTL:
        return
    _info.update(key=username, at=time.monotonic(), title="", photo_id="", photo=None)
    if ctx.bot is None:
        return
    try:
        chat = await ctx.bot.get_chat("@" + username)
        _info["title"] = chat.title or username
        if chat.photo:
            _info["photo_id"] = chat.photo.big_file_id
    except Exception as exc:  # noqa: BLE001 — wrong username, bot not allowed to read it
        log.info("Channel @%s info unavailable: %s", username, exc)


async def info(user_id: int) -> dict | None:
    """What the Mini App needs for the popup, or None when it should not be shown."""
    ctx = get_context()
    s = ctx.settings
    username = (s.channel_username or "").strip().lstrip("@")
    if not username or not s.channel_popup:
        return None
    await _load(username)
    joined = None
    if ctx.bot is not None:
        try:
            m = await ctx.bot.get_chat_member("@" + username, user_id)
            status = getattr(m.status, "value", m.status)
            joined = status in ("member", "administrator", "creator") or (status == "restricted" and bool(getattr(m, "is_member", False)))
        except Exception:  # noqa: BLE001 — bot is not an admin there: membership unknown
            joined = None
    if joined:
        return None
    return {"username": username, "title": _info["title"] or username, "url": f"https://t.me/{username}",
            "photo": "/api/channel/photo" if _info["photo_id"] else ""}


async def photo() -> bytes | None:
    ctx = get_context()
    if not _info["photo_id"] or ctx.bot is None:
        return None
    if _info["photo"] is None:
        try:
            buf = await ctx.bot.download(_info["photo_id"])
            _info["photo"] = buf.read() if buf else None
        except Exception as exc:  # noqa: BLE001
            log.info("Channel photo download failed: %s", exc)
            return None
    return _info["photo"]
