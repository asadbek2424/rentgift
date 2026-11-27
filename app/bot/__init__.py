"""Bot factory."""

from __future__ import annotations

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeChat, MenuButtonWebApp, WebAppInfo

from ..config import Settings
from ..i18n import LANGS, t
from . import admin, broadcast, handlers, subscribe_gate, userbot_login


def create_bot(settings: Settings) -> tuple[Bot, Dispatcher]:
    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(userbot_login.router)  # admin-only; catches the 2FA password reply
    dp.include_router(broadcast.router)  # admin-only; must see the next admin message after /broadcast
    dp.include_router(admin.staff_router)   # /panel for owners and operators
    dp.include_router(admin.router)     # admin first: its filter only matches admins
    dp.include_router(subscribe_gate.router)                      # «✅ Check subscription» button
    gate = subscribe_gate.SubscriptionGate()
    handlers.router.message.middleware(gate)                      # mandatory channels for customers
    handlers.router.callback_query.middleware(gate)
    dp.include_router(handlers.router)
    return bot, dp


async def configure_bot(bot: Bot, settings: Settings) -> None:
    """Menu button + command lists for each language."""
    for lang in LANGS:
        commands = [BotCommand(command="start", description=t(lang, "bot.open_app")),
                    BotCommand(command="orders", description=t(lang, "nav.rentals")),
                    BotCommand(command="lang", description=t(lang, "profile.lang")),
                    BotCommand(command="help", description=t(lang, "guide.title"))]
        await bot.set_my_commands(commands, language_code=lang)
    admin_commands = [BotCommand(command="admin", description="Admin"),
                      BotCommand(command="panel", description="Admin panel (sayt) — kirish havolasi"),
                      BotCommand(command="broadcast", description="Broadcast / Рассылка / Xabar yuborish"),
                      BotCommand(command="backup", description="Backup / Zaxira"),
                      BotCommand(command="userbot", description="CardXabar akkaunt ulash / status"),
                      BotCommand(command="notices", description="CardXabar xabarlari / Уведомления"),
                      BotCommand(command="order", description="/order 12"),
                      BotCommand(command="markup", description="/markup 15"),
                      BotCommand(command="rate", description="/rate auto"),
                      BotCommand(command="card", description="/card 8600… Name"),
                      BotCommand(command="cancel", description="Cancel")]
    for admin_id in settings.admin_ids:
        try:
            await bot.set_my_commands(admin_commands, scope=BotCommandScopeChat(chat_id=admin_id))
        except Exception:  # noqa: BLE001 — admin never opened the bot yet
            pass
    if settings.webapp_base.startswith("https://"):
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
            text=settings.app_name[:16], web_app=WebAppInfo(url=settings.webapp_base + "/")))
