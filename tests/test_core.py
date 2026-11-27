import asyncio
import base64
import json
import urllib.parse
from decimal import Decimal

import pytest
from pytoniq_core import Address, Cell
from pytoniq_core.crypto.keys import mnemonic_new

from app.i18n import LANGS, flatten
from app.pricing import PricingConfig, duration_days, image_url, make_quote
from app.tg_auth import InitDataError, sign_init_data, validate_init_data
from app.ton import HotWallet, canonical_address, transaction_total_nano, validate_tonconnect_url


def fragment_link(manifest="https://fragment.com/tonconnect-manifest.json"):
    r = json.dumps({"manifestUrl": manifest, "items": [{"name": "ton_addr"}]})
    return "tc://?v=2&id=" + "ab" * 32 + "&r=" + urllib.parse.quote(r) + "&ret=none"


def test_locales_have_identical_keys():
    keys = [set(flatten(json.loads(open(f"locales/{lang}.json", encoding="utf-8").read()))) for lang in LANGS]
    assert keys[0] == keys[1] == keys[2]


def test_init_data_roundtrip_and_tamper():
    data = sign_init_data({"id": 42, "first_name": "Ali"}, "123:ABC")
    assert validate_init_data(data, "123:ABC")["id"] == 42
    with pytest.raises(InitDataError):
        validate_init_data(data, "123:OTHER")
    with pytest.raises(InitDataError):
        validate_init_data(data.replace("Ali", "Bob"), "123:ABC")
    old = sign_init_data({"id": 42}, "123:ABC", auth_date=1000)
    with pytest.raises(InitDataError):
        validate_init_data(old, "123:ABC", max_age=60)


def test_tonconnect_link_validation():
    link = fragment_link()
    assert validate_tonconnect_url("here it is: " + link).startswith("tc://")
    for bad in ["hello", "https://fragment.com", "tc://?v=2&id=zz&r={}"]:
        with pytest.raises(ValueError):
            validate_tonconnect_url(bad)
    with pytest.raises(ValueError, match="link_not_fragment"):
        validate_tonconnect_url(fragment_link("https://evil.example/manifest.json"))


def test_quote_maths_fee_profit_and_rounding():
    from app.pricing import collection_images, floor_nano, uzs_to_base_nano
    # 1 TON/day listing, Marketapp +20%, profit +15% and +2 000 so'm/day, 1 TON = 40 000 so'm
    config = PricingConfig(rate_uzs_per_ton=Decimal(40000), fee_percent=Decimal(20), markup_percent=Decimal(15),
                           fixed_per_day=Decimal(2000), round_to=100, rate_mode="manual")
    quote = make_quote(1_000_000_000, 3, config)
    assert quote.cost_nano == 3_600_000_000                 # 3 TON + 20 %
    assert quote.cost_uzs == 144_000                        # 3.6 TON × 40 000
    assert quote.amount_uzs == 171_600                      # 144 000 × 1.15 + 3 × 2 000
    assert quote.profit_uzs == 27_600
    assert quote.per_day_uzs == 57_200
    # tiny listings are no longer blown up by rounding to 1 000
    cheap = make_quote(10_000_000, 1, PricingConfig(Decimal(40000), Decimal(0), Decimal(0), Decimal(0), 100, "manual"))
    assert cheap.amount_uzs == 400
    # price filter inverse
    assert abs(uzs_to_base_nano(Decimal(57_200), config) - 1_000_000_000) < 1000
    assert duration_days(86400, 30 * 86400) == (1, 30)
    assert image_url("Plush Pepe #12") == "https://nft.fragment.com/gift/plushpepe-12.webp"
    assert collection_images("Swiss Watches")[0] == "https://nft.fragment.com/gift/swisswatch-1.webp"
    assert "https://nft.fragment.com/gift/durovscap-1.webp" in collection_images("Durov's Caps")
    assert floor_nano("1.19") == 1_190_000_000 and floor_nano("1190000000") == 1_190_000_000


def test_tx_total_rejects_garbage():
    addr = Address((0, b"\x01" * 32)).to_str()
    assert transaction_total_nano({"messages": [{"address": addr, "amount": "5"}, {"address": addr, "amount": "7"}]}) == 12
    with pytest.raises(ValueError):
        transaction_total_nano({"messages": [{"address": addr, "amount": "-1"}]})


def test_hot_wallet_builds_signed_external_message():
    wallet = HotWallet(" ".join(mnemonic_new()))
    dest = Address((0, b"\x02" * 32)).to_str()
    payload = base64.b64encode(Cell.empty().to_boc()).decode()
    tx = {"validUntil": 4_000_000_000, "messages": [{"address": dest, "amount": "1000", "payload": payload}]}
    cell = wallet.build_transfer(tx, seqno=5, now=3_999_999_000)
    parsed = Cell.one_from_boc(cell.to_boc())
    assert parsed.hash == cell.hash
    assert canonical_address(wallet.address.to_str()).startswith("0:")


