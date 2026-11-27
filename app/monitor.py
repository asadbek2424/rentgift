"""Health alerts for admins: low TON on the admin wallet, Marketapp unreachable.

* Admin wallet balance (hot wallet or the TON Connect wallet address) is checked every 10 minutes through toncenter.
  Below MIN_TON_BALANCE every admin gets a Telegram message (again at most every 6 hours while it stays low) and the
  admin panel shows a red banner. Rentals silently stop working when the wallet is empty — this makes it loud.
* Marketapp: if its API fails for 3 checks in a row, admins are told once; they are told again when it is back.
"""

from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal

import httpx

from .context import AppContext
from .ton import NANO, ton_text

log = logging.getLogger(__name__)
CHECK_EVERY = 600
REPEAT_LOW = 6 * 3600
state: dict = {"balance_nano": None, "checked_at": None, "low": False, "low_alert_at": 0.0,
               "market_fail": 0, "market_down": False}


async def wallet_balance(ctx: AppContext) -> int | None:
    if ctx.hot_wallet is not None:
        return await ctx.hot_wallet.balance_nano()
    address = ctx.settings.admin_wallet_address
    if not address:
        return None
    headers = {"X-API-Key": ctx.settings.toncenter_api_key} if ctx.settings.toncenter_api_key else {}
    try:
        async with httpx.AsyncClient(base_url=ctx.settings.toncenter_url, timeout=15, headers=headers) as client:
            r = await client.get("/api/v2/getAddressBalance", params={"address": address})
            r.raise_for_status()
            return int(r.json().get("result") or 0)
    except Exception as exc:  # noqa: BLE001
        log.info("Wallet balance check failed: %s", type(exc).__name__)
        return None


async def _admins(ctx: AppContext, text: str) -> None:
    if ctx.bot is None:
        return
    for admin_id in ctx.settings.admin_ids:
        try:
            await ctx.bot.send_message(admin_id, text)
        except Exception as exc:  # noqa: BLE001
            log.warning("Alert to admin %s failed: %s", admin_id, exc)


async def check_wallet(ctx: AppContext) -> None:
    nano = await wallet_balance(ctx)
    state["checked_at"] = time.time()
    if nano is None:
        return
    state["balance_nano"] = nano
    threshold = Decimal(str(ctx.settings.min_ton_balance or 0))
    low = threshold > 0 and Decimal(nano) / NANO < threshold
    now = time.monotonic()
    if low and (not state["low"] or now - state["low_alert_at"] > REPEAT_LOW):
        state["low_alert_at"] = now
        await _admins(ctx, f"⚠️ <b>Admin hamyonida TON kam qoldi</b>\n\nBalans: <b>{ton_text(nano)} TON</b> "
                           f"(chegara: {threshold} TON).\nIjara va Stars/Premium to'lovlari to'xtab qolmasligi uchun "
                           f"hamyonni to'ldiring.")
    elif not low and state["low"]:
        await _admins(ctx, f"✅ Admin hamyoni to'ldirildi: {ton_text(nano)} TON")
    state["low"] = low


async def check_marketapp(ctx: AppContext) -> None:
    try:
        await ctx.market.gift_collections()        # cached 1 h by the client: cheap when healthy
        ok = True
    except Exception:  # noqa: BLE001
        ok = False
    if ok:
        if state["market_down"]:
            await _admins(ctx, "✅ Marketapp yana ishlayapti.")
        state.update(market_fail=0, market_down=False)
        return
    state["market_fail"] += 1
    if state["market_fail"] >= 3 and not state["market_down"]:
        state["market_down"] = True
        await _admins(ctx, "🚨 <b>Marketapp javob bermayapti</b> (3 marta ketma-ket).\nKatalog va ijaralar ishlamasligi mumkin. "
                           "Token va Marketapp holatini tekshiring.")


def summary(ctx: AppContext) -> dict:
    nano = state["balance_nano"]
    return {"walletTon": ton_text(nano) if nano is not None else None, "walletLow": bool(state["low"]),
            "minTon": float(ctx.settings.min_ton_balance or 0), "marketappDown": bool(state["market_down"])}


async def monitor_loop(ctx: AppContext) -> None:
    await asyncio.sleep(30)
    while True:
        for check in (check_wallet, check_marketapp):
            try:
                await check(ctx)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("Monitor check failed")
        await asyncio.sleep(CHECK_EVERY)
