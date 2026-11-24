"""Application settings, read from environment variables or a .env file."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Telegram ---------------------------------------------------------
    bot_token: str = ""
    admin_ids: Annotated[list[int], NoDecode] = Field(default_factory=list)
    webapp_url: str = "http://localhost:8080"  # public HTTPS URL of this server (Mini App)
    app_name: str = "GiftRent"
    default_lang: Literal["uz", "ru", "en"] = "uz"
    support_username: str = ""   # without @
    channel_username: str = ""   # without @
    offer_url: str = ""          # public offer / terms page
    init_data_max_age: int = 86400
    timezone: str = "Asia/Tashkent"

    # --- Marketapp ----------------------------------------------------------
    marketapp_api_token: str = ""
    marketapp_base_url: str = "https://api.marketapp.org"
    marketapp_rps: float = 1.0
    marketapp_paid_plan: bool = False       # true → may also use paid /v1/nfts/{address}/ for fresh checks

    # --- TON wallet (the SAME wallet that created the Marketapp API token) ---
    admin_wallet_address: str = ""
    wallet_mode: Literal["tonconnect", "hot"] = "tonconnect"
    hot_wallet_mnemonic: str = ""
    auto_rent: bool = False                 # hot mode only: rent right after payment is confirmed
    toncenter_api_key: str = ""
    toncenter_url: str = "https://toncenter.com"
    max_tx_overpay_percent: float = 5.0     # safety: refuse to sign if Marketapp asks more than quote (+fees)
    max_tx_fee_ton: float = 0.5

    # --- Payment (manual card transfer) -------------------------------------
    card_number: str = ""
    card_holder: str = ""
    card_bank: str = ""
    payment_window_minutes: int = 30
    unique_amount_max: int = 99              # each order gets +1..N so'm so the bank notice identifies it (0 = off)

    # --- Automatic payment check (CardXabar / Uzcard notifications) ----------------
    auto_confirm_payments: bool = True       # confirm an order when a matching card notice arrives
    userbot_api_id: int = 0                  # my.telegram.org → API development tools (separate account!)
    userbot_api_hash: str = ""
    userbot_session: str = ""                # StringSession from tools/make_session.py
    card_notify_bots: str = "CardXabarBot"   # usernames whose messages are bank notices (comma separated)
    card_notify_regex: str = ""              # optional custom regex with a named group (?P<amount>...)
    card_last4: str = ""                     # only count notices for this card (e.g. 4625); empty = any card
    card_notify_late_minutes: int = 120      # also match orders cancelled for timeout this recently
    max_open_orders_per_user: int = 3

    # --- Pricing -------------------------------------------------------------
    markup_percent: float = 0.0             # extra profit on the rent itself, % (0 = rent at Marketapp price)
    service_fee_uzs: int = 1800             # "Xizmat haqi": fixed fee per order, so'm (your profit)
    min_rent_days: int = 3                  # shortest rental offered to customers
    profit_fixed_uzs: int = 0               # admin profit, so'm per rental day
    marketapp_fee_percent: float = 0.0      # Marketapp commission on top of the listing price
    rate_mode: Literal["auto", "manual"] = "auto"
    manual_rate_uzs_per_ton: float = 0.0
    uzs_round_to: int = 10

    # --- Runtime ------------------------------------------------------------
    database_url: str = "sqlite+aiosqlite:///data/giftrent.db"
    host: str = "0.0.0.0"
    port: int = 8080
    run_bot: bool = True
    demo_mode: bool = False      # fake Marketapp catalogue, for UI testing without a token
    dev_user_id: int = 0         # DEV ONLY: accept requests without Telegram initData as this user
    worker_interval: int = 20
    rent_confirm_timeout_minutes: int = 15
    use_rent_events: bool = True             # follow Marketapp /v1/rent/events/ instead of polling /my-rented/ only

    # --- Backups ---------------------------------------------------------------
    backup_interval_hours: float = 24.0      # 0 = off
    backup_keep: int = 14                    # how many local backup files to keep
    backup_dir: str = "data/backups"
    backup_send_to_admins: bool = True       # also send each backup file to admins in Telegram (off-site copy)

    @field_validator("admin_ids", mode="before")
    @classmethod
    def _split_ids(cls, value):
        if isinstance(value, str):
            return [int(part) for part in value.replace(";", ",").split(",") if part.strip()]
        if isinstance(value, int):
            return [value]
        return value

    @field_validator("support_username", "channel_username", mode="before")
    @classmethod
    def _strip_at(cls, value):
        return value.strip().lstrip("@") if isinstance(value, str) else value

    @field_validator("marketapp_api_token", "bot_token", "userbot_api_hash", "userbot_session",
                     "hot_wallet_mnemonic", "admin_wallet_address", mode="before")
    @classmethod
    def _clean_secret(cls, value):
        """Railway paste mistakes: surrounding quotes, spaces/newlines, zero-width chars, 'Bearer ' prefix."""
        if not isinstance(value, str):
            return value
        value = "".join(ch for ch in value if ch not in "\u200b\u200c\u200d\u2060\ufeff\xa0").strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'`":
            value = value[1:-1].strip()
        if value.lower().startswith("bearer "):
            value = value[7:].strip()
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def _async_driver(cls, value):
        """Railway/Heroku give postgres://… ; SQLAlchemy async needs postgresql+asyncpg://…"""
        if isinstance(value, str):
            value = value.strip().strip("\"'`").strip()
            if not value:
                return "sqlite+aiosqlite:///data/giftrent.db"
            if "${{" in value or "://" not in value:
                shown = value if "${{" in value else value[:12] + "…"
                raise ValueError(
                    f"DATABASE_URL is not a database address ({shown!r}). On Railway: bot service → Variables → "
                    "DATABASE_URL → 'Add Reference' → pick your Postgres service → DATABASE_URL. The name inside "
                    "${{...}} must match the Postgres service name exactly.")
            for prefix in ("postgres://", "postgresql://"):
                if value.startswith(prefix):
                    return "postgresql+asyncpg://" + value[len(prefix):]
        return value

    @field_validator("webapp_url", mode="before")
    @classmethod
    def _railway_domain(cls, value):
        import os
        if (not value or "localhost" in str(value) or "example." in str(value)) and os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
            return "https://" + os.environ["RAILWAY_PUBLIC_DOMAIN"]
        return value

    @property
    def webapp_base(self) -> str:
        return self.webapp_url.rstrip("/")

    @property
    def card_bot_usernames(self) -> set[str]:
        return {u.strip().lstrip("@").lower() for u in self.card_notify_bots.split(",") if u.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
