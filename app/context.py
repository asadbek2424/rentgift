"""Shared runtime objects (one instance per process)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .config import Settings


class Notifier(Protocol):
    async def user(self, order: Any, key: str, **params: Any) -> None: ...
    async def admin(self, order: Any, key: str, buttons: str | None = None, **params: Any) -> None: ...
    async def receipt_to_admins(self, order: Any, *, file_id: str | None = None, kind: str = "photo",
                                data: bytes | None = None, filename: str = "receipt.jpg") -> tuple[str, str]: ...


class NullNotifier:
    """Used in tests and when RUN_BOT=false."""

    def __init__(self) -> None:
        self.sent: list[tuple] = []

    async def user(self, order, key, **params):
        self.sent.append(("user", order.id, key))

    async def admin(self, order, key, buttons=None, **params):
        self.sent.append(("admin", order.id, key))

    async def admin_text(self, key, **params):
        self.sent.append(("admin_text", None, key))

    async def user_text(self, user_id, key, tab=None, **params):
        self.sent.append(("user_text", user_id, key))

    async def admin_topup(self, topup, key, **params):
        self.sent.append(("admin_topup", topup.id, key))

    async def admin_purchase(self, purchase, key, error=""):
        self.sent.append(("admin_purchase", purchase.id, key))

    async def receipt_to_admins(self, order, *, file_id=None, kind="photo", data=None, filename="receipt.jpg"):
        self.sent.append(("receipt", order.id, kind))
        return file_id or "local-receipt", kind


@dataclass
class AppContext:
    settings: Settings
    market: Any
    rates: Any
    hot_wallet: Any = None
    notifier: Any = field(default_factory=NullNotifier)
    bot: Any = None
    bot_username: str = ""


_ctx: AppContext | None = None


def set_context(ctx: AppContext) -> None:
    global _ctx
    _ctx = ctx


def get_context() -> AppContext:
    if _ctx is None:
        raise RuntimeError("Application context is not initialised")
    return _ctx
