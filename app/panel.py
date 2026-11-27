"""API for the standalone React admin panel (``admin-panel/``, deployed to Vercel).

Auth:   POST /api/panel/login         {username: <admin Telegram ID>, password: ADMIN_PANEL_PASSWORD}
        POST /api/panel/request-code  {admin_id}            → bot sends a 6-digit code
        POST /api/panel/auth          {token}               → one-time link token from the bot's /panel command, or "<id>:<code>"
        → {session, admin}; the session goes into ``Authorization: Bearer …`` (also accepted by /api/admin/*).
Data:   dashboard, users, activity log, broadcast, system status.
Order / top-up / purchase actions, pricing and settings reuse the existing /api/admin/* endpoints.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update

from . import admin_auth
from .api import CurrentUser, admin_user, owner_user
from .context import get_context
from .db import Order, OrderEvent, OrderStatus as S, Purchase, Session, Topup, User

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/panel")

DONE = {S.ACTIVE, S.EXPIRED, S.AWAITING_LINK, S.CONNECTING, S.CONNECT_SIGNING, S.RENTING, S.EXTENDED}
LINK_TTL = 600
_links: dict[str, tuple[int, float]] = {}   # one-time login links issued by the bot: token -> (admin_id, expires)


def issue_link_token(admin_id: int) -> str:
    """Used by the bot's /panel command: a single-use token for ``<ADMIN_PANEL_URL>/#/login?t=…``."""
    now = time.time()
    for key, (_, exp) in list(_links.items()):
        if exp < now:
            _links.pop(key, None)
    token = secrets.token_urlsafe(24)
    _links[token] = (admin_id, now + LINK_TTL)
    return token


