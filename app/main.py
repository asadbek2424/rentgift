"""FastAPI app: Mini App static files + API + Telegram bot + background worker in one process."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import backup, orders
from .userbot import run_userbot
from .api import router as api_router, service_error_handler
from .config import get_settings
from .context import AppContext, NullNotifier, set_context
from .db import init_db
from .marketapp import DemoMarketapp, MarketappClient
from .pricing import RateProvider
from .ton import HotWallet, HotWalletError, same_address

log = logging.getLogger("giftrent")
ROOT = Path(__file__).resolve().parent.parent
WEBAPP = ROOT / "webapp"


def build_context() -> AppContext:
    settings = get_settings()
    if settings.demo_mode:
        market = DemoMarketapp()
    else:
        market = MarketappClient(settings.marketapp_api_token, settings.marketapp_base_url, settings.marketapp_rps)
    hot = None
    if settings.wallet_mode == "hot":
        hot = HotWallet(settings.hot_wallet_mnemonic, settings.toncenter_url, settings.toncenter_api_key,
                        expected_address=settings.admin_wallet_address)
        log.info("Hot wallet enabled: %s (%s)", hot.address.to_str(is_bounceable=False), hot.derivation)
    return AppContext(settings=settings, market=market, rates=RateProvider(), hot_wallet=hot, notifier=NullNotifier())


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    await init_db()
    ctx = build_context()
    tasks: list[asyncio.Task] = []
    if settings.run_bot and settings.bot_token:
        from .bot import configure_bot, create_bot
        from .bot.notify import BotNotifier
        bot, dp = create_bot(settings)
        ctx.bot = bot
        ctx.notifier = BotNotifier(bot)
        with contextlib.suppress(Exception):
            await configure_bot(bot, settings)
        with contextlib.suppress(Exception):
            ctx.bot_username = (await bot.get_me()).username or ""
        tasks.append(asyncio.create_task(dp.start_polling(bot, handle_signals=False), name="bot"))
    elif settings.run_bot:
        log.warning("BOT_TOKEN is empty: the Telegram bot is not started")
    set_context(ctx)
    tasks.append(asyncio.create_task(orders.worker_loop(ctx), name="worker"))
    tasks.append(asyncio.create_task(backup.backup_loop(ctx), name="backup"))
    tasks.append(asyncio.create_task(run_userbot(ctx), name="userbot"))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        await ctx.market.close()
        await ctx.rates.close()
        if ctx.hot_wallet:
            await ctx.hot_wallet.close()
        if ctx.bot:
            await ctx.bot.session.close()


def create_app() -> FastAPI:
    app = FastAPI(title="GiftRent", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.include_router(api_router)
    app.add_exception_handler(orders.ServiceError, service_error_handler)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/tonconnect-manifest.json")
    async def manifest():
        s = get_settings()
        return JSONResponse({"url": s.webapp_base, "name": s.app_name, "iconUrl": f"{s.webapp_base}/static/img/icon.png"},
                            headers={"Access-Control-Allow-Origin": "*"})

    app.mount("/locales", StaticFiles(directory=ROOT / "locales"), name="locales")
    app.mount("/static", StaticFiles(directory=WEBAPP), name="static")

    @app.get("/")
    async def index():
        return FileResponse(WEBAPP / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()