# ---------------------------------------------------------------------------- full order flow
async def _flow():
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.db import init_db
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    await init_db()
    ctx = AppContext(settings=get_settings(), market=DemoMarketapp(), rates=RateProvider(), notifier=NullNotifier())
    gift = ctx.market.items[5]           # 0.1 TON × 1.35 per day
    await svc.upsert_user(7, "Test")
    order = await svc.create_order(ctx, 7, gift["nft_address"], 3)
    per_day = -(-int(int(gift["price_per_day"]) / 1e9 * 40000 * 1.15) // 10) * 10
    assert 1 <= order.unique_add_uzs <= 99
    assert order.amount_uzs == per_day * 3 + 1800 + order.unique_add_uzs and order.status == "awaiting_payment"
    assert order.service_fee_uzs == 1800
    assert order.profit_uzs == order.amount_uzs - order.cost_uzs > 0

    with pytest.raises(svc.ServiceError):          # cannot send a link before renting
        await svc.submit_link(ctx, 7, order.id, fragment_link())
    with pytest.raises(svc.ServiceError):          # another user cannot touch it
        await svc.attach_receipt(ctx, 8, order.id, file_id="x")

    order = await svc.attach_receipt(ctx, 7, order.id, file_id="file-1", kind="photo")
    assert order.status == "payment_review"

    # two admins press "confirm" at the same time: exactly one wins
    results = await asyncio.gather(svc.confirm_payment(ctx, order.id, 1), svc.confirm_payment(ctx, order.id, 1),
                                   return_exceptions=True)
    assert sum(1 for r in results if isinstance(r, svc.ServiceError)) == 1

    prepared = await svc.prepare_tx(ctx, order.id)
    assert prepared["kind"] == "rent" and prepared["transaction"]["messages"]
    from app.db import Session, get_setting
    async with Session() as session:
        assert await get_setting(session, "observed_fee_percent") == "10.00"   # demo Marketapp adds 10 %
    await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
    await svc.worker_tick(ctx)
    order = await svc.get_order(order.id)
    assert order.status == "awaiting_link" and order.end_time is not None

    # main way: connect the customer's Telegram (Marketapp /v1/rent/tg/*), no fragment.com
    started = await svc.tg_connect(ctx, 7, order.id)
    assert started["status"] == "waiting" and started["link"].startswith("https://t.me/")
    assert (await svc.tg_poll(ctx, 7, order.id))["status"] == "consumed"
    done = await svc.tg_poll(ctx, 7, order.id)
    assert done["status"] == "displayed" and done["order"].status == "active"

    # backup way still works (Fragment TonConnect link), e.g. to reconnect an active rental
    with pytest.raises(svc.ServiceError):
        await svc.submit_link(ctx, 7, order.id, "not a link")
    order = await svc.submit_link(ctx, 7, order.id, fragment_link())
    assert order.status == "active"
    sent = [k for _, oid, k in ctx.notifier.sent if oid == order.id]
    assert {"payment_confirmed", "awaiting_link", "displayed"} <= set(sent)

    # the next rental of an already connected customer is displayed automatically
    second = await svc.create_order(ctx, 7, ctx.market.items[9]["nft_address"], 3)
    await svc.attach_receipt(ctx, 7, second.id, file_id="file-2")
    await svc.confirm_payment(ctx, second.id, 1)
    await svc.prepare_tx(ctx, second.id)
    await svc.tx_sent(ctx, second.id, "admin:1", "boc", None)
    await svc.worker_tick(ctx)
    assert (await svc.get_order(second.id)).status == "active"


async def _overprice_guard():
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    market = DemoMarketapp()

    async def greedy_pay(nft_address, duration, price, sale_during_rent=False):
        return {"transaction": {"validUntil": 4_000_000_000, "messages": [
            {"address": market.items[0]["nft_address"], "amount": str(10 ** 15), "payload": None}]}}
    market.pay = greedy_pay
    ctx = AppContext(settings=get_settings(), market=market, rates=RateProvider(), notifier=NullNotifier())
    await svc.upsert_user(9, "Guard")
    order = await svc.create_order(ctx, 9, market.items[6]["nft_address"], 3)
    assert order.sellable is False
    await svc.confirm_payment(ctx, order.id, 1)
    with pytest.raises(svc.ServiceError) as err:
        await svc.prepare_tx(ctx, order.id)
    assert err.value.code == "price_changed"


def test_order_flow():
    asyncio.run(_flow())
    asyncio.run(_overprice_guard())


def test_api_requires_telegram_signature():
    from fastapi.testclient import TestClient
    from app.main import create_app

    with TestClient(create_app()) as client:
        assert client.get("/api/me").status_code == 401
        assert client.get("/api/me", headers={"X-Telegram-Init-Data": "user=%7B%22id%22%3A1%7D&hash=00"}).status_code == 401
        good = sign_init_data({"id": 55, "first_name": "Ali", "language_code": "ru"}, "123:TEST")
        me = client.get("/api/me", headers={"X-Telegram-Init-Data": good}).json()
        assert me["user"]["id"] == 55 and me["user"]["lang"] == "ru" and me["user"]["is_admin"] is False
        assert client.get("/api/admin/stats", headers={"X-Telegram-Init-Data": good}).status_code == 403
        gifts = client.get("/api/gifts", headers={"X-Telegram-Init-Data": good}).json()
        assert gifts["items"] and gifts["items"][0]["per_day_uzs"] > 0


def test_listing_cache_replaces_paid_nft_endpoint():
    from app.marketapp import lookup_listing, remember_listings
    store = {}
    addr = Address((0, b"\x05" * 32)).to_str()
    remember_listings(store, [{"nft_address": addr, "nft_name": "Toy Bear #5", "price_per_day": "20000000",
                               "is_sellable_during_rent": True}], "EQcollection")
    hit = lookup_listing(store, Address(addr).to_str(is_user_friendly=False), 60)
    assert hit["price_per_day"] == "20000000" and hit["_collection"] == "EQcollection"
    assert lookup_listing(store, addr, -1) is None


async def _extension_and_events():
    from dataclasses import replace
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.db import init_db
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    await init_db()
    market = DemoMarketapp()
    settings = get_settings().model_copy(update={"use_rent_events": True})
    ctx = AppContext(settings=settings, market=market, rates=RateProvider(), notifier=NullNotifier())
    await svc.upsert_user(21, "Ext")
    gift = market.items[10]

    # --- rent confirmed through the /v1/rent/events/ feed (no my-rented polling needed)
    order = await svc.create_order(ctx, 21, gift["nft_address"], 3)
    await svc.attach_receipt(ctx, 21, order.id, file_id="r")
    await svc.confirm_payment(ctx, order.id, 1)
    await svc.prepare_tx(ctx, order.id)
    await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
    end = int(__import__("time").time()) + 3 * 86400

    async def feed(cursor=None, **_):
        if cursor == "c1":
            return {"cursor": "c1", "items": []}
        return {"cursor": "c1", "items": [{"address": gift["nft_address"], "name": gift["nft_name"], "type": "rented",
                                           "collection_address": "x", "ts": 1, "type_data": {"end_time": end}}]}
    market.rent_events = feed
    market.rented[gift["nft_address"]] = end
    await svc.worker_tick(ctx)
    order = await svc.get_order(order.id)
    from app.db import aware
    assert order.status == "awaiting_link" and int(aware(order.end_time).timestamp()) == end
    from app.db import Session, get_setting
    async with Session() as session:
        assert await get_setting(session, "rent_events_cursor") == "c1"

    # --- extension: quote, order, pay, sign, applied → parent end time moves
    quote = await svc.extension_quote(ctx, 21, order.id, 3)
    assert quote["max_days"] == 30 and quote["amount_uzs"] > 0
    ext = await svc.create_extension(ctx, 21, order.id, 3)
    assert ext.kind == "extend" and ext.parent_id == order.id
    with pytest.raises(svc.ServiceError) as busy:
        await svc.create_extension(ctx, 21, order.id, 1)
    assert busy.value.code == "extend_pending"
    await svc.attach_receipt(ctx, 21, ext.id, file_id="r2")
    await svc.confirm_payment(ctx, ext.id, 1)
    prepared = await svc.prepare_tx(ctx, ext.id)
    assert prepared["kind"] == "rent"
    await svc.tx_sent(ctx, ext.id, "admin:1", "boc", None)
    ctx.settings = settings.model_copy(update={"use_rent_events": False})
    await svc.worker_tick(ctx)
    assert (await svc.get_order(ext.id)).status == "extended"
    parent = await svc.get_order(order.id)
    assert int(aware(parent.end_time).timestamp()) == end + 3 * 86400
    assert ("user", ext.id, "extended") in ctx.notifier.sent


def test_extension_and_rent_events():
    asyncio.run(_extension_and_events())


def test_backup_and_restore(tmp_path, monkeypatch):
    import gzip, sqlite3
    from app import backup
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "backup_dir", str(tmp_path))
    path = asyncio.run(backup.make_backup())
    assert path.exists() and path.name.startswith("giftrent-")
    raw = tmp_path / "restored.db"
    raw.write_bytes(gzip.open(path).read())
    tables = {r[0] for r in sqlite3.connect(raw).execute("select name from sqlite_master where type='table'")}
    assert {"users", "orders", "order_events", "settings"} <= tables