def _ts(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def _name(user: User | None) -> str:
    if not user:
        return ""
    return " ".join(p for p in (user.first_name, user.last_name) if p).strip() or (f"@{user.username}" if user.username else str(user.id))


async def _session_for(admin_id: int) -> dict:
    token, exp = admin_auth.make_token(get_context().settings, admin_id)
    async with Session() as session:
        user = await session.get(User, admin_id)
    return {"session": token, "expires_at": exp, "admin": {"id": admin_id, "name": _name(user) or "Admin",
                                                              "username": user.username if user else "",
                                                              "role": get_context().settings.role_of(admin_id)}}


# ---------------------------------------------------------------------------- auth
class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class TokenBody(BaseModel):
    token: str = Field(min_length=4, max_length=120)


class CodeBody(BaseModel):
    admin_id: int


def _bad():
    return HTTPException(401, detail={"code": "bad_code", "error": "Login, parol yoki kod noto'g'ri"})


@router.post("/login")
async def login(body: LoginBody):
    s = get_context().settings
    try:
        admin_id = int(body.username.strip().lstrip("@"))
    except ValueError:
        raise _bad() from None
    if admin_auth.password_locked(admin_id):
        raise HTTPException(429, detail={"code": "too_many", "error": "Ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring"})
    if not s.admin_panel_password:
        raise HTTPException(400, detail={"code": "no_password", "error": "ADMIN_PANEL_PASSWORD o'rnatilmagan — Telegram kodi bilan kiring"})
    if admin_id not in s.staff_ids or not admin_auth.check_password(s, body.password, admin_id):
        raise _bad()
    return await _session_for(admin_id)


@router.post("/request-code")
async def request_code(body: CodeBody):
    ctx = get_context()
    if body.admin_id in ctx.settings.staff_ids and ctx.bot is not None:
        code = admin_auth.new_code(body.admin_id)
        if code is None:
            raise HTTPException(429, detail={"code": "too_many", "error": "Kod yaqinda yuborilgan, biroz kuting"})
        try:
            await ctx.bot.send_message(body.admin_id, f"🔐 Admin panel kodi: <code>{code}</code>\n5 daqiqa amal qiladi.",
                                       parse_mode="HTML")
        except Exception:  # noqa: BLE001
            log.warning("Could not send panel code to %s", body.admin_id)
    return {"ok": True}


@router.post("/auth")
async def auth(body: TokenBody):
    token = body.token.strip()
    entry = _links.pop(token, None)
    if entry and entry[1] >= time.time():
        return await _session_for(entry[0])
    if ":" in token:   # "<admin_id>:<6-digit code>"
        raw_id, _, code = token.partition(":")
        try:
            admin_id = int(raw_id)
        except ValueError:
            raise _bad() from None
        if admin_id in get_context().settings.staff_ids and admin_auth.verify_code(admin_id, code):
            return await _session_for(admin_id)
    raise _bad()


@router.post("/logout")
async def logout():
    return {"ok": True}   # sessions are stateless signed tokens; the panel forgets its copy


@router.get("/info")
async def info():
    ctx = get_context()
    return {"app": ctx.settings.app_name, "bot_username": ctx.bot_username, "code_login": ctx.bot is not None,
            "password_login": bool(ctx.settings.admin_panel_password)}


# ---------------------------------------------------------------------------- dashboard
@router.get("/dashboard")
async def dashboard(admin: CurrentUser = Depends(admin_user)):
    ctx = get_context()
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_start = (month_start - timedelta(days=1)).replace(day=1)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since = day_start - timedelta(days=13)
    async with Session() as session:
        q = lambda stmt: session.execute(stmt)
        sum_orders = lambda start, end=None: select(func.coalesce(func.sum(Order.amount_uzs), 0), func.coalesce(func.sum(Order.profit_uzs), 0)) \
            .where(Order.status.in_(DONE), Order.created_at >= start, *( [Order.created_at < end] if end else []))
        month_rev, month_profit = (await q(sum_orders(month_start))).one()
        prev_rev, prev_profit = (await q(sum_orders(prev_start, month_start))).one()
        total_rev, total_profit = (await q(select(func.coalesce(func.sum(Order.amount_uzs), 0), func.coalesce(func.sum(Order.profit_uzs), 0))
                                           .where(Order.status.in_(DONE)))).one()
        purchases_month = (await q(select(func.coalesce(func.sum(Purchase.price_uzs), 0))
                                   .where(Purchase.status == "done", Purchase.created_at >= month_start))).scalar_one()
        users = (await q(select(func.count(User.id)))).scalar_one()
        new_today = (await q(select(func.count(User.id)).where(User.created_at >= day_start))).scalar_one()
        active_today = (await q(select(func.count(User.id)).where(User.last_seen >= day_start))).scalar_one()
        balances = (await q(select(func.coalesce(func.sum(User.balance_uzs), 0)))).scalar_one()
        status_counts = dict((await q(select(Order.status, func.count(Order.id)).group_by(Order.status))).all())
        open_topups = (await q(select(func.count(Topup.id)).where(Topup.status.in_({"pending", "review"})))).scalar_one()
        open_purchases = (await q(select(func.count(Purchase.id)).where(Purchase.status.in_({"pending", "signing", "sent", "failed"})))).scalar_one()

        # 14-day chart
        rows = (await q(select(Order.created_at, Order.amount_uzs, Order.profit_uzs, Order.status).where(Order.created_at >= since))).all()
        user_rows = (await q(select(User.created_at).where(User.created_at >= since))).all()
        days = [(since + timedelta(days=i)) for i in range(14)]
        chart = {d.date(): {"day": d.strftime("%d.%m"), "orders": 0, "revenue": 0, "profit": 0, "newUsers": 0} for d in days}
        for created, amount, profit, status in rows:
            key = (created if created.tzinfo else created.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date()
            if key in chart:
                chart[key]["orders"] += 1
                if status in DONE:
                    chart[key]["revenue"] += int(amount or 0)
                    chart[key]["profit"] += int(profit or 0)
        for (created,) in user_rows:
            key = (created if created.tzinfo else created.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).date()
            if key in chart:
                chart[key]["newUsers"] += 1

        by_cat = (await q(select(Order.category, func.count(Order.id)).where(Order.status.in_(DONE)).group_by(Order.category))).all()
        by_coll = (await q(select(Order.nft_name, func.count(Order.id)).where(Order.status.in_(DONE), Order.category == "gift")
                            .group_by(Order.nft_name))).all()
        pending = (await q(select(Order, User).join(User, User.id == Order.user_id)
                           .where(Order.status.in_({S.PAYMENT_REVIEW, S.PAID, S.CONNECT_SIGNING, S.FAILED}))
                           .order_by(Order.id.desc()).limit(6))).all()
        top = (await q(select(User).where(User.spent_uzs > 0).order_by(User.spent_uzs.desc()).limit(5))).scalars().all()

    collections: dict[str, int] = {}
    for name, count in by_coll:
        coll = (name or "").rpartition(" #")[0] or name
        collections[coll] = collections.get(coll, 0) + int(count)
    from . import monitor, userbot
    if admin.role == "operator":                  # operators work with orders, not with money
        month_profit = prev_profit = total_profit = 0
        for point in chart.values():
            point["profit"] = 0
    return {
        "role": admin.role or "owner",
        "health": monitor.summary(ctx),
        "monthRevenue": int(month_rev) + int(purchases_month), "prevRevenue": int(prev_rev),
        "monthProfit": int(month_profit), "prevProfit": int(prev_profit),
        "totalRevenue": int(total_rev), "totalProfit": int(total_profit),
        "totalUsers": users, "newToday": new_today, "activeToday": active_today, "balances": int(balances),
        "activeRentals": sum(status_counts.get(s, 0) for s in (S.ACTIVE, S.AWAITING_LINK, S.CONNECTING)),
        "review": status_counts.get(S.PAYMENT_REVIEW, 0), "toRent": status_counts.get(S.PAID, 0),
        "toSign": status_counts.get(S.CONNECT_SIGNING, 0) + status_counts.get(S.RENTING, 0),
        "problems": status_counts.get(S.FAILED, 0), "openTopups": open_topups, "openPurchases": open_purchases,
        "connectIssues": status_counts.get(S.AWAITING_LINK, 0),
        "activity": list(chart.values()),
        "byCategory": [{"name": c or "gift", "value": int(n)} for c, n in by_cat],
        "byCollection": sorted(({"name": k, "value": v} for k, v in collections.items()), key=lambda x: -x["value"]),
        "pending": [{"id": o.id, "name": _name(u), "userId": u.id, "gift": o.nft_name, "amount": int(o.amount_uzs),
                     "status": o.status, "createdAt": _ts(o.created_at)} for o, u in pending],
        "top": [{"id": u.id, "name": _name(u), "username": u.username, "spent": int(u.spent_uzs or 0),
                 "balance": int(u.balance_uzs or 0)} for u in top],
        "walletMode": ctx.settings.wallet_mode, "demo": ctx.settings.demo_mode,
        "userbot": userbot.status.get("state", "off"), "botUsername": ctx.bot_username,
    }


# ---------------------------------------------------------------------------- users
@router.get("/users")
async def users(q: str = "", filter: str = "all", page: int = 1, admin: CurrentUser = Depends(admin_user)):
    page = max(1, min(page, 10_000))
    size = 30
    async with Session() as session:
        stmt = select(User)
        if q.strip():
            term = q.strip().lstrip("@")
            conds = [User.username.ilike(f"%{term}%"), User.first_name.ilike(f"%{term}%"), User.last_name.ilike(f"%{term}%")]
            if term.isdigit():
                conds.append(User.id == int(term))
            stmt = stmt.where(or_(*conds))
        if filter == "customers":
            stmt = stmt.where(User.spent_uzs > 0)
        elif filter == "balance":
            stmt = stmt.where(User.balance_uzs > 0)
        elif filter == "blocked":
            stmt = stmt.where(User.is_blocked.is_(True))
        total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (await session.execute(stmt.order_by(User.last_seen.desc()).offset((page - 1) * size).limit(size))).scalars().all()
        ids = [u.id for u in rows]
        counts = dict((await session.execute(select(Order.user_id, func.count(Order.id)).where(Order.user_id.in_(ids))
                                             .group_by(Order.user_id))).all()) if ids else {}
    return {"total": total, "page": page, "pages": max(1, -(-total // size)), "users": [{
        "id": u.id, "name": _name(u), "username": u.username, "lang": u.lang or "", "balance": int(u.balance_uzs or 0),
        "spent": int(u.spent_uzs or 0), "refEarned": int(u.ref_earned_uzs or 0), "orders": int(counts.get(u.id, 0)),
        "isBlocked": bool(u.is_blocked), "botBlocked": bool(u.bot_blocked), "tgConnected": bool(u.tg_display_ready),
        "createdAt": _ts(u.created_at), "lastSeen": _ts(u.last_seen), "isAdmin": u.id in get_context().settings.admin_ids,
    } for u in rows]}


@router.get("/users/{user_id}")
async def user_detail(user_id: int, admin: CurrentUser = Depends(admin_user)):
    from .db import Ledger
    async with Session() as session:
        u = await session.get(User, user_id)
        if not u:
            raise HTTPException(404, detail={"code": "not_found", "error": "Foydalanuvchi topilmadi"})
        orders = (await session.execute(select(Order).where(Order.user_id == user_id).order_by(Order.id.desc()).limit(30))).scalars().all()
        ledger = (await session.execute(select(Ledger).where(Ledger.user_id == user_id).order_by(Ledger.id.desc()).limit(30))).scalars().all()
        invited = (await session.execute(select(func.count(User.id)).where(User.referrer_id == user_id))).scalar_one()
    return {"id": u.id, "name": _name(u), "username": u.username, "balance": int(u.balance_uzs or 0), "spent": int(u.spent_uzs or 0),
            "invited": invited, "refEarned": int(u.ref_earned_uzs or 0), "isBlocked": bool(u.is_blocked),
            "createdAt": _ts(u.created_at), "lastSeen": _ts(u.last_seen),
            "orders": [{"id": o.id, "gift": o.nft_name, "status": o.status, "amount": int(o.amount_uzs), "days": o.days,
                        "createdAt": _ts(o.created_at)} for o in orders],
            "ledger": [{"id": x.id, "delta": int(x.delta_uzs), "after": int(x.balance_after), "kind": x.kind, "note": x.note,
                        "createdAt": _ts(x.created_at)} for x in ledger]}


class BlockBody(BaseModel):
    blocked: bool


@router.post("/users/{user_id}/block")
async def block_user(user_id: int, body: BlockBody, admin: CurrentUser = Depends(admin_user)):
    if user_id in get_context().settings.admin_ids:
        raise HTTPException(400, detail={"code": "generic", "error": "Adminni bloklab bo'lmaydi"})
    async with Session() as session:
        result = await session.execute(update(User).where(User.id == user_id).values(is_blocked=body.blocked))
        await session.commit()
    if not result.rowcount:
        raise HTTPException(404, detail={"code": "not_found", "error": "Foydalanuvchi topilmadi"})
    log.info("Admin %s set blocked=%s for user %s", admin.id, body.blocked, user_id)
    return {"ok": True, "blocked": body.blocked}


# ---------------------------------------------------------------------------- activity log
@router.get("/activity")
async def activity(limit: int = 100, admin: CurrentUser = Depends(admin_user)):
    limit = max(1, min(limit, 300))
    async with Session() as session:
        rows = (await session.execute(select(OrderEvent, Order.nft_name, Order.user_id).join(Order, Order.id == OrderEvent.order_id)
                                      .order_by(OrderEvent.id.desc()).limit(limit))).all()
    return {"events": [{"id": e.id, "orderId": e.order_id, "gift": name, "userId": uid, "from": e.from_status, "to": e.to_status,
                        "actor": e.actor, "note": e.note, "createdAt": _ts(e.created_at)} for e, name, uid in rows]}


# ---------------------------------------------------------------------------- broadcast (text, from the panel)
_broadcast = {"running": False, "total": 0, "done": 0, "ok": 0, "fail": 0, "blocked": 0, "segment": "", "startedAt": None}


class BroadcastBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    segment: str = "all"
    button_text: str = Field(default="", max_length=40)
    button_url: str = Field(default="", max_length=300)


@router.get("/broadcast")
async def broadcast_info(admin: CurrentUser = Depends(owner_user)):
    from .bot.broadcast import audience
    counts = {seg: len(await audience(seg)) for seg in ("all", "customers", "active")}
    return {"counts": counts, "status": _broadcast, "botReady": get_context().bot is not None}


@router.post("/broadcast")
async def broadcast_send(body: BroadcastBody, admin: CurrentUser = Depends(owner_user)):
    ctx = get_context()
    if ctx.bot is None:
        raise HTTPException(400, detail={"code": "generic", "error": "Bot ishlamayapti (BOT_TOKEN yoki RUN_BOT)"})
    if _broadcast["running"]:
        raise HTTPException(409, detail={"code": "generic", "error": "Oldingi tarqatish hali tugamagan"})
    if body.segment not in ("all", "customers", "active"):
        raise HTTPException(400, detail={"code": "generic", "error": "Segment noto'g'ri"})
    if body.button_url and not body.button_url.startswith("https://"):
        raise HTTPException(400, detail={"code": "generic", "error": "Tugma havolasi https:// bilan boshlanishi kerak"})
    from .bot.broadcast import audience
    users = await audience(body.segment)
    _broadcast.update(running=True, total=len(users), done=0, ok=0, fail=0, blocked=0, segment=body.segment, startedAt=_ts(datetime.now(timezone.utc)))
    asyncio.create_task(_run_broadcast(ctx.bot, users, body), name="panel-broadcast")
    log.info("Admin %s started a panel broadcast to %s users (%s)", admin.id, len(users), body.segment)
    return {"ok": True, "total": len(users)}


async def _run_broadcast(bot, users: list[int], body: BroadcastBody) -> None:
    from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramRetryAfter
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=body.button_text, url=body.button_url)]]) \
        if body.button_text and body.button_url else None
    try:
        for user_id in users:
            for _ in range(3):
                try:
                    await bot.send_message(user_id, body.text, reply_markup=keyboard, parse_mode="HTML")
                    _broadcast["ok"] += 1
                    break
                except TelegramRetryAfter as exc:
                    await asyncio.sleep(exc.retry_after + 1)
                except TelegramForbiddenError:
                    _broadcast["fail"] += 1
                    _broadcast["blocked"] += 1
                    async with Session() as session:
                        await session.execute(update(User).where(User.id == user_id).values(bot_blocked=True))
                        await session.commit()
                    break
                except TelegramAPIError:
                    _broadcast["fail"] += 1
                    break
            _broadcast["done"] += 1
            await asyncio.sleep(0.05)
    finally:
        _broadcast["running"] = False


class MessageBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/users/{user_id}/message")
async def message_user(user_id: int, body: MessageBody, admin: CurrentUser = Depends(admin_user)):
    """Personal message from the admin, delivered by the bot."""
    bot = get_context().bot
    if bot is None:
        raise HTTPException(400, detail={"code": "generic", "error": "Bot ishlamayapti (BOT_TOKEN yoki RUN_BOT)"})
    try:
        await bot.send_message(user_id, body.text, parse_mode="HTML")
    except Exception as exc:  # noqa: BLE001 — blocked bot, bad HTML, unknown chat …
        raise HTTPException(400, detail={"code": "generic", "error": f"Yuborilmadi: {str(exc)[:120]}"}) from None
    log.info("Admin %s messaged user %s", admin.id, user_id)
    return {"ok": True}



# ---------------------------------------------------------------------------- runtime settings (no redeploy)
class ConfigBody(BaseModel):
    values: dict


class ResetBody(BaseModel):
    key: str


async def _system_status() -> list[dict]:
    """Read-only health of things that stay in Railway (secrets are never returned, only whether they are set)."""
    ctx = get_context()
    s = ctx.settings
    from . import userbot
    ub = userbot.status.get("state", "off")
    db_kind = "PostgreSQL" if s.database_url.startswith("postgresql") else "SQLite"
    rows = [
        ("Telegram bot", bool(ctx.bot), f"@{ctx.bot_username}" if ctx.bot_username else "BOT_TOKEN yo'q yoki RUN_BOT=false"),
        ("Marketapp API token", bool(s.marketapp_api_token) or s.demo_mode, "o'rnatilgan" if s.marketapp_api_token else ("demo" if s.demo_mode else "MARKETAPP_API_TOKEN yo'q")),
        ("Admin hamyoni", bool(s.admin_wallet_address), (s.admin_wallet_address[:6] + "…" + s.admin_wallet_address[-4:]) if s.admin_wallet_address else "ADMIN_WALLET_ADDRESS yo'q"),
        ("Hamyon rejimi", True, "hot (server imzolaydi)" if s.wallet_mode == "hot" else "TON Connect (siz imzolaysiz)"),
        ("Hot hamyon", s.wallet_mode != "hot" or ctx.hot_wallet is not None, "ishlamoqda" if ctx.hot_wallet is not None else ("kerak emas" if s.wallet_mode != "hot" else "HOT_WALLET_MNEMONIC xato")),
        ("CardXabar userbot", ub == "on", {"on": "ulangan " + userbot.status.get("me", ""), "off": "ulanmagan (/userbot)", "bad": "sessiya eskirgan — /userbot",
                                           "no_bot": "CARD_NOTIFY_BOTS topilmadi", "no_api": "USERBOT_API_ID/HASH yo'q", "error": "xato, qayta ulanmoqda"}.get(ub, ub)),
        ("Baza", True, db_kind + (" — Railway'da PostgreSQL tavsiya etiladi" if db_kind == "SQLite" and not s.demo_mode else "")),
        ("Mini App manzili", s.webapp_base.startswith("https://"), s.webapp_base),
        ("Adminlar", bool(s.admin_ids), f"{len(s.admin_ids)} ta (ADMIN_IDS)"),
        ("Rejim", not s.demo_mode, "DEMO — haqiqiy pul harakati yo'q" if s.demo_mode else "jonli"),
    ]
    return [{"name": n, "ok": bool(ok), "detail": d} for n, ok, d in rows]


