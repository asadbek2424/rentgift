"""Userbot: a separate Telegram ACCOUNT (not a bot) that has CardXabar connected and reads its notices.

Telegram bots cannot read what another bot sends to a person, so the bank notices are read with the
official Telegram client API (Telethon) logged in as that separate account. Only messages coming from the
bots in CARD_NOTIFY_BOTS are looked at; nothing is ever sent from this account.

Setup (once, on your own computer):
    pip install telethon
    python tools/make_session.py          → prints USERBOT_SESSION (keep it secret, it is a login!)
Then set USERBOT_API_ID, USERBOT_API_HASH and USERBOT_SESSION in Railway / .env.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .card_notices import handle_notice
from .context import AppContext

log = logging.getLogger(__name__)


async def run_userbot(ctx: AppContext) -> None:
    settings = ctx.settings
    if not (settings.userbot_api_id and settings.userbot_api_hash and settings.userbot_session):
        log.info("Userbot not configured: card notices are checked only when an admin forwards them")
        return
    try:
        from telethon import TelegramClient, events
        from telethon.sessions import StringSession
    except ImportError:
        log.error("telethon is not installed; add it to requirements")
        return

    usernames = settings.card_bot_usernames
    while True:
        client = TelegramClient(StringSession(settings.userbot_session), settings.userbot_api_id,
                                settings.userbot_api_hash, device_model="GiftRent notices", app_version="1.0")
        try:
            await client.connect()
            if not await client.is_user_authorized():
                log.error("USERBOT_SESSION is not valid any more — create a new one with tools/make_session.py")
                await ctx.notifier.admin_text("userbot_bad_session")
                return
            bots = []
            for name in usernames:
                try:
                    bots.append(await client.get_entity(name))
                except Exception as exc:  # noqa: BLE001
                    log.warning("Cannot resolve @%s: %s", name, exc)
            if not bots:
                log.error("None of CARD_NOTIFY_BOTS could be found from the userbot account")
                return
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
            log.info("Userbot listening as %s for %s", me.id, ", ".join("@" + u for u in usernames))
            await client.run_until_disconnected()
        except asyncio.CancelledError:
            await client.disconnect()
            raise
        except Exception:
            log.exception("Userbot crashed; reconnecting in 30 s")
        finally:
            if client.is_connected():
                await client.disconnect()
        await asyncio.sleep(30)