def test_broadcast_segments_and_blocked_users():
    from aiogram.exceptions import TelegramForbiddenError
    from aiogram.methods import CopyMessage
    from app.bot import broadcast
    from app.db import Session, User
    from app import orders as svc

    class FakeStatus:
        text = ""
        async def edit_text(self, text, **_):
            self.text = text

    class FakeBot:
        def __init__(self):
            self.sent = []
        async def copy_message(self, chat_id, from_chat_id, message_id):
            if chat_id == 303:
                raise TelegramForbiddenError(method=CopyMessage(chat_id=chat_id, from_chat_id=1, message_id=1),
                                             message="Forbidden: bot was blocked by the user")
            self.sent.append(chat_id)

    async def scenario():
        for uid in (301, 302, 303):
            await svc.upsert_user(uid, f"U{uid}")
        broadcast.DELAY = 0
        bot, status = FakeBot(), FakeStatus()
        users = set(await broadcast.audience("all"))
        assert {301, 302, 303} <= users
        result = await broadcast.run(bot, broadcast.Draft(chat_id=1, message_id=9, segment="all"), status, "uz")
        assert 303 not in bot.sent and result["blocked"] == 1 and "Tayyor" in status.text
        async with Session() as session:
            assert (await session.get(User, 303)).bot_blocked is True
        assert 303 not in await broadcast.audience("all")
        assert set(await broadcast.audience("active")) <= set(await broadcast.audience("customers"))

    asyncio.run(scenario())


def test_rent_plus_service_fee_and_minimum_days():
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider
    # same numbers as the reference shop: 450 so'm/day × 3 days + 1 800 service fee = 3 150
    config = PricingConfig(rate_uzs_per_ton=Decimal(45000), fee_percent=Decimal(0), markup_percent=Decimal(0),
                           fixed_per_day=Decimal(0), round_to=10, rate_mode="manual", service_fee=Decimal(1800), min_days=3)
    q = make_quote(10_000_000, 3, config)                 # 0.01 TON/day
    assert (q.per_day_uzs, q.rent_uzs, q.service_fee_uzs, q.amount_uzs) == (450, 1350, 1800, 3150)

    async def scenario():
        ctx = AppContext(settings=get_settings(), market=DemoMarketapp(), rates=RateProvider(), notifier=NullNotifier())
        await svc.upsert_user(41, "Min")
        with pytest.raises(svc.ServiceError) as err:
            await svc.create_order(ctx, 41, ctx.market.items[0]["nft_address"], 2)     # shop minimum is 3 days
        assert err.value.code == "days_out_of_range"
        quote = await svc.quote_for(ctx, ctx.market.items[0]["nft_address"], 3)
        assert quote["min_days"] == 3 and quote["amount_uzs"] == quote["rent_uzs"] + 1800
    asyncio.run(scenario())


CARDXABAR_IN = """🟢 Popolnenie scheta
➕ {amount} UZS
💳 ***4625
📍 TOSHKENT SH., ORIENT FINANS KHAT BANKI, UZ
🕓 27.07.26 14:34
💵 381 810.84 UZS"""


def test_cardxabar_parser_real_format():
    from app.card_notices import parse_notice
    n = parse_notice(CARDXABAR_IN.format(amount="381 216.00"))
    assert n.is_credit and n.amount == Decimal("381216.00") and n.card_last4 == "4625"   # not the 💵 balance
    out = parse_notice(CARDXABAR_IN.format(amount="5 000.00").replace("🟢 Popolnenie scheta", "🔴 Spisanie").replace("➕", "➖"))
    assert not out.is_credit
    custom = parse_notice("Kirim: 12 345 so'm", r"Kirim:\s*(?P<amount>[\d ]+)")
    assert custom.amount == Decimal("12345")