@router.get("/config")
async def config_get(admin: CurrentUser = Depends(owner_user)):
    from . import runtime_config
    return {**await runtime_config.describe(), "status": await _system_status()}


@router.post("/config")
async def config_save(body: ConfigBody, admin: CurrentUser = Depends(owner_user)):
    from . import runtime_config
    try:
        changed = await runtime_config.save(body.values, admin.id)
    except runtime_config.ConfigError as exc:
        raise HTTPException(400, detail={"code": "generic", "error": str(exc), "field": exc.key}) from None
    await _after_change(changed)
    return {"ok": True, "changed": changed}


@router.post("/config/reset")
async def config_reset(body: ResetBody, admin: CurrentUser = Depends(owner_user)):
    from . import runtime_config
    try:
        await runtime_config.reset(body.key, admin.id)
    except runtime_config.ConfigError as exc:
        raise HTTPException(400, detail={"code": "generic", "error": str(exc)}) from None
    await _after_change([body.key])
    return {"ok": True}


async def _after_change(changed: list[str]) -> None:
    """Side effects for settings that are used once at startup."""
    ctx = get_context()
    if "card_notify_bots" in changed:
        from . import userbot
        userbot.request_restart()
    if "app_name" in changed and ctx.bot is not None and ctx.settings.webapp_base.startswith("https://"):
        from aiogram.types import MenuButtonWebApp, WebAppInfo
        try:
            await ctx.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
                text=ctx.settings.app_name[:16], web_app=WebAppInfo(url=ctx.settings.webapp_base + "/")))
        except Exception:  # noqa: BLE001
            log.warning("Could not update the bot menu button")


