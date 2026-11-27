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
    assert err.value.code == "display_failed" and disconnected == ["tg11"]
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