def test_cardxabar_auto_confirms_unique_amounts():
    from app import orders as svc
    from app.card_notices import handle_notice
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    async def scenario():
        ctx = AppContext(settings=get_settings(), market=DemoMarketapp(), rates=RateProvider(), notifier=NullNotifier())
        await svc.upsert_user(51, "A")
        await svc.upsert_user(52, "B")
        gift = ctx.market.items[7]
        a = await svc.create_order(ctx, 51, gift["nft_address"], 3)
        b = await svc.create_order(ctx, 52, gift["nft_address"], 3)
        assert a.amount_uzs != b.amount_uzs                     # same gift, same days, still distinguishable

        fmt = lambda v: f"{v:,}".replace(",", " ") + ".00"
        r = await handle_notice(ctx, "userbot:1:100", CARDXABAR_IN.format(amount=fmt(b.amount_uzs)))
        assert r == {"result": "matched", "order_id": b.id, "amount": b.amount_uzs}
        assert (await svc.get_order(b.id)).status == "paid"
        assert (await svc.get_order(a.id)).status == "awaiting_payment"
        assert (await handle_notice(ctx, "userbot:1:100", "same message again"))["result"] == "duplicate"
        assert (await handle_notice(ctx, "userbot:1:101", CARDXABAR_IN.format(amount="777.00")))["result"] == "unmatched"
        debit = CARDXABAR_IN.format(amount=fmt(a.amount_uzs)).replace("Popolnenie scheta", "Spisanie").replace("➕", "➖")
        assert (await handle_notice(ctx, "userbot:1:102", debit))["result"] == "ignored"
        other_card = CARDXABAR_IN.format(amount=fmt(a.amount_uzs)).replace("***4625", "***9999")
        ctx.settings = get_settings().model_copy(update={"card_last4": "4625"})
        assert (await handle_notice(ctx, "userbot:1:103", other_card))["result"] == "ignored"
        assert (await handle_notice(ctx, "userbot:1:104", CARDXABAR_IN.format(amount=fmt(a.amount_uzs))))["result"] == "matched"
        assert ("admin", a.id, "auto_paid") in ctx.notifier.sent
    asyncio.run(scenario())


# ---------------------------------------------------------------------------- Telegram connect failures
async def _tg_connect_failures():
    from datetime import timedelta
    from sqlalchemy import update
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.db import Order, Session, init_db, utcnow
    from app.marketapp import DemoMarketapp, MarketappError
    from app.pricing import RateProvider

    await init_db()
    market = DemoMarketapp()
    ctx = AppContext(settings=get_settings(), market=market, rates=RateProvider(), notifier=NullNotifier())
    await svc.upsert_user(11, "Stale")
    order = await svc.create_order(ctx, 11, market.items[5]["nft_address"], 3)
    await svc.attach_receipt(ctx, 11, order.id, file_id="f")
    await svc.confirm_payment(ctx, order.id, 1)
    await svc.prepare_tx(ctx, order.id)
    await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
    await svc.worker_tick(ctx)
    assert (await svc.get_order(order.id)).status == "awaiting_link"

    # Marketapp says "ready" but Telegram refuses the stale login: we must disconnect it on Marketapp too,
    # otherwise every new try gets "ready" again and fails the same way forever.
    disconnected = []

    async def ready(customer_id):
        return {"status": "ready", "telegram": {"name": "Old"}}

    async def refuse(nft_address, customer_id):
        raise MarketappError("Marketapp HTTP 400", 400, {"detail": "Telegram session expired"})

    async def disconnect(customer_id):
        disconnected.append(customer_id)
        return {"status": "ok"}
    market.tg_connect, market.tg_display, market.tg_disconnect = ready, refuse, disconnect
    with pytest.raises(svc.ServiceError) as err:
        await svc.tg_connect(ctx, 11, order.id)
    assert err.value.code == "login_expired" and disconnected == ["tg11"]
    assert (await svc.get_order(order.id)).status == "awaiting_link"

    # an order left in CONNECTING (app restarted mid-display) goes back after a few minutes
    async with Session() as session:
        await session.execute(update(Order).where(Order.id == order.id)
                              .values(status="connecting", updated_at=utcnow() - timedelta(minutes=10)))
        await session.commit()
    await svc.worker_tick(ctx)
    assert (await svc.get_order(order.id)).status == "awaiting_link"

    # re-showing an ACTIVE gift waits for the real confirmation instead of reporting "displayed" at once
    market.tg_display = DemoMarketapp.tg_display.__get__(market)
    async def waiting(customer_id):
        return {"status": "waiting", "link": "https://t.me/oauth?x"}
    market.tg_connect = market.tg_status = waiting
    await svc.submit_link(ctx, 11, order.id, fragment_link())
    assert (await svc.get_order(order.id)).status == "active"
    assert (await svc.tg_poll(ctx, 11, order.id))["status"] == "waiting"
    market.tg_status = ready
    assert (await svc.tg_poll(ctx, 11, order.id))["status"] == "displayed"


def test_tg_connect_failures():
    asyncio.run(_tg_connect_failures())


def test_admin_panel_tokens_codes_and_password():
    from app import admin_auth
    from app.config import Settings
    s = Settings(bot_token="123:ABC", admin_ids=[7], admin_panel_password="long-enough-pw", _env_file=None)
    token, exp = admin_auth.make_token(s, 7, now=1000)
    assert admin_auth.check_token(s, token, now=1001) == 7
    assert admin_auth.check_token(s, token, now=exp + 1) is None            # expired
    assert admin_auth.check_token(s, token[:-2] + "xx", now=1001) is None   # tampered signature
    other, _ = admin_auth.make_token(s, 8, now=1000)
    assert admin_auth.check_token(s, other, now=1001) is None               # not an admin
    code = admin_auth.new_code(7, now=2000)
    assert admin_auth.new_code(7, now=2010) is None                          # cooldown
    assert not admin_auth.verify_code(7, "000000" if code != "000000" else "111111", now=2001)
    assert admin_auth.verify_code(7, code, now=2002)
    assert not admin_auth.verify_code(7, code, now=2003)                     # single use
    assert admin_auth.check_password(s, "long-enough-pw", 7)
    for _ in range(admin_auth.PASSWORD_ATTEMPTS):
        assert not admin_auth.check_password(s, "nope", 7)
    assert admin_auth.password_locked(7)


