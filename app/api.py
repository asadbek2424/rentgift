"""HTTP API for the Mini App (user + admin)."""

from __future__ import annotations

import base64
import io
import json
import logging
import mimetypes
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from . import admin_auth
from . import orders as svc
from . import purchases as shop
from . import wallet
from .context import get_context
from .db import Order, OrderStatus as S, Session, User, get_setting, set_setting
from .i18n import LANGS, guess_lang
from .marketapp import MarketappError
from .pricing import (RateUnavailable, collection_images, floor_nano, gift_card, image_url, pricing_config, split_name,
                      uzs_for_nano, uzs_to_base_nano)
from .ton import ton_text
from .tg_auth import InitDataError, validate_init_data
from .ton import canonical_address

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
MAX_RECEIPT = 10 * 1024 * 1024
RECEIPT_TYPES = {"image/jpeg": "photo", "image/png": "photo", "image/webp": "photo", "application/pdf": "document"}


# ---------------------------------------------------------------------------- auth
class CurrentUser(BaseModel):
    id: int
    lang: str
    is_admin: bool
    role: str = ""            # owner | operator (panel sessions)
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    photo_url: str = ""


SUBSCRIBE_EXEMPT = ("/api/me", "/api/subscription")


async def current_user(request: Request = None, x_telegram_init_data: str = Header(default="")) -> CurrentUser:
    ctx = get_context()
    settings = ctx.settings
    tg_user = None
    if x_telegram_init_data:
        try:
            tg_user = validate_init_data(x_telegram_init_data, settings.bot_token, settings.init_data_max_age)
        except InitDataError:
            raise HTTPException(401, detail={"code": "auth"}) from None
    elif settings.dev_user_id:
        tg_user = {"id": settings.dev_user_id, "first_name": "Dev", "username": "dev", "language_code": settings.default_lang}
    if not tg_user:
        raise HTTPException(401, detail={"code": "auth"})
    user = await svc.upsert_user(tg_user["id"], tg_user.get("first_name", ""), tg_user.get("last_name", ""),
                                 tg_user.get("username", ""), tg_user.get("photo_url", ""))
    if user.is_blocked:
        raise HTTPException(403, detail={"code": "auth"})
    lang = user.lang or guess_lang(tg_user.get("language_code"), settings.default_lang)
    # mandatory channels: everything except /api/me and the check endpoint needs a subscription (admins exempt)
    if request is not None and not request.url.path.startswith(SUBSCRIBE_EXEMPT) and user.id not in settings.admin_ids:
        from . import subscription
        need = await subscription.missing(user.id)
        if need:
            raise HTTPException(403, detail={"code": "subscribe", "channels": need})
    return CurrentUser(id=user.id, lang=lang, is_admin=user.id in settings.admin_ids, first_name=user.first_name,
                       last_name=user.last_name, username=user.username, photo_url=user.photo_url)


async def admin_user(x_telegram_init_data: str = Header(default=""),
                     authorization: str = Header(default="")) -> CurrentUser:
    """Admin endpoints accept either Telegram initData (Mini App) or a panel session token (standalone site)."""
    settings = get_context().settings
    if authorization.lower().startswith("bearer "):
        admin_id = admin_auth.check_token(settings, authorization[7:].strip())
        if admin_id is None:
            raise HTTPException(401, detail={"code": "auth"})
        async with Session() as session:
            db_user = await session.get(User, admin_id)
        return CurrentUser(id=admin_id, lang=(db_user.lang if db_user and db_user.lang else settings.default_lang),
                           is_admin=True, role=settings.role_of(admin_id), first_name=db_user.first_name if db_user else "Admin",
                           last_name=db_user.last_name if db_user else "", username=db_user.username if db_user else "",
                           photo_url=db_user.photo_url if db_user else "")
    user = await current_user(None, x_telegram_init_data)
    if not user.is_admin:
        raise HTTPException(403, detail={"code": "auth"})
    user.role = "owner"
    return user


async def owner_user(admin: CurrentUser = Depends(admin_user)) -> CurrentUser:
    """Owner-only: money, prices, settings, channels, promo codes, broadcasts, balances."""
    if admin.role != "owner":
        raise HTTPException(403, detail={"code": "owner_only", "error": "Bu bo'lim faqat egasi (owner) uchun"})
    return admin


# ---------------------------------------------------------------------------- admin panel login
class CodeRequestBody(BaseModel):
    admin_id: int


class CodeVerifyBody(BaseModel):
    admin_id: int
    code: str = Field(min_length=4, max_length=12)


class PasswordBody(BaseModel):
    admin_id: int
    password: str = Field(min_length=1, max_length=200)


def _session(admin_id: int) -> dict:
    token, exp = admin_auth.make_token(get_context().settings, admin_id)
    return {"token": token, "expires_at": exp, "admin_id": admin_id}


@router.get("/admin-auth/info")
async def admin_auth_info():
    ctx = get_context()
    s = ctx.settings
    return {"app": s.app_name, "bot_username": ctx.bot_username, "code_login": ctx.bot is not None,
            "password_login": bool(s.admin_panel_password), "default_lang": s.default_lang}


@router.post("/admin-auth/request-code")
async def admin_request_code(body: CodeRequestBody):
    ctx = get_context()
    # Same answer for unknown IDs, so the endpoint can't be used to discover admin IDs.
    if body.admin_id in ctx.settings.admin_ids and ctx.bot is not None:
        code = admin_auth.new_code(body.admin_id)
        if code is None:
            raise HTTPException(429, detail={"code": "too_many"})
        try:
            await ctx.bot.send_message(body.admin_id, f"🔐 Admin panel: <code>{code}</code>\n"
                                       f"5 daqiqa amal qiladi. Siz so'ramagan bo'lsangiz, hech kimga bermang.",
                                       parse_mode="HTML")
        except Exception:  # noqa: BLE001 — admin never started the bot, etc.
            log.warning("Could not send admin login code to %s", body.admin_id)
    return {"ok": True}