# ---------------------------------------------------------------------------- mandatory channels
class ChannelBody(BaseModel):
    input: str = Field(min_length=2, max_length=200)
    invite_link: str = Field(default="", max_length=200)


class ToggleBody(BaseModel):
    enabled: bool


@router.get("/channels")
async def channels_list(admin: CurrentUser = Depends(owner_user)):
    from . import subscription
    ctx = get_context()
    return {"channels": await subscription.describe(), "botReady": ctx.bot is not None, "botUsername": ctx.bot_username}


@router.post("/channels")
async def channels_add(body: ChannelBody, admin: CurrentUser = Depends(owner_user)):
    from . import subscription
    try:
        channel = await subscription.add(body.input, body.invite_link)
    except subscription.ChannelError as exc:
        raise HTTPException(400, detail={"code": "generic", "error": str(exc)}) from None
    log.info("Admin %s added mandatory channel %s (%s)", admin.id, channel["chat_id"], channel["title"])
    return {"ok": True, "channel": channel}


@router.delete("/channels/{chat_id}")
async def channels_remove(chat_id: int, admin: CurrentUser = Depends(owner_user)):
    from . import subscription
    await subscription.remove(chat_id)
    log.info("Admin %s removed mandatory channel %s", admin.id, chat_id)
    return {"ok": True}