def test_panel_link_token_is_single_use():
    import time as _t
    from app import panel
    token = panel.issue_link_token(7)
    assert panel._links[token][0] == 7 and panel._links[token][1] > _t.time()
    assert panel._links.pop(token)[0] == 7 and token not in panel._links


def test_percent_markup_and_ton_service_fee():
    """0.1 TON/day at 60 000 so'm/TON = 6 000; +20% = 7 200/day; 3 days = 21 600; fee 0.01 TON = 600 → 22 200.
    A stored so'm/day add-on (old setting) is ignored."""
    from app.db import Session, init_db, set_setting
    from app.pricing import RateProvider, make_quote, pricing_config

    async def run():
        await init_db()
        async with Session() as session:
            for k, v in {"rate_mode": "manual", "manual_rate": "60000", "markup_percent": "20", "fee_percent": "0",
                         "service_fee_ton": "0.01", "profit_fixed_uzs": "1000", "round_to": "10"}.items():
                await set_setting(session, k, v)
        rates = RateProvider()
        try:
            config = await pricing_config(rates)
        finally:
            await rates.close()
        q = make_quote(100_000_000, 3, config)                    # 0.1 TON per day
        assert (q.per_day_uzs, q.rent_uzs, q.service_fee_uzs, q.amount_uzs) == (7200, 21600, 600, 22200)
        async with Session() as session:                          # restore defaults for the other tests
            for k in ("rate_mode", "manual_rate", "markup_percent", "fee_percent", "service_fee_ton", "profit_fixed_uzs", "round_to"):
                from app.db import Setting
                row = await session.get(Setting, k)
                if row:
                    await session.delete(row)
            await session.commit()
    asyncio.run(run())

def test_panel_url_defaults_to_builtin_admin(tmp_path, monkeypatch):
    from app.config import Settings
    s = Settings(webapp_url="https://bot.up.railway.app/", _env_file=None)
    # the repo has admin-panel/dist after a build; Railway has admin_dist — either way it is /admin
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    built = any((root / d / "index.html").exists() for d in ("admin_dist", "admin-panel/dist"))
    assert s.panel_url == ("https://bot.up.railway.app/admin" if built else "")
    assert Settings(webapp_url="https://bot.up.railway.app", admin_panel_url="https://x.vercel.app/", _env_file=None).panel_url == "https://x.vercel.app"


def test_trait_rarity_from_collection_attributes():
    import asyncio as _a
    from app import rarity
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    class Market(DemoMarketapp):
        async def collection_attributes(self, collection_address):
            assert collection_address == "EQbear"
            return [{"trait_type": "Model", "values": [{"value": "Unicorns", "perc": 1.5}, {"value": "Other", "perc": 98.5}]},
                    {"trait_type": "Symbol", "values": [{"value": "Flower", "count": 11}, {"value": "Star", "count": 989}]},
                    {"trait_type": "Backdrop", "values": [{"value": "Emerald", "perc": 2.0}]}]

        async def gift_collections(self):
            return [{"name": "Nail Bracelet", "address": "EQbear"}]

    ctx = AppContext(settings=get_settings(), market=Market(), rates=RateProvider(), notifier=NullNotifier())
    listing = {"name": "Nail Bracelet #4596", "collection_address": "",       # found by name, like the "all gifts" feed
               "attributes": [{"trait_type": "Model", "value": "Unicorns"}, {"trait_type": "Symbol", "value": "Flower"},
                              {"trait_type": "Backdrop", "value": "Emerald"}]}
    got = {x["trait"]: x["perc"] for x in _a.run(rarity.traits(ctx, listing))}
    assert got == {"model": "1.5", "symbol": "1.1", "backdrop": "2"}


def test_backdrop_colour_parsing():
    from app.gift_assets import parse
    sample = [{"name": "Navy Blue", "hex": {"centerColor": "#3B5C8C", "edgeColor": "#22355A"}},
              {"name": "Black", "centerColor": 3552058, "edgeColor": 921359},
              {"name": "Broken"}]
    got = parse(sample)
    assert got["Navy Blue"] == ["#3b5c8c", "#22355a"] and got["Black"] == ["#36333a", "#0e0f0f"] and "Broken" not in got
    assert parse({"backdrops": sample}) == got


def test_trait_rarity_loose_names_and_other_fields():
    import asyncio as _a
    from app import rarity
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    class Market(DemoMarketapp):
        async def gift_collections(self):
            return [{"name": "Durov’s  Cap", "address": "EQcap"}]           # curly quote + double space

        async def collection_attributes(self, address):
            assert address == "EQcap"
            return [{"trait_type": "model", "values": [{"value": "Iconic Dude", "rarity_per_mille": 12}]},
                    {"trait_type": "Backdrop", "values": [{"value": "Black", "percent": "2"}]}]

    ctx = AppContext(settings=get_settings(), market=Market(), rates=RateProvider(), notifier=NullNotifier())
    listing = {"name": "Durov's Cap #77", "attributes": [{"trait_type": "Model", "value": "Iconic Dude"},
                                                         {"trait_type": "Backdrop", "value": "Black"}]}
    got = {x["trait"]: x["perc"] for x in _a.run(rarity.traits(ctx, listing))}
    assert got == {"model": "1.2", "backdrop": "2"}