@router.post("/admin-auth/verify")
async def admin_verify_code(body: CodeVerifyBody):
    if body.admin_id not in get_context().settings.admin_ids or not admin_auth.verify_code(body.admin_id, body.code):
        raise HTTPException(401, detail={"code": "bad_code"})
    return _session(body.admin_id)


@router.post("/admin-auth/password")
async def admin_password_login(body: PasswordBody):
    s = get_context().settings
    if admin_auth.password_locked(body.admin_id):
        raise HTTPException(429, detail={"code": "too_many"})
    if body.admin_id not in s.admin_ids or not admin_auth.check_password(s, body.password, body.admin_id):
        raise HTTPException(401, detail={"code": "bad_code"})
    return _session(body.admin_id)


@router.get("/admin/me")
async def admin_me(admin: CurrentUser = Depends(admin_user)):
    s = get_context().settings
    return {"user": admin.model_dump(),
            "app": {"name": s.app_name, "wallet_mode": s.wallet_mode, "admin_wallet": s.admin_wallet_address,
                    "admin_wallet_raw": _raw(s.admin_wallet_address), "webapp_url": s.webapp_base,
                    "manifest_url": f"{s.webapp_base}/tonconnect-manifest.json", "demo": s.demo_mode}}


def _error(exc: svc.ServiceError) -> HTTPException:
    return HTTPException(exc.status, detail={"code": exc.code, "detail": exc.detail})


def _raw(address: str) -> str:
    try:
        return canonical_address(address) if address else ""
    except ValueError:
        return ""


# ---------------------------------------------------------------------------- public
@router.get("/me")
async def me(user: CurrentUser = Depends(current_user)):
    ctx = get_context()
    s = ctx.settings
    async with Session() as session:
        rentals = (await session.execute(select(func.count(Order.id)).where(
            Order.user_id == user.id, Order.status.in_({S.ACTIVE, S.EXPIRED, S.AWAITING_LINK})))).scalar_one()
        card = {"number": await get_setting(session, "card_number", s.card_number),
                "holder": await get_setting(session, "card_holder", s.card_holder),
                "bank": await get_setting(session, "card_bank", s.card_bank)}
        db_user = await session.get(User, user.id)
    from . import userbot
    from . import channel_promo, subscription
    need = await subscription.missing(user.id)
    promo = await channel_promo.info(user.id) if not need else None
    from . import extras
    unread = await extras.unread_count(user.id)
    favs = [f["address"] for f in await extras.favorites(user.id)]
    return {"subscribe": need, "channel_promo": promo, "unread": unread, "favorites": favs, "user": {**user.model_dump(), "tg_display_ready": bool(db_user and db_user.tg_display_ready),
                     "tg_display_name": db_user.tg_display_name if db_user else "",
                     "balance_uzs": int(db_user.balance_uzs or 0) if db_user else 0,
                     "spent_uzs": int(db_user.spent_uzs or 0) if db_user else 0},
            "rentals": rentals, "card": card,
            "app": {"name": s.app_name, "support": s.support_username, "channel": s.channel_username,
                    "offer_url": s.offer_url, "langs": list(LANGS), "bot_username": ctx.bot_username,
                    "auto_payments": bool(s.auto_confirm_payments and userbot.status.get("state") == "on"),
                    "wallet_mode": s.wallet_mode, "topup_min": s.topup_min_uzs, "topup_max": s.topup_max_uzs,
                    "admin_wallet": s.admin_wallet_address if user.is_admin else "",
                    "admin_wallet_raw": _raw(s.admin_wallet_address) if user.is_admin else "", "demo": s.demo_mode,
                    "manifest_url": f"{s.webapp_base}/tonconnect-manifest.json",
                    "admin_panel_url": s.panel_url if user.is_admin else ""}}


