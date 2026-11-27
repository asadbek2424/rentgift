"""Login for the standalone admin panel (a separate website, e.g. on Vercel or a second Railway service).

Flow: the admin types their Telegram ID → the bot sends them a 6-digit code → the panel exchanges
the code for a signed session token (``Authorization: Bearer …``). Optionally ``ADMIN_PANEL_PASSWORD``
works as a second factor-free fallback when the bot is not running.
Tokens are HMAC-signed with ``ADMIN_SECRET`` (or a key derived from ``BOT_TOKEN``) — no DB table needed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

from .config import Settings

CODE_TTL = 300          # seconds a login code is valid
CODE_ATTEMPTS = 5       # wrong guesses before the code is burned
SEND_COOLDOWN = 45      # seconds between two codes for the same admin

_codes: dict[int, dict] = {}   # admin_id -> {"code", "exp", "tries", "sent"}


def _key(settings: Settings) -> bytes:
    base = settings.admin_secret or ("admin-panel:" + settings.bot_token)
    if not base or base == "admin-panel:":
        base = "admin-panel:insecure-dev-key"
    return hashlib.sha256(base.encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def make_token(settings: Settings, admin_id: int, now: float | None = None) -> tuple[str, int]:
    exp = int((now or time.time()) + settings.admin_session_hours * 3600)
    body = f"{admin_id}.{exp}"
    sig = _b64(hmac.new(_key(settings), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", exp


def check_token(settings: Settings, token: str, now: float | None = None) -> int | None:
    try:
        uid, exp, sig = token.split(".")
        body = f"{uid}.{exp}"
        good = _b64(hmac.new(_key(settings), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(good, sig) or int(exp) < (now or time.time()):
            return None
        uid_int = int(uid)
    except (ValueError, TypeError):
        return None
    return uid_int if uid_int in settings.admin_ids else None


def new_code(admin_id: int, now: float | None = None) -> str | None:
    """Returns a fresh code, or None if one was sent less than SEND_COOLDOWN seconds ago."""
    now = now or time.time()
    old = _codes.get(admin_id)
    if old and now - old["sent"] < SEND_COOLDOWN:
        return None
    code = f"{secrets.randbelow(1_000_000):06d}"
    _codes[admin_id] = {"code": code, "exp": now + CODE_TTL, "tries": 0, "sent": now}
    return code


def verify_code(admin_id: int, code: str, now: float | None = None) -> bool:
    now = now or time.time()
    entry = _codes.get(admin_id)
    if not entry or entry["exp"] < now:
        _codes.pop(admin_id, None)
        return False
    entry["tries"] += 1
    if hmac.compare_digest(entry["code"], (code or "").strip()):
        _codes.pop(admin_id, None)
        return True
    if entry["tries"] >= CODE_ATTEMPTS:
        _codes.pop(admin_id, None)
    return False


_fails: dict[int, list[float]] = {}   # admin_id -> timestamps of recent wrong passwords
PASSWORD_ATTEMPTS = 5
PASSWORD_LOCK = 600


def password_locked(admin_id: int, now: float | None = None) -> bool:
    now = now or time.time()
    recent = [ts for ts in _fails.get(admin_id, []) if now - ts < PASSWORD_LOCK]
    _fails[admin_id] = recent
    return len(recent) >= PASSWORD_ATTEMPTS


def check_password(settings: Settings, password: str, admin_id: int = 0, now: float | None = None) -> bool:
    ok = bool(settings.admin_panel_password) and len(settings.admin_panel_password) >= 8 and \
        hmac.compare_digest(settings.admin_panel_password.encode(), (password or "").encode())
    if ok:
        _fails.pop(admin_id, None)
    else:
        _fails.setdefault(admin_id, []).append(now or time.time())
    return ok