@router.post("/channels/{chat_id}/toggle")
async def channels_toggle(chat_id: int, body: ToggleBody, admin: CurrentUser = Depends(owner_user)):
    from . import subscription
    await subscription.toggle(chat_id, body.enabled)
    return {"ok": True}


# ---------------------------------------------------------------------------- «Ulash muammolari»
@router.get("/connect-issues")
async def connect_issues(admin: CurrentUser = Depends(admin_user)):
    """Paid and rented gifts that are still not on the customer's profile (oldest first), with the last problem."""
    now = datetime.now(timezone.utc)
    async with Session() as session:
        rows = (await session.execute(select(Order, User).join(User, User.id == Order.user_id)
                                      .where(Order.status.in_({S.AWAITING_LINK, S.CONNECTING}), Order.category == "gift")
                                      .order_by(Order.id.asc()).limit(200))).all()
        notes = {}
        ids = [o.id for o, _ in rows]
        if ids:
            for e in (await session.execute(select(OrderEvent).where(OrderEvent.order_id.in_(ids), OrderEvent.note != "")
                                            .order_by(OrderEvent.id.asc()))).scalars():
                notes[e.order_id] = e.note
    items = []
    for o, u in rows:
        since = o.rented_at or o.updated_at
        if since is not None and since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        items.append({"id": o.id, "gift": o.nft_name, "status": o.status, "userId": u.id, "name": _name(u), "username": u.username,
                      "minutes": int((now - since).total_seconds() // 60) if since else None, "attempts": o.connect_attempts or 0,
                      "error": o.tg_error or "", "waiting": bool(o.tg_wait_started), "reminded": bool(o.tg_reminded),
                      "tgReady": bool(u.tg_display_ready), "lastNote": (notes.get(o.id) or "")[:200]})
    return {"items": items}


@router.post("/orders/{order_id}/tg-retry")
async def connect_retry(order_id: int, admin: CurrentUser = Depends(admin_user)):
    """Show the gift again on the customer's already-connected Telegram (works when their login is still valid)."""
    from . import orders as svc
    ctx = get_context()
    try:
        await svc.display_gift(ctx, order_id, f"admin:{admin.id}")
    except svc.ServiceError as exc:
        texts = {"display_limit": "Fragment cheklovi (soatiga 3 marta) — 20 daqiqadan keyin urining",
                 "login_expired": "Mijozning Telegram kirishi eskirgan — u «Telegramni ulash»ni qayta bosishi kerak",
                 "display_failed": "Telegram/Fragment rad etdi — mijoz qayta ulashi yoki 2-usuldan foydalanishi kerak",
                 "marketapp": "Marketapp javob bermadi — keyinroq urining", "bad_state": "Buyurtma holati o'zgargan"}
        raise HTTPException(400, detail={"code": exc.code, "error": texts.get(exc.code, exc.code)}) from None
    return {"ok": True}


@router.post("/orders/{order_id}/tg-remind")
async def connect_remind(order_id: int, admin: CurrentUser = Depends(admin_user)):
    from . import orders as svc
    ctx = get_context()
    order = await svc.get_order(order_id)
    if ctx.bot is None:
        raise HTTPException(400, detail={"code": "generic", "error": "Bot ishlamayapti"})
    await ctx.notifier.user(order, "tg_reminder")
    return {"ok": True}


# ---------------------------------------------------------------------------- promo codes (owner)
class PromoBody(BaseModel):
    code: str = Field(min_length=3, max_length=24)
    percent: int = Field(default=0, ge=0, le=90)
    amount: int = Field(default=0, ge=0, le=100_000_000)
    maxUses: int = Field(default=0, ge=0, le=1_000_000)
    perUser: int = Field(default=1, ge=0, le=1000)
    category: str = Field(default="", max_length=10)
    active: bool = True
    note: str = Field(default="", max_length=200)
    expiresAt: str | None = None


def _promo_error(exc) -> HTTPException:
    text = {"promo_bad_code": "Kod 3–24 ta lotin harf/raqam bo'lishi kerak (A-Z, 0-9, _ -)",
            "promo_bad_value": "Yoki foiz (1–90), yoki so'm miqdor kiriting — bittasini"}.get(exc.code, exc.code)
    return HTTPException(400, detail={"code": exc.code, "error": text})


@router.get("/promos")
async def promos_list(admin: CurrentUser = Depends(owner_user)):
    from . import extras
    return {"items": await extras.list_promos()}


@router.post("/promos")
async def promos_save(body: PromoBody, admin: CurrentUser = Depends(owner_user)):
    from . import extras
    try:
        return await extras.save_promo(body.model_dump())
    except extras.PromoError as exc:
        raise _promo_error(exc) from None
    except ValueError:
        raise HTTPException(400, detail={"code": "bad_date", "error": "Sana noto'g'ri"}) from None


@router.delete("/promos/{code}")
async def promos_delete(code: str, admin: CurrentUser = Depends(owner_user)):
    from . import extras
    await extras.delete_promo(code)
    return {"ok": True}


# ---------------------------------------------------------------------------- profit by collection (owner)
@router.get("/analytics")
async def analytics(days: int = 30, admin: CurrentUser = Depends(owner_user)):
    """Revenue, cost, profit and rentals per gift collection (and per username / number category)."""
    since = datetime.now(timezone.utc) - timedelta(days=days) if days > 0 else None
    async with Session() as session:
        stmt = select(Order.category, Order.nft_name, Order.days, Order.amount_uzs, Order.cost_uzs, Order.profit_uzs,
                      Order.discount_uzs, Order.kind).where(Order.status.in_(DONE))
        if since:
            stmt = stmt.where(Order.created_at >= since)
        rows = (await session.execute(stmt)).all()
    groups: dict[tuple[str, str], dict] = {}
    for category, name, n_days, amount, cost, profit, discount, kind in rows:
        category = category or "gift"
        key = (category, ((name or "").rpartition(" #")[0] or name or "—") if category == "gift" else category)
        g = groups.setdefault(key, {"category": category, "name": key[1], "orders": 0, "extensions": 0, "days": 0,
                                    "revenue": 0, "cost": 0, "profit": 0, "discount": 0})
        g["orders" if kind != "extend" else "extensions"] += 1
        g["days"] += int(n_days or 0)
        g["revenue"] += int(amount or 0)
        g["cost"] += int(cost or 0)
        g["profit"] += int(profit or 0)
        g["discount"] += int(discount or 0)
    items = sorted(groups.values(), key=lambda g: -g["profit"])
    for g in items:
        g["margin"] = round(g["profit"] * 100 / g["revenue"], 1) if g["revenue"] else 0
        g["perDayProfit"] = g["profit"] // g["days"] if g["days"] else 0
    total = {k: sum(g[k] for g in items) for k in ("orders", "extensions", "days", "revenue", "cost", "profit", "discount")}
    total["margin"] = round(total["profit"] * 100 / total["revenue"], 1) if total["revenue"] else 0
    return {"days": days, "items": items, "total": total}


# ---------------------------------------------------------------------------- CSV export (owner)
def _csv(rows: list[list]) -> str:
    import csv
    import io
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")          # ";" opens correctly in Excel with a Russian/Uzbek locale
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return "\ufeff" + buf.getvalue()                   # BOM: Excel shows Cyrillic/Uzbek letters correctly


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone(timedelta(hours=5))).strftime("%Y-%m-%d %H:%M")   # Tashkent time


