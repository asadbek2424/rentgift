"""Telegram Mini App ``initData`` validation (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class InitDataError(ValueError):
    pass


def validate_init_data(init_data: str, bot_token: str, max_age: int = 86400, now: float | None = None) -> dict:
    if not init_data or not bot_token:
        raise InitDataError("missing")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = pairs.pop("hash", None)
    if not received:
        raise InitDataError("no hash")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise InitDataError("bad hash")
    auth_date = int(pairs.get("auth_date", "0") or 0)
    if max_age and (now or time.time()) - auth_date > max_age:
        raise InitDataError("expired")
    try:
        user = json.loads(pairs.get("user", "{}"))
    except ValueError:
        raise InitDataError("bad user") from None
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise InitDataError("bad user")
    return user


def sign_init_data(user: dict, bot_token: str, auth_date: int | None = None) -> str:
    """Build a valid initData string (used by tests)."""
    from urllib.parse import urlencode
    pairs = {"auth_date": str(auth_date or int(time.time())), "user": json.dumps(user, separators=(",", ":"))}
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)