def test_collection_names_singular_plural():
    from app.rarity import singular
    pairs = [("Durov’s Cap", "Durov's Caps"), ("Vice Cream", "Vice Creams"), ("Whip Cupcake", "Whip Cupcakes"),
             ("Swiss Watch", "Swiss Watches"), ("Jelly Bunny", "Jelly Bunnies"), ("Precious Peach", "Precious Peaches"),
             ("Light Sword", "Light Swords"), ("Plush Pepe", "Plush Pepes"), ("Lol Pop", "Lol Pops")]
    for gift, collection in pairs:
        assert singular(gift) == singular(collection), (gift, collection)
    assert singular("Kiss") != singular("Kis")          # "ss" endings are not plurals



def test_tg_connect_resilience():
    """A one-off unexplained refusal keeps the login (no new link needed); a second one drops it.
    A 503 is retried quietly. A login confirmed from another account is not displayed without consent."""
    import asyncio as _a
    from app import orders as svc
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.db import init_db
    from app.marketapp import DemoMarketapp, MarketappError
    from app.pricing import RateProvider

    async def run():
        await init_db()
        market = DemoMarketapp()
        ctx = AppContext(settings=get_settings(), market=market, rates=RateProvider(), notifier=NullNotifier())
        await svc.upsert_user(12, "Retry")
        order = await svc.create_order(ctx, 12, market.items[6]["nft_address"], 3)
        await svc.attach_receipt(ctx, 12, order.id, file_id="f")
        await svc.confirm_payment(ctx, order.id, 1)
        await svc.prepare_tx(ctx, order.id)
        await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
        await svc.worker_tick(ctx)
        dropped, calls = [], {"n": 0}

        async def ready(customer_id):
            return {"status": "ready", "telegram": {"id": 12, "name": "Me"}}

        async def drop(customer_id):
            dropped.append(customer_id)
            return {}

        async def odd(nft, customer_id):
            raise MarketappError("Marketapp HTTP 400", 400, {"detail": "something odd"})
        market.tg_connect, market.tg_display, market.tg_disconnect = ready, odd, drop
        for expected_drops in (0, 1):
            with pytest.raises(svc.ServiceError) as err:
                await svc.tg_connect(ctx, 12, order.id)
            assert err.value.code == "display_failed" and len(dropped) == expected_drops

        async def flaky(nft, customer_id):                 # 503 once, then fine
            calls["n"] += 1
            if calls["n"] == 1:
                raise MarketappError("Marketapp HTTP 503", 503, None)
            return {"displayed": "Me"}
        market.tg_display = flaky
        assert (await svc.tg_connect(ctx, 12, order.id))["status"] == "displayed" and calls["n"] == 2

        async def other(customer_id):                      # confirmed from someone else's account
            return {"status": "ready", "telegram": {"id": 999, "name": "Stranger"}}
        market.tg_connect = other
        result = await svc.tg_connect(ctx, 12, order.id)
        assert result == {"status": "wrong_account", "account": "Stranger"}
        market.tg_display = DemoMarketapp.tg_display.__get__(market)
        assert (await svc.tg_account_choice(ctx, 12, order.id, use_it=True))["status"] == "displayed"
    _a.run(run())


def test_server_finishes_tg_login_when_app_is_closed():
    """Android: the Mini App is closed while the customer confirms in Telegram. The worker must finish the job,
    and customers who never connect get one reminder."""
    import asyncio as _a
    from datetime import timedelta as _td
    from sqlalchemy import update as _update
    from app import orders as svc
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.db import Order, Session, init_db, utcnow
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    class Recorder(NullNotifier):
        def __init__(self):
            self.sent = []

        async def user(self, order, key, **params):
            self.sent.append((order.id, key))

    async def rented(ctx, market, uid, idx):
        await svc.upsert_user(uid, "A")
        order = await svc.create_order(ctx, uid, market.items[idx]["nft_address"], 3)
        await svc.attach_receipt(ctx, uid, order.id, file_id="f")
        await svc.confirm_payment(ctx, order.id, 1)
        await svc.prepare_tx(ctx, order.id)
        await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
        await svc.worker_tick(ctx)
        return order

    async def run():
        await init_db()
        market = DemoMarketapp()
        rec = Recorder()
        ctx = AppContext(settings=get_settings(), market=market, rates=RateProvider(), notifier=rec)
        a = await rented(ctx, market, 21, 7)
        b = await rented(ctx, market, 22, 8)
        assert (await svc.tg_connect(ctx, 21, a.id))["status"] == "waiting"      # app opens the link and dies
        market.tg[svc.customer_id(21)] = 5                                       # customer confirms in Telegram
        await svc.worker_tick(ctx)
        assert (await svc.get_order(a.id)).status == "active" and (a.id, "displayed") in rec.sent
        async with Session() as session:                                          # b never connected for 20 min
            await session.execute(_update(Order).where(Order.id == b.id).values(rented_at=utcnow() - _td(minutes=20)))
            await session.commit()
        await svc.worker_tick(ctx)
        await svc.worker_tick(ctx)
        assert rec.sent.count((b.id, "tg_reminder")) == 1
    _a.run(run())


def test_monitor_low_balance_and_marketapp_alerts():
    from types import SimpleNamespace
    from app import monitor

    sent = []

    class Bot:
        async def send_message(self, chat_id, text):
            sent.append((chat_id, text))

    class Wallet:
        nano = 2 * 10**9
        async def balance_nano(self):
            return self.nano

    class Market:
        ok = False
        async def gift_collections(self):
            if not self.ok:
                raise RuntimeError("down")
            return []

    wallet, market = Wallet(), Market()
    ctx = SimpleNamespace(bot=Bot(), hot_wallet=wallet, market=market,
                          settings=SimpleNamespace(admin_ids=[7], min_ton_balance=5.0, admin_wallet_address=""))
    monitor.state.update(balance_nano=None, low=False, low_alert_at=0.0, market_fail=0, market_down=False)

    async def run():
        await monitor.check_wallet(ctx)
        await monitor.check_wallet(ctx)          # still low: no repeat within 6 h
        assert len(sent) == 1 and "TON kam" in sent[0][1]
        assert monitor.summary(ctx)["walletLow"] is True
        wallet.nano = 9 * 10**9
        await monitor.check_wallet(ctx)
        assert len(sent) == 2 and monitor.summary(ctx)["walletLow"] is False
        for _ in range(4):
            await monitor.check_marketapp(ctx)
        assert len(sent) == 3 and monitor.summary(ctx)["marketappDown"] is True
        market.ok = True
        await monitor.check_marketapp(ctx)
        assert len(sent) == 4 and not monitor.state["market_down"]

    asyncio.run(run())