@router.get("/export/{kind}")
async def export_csv(kind: str, days: int = 0, admin: CurrentUser = Depends(owner_user)):
    from fastapi.responses import Response
    since = datetime.now(timezone.utc) - timedelta(days=days) if days > 0 else None
    async with Session() as session:
        if kind == "orders":
            stmt = select(Order, User).join(User, User.id == Order.user_id).order_by(Order.id)
            if since:
                stmt = stmt.where(Order.created_at >= since)
            data = (await session.execute(stmt)).all()
            rows = [["ID", "Sana", "Holat", "Turi", "Kategoriya", "Gift", "Kun", "Summa (so'm)", "Xizmat haqi", "Chegirma",
                     "Promo", "Tannarx (so'm)", "Foyda (so'm)", "TON", "Kurs", "To'lov", "Mijoz ID", "Mijoz", "Username"]]
            for o, u in data:
                rows.append([o.id, _iso(o.created_at), o.status, o.kind, o.category, o.nft_name, o.days, o.amount_uzs,
                             o.service_fee_uzs, o.discount_uzs, o.promo_code, o.cost_uzs, o.profit_uzs,
                             o.actual_cost_nano and str(int(o.actual_cost_nano) / 1e9) or str(int(o.cost_nano or 0) / 1e9),
                             o.rate_uzs_per_ton, o.paid_by, u.id, _name(u), u.username])
        elif kind == "topups":
            stmt = select(Topup, User).join(User, User.id == Topup.user_id).order_by(Topup.id)
            if since:
                stmt = stmt.where(Topup.created_at >= since)
            data = (await session.execute(stmt)).all()
            rows = [["ID", "Sana", "Holat", "Summa (so'm)", "To'langan", "Kim tasdiqladi", "Mijoz ID", "Mijoz", "Username"]]
            for t_, u in data:
                rows.append([t_.id, _iso(t_.created_at), t_.status, t_.amount_uzs, _iso(t_.paid_at), t_.actor, u.id, _name(u), u.username])
        elif kind == "purchases":
            stmt = select(Purchase, User).join(User, User.id == Purchase.user_id).order_by(Purchase.id)
            if since:
                stmt = stmt.where(Purchase.created_at >= since)
            data = (await session.execute(stmt)).all()
            rows = [["ID", "Sana", "Holat", "Turi", "Miqdor", "Qabul qiluvchi", "Narx (so'm)", "TON", "Kurs", "Xato",
                     "Mijoz ID", "Mijoz"]]
            for p_, u in data:
                rows.append([p_.id, _iso(p_.created_at), p_.status, p_.kind, p_.quantity, "@" + p_.recipient, p_.price_uzs,
                             str(int(p_.cost_nano or 0) / 1e9), p_.rate_uzs_per_ton, p_.error, u.id, _name(u)])
        else:
            raise HTTPException(404, detail={"code": "not_found"})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{kind}-{stamp}.csv"'})


# ---------------------------------------------------------------------------- staff (who has access)
@router.get("/staff")
async def staff(admin: CurrentUser = Depends(admin_user)):
    s = get_context().settings
    async with Session() as session:
        people = {u.id: u for u in (await session.execute(select(User).where(User.id.in_(s.staff_ids)))).scalars()}
    return {"me": {"id": admin.id, "role": admin.role or "owner"},
            "items": [{"id": i, "role": s.role_of(i), "name": _name(people.get(i)) or str(i),
                       "username": people[i].username if i in people else ""} for i in s.staff_ids]}
