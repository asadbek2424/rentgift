import asyncio

import pytest

CARD_IN = "🟢 Perevod na kartu\n➕ {amount} UZS\n💳 ***8721\n📍 CLICK P2P, UZ\n🕓 24.11.26 20:43\n💵 144 452.83 UZS"
fmt = lambda v: f"{v:,}".replace(",", " ") + ".00"


def _ctx(**overrides):
    from app.config import get_settings
    from app.context import AppContext, NullNotifier
    from app.marketapp import DemoMarketapp
    from app.pricing import RateProvider
    settings = get_settings().model_copy(update=overrides) if overrides else get_settings()
    return AppContext(settings=settings, market=DemoMarketapp(), rates=RateProvider(), notifier=NullNotifier())


def test_topup_by_notice_and_pay_order_from_balance():
    from app import orders as svc, wallet
    from app.card_notices import handle_notice
    from app.db import init_db

    async def scenario():
        await init_db()
        ctx = _ctx()
        await svc.upsert_user(301, "Inviter")
        await svc.upsert_user(302, "Buyer")
        assert await wallet.set_referrer(302, 301) is True
        assert await wallet.set_referrer(302, 302) is False

        with pytest.raises(wallet.WalletError):
            await wallet.create_topup(ctx, 302, 100)                   # below the minimum
        topup = await wallet.create_topup(ctx, 302, 200_000)
        assert 1 <= topup.unique_add_uzs <= 99 and topup.amount_uzs == 200_000 + topup.unique_add_uzs
        # an order created now never gets the same total as the open top-up
        r = await handle_notice(ctx, "userbot:9:1", CARD_IN.format(amount=fmt(topup.amount_uzs)))
        assert r["result"] == "topup"
        assert await wallet.balance_of(302) == topup.amount_uzs
        assert (await handle_notice(ctx, "userbot:9:1", "again"))["result"] == "duplicate"
        with pytest.raises(wallet.WalletError):                         # credited exactly once
            await wallet.confirm_topup(ctx, topup.id, "admin:1")

        cheap = min(ctx.market.items, key=lambda i: int(i["price_per_day"]))
        order = await svc.create_order(ctx, 302, cheap["nft_address"], 3)
        before = await wallet.balance_of(302)
        paid = await svc.pay_from_balance(ctx, 302, order.id)
        price = order.amount_uzs - order.unique_add_uzs
        assert paid.status == "paid" and paid.paid_by == "balance" and paid.amount_uzs == price
        assert await wallet.balance_of(302) == before - price
        with pytest.raises(svc.ServiceError):                          # cannot pay twice
            await svc.pay_from_balance(ctx, 302, order.id)
        # inviter got the referral share, the buyer climbed the rating
        assert await wallet.balance_of(301) == int(price * 0.01)
        top = await wallet.top_rating(302)
        assert top["me"]["rank"] >= 1 and top["me"]["spent_uzs"] == price
        assert any(i["me"] for i in top["items"]) and "Buyer" not in str(top)      # names are masked
        # failed balance order → refunded to the balance automatically
        await svc._transition(order.id, {"paid"}, "failed", "test")
        await svc.mark_refunded(ctx, order.id, 1)
        assert await wallet.balance_of(302) == before

        # not enough money
        dear = max(ctx.market.items, key=lambda i: int(i["price_per_day"]))
        big = await svc.create_order(ctx, 302, dear["nft_address"], 3)
        assert big.amount_uzs > await wallet.balance_of(302)
        with pytest.raises(svc.ServiceError) as err:
            await svc.pay_from_balance(ctx, 302, big.id)
        assert err.value.code == "low_balance" and (await svc.get_order(big.id)).status == "awaiting_payment"
        await svc.cancel_by_user(ctx, 302, big.id)

        # expired top-up paid late → admin decides
        late = await wallet.create_topup(ctx, 302, 50_000)
        await wallet._set_status(late.id, {"pending"}, "expired")
        r = await handle_notice(ctx, "userbot:9:2", CARD_IN.format(amount=fmt(late.amount_uzs)))
        assert r["result"] == "late_topup" and ("admin_topup", late.id, "topup_late") in ctx.notifier.sent
        await wallet.confirm_topup(ctx, late.id, "admin:1", late=True)
        assert (await wallet.get_topup(late.id)).status == "paid"
    asyncio.run(scenario())