def test_promo_codes_notices_and_favorites():
    from app import extras, orders as svc
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.db import init_db
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider

    async def run():
        await init_db()
        market = DemoMarketapp()
        ctx = AppContext(settings=get_settings(), market=market, rates=RateProvider(), notifier=NullNotifier())
        await svc.upsert_user(31, "Promo")
        await extras.save_promo({"code": "yangi10", "percent": 10, "perUser": 1, "maxUses": 5})
        gift = market.items[7]["nft_address"]
        plain = await svc.create_order(ctx, 31, gift, 3)
        order = await svc.create_order(ctx, 31, market.items[8]["nft_address"], 3, "YANGI10")
        assert order.promo_code == "YANGI10" and order.discount_uzs > 0
        assert order.discount_uzs <= order.profit_uzs + order.discount_uzs      # never below cost
        assert svc.order_view(order)["discount_uzs"] == order.discount_uzs
        with pytest.raises(svc.ServiceError) as err:                             # once per customer
            await svc.create_order(ctx, 31, gift, 3, "yangi10")
        assert err.value.code == "promo_already_used"
        with pytest.raises(svc.ServiceError):
            await svc.create_order(ctx, 31, gift, 3, "NOPE")
        await svc.cancel_by_user(ctx, 31, order.id)                              # a cancelled order frees the use
        assert (await extras.check_promo("yangi10", 31)).code == "YANGI10"
        rows = await extras.list_promos()
        assert rows[0]["code"] == "YANGI10" and rows[0]["used"] == 0
        # a fixed discount larger than our profit is capped at the profit
        await extras.save_promo({"code": "BIG", "amount": 10**9, "perUser": 0})
        big = await svc.create_order(ctx, 31, market.items[9]["nft_address"], 3, "big")
        assert big.profit_uzs - big.unique_add_uzs == 0 and big.amount_uzs >= big.cost_uzs
        await svc.cancel_by_user(ctx, 31, plain.id)

        # 🔔 notices
        await extras.add_notice(31, "<b>Gift</b> tayyor &amp; faol", order_id=order.id)
        data = await extras.notices(31)
        assert data["unread"] == 1 and data["items"][0]["text"] == "Gift tayyor & faol"
        await extras.mark_read(31)
        assert await extras.unread_count(31) == 0

        # ❤️ favorites + price drop alert (once)
        listing = await svc._listing(ctx, gift)
        await extras.add_favorite(31, listing["address"], listing["name"], "", "1000000000")
        assert [f["address"] for f in await extras.favorites(31)] == [listing["address"]]
        sent = []

        async def user_text(user_id, key, tab=None, **params):
            sent.append((user_id, key, params))
        ctx.notifier.user_text = user_text
        item = dict(market.cached_listing(gift), price_per_day="900000000")
        market.cached_listing = lambda a, max_age=1800: item if a == gift or a == listing["address"] else None
        assert await extras.watch_favorites(ctx, force=True) == 1
        assert sent[0][1] == "fav_cheaper" and sent[0][2]["percent"] == 10
        assert await extras.watch_favorites(ctx, force=True) == 0               # no repeat at the same price
        await extras.remove_favorite(31, listing["address"])
        assert await extras.favorites(31) == []

    asyncio.run(run())


def test_roles_analytics_and_csv_export():
    from fastapi.testclient import TestClient
    from app import admin_auth
    from app.main import create_app

    with TestClient(create_app()) as client:
        from app.context import get_context
        s = get_context().settings
        old_admins, old_ops = list(s.admin_ids), list(s.operator_ids)
        s.admin_ids, s.operator_ids = [901], [902]
        try:
            owner = {"Authorization": "Bearer " + admin_auth.make_token(s, 901)[0]}
            op = {"Authorization": "Bearer " + admin_auth.make_token(s, 902)[0]}
            stranger = {"Authorization": "Bearer " + admin_auth.make_token(s, 903)[0]}
            assert client.get("/api/panel/dashboard", headers=stranger).status_code == 401
            dash = client.get("/api/panel/dashboard", headers=op).json()
            assert dash["role"] == "operator" and dash["totalProfit"] == 0
            assert client.get("/api/panel/dashboard", headers=owner).json()["role"] == "owner"
            for path in ("/api/panel/config", "/api/panel/promos", "/api/panel/analytics", "/api/panel/export/orders",
                         "/api/admin/stats", "/api/panel/channels"):
                assert client.get(path, headers=op).status_code == 403, path
                assert client.get(path, headers=owner).status_code == 200, path
            assert client.get("/api/panel/connect-issues", headers=op).status_code == 200
            assert client.post("/api/panel/promos", headers=op, json={"code": "X123", "percent": 5}).status_code == 403
            made = client.post("/api/panel/promos", headers=owner, json={"code": "spring", "percent": 15, "perUser": 1})
            assert made.status_code == 200 and made.json()["code"] == "SPRING"
            assert client.post("/api/panel/promos", headers=owner, json={"code": "bad", "percent": 5, "amount": 100}).status_code == 400
            csv = client.get("/api/panel/export/orders?days=30", headers=owner)
            assert csv.headers["content-type"].startswith("text/csv") and csv.text.startswith("﻿ID;Sana")
            assert client.get("/api/panel/export/purchases", headers=owner).status_code == 200
            assert client.get("/api/panel/export/topups", headers=owner).status_code == 200
            data = client.get("/api/panel/analytics?days=0", headers=owner).json()
            assert "items" in data and "margin" in data["total"]
            staff = client.get("/api/panel/staff", headers=op).json()
            assert {x["role"] for x in staff["items"]} == {"owner", "operator"}
        finally:
            s.admin_ids, s.operator_ids = old_admins, old_ops


