import asyncio
import json
from types import SimpleNamespace

import pytest

from app import subscription
from app.tg_auth import sign_init_data


class FakeBot:
    """Pretends user 77 joined channel -1001 but not -1002."""
    id = 999

    class session:  # closed by the app on shutdown
        @staticmethod
        async def close():
            pass

    async def get_chat_member(self, chat_id, user_id):
        if user_id == self.id:
            return SimpleNamespace(status="administrator")
        joined = {(-1001, 77)}
        return SimpleNamespace(status="member" if (chat_id, user_id) in joined else "left")


def test_parse_target():
    assert subscription.parse_target("https://t.me/rentagift") == "@rentagift"
    assert subscription.parse_target("@rentagift") == "@rentagift"
    assert subscription.parse_target("-1001234567890") == -1001234567890
    for bad in ("https://t.me/+AbCdEf", "a b", "@x"):
        with pytest.raises(subscription.ChannelError):
            subscription.parse_target(bad)


def test_gate_bot_and_api(monkeypatch):
    from fastapi.testclient import TestClient
    from app.db import Session, set_setting
    from app.main import create_app

    with TestClient(create_app()) as client:
        from app.context import get_context
        ctx = get_context()
        monkeypatch.setattr(ctx, "bot", FakeBot())

        async def seed(items):
            async with Session() as session:
                await set_setting(session, subscription.KEY, json.dumps(items))
            subscription._cache.clear()
        chans = [{"chat_id": -1001, "title": "News", "url": "https://t.me/news", "enabled": True},
                 {"chat_id": -1002, "title": "Promo", "url": "https://t.me/promo", "enabled": True}]
        asyncio.run(seed(chans))

        assert [c["chat_id"] for c in asyncio.run(subscription.missing(77))] == [-1002]
        assert asyncio.run(subscription.missing(1)) == []                       # admins (ADMIN_IDS=1) are never gated

        user = {"X-Telegram-Init-Data": sign_init_data({"id": 77, "first_name": "Ali"}, "123:TEST")}
        me = client.get("/api/me", headers=user)
        assert me.status_code == 200 and [c["title"] for c in me.json()["subscribe"]] == ["Promo"]
        blocked = client.get("/api/gifts", headers=user)
        assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "subscribe"
        assert client.get("/api/subscription", headers=user).json()["ok"] is False

        chans[1]["enabled"] = False                                              # admin switches it off → open
        asyncio.run(seed(chans))
        assert client.get("/api/gifts", headers=user).status_code == 200
        assert client.get("/api/subscription", headers=user).json() == {"ok": True, "channels": []}
        asyncio.run(seed([]))
