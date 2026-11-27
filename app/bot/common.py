"""Bot helpers: keyboards, formatting, user language."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

from ..config import get_settings
from ..db import Session, User, aware
from ..i18n import FLAGS, LANGS, t


def fmt_sum(amount: int) -> str:
    return f"{int(amount):,}".replace(",", " ")


def fmt_dt(value: datetime | None) -> str:
    if not value:
        return "—"
    return aware(value).astimezone(ZoneInfo(get_settings().timezone)).strftime("%d.%m.%Y %H:%M")


def fmt_left(seconds: int, lang: str) -> str:
    seconds = max(0, int(seconds))
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes = rest // 60
    parts = []
    if days:
        parts.append(t(lang, "time.d", n=days))
    if hours:
        parts.append(t(lang, "time.h", n=hours))
    if minutes and not days:
        parts.append(t(lang, "time.m", n=minutes))
    return " ".join(parts) or t(lang, "time.lt_minute")


async def user_lang(user_id: int) -> str:
    async with Session() as session:
        user = await session.get(User, user_id)
    return (user.lang if user and user.lang else None) or get_settings().default_lang


def webapp_url(**params) -> str | None:
    base = get_settings().webapp_base
    if not base.startswith("https://"):
        return None  # Telegram only opens Mini Apps over HTTPS
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{base}/?{query}" if query else f"{base}/"


def webapp_button(text: str, **params) -> InlineKeyboardButton | None:
    url = webapp_url(**params)
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url)) if url else None


def admin_button(text: str, order: int | None = None) -> InlineKeyboardButton | None:
    """Opens the standalone admin panel (ADMIN_PANEL_URL) in the browser; falls back to the Mini App admin tab."""
    base = get_settings().panel_url
    if base.startswith("https://"):
        return InlineKeyboardButton(text=text, url=f"{base}/#/orders?order={order}" if order else f"{base}/#/")
    return webapp_button(text, admin=1, **({"order": order} if order else {}))


def markup(*rows) -> InlineKeyboardMarkup | None:
    clean = [[b for b in row if b is not None] for row in rows]
    clean = [row for row in clean if row]
    return InlineKeyboardMarkup(inline_keyboard=clean) if clean else None


def lang_keyboard() -> InlineKeyboardMarkup:
    return markup([InlineKeyboardButton(text=f"{FLAGS[code]} {t(code, 'lang.name')}", callback_data=f"lang:{code}")
                   for code in LANGS])