def test_add_and_remove_admins_from_panel(monkeypatch):
    from fastapi.testclient import TestClient
    from app import admin_auth, staff
    from app.main import create_app

    with TestClient(create_app()) as client:
        from app.context import get_context
        s = get_context().settings
        old = (list(s.admin_ids), list(s.operator_ids))
        monkeypatch.setattr(staff, "_env", {"admins": [901], "operators": []})
        s.admin_ids, s.operator_ids = [901], []
        try:
            owner = {"Authorization": "Bearer " + admin_auth.make_token(s, 901)[0]}
            r = client.post("/api/panel/staff", headers=owner, json={"id": 777, "role": "owner"})
            assert r.status_code == 200 and 777 in s.admin_ids
            r = client.post("/api/panel/staff", headers=owner, json={"id": 778, "role": "operator"})
            assert 778 in s.operator_ids and 778 not in s.admin_ids
            new_admin = {"Authorization": "Bearer " + admin_auth.make_token(s, 777)[0]}
            assert client.get("/api/panel/config", headers=new_admin).status_code == 200     # full owner rights
            op = {"Authorization": "Bearer " + admin_auth.make_token(s, 778)[0]}
            assert client.post("/api/panel/staff", headers=op, json={"id": 5, "role": "owner"}).status_code == 403
            items = {i["id"]: i for i in client.get("/api/panel/staff", headers=owner).json()["items"]}
            assert items[901]["fixed"] and not items[777]["fixed"] and items[778]["role"] == "operator"
            assert client.delete("/api/panel/staff/901", headers=new_admin).status_code == 400  # env owner is protected
            assert client.delete("/api/panel/staff/777", headers=new_admin).status_code == 400  # not yourself
            assert client.delete("/api/panel/staff/777", headers=owner).status_code == 200
            assert 777 not in s.admin_ids
            assert client.get("/api/panel/config", headers=new_admin).status_code == 401      # access gone at once
            client.delete("/api/panel/staff/778", headers=owner)
        finally:
            s.admin_ids, s.operator_ids = old


def test_each_listing_keeps_its_own_minimum_days():
    from app.pricing import PricingConfig, rentable_days
    config = PricingConfig(rate_uzs_per_ton=Decimal(30000), markup_percent=Decimal(0), fee_percent=Decimal(0),
                           fixed_per_day=Decimal(0), round_to=10, rate_mode="manual", service_fee=Decimal(0), min_days=1)
    assert rentable_days(86400, 30 * 86400, config) == (1, 30)          # Marketapp: 1 day minimum
    assert rentable_days(3 * 86400, 30 * 86400, config) == (3, 30)      # Marketapp: 3 day minimum
    from dataclasses import replace
    config = replace(config, min_days=3)                                 # shop floor still raises it when set
    assert rentable_days(86400, 30 * 86400, config) == (3, 30)


def test_usernames_and_numbers_have_their_own_markup():
    import asyncio
    from app.db import Session, init_db, set_setting
    from app.pricing import RateProvider, make_quote, pricing_config

    async def scenario():
        await init_db()
        rates = RateProvider()
        base = await pricing_config(rates)
        assert base.for_category("username").markup_percent == base.markup_percent      # not set → gifts' %
        async with Session() as session:
            await set_setting(session, "username_markup_percent", "50")
            await set_setting(session, "number_markup_percent", "0")
        config = await pricing_config(rates)
        assert config.for_category("username").markup_percent == 50
        assert config.for_category("number").markup_percent == 0
        assert config.for_category("gift").markup_percent == base.markup_percent
        gift = make_quote(1_000_000_000, 2, config.for_category("gift"))
        user = make_quote(1_000_000_000, 2, config.for_category("username"))
        assert user.amount_uzs > gift.amount_uzs
        async with Session() as session:
            await set_setting(session, "username_markup_percent", "")
            await set_setting(session, "number_markup_percent", "")
        assert (await pricing_config(rates)).for_category("number").markup_percent == base.markup_percent
        await rates.close()

    asyncio.run(scenario())


def test_sellable_gift_sold_during_rent_refunds_customer():
    """Gifts the owner may sell during the rent are offered too; if one is sold, the whole payment goes back."""
    from app import orders as svc
    from app.context import AppContext, NullNotifier
    from app.config import get_settings
    from app.db import init_db
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider
    from app.wallet import balance_of

    async def scenario():
        await init_db()
        market = DemoMarketapp()
        settings = get_settings().model_copy(update={"use_rent_events": True})
        ctx = AppContext(settings=settings, market=market, rates=RateProvider(), notifier=NullNotifier())
        await svc.upsert_user(31, "Sold")
        gift = next(i for i in market.items[20:] if i.get("is_sellable_during_rent"))
        days = max(3, gift["min_duration"] // 86400)
        order = await svc.create_order(ctx, 31, gift["nft_address"], days)
        assert order.sellable is True
        await svc.attach_receipt(ctx, 31, order.id, file_id="r")
        await svc.confirm_payment(ctx, order.id, 1)
        await svc.prepare_tx(ctx, order.id)
        await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
        end = int(__import__("time").time()) + days * 86400
        events = [{"address": gift["nft_address"], "type": "rented", "type_data": {"end_time": end}}]

        async def feed(cursor=None, **_):
            items, events[:] = list(events), []
            return {"cursor": f"s{len(items)}{cursor}", "items": items}
        market.rent_events = feed
        market.rented[gift["nft_address"]] = end
        await svc.worker_tick(ctx)
        assert (await svc.get_order(order.id)).status == "awaiting_link"
        before = await balance_of(31)

        events.append({"address": gift["nft_address"], "type": "cancel", "type_data": {}})   # bought from us
        await svc.worker_tick(ctx)
        order = await svc.get_order(order.id)
        assert order.status == "refunded"
        assert await balance_of(31) == before + order.amount_uzs
        assert ("user", order.id, "sold_refund") in ctx.notifier.sent

    asyncio.run(scenario())