@router.get("/channel/photo")
async def channel_photo():
    """Avatar of CHANNEL_USERNAME for the invite popup (public picture, cached in memory)."""
    from . import channel_promo
    data = await channel_promo.photo()
    if not data:
        raise HTTPException(404, detail={"code": "not_found"})
    return StreamingResponse(io.BytesIO(data), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/subscription")
async def subscription_check(user: CurrentUser = Depends(current_user)):
    from . import subscription
    need = await subscription.missing(user.id, fresh=True)
    return {"ok": not need, "channels": need}


class LangBody(BaseModel):
    lang: str


@router.post("/me/lang")
async def change_lang(body: LangBody, user: CurrentUser = Depends(current_user)):
    if body.lang not in LANGS:
        raise HTTPException(400, detail={"code": "generic"})
    await svc.set_lang(user.id, body.lang)
    return {"ok": True, "lang": body.lang}


@router.get("/collections")
async def collections(user: CurrentUser = Depends(current_user)):
    ctx = get_context()
    try:
        items = await ctx.market.gift_collections()
    except MarketappError:
        raise HTTPException(503, detail={"code": "marketapp"}) from None
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        config = None
    result = []
    for c in items:
        if not c.get("address"):
            continue
        extra = c.get("extra_data") or {}
        floor = floor_nano(extra.get("rent_floor"))
        result.append({"address": c.get("address"), "name": c.get("name"), "items": extra.get("items"),
                       "for_rent": extra.get("for_rent"),
                       "images": collection_images(c.get("name") or ""),
                       "floor_ton": ton_text(config.cost_nano(floor) if config else floor) if floor else None,
                       "floor_uzs": uzs_for_nano(floor, config) if floor and config else None})
    return {"items": result}


@router.get("/attributes")
async def attributes(collection: str | None = None, user: CurrentUser = Depends(current_user)):
    """Model/Backdrop/Symbol values. Without a collection, Backdrop and Symbol of the first collection
    are returned (these sets are shared by Telegram gifts); Model needs a collection."""
    ctx = get_context()
    try:
        address = collection
        if not address:
            listed = await ctx.market.gift_collections()
            address = next((c.get("address") for c in listed if c.get("address")), None)
        raw = await ctx.market.collection_attributes(address) if address else []
    except MarketappError:
        raise HTTPException(503, detail={"code": "marketapp"}) from None
    out = []
    for group in raw:
        trait = str(group.get("trait_type", ""))
        if trait.lower() not in ("model", "backdrop", "symbol") or (not collection and trait.lower() == "model"):
            continue
        raw_values = [v for v in group.get("values") or [] if v.get("value") not in (None, "")]
        total = sum(int(v.get("count") or 0) for v in raw_values)
        values = []
        for v in raw_values:
            count = int(v.get("count") or 0)
            perc = float(v.get("perc") or 0) or (count / total * 100 if total else 0)
            values.append({"value": str(v.get("value")), "count": count, "perc": round(perc, 2) if perc else None})
        # rarest first (like the gift-changes lists: "Imposter — 0.1%"); unknown rarity at the end
        values.sort(key=lambda v: (v["perc"] is None, v["perc"] or 0, v["value"].lower()))
        out.append({"trait": trait.lower(), "values": values[:1000]})
    order = {"model": 0, "backdrop": 1, "symbol": 2}
    from . import gift_assets
    colors = await gift_assets.backdrops()
    return {"attributes": sorted(out, key=lambda g: order[g["trait"]]), "backdrop_colors": colors}


def _decode_cursor(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(raw.encode() + b"==").decode())
        return data if isinstance(data, dict) else None
    except (ValueError, UnicodeError):
        return None


def _encode_cursor(state: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(state, separators=(",", ":")).encode()).decode().rstrip("=")


_END = "__end__"


async def _other_category(category: str, sort: str, cursor: str | None, q: str | None) -> dict:
    """Usernames / anonymous numbers: Marketapp pages + an optional text filter on the current page set."""
    ctx = get_context()
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        config = None
    needle = (q or "").strip().lower().lstrip("@").replace(" ", "").replace("+", "")
    collected, next_cursor = [], cursor
    try:
        for _ in range(5 if needle else 1):
            page = await ctx.market.rent_list(category, cursor=next_cursor, sort_by=sort, limit=50 if needle else 20)
            next_cursor = page.get("cursor")
            for item in page.get("items") or []:
                name = str(item.get("nft_name") or "").lower().replace(" ", "").replace("+", "").lstrip("@")
                if not needle or needle in name:
                    collected.append(item)
            if not next_cursor or len(collected) >= 20:
                break
    except MarketappError:
        if not collected:
            raise HTTPException(503, detail={"code": "marketapp"}) from None
    cards = []
    config = config.for_category(category) if config else None
    for item in collected:
        card = gift_card(item, config)
        card.update({"category": category, "image": "", "collection": card["name"], "number": ""})
        if card["rentable"]:
            cards.append(card)
    return {"items": cards, "cursor": next_cursor, "priced": config is not None}


@router.get("/gifts")
async def gifts(collections: str | None = None, collection: str | None = None, sort: str = "recently_touch",
                cursor: str | None = None, model: str | None = None, backdrop: str | None = None, symbol: str | None = None,
                price_min: Decimal | None = None, price_max: Decimal | None = None,
                num_min: int | None = None, num_max: int | None = None, category: str = "gift", q: str | None = None,
                user: CurrentUser = Depends(current_user)):
    if category in ("username", "number"):
        return await _other_category(category, sort, cursor, q)
    """Catalogue with Marketapp filters (collection, model, backdrop, symbol, sort) plus local filters
    (price in so'm/day, item number). Several collections are merged; the cursor keeps one position per collection."""
    ctx = get_context()
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        config = None
    keys = [c for c in (collections or collection or "").split(",") if c.strip()][:5] or [""]
    state = _decode_cursor(cursor) or {k: None for k in keys}
    state = {k: state.get(k) for k in keys}
    min_nano = uzs_to_base_nano(price_min, config) if price_min and config else None
    max_nano = uzs_to_base_nano(price_max, config) if price_max and config else None
    local_filters = any(v is not None for v in (min_nano, max_nano, num_min, num_max))
    collected: list[dict] = []
    try:
        for _ in range(6 if local_filters else 1):
            for key in keys:
                if state[key] == _END:
                    continue
                page = await ctx.market.rent_gifts(cursor=state[key], collection_address=key or None, sort_by=sort,
                                                   model=model, backdrop=backdrop, symbol=symbol,
                                                   limit=50 if local_filters else 20)
                state[key] = page.get("cursor") or _END
                for item in page.get("items") or []:
                    ppd = int(item.get("price_per_day") or 0)
                    if sort in ("price_per_day", "min_price") and max_nano is not None and ppd > max_nano:
                        state[key] = _END          # sorted by price: nothing cheaper follows
                        break
                    number = split_name(str(item.get("nft_name") or ""))[1]
                    number = int(number) if number.isdigit() else None
                    if (min_nano is not None and ppd < min_nano) or (max_nano is not None and ppd > max_nano):
                        continue
                    if (num_min is not None and (number is None or number < num_min)) or \
                            (num_max is not None and (number is None or number > num_max)):
                        continue
                    collected.append(item)
            if len(collected) >= 20 or all(v == _END for v in state.values()):
                break
    except MarketappError:
        if not collected:
            raise HTTPException(503, detail={"code": "marketapp"}) from None
    if len(keys) > 1:
        if sort in ("price_per_day", "min_price"):
            collected.sort(key=lambda i: int(i.get("price_per_day") or 0))
        elif sort.startswith("item_num"):
            num = lambda i: int(split_name(str(i.get("nft_name") or ""))[1] or 0) if split_name(str(i.get("nft_name") or ""))[1].isdigit() else 0
            collected.sort(key=num, reverse=sort.endswith("desc"))
    more = any(v != _END for v in state.values())
    cards = [gift_card(i, config) for i in collected]
    cards = [c for c in cards if c["rentable"]]          # e.g. listings that allow only 1–2 days
    return {"items": cards, "cursor": _encode_cursor(state) if more else None,
            "priced": config is not None}


@router.get("/gifts/{address}")
async def gift_detail(address: str, user: CurrentUser = Depends(current_user)):
    ctx = get_context()
    try:
        listing = await svc._listing(ctx, address)
    except svc.ServiceError as exc:
        raise _error(exc) from None
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        config = None
    config = config.for_category(listing.get("category")) if config else None
    item = {"nft_address": listing["address"], "nft_name": listing["name"], "attributes": listing["attributes"],
            "price_per_day": listing["price_per_day"], "min_duration": listing["min_duration"],
            "max_duration": listing["max_duration"], "is_sellable_during_rent": listing.get("sellable")}
    return gift_card(item, config)


@router.get("/gifts/{address}/traits")
async def gift_traits(address: str, user: CurrentUser = Depends(current_user)):
    """Model / Symbol / Backdrop of a gift with their rarity in the collection (e.g. 1.5%)."""
    from . import rarity
    ctx = get_context()
    try:
        listing = await svc._listing(ctx, address)
    except svc.ServiceError as exc:
        raise _error(exc) from None
    from . import gift_assets
    from .pricing import attr
    backdrop = attr(listing.get("attributes") or [], "Backdrop")
    try:
        colors = (await gift_assets.backdrops()).get(backdrop) if backdrop else None
    except Exception:  # noqa: BLE001 - colours are decoration only
        colors = None
    return {"traits": await rarity.traits(ctx, listing), "backdrop": backdrop, "backdrop_colors": colors}


@router.get("/gift-anim/{key}")
async def gift_animation(key: str):
    """Animated (Lottie) version of a gift picture, proxied from Fragment and cached. 404 when there is none."""
    from fastapi.responses import Response
    from . import gift_anim
    if not gift_anim.valid(key):
        raise HTTPException(404, detail={"code": "not_found"})
    data = await gift_anim.get(key)
    if not data:
        raise HTTPException(404, detail={"code": "not_found"})
    return Response(data, media_type="application/json", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/quote")
async def quote(nft: str, days: int, user: CurrentUser = Depends(current_user)):
    try:
        return await svc.quote_for(get_context(), nft, days)
    except svc.ServiceError as exc:
        raise _error(exc) from None


class OrderBody(BaseModel):
    nft_address: str = Field(max_length=80)
    days: int = Field(ge=1, le=365)
    promo: str = Field(default="", max_length=24)


@router.post("/orders")
async def create_order(body: OrderBody, user: CurrentUser = Depends(current_user)):
    try:
        order = await svc.create_order(get_context(), user.id, body.nft_address, body.days, body.promo)
    except svc.ServiceError as exc:
        raise _error(exc) from None
    return svc.order_view(order)


class PromoCheckBody(BaseModel):
    code: str = Field(max_length=24)
    nft_address: str = Field(default="", max_length=80)
    days: int = Field(default=1, ge=1, le=365)


@router.post("/promo/check")
async def promo_check(body: PromoCheckBody, user: CurrentUser = Depends(current_user)):
    """Validate a promo code and show the discount for this gift/days before the order is created."""
    from . import extras
    ctx = get_context()
    try:
        promo = await extras.check_promo(body.code, user.id)
        quote = await svc.quote_for(ctx, body.nft_address, body.days, raw=True) if body.nft_address else None
    except extras.PromoError as exc:
        raise _error(svc.ServiceError(exc.code)) from None
    except svc.ServiceError as exc:
        raise _error(exc) from None
    discount = extras.discount_for(promo, quote.amount_uzs, quote.profit_uzs) if quote else 0
    return {"code": promo.code, "percent": promo.percent, "amount": int(promo.amount_uzs or 0), "discount_uzs": discount,
            "total_uzs": quote.amount_uzs - discount if quote else None}


@router.get("/notices")
async def notices_list(user: CurrentUser = Depends(current_user)):
    from . import extras
    return await extras.notices(user.id)


@router.post("/notices/read")
async def notices_read(user: CurrentUser = Depends(current_user)):
    from . import extras
    await extras.mark_read(user.id)
    return {"ok": True}


class FavoriteBody(BaseModel):
    address: str = Field(max_length=80)


@router.get("/favorites")
async def favorites_list(user: CurrentUser = Depends(current_user)):
    from . import extras
    ctx = get_context()
    try:
        config = await pricing_config(ctx.rates)
    except RateUnavailable:
        config = None
    items = []
    for fav in await extras.favorites(user.id):
        live = ctx.market.cached_listing(fav["address"])
        item = {"nft_address": fav["address"], "nft_name": fav["name"],
                "attributes": (live or {}).get("attributes") or [],
                "price_per_day": str((live or {}).get("price_per_day") or fav["price_per_day"] or 0),
                "min_duration": int((live or {}).get("min_duration") or 86400),
                "max_duration": int((live or {}).get("max_duration") or 86400)}
        card = gift_card(item, config.for_category((live or {}).get("_category")) if config else None)
        items.append({**card, "available": bool(live), "liked_price_ton": fav["price_per_day"]})
    return {"items": items}


@router.post("/favorites")
async def favorites_add(body: FavoriteBody, user: CurrentUser = Depends(current_user)):
    from . import extras
    ctx = get_context()
    try:
        listing = await svc._listing(ctx, body.address)
        await extras.add_favorite(user.id, listing["address"], listing["name"],
                                  image_url(listing["name"]) if listing.get("category", "gift") == "gift" else "",
                                  listing["price_per_day"])
    except extras.PromoError as exc:
        raise _error(svc.ServiceError(exc.code)) from None
    except svc.ServiceError as exc:
        raise _error(exc) from None
    return {"ok": True}


@router.delete("/favorites/{address}")
async def favorites_remove(address: str, user: CurrentUser = Depends(current_user)):
    from . import extras
    await extras.remove_favorite(user.id, address)
    return {"ok": True}


@router.get("/orders")
async def my_orders(user: CurrentUser = Depends(current_user)):
    async with Session() as session:
        rows = (await session.execute(select(Order).where(Order.user_id == user.id).order_by(Order.id.desc()).limit(100))).scalars()
        return {"items": [svc.order_view(o) for o in rows]}


@router.get("/orders/{order_id}")
async def one_order(order_id: int, user: CurrentUser = Depends(current_user)):
    try:
        order = await svc.get_order(order_id, None if user.is_admin else user.id)
    except svc.ServiceError as exc:
        raise _error(exc) from None
    return svc.order_view(order)


@router.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return svc.order_view(await svc.cancel_by_user(get_context(), user.id, order_id))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.post("/orders/{order_id}/receipt")
async def upload_receipt(order_id: int, file: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    kind = RECEIPT_TYPES.get((file.content_type or "").lower())
    if not kind:
        raise HTTPException(400, detail={"code": "file_type"})
    data = await file.read(MAX_RECEIPT + 1)
    if len(data) > MAX_RECEIPT:
        raise HTTPException(413, detail={"code": "file_too_large"})
    if not data:
        raise HTTPException(400, detail={"code": "file_type"})
    try:
        order = await svc.attach_receipt(get_context(), user.id, order_id, kind=kind, data=data,
                                         filename=(file.filename or "receipt")[:64])
    except svc.ServiceError as exc:
        raise _error(exc) from None
    return svc.order_view(order)


class LinkBody(BaseModel):
    url: str = Field(max_length=4096)


@router.post("/orders/{order_id}/link")
async def send_link(order_id: int, body: LinkBody, user: CurrentUser = Depends(current_user)):
    try:
        return svc.order_view(await svc.submit_link(get_context(), user.id, order_id, body.url))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.get("/orders/{order_id}/extend-quote")
async def extend_quote(order_id: int, days: int | None = None, user: CurrentUser = Depends(current_user)):
    try:
        return await svc.extension_quote(get_context(), user.id, order_id, days)
    except svc.ServiceError as exc:
        raise _error(exc) from None


class ExtendBody(BaseModel):
    days: int = Field(ge=1, le=365)


@router.post("/orders/{order_id}/extend")
async def extend(order_id: int, body: ExtendBody, user: CurrentUser = Depends(current_user)):
    try:
        return svc.order_view(await svc.create_extension(get_context(), user.id, order_id, body.days))
    except svc.ServiceError as exc:
        raise _error(exc) from None


def _tg_result(result: dict) -> dict:
    out = {"status": result["status"], "link": result.get("link"), "account": result.get("account")}
    if result.get("order") is not None:
        out["order"] = svc.order_view(result["order"])
    return out


@router.post("/orders/{order_id}/tg-connect")
async def tg_connect(order_id: int, user: CurrentUser = Depends(current_user)):
    """Main way to show the gift: connect the customer's Telegram via Marketapp (no fragment.com)."""
    try:
        return _tg_result(await svc.tg_connect(get_context(), user.id, order_id))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.get("/orders/{order_id}/tg-status")
async def tg_status(order_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return _tg_result(await svc.tg_poll(get_context(), user.id, order_id))
    except svc.ServiceError as exc:
        raise _error(exc) from None


# ---------------------------------------------------------------------------- admin
def _wallet_error(exc) -> HTTPException:
    return HTTPException(exc.status, detail={"code": exc.code, "detail": exc.detail})


class TgAccountBody(BaseModel):
    use: bool


@router.post("/orders/{order_id}/tg-account")
async def tg_account(order_id: int, body: TgAccountBody, user: CurrentUser = Depends(current_user)):
    """After a 'different Telegram account' warning: show there anyway (use=true) or reconnect (use=false)."""
    try:
        return _tg_result(await svc.tg_account_choice(get_context(), user.id, order_id, body.use))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.post("/orders/{order_id}/pay-balance")
async def pay_balance(order_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return svc.order_view(await svc.pay_from_balance(get_context(), user.id, order_id))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.get("/orders/{order_id}/login-code")
async def number_login_code(order_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return await svc.login_code(get_context(), user.id, order_id)
    except svc.ServiceError as exc:
        raise _error(exc) from None


# ---------------------------------------------------------------------------- balance
@router.get("/balance")
async def balance(user: CurrentUser = Depends(current_user)):
    topups = await wallet.list_topups(user.id, limit=20)
    return {"balance_uzs": await wallet.balance_of(user.id), "history": await wallet.history(user.id),
            "topups": [wallet.topup_view(t) for t in topups]}


class TopupBody(BaseModel):
    amount: int = Field(ge=1, le=1_000_000_000)


@router.post("/topups")
async def create_topup(body: TopupBody, user: CurrentUser = Depends(current_user)):
    try:
        return wallet.topup_view(await wallet.create_topup(get_context(), user.id, body.amount))
    except wallet.WalletError as exc:
        raise _wallet_error(exc) from None


@router.get("/topups/{topup_id}")
async def one_topup(topup_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return wallet.topup_view(await wallet.get_topup(topup_id, None if user.is_admin else user.id))
    except wallet.WalletError as exc:
        raise _wallet_error(exc) from None


@router.post("/topups/{topup_id}/cancel")
async def cancel_topup(topup_id: int, user: CurrentUser = Depends(current_user)):
    try:
        return wallet.topup_view(await wallet.cancel_topup(user.id, topup_id))
    except wallet.WalletError as exc:
        raise _wallet_error(exc) from None


# ---------------------------------------------------------------------------- Stars / Premium
def _shop_error(exc) -> HTTPException:
    return HTTPException(exc.status, detail={"code": exc.code, "detail": exc.detail})


@router.get("/stars")
async def stars_info(user: CurrentUser = Depends(current_user)):
    try:
        return await shop.stars_info(get_context())
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None


@router.get("/stars/quote")
async def stars_quote(quantity: int, user: CurrentUser = Depends(current_user)):
    try:
        quote = await shop.stars_quote(get_context(), quantity)
        return {"quantity": quote["quantity"], "price_uzs": quote["price_uzs"]}
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None


@router.get("/premium")
async def premium_info(user: CurrentUser = Depends(current_user)):
    try:
        info = await shop.premium_info(get_context())
        return {"plans": [{"months": p["months"], "price_uzs": p["price_uzs"]} for p in info["plans"]],
                "fee_uzs": info.get("fee_uzs", 0)}
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None


class RecipientBody(BaseModel):
    kind: str = Field(pattern="^(stars|premium)$")
    username: str = Field(max_length=80)


@router.post("/recipient")
async def check_recipient(body: RecipientBody, user: CurrentUser = Depends(current_user)):
    try:
        return await shop.recipient(get_context(), body.kind, body.username)
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None


class PurchaseBody(BaseModel):
    kind: str = Field(pattern="^(stars|premium)$")
    username: str = Field(max_length=80)
    quantity: int = Field(ge=1, le=1_000_000)


@router.post("/purchases")
async def create_purchase(body: PurchaseBody, user: CurrentUser = Depends(current_user)):
    try:
        return shop.purchase_view(await shop.buy(get_context(), user.id, body.kind, body.username, body.quantity))
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None


@router.get("/purchases")
async def my_purchases(user: CurrentUser = Depends(current_user)):
    return {"items": [shop.purchase_view(p) for p in await shop.list_purchases(user.id, limit=30)]}


# ---------------------------------------------------------------------------- referral / rating
@router.get("/referral")
async def referral(user: CurrentUser = Depends(current_user)):
    ctx = get_context()
    info = await wallet.referral_info(user.id)
    async with Session() as session:
        percent = await get_setting(session, "referral_percent", str(ctx.settings.referral_percent))
    link = f"https://t.me/{ctx.bot_username}?start=ref_{user.id}" if ctx.bot_username else ""
    return {**info, "percent": percent, "link": link}


@router.get("/top")
async def top(user: CurrentUser = Depends(current_user)):
    return await wallet.top_rating(user.id)


ADMIN_FILTERS = {
    "review": {S.PAYMENT_REVIEW}, "paid": {S.PAID}, "sign": {S.CONNECT_SIGNING, S.RENTING},
    "active": {S.AWAITING_LINK, S.CONNECTING, S.ACTIVE}, "problem": {S.FAILED}, "all": set(S.ALL),
}


@router.get("/admin/orders")
async def admin_orders(filter: str = "review", admin: CurrentUser = Depends(admin_user)):
    statuses = ADMIN_FILTERS.get(filter, ADMIN_FILTERS["all"])
    async with Session() as session:
        rows = (await session.execute(select(Order).options(selectinload(Order.user)).where(Order.status.in_(statuses))
                                      .order_by(Order.id.desc()).limit(200))).scalars()
        items = [svc.order_view(o, admin=True) for o in rows]
        counts = dict((await session.execute(select(Order.status, func.count(Order.id)).group_by(Order.status))).all())
    return {"items": items, "counts": {k: sum(counts.get(s, 0) for s in v) for k, v in ADMIN_FILTERS.items() if k != "all"}}


@router.get("/admin/stats")
async def admin_stats(admin: CurrentUser = Depends(owner_user)):
    ctx = get_context()
    s = ctx.settings
    done = {S.ACTIVE, S.EXPIRED, S.AWAITING_LINK, S.CONNECTING, S.CONNECT_SIGNING, S.RENTING}
    async with Session() as session:
        revenue, profit = (await session.execute(select(func.coalesce(func.sum(Order.amount_uzs), 0),
                                                        func.coalesce(func.sum(Order.profit_uzs), 0))
                                                 .where(Order.status.in_(done)))).one()
        users = (await session.execute(select(func.count(User.id)))).scalar_one()
        balances = (await session.execute(select(func.coalesce(func.sum(User.balance_uzs), 0)))).scalar_one()
        g = lambda key, default: get_setting(session, key, str(default))
        settings = {"markup_percent": await g("markup_percent", s.markup_percent),
                    "fee_percent": await g("fee_percent", s.marketapp_fee_percent),
                    "profit_fixed_uzs": await g("profit_fixed_uzs", s.profit_fixed_uzs),
                    "service_fee_uzs": await g("service_fee_uzs", s.service_fee_uzs),
                    "service_fee_ton": await g("service_fee_ton", s.service_fee_ton),
                    "min_rent_days": await g("min_rent_days", s.min_rent_days),
                    "round_to": await g("round_to", s.uzs_round_to),
                    "rate_mode": await g("rate_mode", s.rate_mode),
                    "manual_rate": await g("manual_rate", s.manual_rate_uzs_per_ton),
                    "card_number": await g("card_number", s.card_number),
                    "card_holder": await g("card_holder", s.card_holder),
                    "card_bank": await g("card_bank", s.card_bank),
                    "stars_markup_percent": await g("stars_markup_percent", s.stars_markup_percent),
                    "premium_markup_percent": await g("premium_markup_percent", s.premium_markup_percent),
                    "referral_percent": await g("referral_percent", s.referral_percent),
                    **{k: await g(k, "" if getattr(s, k) is None else getattr(s, k)) for k in _USD_KEYS}}
        observed = await get_setting(session, "observed_fee_percent", None)
    try:
        config = await pricing_config(ctx.rates)
        rate = str(config.rate_uzs_per_ton.quantize(Decimal(1)))
        uzs_per_usd = str(config.uzs_per_usd.quantize(Decimal("0.01"))) if config.uzs_per_usd else None
    except RateUnavailable:
        rate = uzs_per_usd = None
    hot_balance = None
    if ctx.hot_wallet is not None:
        nano = await ctx.hot_wallet.balance_nano()
        hot_balance = ton_text(nano) if nano is not None else None
    return {"revenue_uzs": int(revenue), "profit_uzs": int(profit), "users": users, "rate": rate,
            "balances_uzs": int(balances), "hot_balance": hot_balance,
            "uzs_per_usd": uzs_per_usd, "observed_fee_percent": observed, "settings": settings,
            "wallet_mode": s.wallet_mode, "admin_wallet": s.admin_wallet_address}


class SettingsBody(BaseModel):
    markup_percent: str | None = None
    fee_percent: str | None = None
    profit_fixed_uzs: str | None = None
    service_fee_uzs: str | None = None
    service_fee_ton: str | None = None
    min_rent_days: str | None = None
    round_to: str | None = None
    rate_mode: str | None = None
    manual_rate: str | None = None
    card_number: str | None = None
    card_holder: str | None = None
    card_bank: str | None = None
    stars_markup_percent: str | None = None
    premium_markup_percent: str | None = None
    referral_percent: str | None = None
    stars_usd_per_1000: str | None = None
    username_markup_percent: str | None = None
    number_markup_percent: str | None = None
    premium_usd_3: str | None = None
    premium_usd_6: str | None = None
    premium_usd_12: str | None = None
    fragment_fee_ton: str | None = None


_USD_KEYS = ("username_markup_percent", "number_markup_percent", "stars_usd_per_1000", "premium_usd_3", "premium_usd_6", "premium_usd_12", "fragment_fee_ton")
_LIMITS = {"username_markup_percent": (0, 1000), "number_markup_percent": (0, 1000), "stars_usd_per_1000": (0, 1000), "premium_usd_3": (0, 1000), "premium_usd_6": (0, 1000),
           "premium_usd_12": (0, 1000), "fragment_fee_ton": (0, 5), "stars_markup_percent": (0, 500), "premium_markup_percent": (0, 500), "referral_percent": (0, 50),"markup_percent": (0, 1000), "fee_percent": (0, 100), "profit_fixed_uzs": (0, 100_000_000),
           "service_fee_uzs": (0, 100_000_000), "service_fee_ton": (0, 1000), "min_rent_days": (1, 180),
           "round_to": (1, 100_000), "manual_rate": (0, 10_000_000_000)}


@router.post("/admin/settings")
async def admin_settings(body: SettingsBody, admin: CurrentUser = Depends(owner_user)):
    values = body.model_dump(exclude_none=True)
    for key, (low, high) in _LIMITS.items():
        if key in ("username_markup_percent", "number_markup_percent") and key in values and not values[key].strip():
            values[key] = ""                     # empty = same % as gifts
            continue
        if key in values:
            try:
                number = Decimal((values[key] or "0").replace(",", ".").replace(" ", ""))
            except InvalidOperation:
                raise HTTPException(400, detail={"code": "generic", "detail": key}) from None
            if not low <= number <= high:
                raise HTTPException(400, detail={"code": "generic", "detail": key})
            values[key] = str(int(number)) if key in ("round_to", "profit_fixed_uzs", "service_fee_uzs", "min_rent_days") \
                else str(number.normalize())
    if "rate_mode" in values and values["rate_mode"] not in ("auto", "manual"):
        raise HTTPException(400, detail={"code": "generic"})
    if "card_number" in values:
        values["card_number"] = " ".join(values["card_number"].split())[:32]
    async with Session() as session:
        for key, value in values.items():
            await set_setting(session, key, value[:128])
    return {"ok": True}


def _admin_action(action):
    async def handler(order_id: int, admin: CurrentUser = Depends(admin_user)):
        try:
            order = await action(get_context(), order_id, admin.id)
        except svc.ServiceError as exc:
            raise _error(exc) from None
        return svc.order_view(order)
    return handler


router.post("/admin/orders/{order_id}/confirm-payment")(_admin_action(svc.confirm_payment))
router.post("/admin/orders/{order_id}/reject-payment")(_admin_action(svc.reject_payment))
router.post("/admin/orders/{order_id}/cancel")(_admin_action(svc.admin_cancel))
router.post("/admin/orders/{order_id}/refunded")(_admin_action(svc.mark_refunded))
router.post("/admin/orders/{order_id}/retry")(_admin_action(svc.retry))
router.post("/admin/orders/{order_id}/tobalance")(_admin_action(svc.refund_to_balance))


async def _user_brief(user_id: int) -> dict:
    async with Session() as session:
        u = await session.get(User, user_id)
    return {"id": user_id, "name": f"{u.first_name} {u.last_name}".strip() if u else "", "username": u.username if u else "",
            "balance_uzs": int(u.balance_uzs or 0) if u else 0}


@router.get("/admin/topups")
async def admin_topups(filter: str = "open", admin: CurrentUser = Depends(admin_user)):
    from .db import TopupStatus as T
    rows = await wallet.list_topups(statuses=T.OPEN if filter == "open" else None, limit=100)
    return {"items": [{**wallet.topup_view(t), "user": await _user_brief(t.user_id)} for t in rows]}


@router.post("/admin/topups/{topup_id}/{action}")
async def admin_topup_action(topup_id: int, action: str, admin: CurrentUser = Depends(admin_user)):
    ctx = get_context()
    try:
        if action == "confirm":
            topup = await wallet.confirm_topup(ctx, topup_id, f"admin:{admin.id}", late=True)
        elif action == "reject":
            topup = await wallet.reject_topup(ctx, topup_id, f"admin:{admin.id}")
        else:
            raise HTTPException(404, detail={"code": "generic"})
    except wallet.WalletError as exc:
        raise _wallet_error(exc) from None
    return wallet.topup_view(topup)


@router.get("/admin/purchases")
async def admin_purchases(filter: str = "open", admin: CurrentUser = Depends(admin_user)):
    from .db import PurchaseStatus as P
    statuses = {P.PENDING, P.SIGNING, P.SENT, P.FAILED} if filter == "open" else None
    rows = await shop.list_purchases(statuses=statuses, limit=100)
    return {"items": [{**shop.purchase_view(p, admin=True), "user": await _user_brief(p.user_id)} for p in rows]}


@router.post("/admin/purchases/{purchase_id}/{action}")
async def admin_purchase_action(purchase_id: int, action: str, body: dict | None = None,
                                admin: CurrentUser = Depends(admin_user)):
    ctx = get_context()
    try:
        if action == "retry":
            p = await shop.admin_retry(ctx, purchase_id)
        elif action == "refund":
            p = await shop.admin_refund(ctx, purchase_id)
        elif action == "done":
            p = await shop.admin_done(ctx, purchase_id)
        elif action == "prepare-tx":
            return await shop.prepare_tx(purchase_id)
        elif action == "tx-sent":
            p = await shop.tx_sent(ctx, purchase_id, str((body or {}).get("boc") or ""))
        else:
            raise HTTPException(404, detail={"code": "generic"})
    except shop.PurchaseError as exc:
        raise _shop_error(exc) from None
    return shop.purchase_view(p, admin=True)


class BalanceBody(BaseModel):
    delta: int = Field(ge=-1_000_000_000, le=1_000_000_000)


@router.post("/admin/users/{user_id}/balance")
async def admin_balance(user_id: int, body: BalanceBody, admin: CurrentUser = Depends(owner_user)):
    try:
        return {"balance_uzs": await wallet.admin_adjust(user_id, body.delta, admin.id)}
    except wallet.WalletError as exc:
        raise _wallet_error(exc) from None


@router.post("/admin/orders/{order_id}/prepare-tx")
async def prepare_tx(order_id: int, admin: CurrentUser = Depends(owner_user)):
    ctx = get_context()
    try:
        if ctx.hot_wallet is not None:
            return {"hot": True, "order": svc.order_view(await svc.sign_pending_hot(ctx, order_id, f"admin:{admin.id}"))}
        return await svc.prepare_tx(ctx, order_id)
    except svc.ServiceError as exc:
        raise _error(exc) from None


class SentBody(BaseModel):
    boc: str = Field(max_length=20000)
    wallet: str = Field(max_length=80)


@router.post("/admin/orders/{order_id}/tx-sent")
async def tx_sent(order_id: int, body: SentBody, admin: CurrentUser = Depends(owner_user)):
    try:
        return svc.order_view(await svc.tx_sent(get_context(), order_id, f"admin:{admin.id}", body.boc, body.wallet))
    except svc.ServiceError as exc:
        raise _error(exc) from None


@router.post("/admin/backup")
async def admin_backup(admin: CurrentUser = Depends(owner_user)):
    from . import backup
    path = await backup.make_backup()
    sent = await backup.send_to_admins(get_context().bot, path)
    return {"file": path.name, "size": path.stat().st_size, "sent": sent}


@router.get("/admin/orders/{order_id}/receipt")
async def receipt(order_id: int, admin: CurrentUser = Depends(admin_user)):
    ctx = get_context()
    order = await svc.get_order(order_id)
    if not order.receipt_file_id or ctx.bot is None:
        raise HTTPException(404, detail={"code": "order_not_found"})
    file = await ctx.bot.get_file(order.receipt_file_id)
    buffer = io.BytesIO()
    await ctx.bot.download_file(file.file_path, buffer)
    buffer.seek(0)
    media = mimetypes.guess_type(file.file_path or "")[0] or "image/jpeg"
    return StreamingResponse(buffer, media_type=media, headers={"Cache-Control": "private, max-age=300"})


async def service_error_handler(request: Request, exc: svc.ServiceError):
    return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code}})