def test_concurrent_debits_never_go_negative():
    from app import orders as svc, wallet

    async def scenario():
        await svc.upsert_user(310, "Racer")
        await wallet.credit(310, 1000, "admin")
        results = await asyncio.gather(*[wallet.debit(310, 300, "test") for _ in range(6)], return_exceptions=True)
        assert sum(1 for r in results if isinstance(r, int)) == 3
        assert await wallet.balance_of(310) == 100
    asyncio.run(scenario())


def test_stars_and_premium_purchase_flow():
    from app import orders as svc, purchases as shop, wallet

    async def scenario():
        ctx = _ctx()
        await svc.upsert_user(320, "Star")
        info = await shop.stars_info(ctx)
        assert info["packs"][0]["quantity"] == 50 and info["packs"][0]["price_uzs"] > 0
        quote = await shop.stars_quote(ctx, 100)
        with pytest.raises(shop.PurchaseError):
            await shop.buy(ctx, 320, "stars", "durov", 100)            # empty balance
        assert await shop.list_purchases(320) == []
        await wallet.credit(320, 500_000, "admin")
        with pytest.raises(shop.PurchaseError):
            await shop.buy(ctx, 320, "stars", "x", 100)                 # bad username
        with pytest.raises(shop.PurchaseError):
            await shop.buy(ctx, 320, "stars", "nobody_here", 100)       # recipient not found

        # TON Connect mode: the admin signs
        p = await shop.buy(ctx, 320, "stars", "@durov", 100)
        assert p.status == "signing" and await wallet.balance_of(320) == 500_000 - quote["price_uzs"]
        prepared = await shop.prepare_tx(p.id)
        assert prepared["transaction"]["messages"]
        p = await shop.tx_sent(ctx, p.id, "boc")
        assert p.status == "done" and ("user_text", 320, "purchase_done") in ctx.notifier.sent

        # Premium refunded by the admin
        plans = (await shop.premium_info(ctx))["plans"]
        assert [x["months"] for x in plans] == [3, 6, 12]
        before = await wallet.balance_of(320)
        p = await shop.buy(ctx, 320, "premium", "https://t.me/durov", 3)
        assert p.recipient == "durov" and await wallet.balance_of(320) == before - plans[0]["price_uzs"]
        await shop.admin_refund(ctx, p.id)
        assert await wallet.balance_of(320) == before

        # Marketapp asks far more than quoted → automatic refund
        async def greedy(username, quantity):
            return {"transaction": {"validUntil": 4_000_000_000, "messages": [
                {"address": ctx.market.items[0]["nft_address"], "amount": str(10 ** 13), "payload": None}]}}
        ctx.market.stars_buy = greedy
        p = await shop.buy(ctx, 320, "stars", "durov", 50)
        assert p.status == "refunded" and await wallet.balance_of(320) == before
    asyncio.run(scenario())


