import asyncio

import pytest

from app import runtime_config as rc
from app.config import get_settings
from app.db import init_db


def test_parse_rules():
    assert rc.parse("support_username", "@my_support") == "my_support"
    assert rc.parse("card_notify_bots", "@CardXabarBot, HumoBot") == "CardXabarBot,HumoBot"
    assert rc.parse("auto_confirm_payments", "false") is False
    assert rc.parse("card_last4", "4625") == "4625" and rc.parse("card_last4", "") == ""
    for key, bad in [("card_last4", "46"), ("offer_url", "http://x.uz"), ("default_lang", "de"),
                     ("payment_window_minutes", "2"), ("support_username", "a b"), ("app_name", ""), ("bot_token", "x")]:
        with pytest.raises(rc.ConfigError):
            rc.parse(key, bad)


def test_safety_limits_can_only_go_down():
    env = float(rc.env_value("max_tx_overpay_percent"))
    assert rc.parse("max_tx_overpay_percent", str(env / 2)) == env / 2
    with pytest.raises(rc.ConfigError):
        rc.parse("max_tx_overpay_percent", str(env + 1))
    with pytest.raises(rc.ConfigError):
        rc.parse("max_tx_fee_ton", str(float(rc.env_value("max_tx_fee_ton")) + 0.1))


def test_save_apply_reset_roundtrip():
    async def run():
        await init_db()
        s = get_settings()
        original = s.payment_window_minutes
        assert await rc.save({"payment_window_minutes": "45", "support_username": "@help_desk"}, admin_id=1) \
            == ["payment_window_minutes", "support_username"]
        assert s.payment_window_minutes == 45 and s.support_username == "help_desk"     # live immediately
        s.payment_window_minutes = 999                                                   # simulate a fresh process
        await rc.apply_all()
        assert s.payment_window_minutes == 45                                            # restored from the DB
        with pytest.raises(rc.ConfigError):
            await rc.save({"topup_min_uzs": "90000", "topup_max_uzs": "50000"}, admin_id=1)
        await rc.reset("payment_window_minutes", admin_id=1)
        await rc.reset("support_username", admin_id=1)
        assert s.payment_window_minutes == original
        info = await rc.describe()
        assert info["history"][0]["key"] == "support_username" and len(info["fields"]) == len(rc.FIELDS)
    asyncio.run(run())
