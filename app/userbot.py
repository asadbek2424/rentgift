"""Userbot: a separate Telegram ACCOUNT (not a bot) that has CardXabar connected and reads its notices.

Telegram bots cannot read what another bot sends to a person, so the bank notices are read with the
official Telegram client API (Telethon) logged in as that separate account. Only messages coming from the
bots in CARD_NOTIFY_BOTS are looked at; nothing is ever sent from this account.

Setup: set USERBOT_API_ID and USERBOT_API_HASH, then an admin sends /userbot to the bot and scans the QR code
with the separate account (Settings → Devices → Link Desktop Device). The session is stored in the database.
(Alternative: tools/make_session.py → USERBOT_SESSION env.)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .card_notices import handle_notice
from .context import AppContext
from .db import Session, get_setting, set_setting

log = logging.getLogger(__name__)


SESSION_KEY = "userbot_session"
_restart = asyncio.Event()
_client = None                      # the running client, so a new login can replace it
status = {"state": "off", "me": ""}  # shown by /userbot


async def current_session(settings) -> str:
    async with Session() as session:
        stored = await get_setting(session, SESSION_KEY, "")
    return stored or settings.userbot_session


async def save_session(value: str) -> None:
    async with Session() as session:
        await set_setting(session, SESSION_KEY, value)
    request_restart()


def request_restart() -> None:
    _restart.set()
    if _client is not None and _client.is_connected():
        asyncio.get_running_loop().create_task(_client.disconnect())


async def _wait_restart() -> None:
    await _restart.wait()
    _restart.clear()


async def run_userbot(ctx: AppContext) -> None:
    global _client
    settings = ctx.settings
    if not (settings.userbot_api_id and settings.userbot_api_hash):
        status["state"] = "no_api"
        log.info("Userbot not configured (USERBOT_API_ID/HASH): card notices are checked only when forwarded")
        return
    try:
        from telethon import TelegramClient, events
        from telethon.sessions import StringSession
    except ImportError:
        log.error("telethon is not installed; add it to requirements")
        return

    while True:
        usernames = settings.card_bot_usernames   # re-read: the admin panel may change CARD_NOTIFY_BOTS
        session_string = await current_session(settings)
        if not session_string:
            status.update(state="off", me="")
            log.info("Userbot has no session yet — an admin can connect it with /userbot in the bot")
            await _wait_restart()
            continue
        _restart.clear()
        try:
            client = TelegramClient(StringSession(session_string), settings.userbot_api_id,
                                    settings.userbot_api_hash, device_model="GiftRent notices", app_version="1.0")
        except Exception:  # noqa: BLE001 — not a session string at all (e.g. a bot token pasted by mistake)
            log.error("Userbot session string is malformed — reconnect with /userbot")
            status.update(state="bad", me="")
            await ctx.notifier.admin_text("userbot_bad_session")
            await _wait_restart()
            continue
        _client = client
        try:
            await client.connect()
            if not await client.is_user_authorized():
                log.error("Userbot session is not valid any more — reconnect with /userbot")
                status.update(state="bad", me="")
                await ctx.notifier.admin_text("userbot_bad_session")
                await client.disconnect()
                await _wait_restart()
                continue
            bots = []
            for name in usernames:
                try:
                    bots.append(await client.get_entity(name))
                except Exception as exc:  # noqa: BLE001
                    log.warning("Cannot resolve @%s: %s", name, exc)
            if not bots:
                log.error("None of CARD_NOTIFY_BOTS could be found from the userbot account")
                status.update(state="no_bot")
                await client.disconnect()
                await _wait_restart()
                continue
            bot_ids = {b.id for b in bots}

            @client.on(events.NewMessage(chats=list(bot_ids), incoming=True))
            async def on_notice(event):  # noqa: ANN001
                if event.sender_id not in bot_ids:
                    return
                key = f"userbot:{event.chat_id}:{event.id}"
                try:
                    result = await handle_notice(ctx, key, event.raw_text or "")
                    log.info("Notice %s → %s", key, result.get("result"))
                except Exception:
                    log.exception("Card notice handling failed")

            # catch up on notices that arrived while the app was restarting (last hour only)
            since = datetime.now(timezone.utc) - timedelta(minutes=60)
            for bot in bots:
                async for message in client.iter_messages(bot, limit=20):
                    if message.date and message.date < since:
                        break
                    if message.sender_id in bot_ids and message.raw_text:
                        await handle_notice(ctx, f"userbot:{message.chat_id}:{message.id}", message.raw_text)
            me = await client.get_me()
            status.update(state="on", me=f"{me.first_name or ''} (id {me.id})".strip())
            log.info("Userbot listening as %s for %s", me.id, ", ".join("@" + u for u in usernames))
            await client.run_until_disconnected()
            if _restart.is_set():
                _restart.clear()
                continue                                  # new session saved → reconnect immediately
        except asyncio.CancelledError:
            await client.disconnect()
            raise
        except Exception:
            log.exception("Userbot crashed; reconnecting in 30 s")
            status.update(state="error")
        finally:
            if client.is_connected():
                await client.disconnect()
        await asyncio.sleep(30)