def test_usernames_and_numbers_catalogue_and_rent():
    from app import orders as svc

    async def scenario():
        ctx = _ctx()
        await svc.upsert_user(330, "Nick")
        page = await ctx.market.rent_list("number")
        number = page["items"][0]
        order = await svc.create_order(ctx, 330, number["nft_address"], 3)
        assert order.category == "number" and order.image_url == ""
        await svc.confirm_payment(ctx, order.id, 1)
        await svc.prepare_tx(ctx, order.id)
        await svc.tx_sent(ctx, order.id, "admin:1", "boc", None)
        await svc.worker_tick(ctx)
        order = await svc.get_order(order.id)
        assert order.status == "active"
        assert (await svc.login_code(ctx, 330, order.id))["code"] == "12345"
        with pytest.raises(svc.ServiceError):
            await svc.tg_connect(ctx, 330, order.id)                     # numbers are not gifts

        username = (await ctx.market.rent_list("username"))["items"][0]
        u = await svc.create_order(ctx, 330, username["nft_address"], 3)
        await svc.confirm_payment(ctx, u.id, 1)
        await svc.prepare_tx(ctx, u.id)
        await svc.tx_sent(ctx, u.id, "admin:1", "boc", None)
        await svc.worker_tick(ctx)
        assert (await svc.get_order(u.id)).status == "awaiting_link"
        assert ("user", u.id, "awaiting_link_username") in ctx.notifier.sent
    asyncio.run(scenario())


def test_api_balance_stars_and_categories():
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.tg_auth import sign_init_data

    with TestClient(create_app()) as client:
        h = {"X-Telegram-Init-Data": sign_init_data({"id": 340, "first_name": "Api"}, "123:TEST")}
        assert client.get("/api/me", headers=h).json()["user"]["balance_uzs"] == 0
        t = client.post("/api/topups", json={"amount": 20000}, headers=h).json()
        assert t["status"] == "pending" and t["amount_uzs"] > 20000
        assert client.post(f"/api/topups/{t['id']}/cancel", headers=h).json()["status"] == "cancelled"
        assert client.get("/api/balance", headers=h).json()["topups"][0]["id"] == t["id"]
        assert client.get("/api/stars", headers=h).json()["packs"]
        assert client.get("/api/premium", headers=h).json()["plans"][0]["months"] == 3
        assert client.post("/api/recipient", json={"kind": "stars", "username": "@durov"}, headers=h).json()["username"] == "durov"
        assert client.post("/api/purchases", json={"kind": "stars", "username": "durov", "quantity": 50},
                           headers=h).json()["detail"]["code"] == "low_balance"
        names = client.get("/api/gifts?category=username", headers=h).json()["items"]
        assert names and names[0]["category"] == "username" and names[0]["name"].startswith("@")
        assert client.get("/api/referral", headers=h).json()["invited"] == 0
        assert "items" in client.get("/api/top", headers=h).json()


def test_hot_wallet_buys_stars_automatically():
    from app import orders as svc, purchases as shop, wallet

    class FakeHot:
        last_seqno, last_confirmed = 0, False
        sent = []

        async def send(self, tx):
            self.sent.append(tx)
            self.last_seqno, self.last_confirmed = 7, True
            return "boc"

        async def seqno(self):
            return 8

    async def scenario():
        ctx = _ctx()
        ctx.hot_wallet = FakeHot()
        await svc.upsert_user(350, "Hot")
        await wallet.credit(350, 100_000, "admin")
        p = await shop.buy(ctx, 350, "stars", "durov", 50)
        assert p.status == "done" and len(ctx.hot_wallet.sent) == 1

        class Broken(FakeHot):
            async def send(self, tx):
                raise RuntimeError("not enough GRAM")
        ctx.hot_wallet = Broken()
        p = await shop.buy(ctx, 350, "stars", "durov", 50)
        assert p.status == "failed" and ("admin_purchase", p.id, "purchase_failed") in ctx.notifier.sent
        before = await wallet.balance_of(350)
        await shop.admin_refund(ctx, p.id)
        assert await wallet.balance_of(350) == before + p.price_uzs
    asyncio.run(scenario())


def test_recipient_photo_html_is_cleaned():
    from app.purchases import photo_url
    assert photo_url('<img src="https://cdn4.cdn-telegram.org/file/abc.jpg" />') == "https://cdn4.cdn-telegram.org/file/abc.jpg"
    assert photo_url('<img src="//cdn4.telesco.pe/f.jpg">') == "https://cdn4.telesco.pe/f.jpg"
    assert photo_url('<svg><text>A</text></svg>') == "" and photo_url("javascript:alert(1)") == ""
