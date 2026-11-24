"""Database models (SQLAlchemy 2, async). SQLite by default, PostgreSQL via DATABASE_URL."""

from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)  # Telegram user id
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    username: Mapped[str] = mapped_column(String(64), default="")
    photo_url: Mapped[str] = mapped_column(String(512), default="")
    lang: Mapped[str | None] = mapped_column(String(2), nullable=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    tg_display_ready: Mapped[bool] = mapped_column(Boolean, default=False)   # connected via /v1/rent/tg/connect/
    tg_display_name: Mapped[str] = mapped_column(String(128), default="")
    bot_blocked: Mapped[bool] = mapped_column(Boolean, default=False)   # user blocked the bot (broadcast skips)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    orders: Mapped[list["Order"]] = relationship(back_populates="user")


class OrderStatus:
    AWAITING_PAYMENT = "awaiting_payment"   # user must transfer UZS to the card and upload a receipt
    PAYMENT_REVIEW = "payment_review"       # receipt uploaded, admin checks it
    PAID = "paid"                           # admin confirmed money; gift not rented yet
    RENTING = "renting"                     # rent transaction sent from the admin wallet, waiting for chain
    AWAITING_LINK = "awaiting_link"         # rented; waiting for the user to connect Telegram (or send a Fragment link)
    CONNECTING = "connecting"               # link sent to Marketapp
    CONNECT_SIGNING = "connect_signing"     # Marketapp returned a transaction that the admin wallet must sign
    ACTIVE = "active"                       # connected to the user's Fragment account
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    FAILED = "failed"                       # needs admin attention (refund or retry)
    REFUNDED = "refunded"
    EXTENDED = "extended"                   # an extension order that was applied to its parent rental

    OPEN = frozenset({AWAITING_PAYMENT, PAYMENT_REVIEW, PAID, RENTING, AWAITING_LINK, CONNECTING, CONNECT_SIGNING, ACTIVE})
    UNPAID = frozenset({AWAITING_PAYMENT, PAYMENT_REVIEW})
    FINAL = frozenset({EXPIRED, CANCELLED, REFUNDED, EXTENDED})
    ALL = (AWAITING_PAYMENT, PAYMENT_REVIEW, PAID, RENTING, AWAITING_LINK, CONNECTING, CONNECT_SIGNING,
           ACTIVE, EXPIRED, CANCELLED, FAILED, REFUNDED, EXTENDED)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True, default=OrderStatus.AWAITING_PAYMENT)
    kind: Mapped[str] = mapped_column(String(8), default="rent")          # rent | extend
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # extension → the rental it extends
    prev_end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # gift snapshot
    nft_address: Mapped[str] = mapped_column(String(80), index=True)
    nft_name: Mapped[str] = mapped_column(String(128))
    collection_address: Mapped[str] = mapped_column(String(80), default="")
    image_url: Mapped[str] = mapped_column(String(512), default="")
    attributes_json: Mapped[str] = mapped_column(Text, default="[]")
    sellable: Mapped[bool] = mapped_column(Boolean, default=False)       # listing's is_sellable_during_rent

    # quote (money is stored as text decimals / integers, never floats)
    days: Mapped[int] = mapped_column(Integer)
    price_per_day_nano: Mapped[str] = mapped_column(String(40))
    ton_total_nano: Mapped[str] = mapped_column(String(40))
    rate_uzs_per_ton: Mapped[str] = mapped_column(String(40))
    markup_percent: Mapped[str] = mapped_column(String(16))
    amount_uzs: Mapped[int] = mapped_column(BigInteger)
    cost_nano: Mapped[str] = mapped_column(String(40), default="0")      # expected wallet spend incl. Marketapp fee
    fee_percent: Mapped[str] = mapped_column(String(16), default="0")
    cost_uzs: Mapped[int] = mapped_column(BigInteger, default=0)
    profit_uzs: Mapped[int] = mapped_column(BigInteger, default=0)
    service_fee_uzs: Mapped[int] = mapped_column(BigInteger, default=0)
    unique_add_uzs: Mapped[int] = mapped_column(Integer, default=0)       # +N so'm that makes the amount unique
    actual_cost_nano: Mapped[str] = mapped_column(String(40), default="")  # from the real Marketapp transaction

    # payment
    payment_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    receipt_file_id: Mapped[str] = mapped_column(String(256), default="")
    receipt_kind: Mapped[str] = mapped_column(String(16), default="")   # photo | document
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # rent / connect
    pending_tx_kind: Mapped[str] = mapped_column(String(16), default="")  # rent | connect
    pending_tx_json: Mapped[str] = mapped_column(Text, default="")
    rent_tx_boc: Mapped[str] = mapped_column(Text, default="")
    rent_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    connect_attempts: Mapped[int] = mapped_column(Integer, default=0)
    connect_response: Mapped[str] = mapped_column(Text, default="")
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)

    error: Mapped[str] = mapped_column(String(64), default="")
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="orders")


class OrderEvent(Base):
    """Audit log of every status change."""
    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(Integer, ForeignKey("orders.id"), index=True)
    from_status: Mapped[str] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str] = mapped_column(String(32))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PaymentNotice(Base):
    """Every bank notice the bot read (CardXabar etc.) — audit + protection against double processing."""
    __tablename__ = "payment_notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String(96), unique=True)   # "userbot:<chat>:<msg>" / "fwd:<hash>"
    amount_uzs: Mapped[int] = mapped_column(BigInteger, default=0)
    is_credit: Mapped[bool] = mapped_column(Boolean, default=False)
    text: Mapped[str] = mapped_column(Text, default="")
    order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str] = mapped_column(String(24), default="")         # matched | unmatched | ambiguous | ignored
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Setting(Base):
    """Runtime settings changed by the admin (override .env values)."""
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


_settings = get_settings()
if _settings.database_url.startswith("sqlite"):
    path = _settings.database_url.split("///", 1)[-1]
    if path and path != ":memory:":
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

engine = create_async_engine(_settings.database_url, pool_pre_ping=True)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def _add_missing_columns(sync_conn) -> None:
    """Tiny forward-only migration: add columns introduced after the first release."""
    from sqlalchemy import inspect
    inspector = inspect(sync_conn)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing:
                continue
            ddl_type = column.type.compile(dialect=sync_conn.dialect)
            default = column.default.arg if column.default is not None and not callable(column.default.arg) else None
            clause = ""
            if isinstance(default, bool):
                clause = f" DEFAULT {'TRUE' if default else 'FALSE'}"
            elif isinstance(default, (int, float)):
                clause = f" DEFAULT {default}"
            elif isinstance(default, str):
                clause = " DEFAULT '" + default.replace("'", "''") + "'"
            sync_conn.exec_driver_sql(f'ALTER TABLE {table.name} ADD COLUMN {column.name} {ddl_type}{clause}')


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


def aware(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def get_setting(session: AsyncSession, key: str, default: str | None = None) -> str | None:
    row = await session.get(Setting, key)
    return row.value if row else default


async def set_setting(session: AsyncSession, key: str, value: str) -> None:
    row = await session.get(Setting, key)
    if row:
        row.value = value
    else:
        session.add(Setting(key=key, value=value))
    await session.commit()


async def count_open_orders(session: AsyncSession, user_id: int) -> int:
    result = await session.execute(
        select(func.count(Order.id)).where(Order.user_id == user_id, Order.status.in_(OrderStatus.UNPAID)))
    return int(result.scalar_one())
