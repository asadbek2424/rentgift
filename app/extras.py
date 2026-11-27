"""Customer extras: in-app notification bell, promo codes, favorites with price-drop alerts.

* Notices — every bot message to a customer is also stored here, so the 🔔 in the Mini App shows the history
  (and an unread badge) even when the customer muted/blocked the bot.
* Promo codes — created in the admin panel: % or fixed so'm discount, total-use and per-user limits, expiry.
  The discount is taken from our profit only (never below cost), so a promo can never make an order a loss.
* Favorites — ❤️ on a gift; the worker checks favorites every 30 min and tells the customer once when the
  per-day price fell by ≥5 % since it was liked (or since the last alert).
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime

from sqlalchemy import delete, func, select, update

from .context import AppContext
from .db import Favorite, Notice, Order, OrderStatus as S, Promo, Session, aware, utcnow

log = logging.getLogger(__name__)
_TAG = re.compile(r"<[^>]+>")
CODE_RE = re.compile(r"^[A-Z0-9_-]{3,24}$")


class PromoError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------------------- notices (🔔)
async def add_notice(user_id: int, text: str, order_id: int | None = None, tab: str = "") -> None:
    plain = _TAG.sub("", text or "").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").strip()
    if not plain:
        return
    try:
        async with Session() as session:
            session.add(Notice(user_id=user_id, text=plain[:1500], order_id=order_id, tab=tab[:16]))
            await session.commit()
    except Exception:  # noqa: BLE001 - a notice must never break the real message
        log.exception("Cannot store notice")


async def notices(user_id: int, limit: int = 50) -> dict:
    async with Session() as session:
        rows = (await session.execute(select(Notice).where(Notice.user_id == user_id)
                                      .order_by(Notice.id.desc()).limit(limit))).scalars().all()
        unread = await unread_count(user_id, session)
    return {"unread": unread, "items": [{"id": n.id, "text": n.text, "order_id": n.order_id, "tab": n.tab,
                                         "read": n.read, "at": aware(n.created_at).isoformat()} for n in rows]}


async def unread_count(user_id: int, session=None) -> int:
    if session is None:
        async with Session() as s:
            return await unread_count(user_id, s)
    return int((await session.execute(select(func.count(Notice.id)).where(
        Notice.user_id == user_id, Notice.read.is_(False)))).scalar_one())


async def mark_read(user_id: int) -> None:
    async with Session() as session:
        await session.execute(update(Notice).where(Notice.user_id == user_id, Notice.read.is_(False)).values(read=True))
        await session.commit()


# ---------------------------------------------------------------------------- promo codes
def norm_code(code: str) -> str:
    return (code or "").strip().upper()


def _used_statuses():
    return set(S.ALL) - {S.CANCELLED, S.REFUNDED}


async def _uses(session, code: str, user_id: int | None = None) -> int:
    q = select(func.count(Order.id)).where(Order.promo_code == code, Order.status.in_(_used_statuses()))
    if user_id is not None:
        q = q.where(Order.user_id == user_id)
    return int((await session.execute(q)).scalar_one())


def discount_for(promo: Promo, amount_uzs: int, profit_uzs: int) -> int:
    raw = amount_uzs * promo.percent // 100 if promo.percent else int(promo.amount_uzs or 0)
    return max(0, min(raw, max(0, profit_uzs)))      # never below our cost


async def check_promo(code: str, user_id: int, category: str = "gift") -> Promo:
    code = norm_code(code)
    if not CODE_RE.match(code):
        raise PromoError("promo_invalid")
    async with Session() as session:
        promo = await session.get(Promo, code)
        if not promo or not promo.active:
            raise PromoError("promo_invalid")
        if promo.expires_at and aware(promo.expires_at) < utcnow():
            raise PromoError("promo_expired")
        if promo.category and promo.category != category:
            raise PromoError("promo_invalid")
        if promo.max_uses and await _uses(session, code) >= promo.max_uses:
            raise PromoError("promo_used_up")
        if promo.per_user and await _uses(session, code, user_id) >= promo.per_user:
            raise PromoError("promo_already_used")
    return promo


async def list_promos() -> list[dict]:
    async with Session() as session:
        rows = (await session.execute(select(Promo).order_by(Promo.created_at.desc()))).scalars().all()
        out = []
        for p in rows:
            used = await _uses(session, p.code)
            saved = int((await session.execute(select(func.coalesce(func.sum(Order.discount_uzs), 0)).where(
                Order.promo_code == p.code, Order.status.in_(_used_statuses())))).scalar_one())
            out.append(promo_view(p) | {"used": used, "discountTotal": saved})
    return out


def promo_view(p: Promo) -> dict:
    return {"code": p.code, "percent": p.percent, "amount": int(p.amount_uzs or 0), "maxUses": p.max_uses,
            "perUser": p.per_user, "category": p.category, "active": p.active, "note": p.note,
            "expiresAt": aware(p.expires_at).isoformat() if p.expires_at else None,
            "createdAt": aware(p.created_at).isoformat()}


async def save_promo(data: dict) -> dict:
    code = norm_code(data.get("code", ""))
    if not CODE_RE.match(code):
        raise PromoError("promo_bad_code")
    percent = int(data.get("percent") or 0)
    amount = int(data.get("amount") or 0)
    if not (0 < percent <= 90) and not (amount > 0):
        raise PromoError("promo_bad_value")
    if percent and amount:
        raise PromoError("promo_bad_value")
    expires = data.get("expiresAt")
    expires_at = datetime.fromisoformat(expires.replace("Z", "+00:00")) if expires else None
    async with Session() as session:
        promo = await session.get(Promo, code) or Promo(code=code)
        promo.percent, promo.amount_uzs = percent, amount
        promo.max_uses = max(0, int(data.get("maxUses") or 0))
        promo.per_user = max(0, int(data.get("perUser") if data.get("perUser") is not None else 1))
        promo.category = str(data.get("category") or "")[:10]
        promo.active = bool(data.get("active", True))
        promo.note = str(data.get("note") or "")[:200]
        promo.expires_at = expires_at
        session.add(promo)
        await session.commit()
        return promo_view(promo)


async def delete_promo(code: str) -> None:
    async with Session() as session:
        await session.execute(delete(Promo).where(Promo.code == norm_code(code)))
        await session.commit()


# ---------------------------------------------------------------------------- favorites ❤️
async def favorites(user_id: int) -> list[dict]:
    async with Session() as session:
        rows = (await session.execute(select(Favorite).where(Favorite.user_id == user_id)
                                      .order_by(Favorite.created_at.desc()))).scalars().all()
    return [{"address": f.nft_address, "name": f.name, "image": f.image, "price_per_day": f.price_nano,
             "at": aware(f.created_at).isoformat()} for f in rows]


async def add_favorite(user_id: int, address: str, name: str, image: str, price_nano: str) -> None:
    async with Session() as session:
        fav = await session.get(Favorite, (user_id, address))
        if fav is None:
            count = int((await session.execute(select(func.count()).select_from(Favorite)
                                               .where(Favorite.user_id == user_id))).scalar_one())
            if count >= 100:
                raise PromoError("favorites_full")
            fav = Favorite(user_id=user_id, nft_address=address)
        fav.name, fav.image = name[:128], image[:512]
        fav.price_nano = fav.alert_price_nano = str(price_nano or "")
        session.add(fav)
        await session.commit()


async def remove_favorite(user_id: int, address: str) -> None:
    async with Session() as session:
        await session.execute(delete(Favorite).where(Favorite.user_id == user_id, Favorite.nft_address == address))
        await session.commit()


_last_fav_check = 0.0
FAV_EVERY = 1800


async def watch_favorites(ctx: AppContext, force: bool = False) -> int:
    """Tell customers once when a favorite got ≥5 % cheaper or came back on the market. Returns alerts sent."""
    global _last_fav_check
    if not force and time.monotonic() - _last_fav_check < FAV_EVERY:
        return 0
    _last_fav_check = time.monotonic()
    sent = 0
    async with Session() as session:
        favs = (await session.execute(select(Favorite))).scalars().all()
    for fav in favs:
        # only gifts seen in a fresh catalogue page: an old/missing cache entry means "unknown", not "gone"
        item = ctx.market.cached_listing(fav.nft_address)
        if not item:
            continue
        price = int(item.get("price_per_day") or 0)
        base = int(fav.alert_price_nano or 0)
        if not (base and price and price <= base * 95 // 100):
            continue
        async with Session() as session:
            await session.execute(update(Favorite).where(Favorite.user_id == fav.user_id,
                                                         Favorite.nft_address == fav.nft_address)
                                  .values(alert_price_nano=str(price)))
            await session.commit()
        if hasattr(ctx.notifier, "user_text"):
            await ctx.notifier.user_text(fav.user_id, "fav_cheaper", tab="favorites", name=fav.name,
                                         percent=round((base - price) * 100 / base))
            sent += 1
    return sent
