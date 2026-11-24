"""/userbot — connect the CardXabar reader account from inside the bot with a QR code.

Admin sends /userbot → the bot sends a QR picture → the separate account scans it in the Telegram app
(Settings → Devices → Link Desktop Device) → the session is stored in the database and the reader restarts.
If that account has a 2-step password, the bot asks for it; the admin's message is deleted right away.
"""

from __future__ import annotations

import asyncio
import io
import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import BufferedInputFile, Message

from .. import userbot
from ..config import get_settings
from ..i18n import t
from .common import user_lang

log = logging.getLogger(__name__)
router = Router(name="userbot_login")
router.message.filter(F.from_user.func(lambda u: u.id in get_settings().admin_ids))

_pending: dict[int, asyncio.Future] = {}     # admin id → waiting for the 2FA password
_running: set[int] = set()
QR_ROUNDS = 5                                # 5 × ~30 s


def _qr_png(url: str) -> bytes:
    import qrcode
    from qrcode.image.pure import PyPNGImage

    buffer = io.BytesIO()
    qrcode.make(url, image_factory=PyPNGImage, box_size=10, border=3).save(buffer)
    return buffer.getvalue()


@router.message(Command("userbot"))
async def userbot_cmd(message: Message, command: CommandObject) -> None:
    lang = await user_lang(message.from_user.id)
    settings = get_settings()
    arg = (command.args or "").strip().lower()
    if arg in ("status", "holat"):
        state = userbot.status.get("state", "off")
        await message.answer(t(lang, f"admin.userbot_state_{state}", me=userbot.status.get("me", "")))
        return
    if arg in ("off", "stop", "ochir"):
        await userbot.save_session("")
        await message.answer(t(lang, "admin.userbot_removed"))
        return
    if not (settings.userbot_api_id and settings.userbot_api_hash):
        await message.answer(t(lang, "admin.userbot_need_api"))
        return
    if message.from_user.id in _running:
        await message.answer(t(lang, "admin.userbot_busy"))
        return
    _running.add(message.from_user.id)
    asyncio.create_task(_login(message, lang))


async def _login(message: Message, lang: str) -> None:
    from telethon import TelegramClient
    from telethon.errors import PasswordHashInvalidError, SessionPasswordNeededError
    from telethon.sessions import StringSession

    settings = get_settings()
    admin_id = message.from_user.id
    client = TelegramClient(StringSession(), settings.userbot_api_id, settings.userbot_api_hash,
                            device_model="GiftRent notices", app_version="1.0")
    shown: list[Message] = []
    try:
        await client.connect()
        qr = await client.qr_login()
        done = False
        for _ in range(QR_ROUNDS):
            photo = BufferedInputFile(_qr_png(qr.url), filename="login.png")
            shown.append(await message.answer_photo(photo, caption=t(lang, "admin.userbot_scan")))
            try:
                await qr.wait(timeout=30)
                done = True
                break
            except asyncio.TimeoutError:
                await qr.recreate()
            except SessionPasswordNeededError:
                for attempt in range(3):
                    future = asyncio.get_running_loop().create_future()
                    _pending[admin_id] = future
                    await message.answer(t(lang, "admin.userbot_password"))
                    try:
                        password = await asyncio.wait_for(future, timeout=180)
                    except asyncio.TimeoutError:
                        break
                    try:
                        await client.sign_in(password=password)
                        done = True
                        break
                    except PasswordHashInvalidError:
                        await message.answer(t(lang, "admin.userbot_bad_password"))
                break
        if not done:
            await message.answer(t(lang, "admin.userbot_timeout"))
            return
        me = await client.get_me()
        if me.bot:
            await message.answer(t(lang, "admin.userbot_is_bot"))
            return
        await userbot.save_session(client.session.save())
        await message.answer(t(lang, "admin.userbot_ok", name=f"{me.first_name or ''} (id {me.id})".strip()))
    except Exception as exc:  # noqa: BLE001
        log.exception("Userbot QR login failed")
        await message.answer(t(lang, "admin.userbot_failed", error=type(exc).__name__))
    finally:
        _pending.pop(admin_id, None)
        _running.discard(admin_id)
        for item in shown:                       # QR codes are a login — don't leave them in the chat
            try:
                await item.delete()
            except Exception:  # noqa: BLE001
                pass
        if client.is_connected():
            await client.disconnect()


@router.message(F.text, F.func(lambda m: m.from_user and m.from_user.id in _pending))
async def password_reply(message: Message) -> None:
    future = _pending.pop(message.from_user.id, None)
    try:
        await message.delete()                   # never keep the password in the chat
    except Exception:  # noqa: BLE001
        pass
    if future and not future.done():
        future.set_result(message.text or "")
