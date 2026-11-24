"""Automatic database backups.

* SQLite  → consistent online copy with sqlite3's backup API, gzipped (``giftrent-YYYYmmdd-HHMMSS.db.gz``).
* Others  → portable JSON export of every table, gzipped (``giftrent-YYYYmmdd-HHMMSS.json.gz``).

Backups are kept in BACKUP_DIR (the newest BACKUP_KEEP files) and, by default, also sent to the admins in
Telegram so a copy survives even if the server disk is lost.

Restore:
    SQLite:  stop the app, then  gunzip -c data/backups/<file>.db.gz > data/giftrent.db
    JSON:    stop the app, empty database, then  python -m app.backup restore data/backups/<file>.json.gz
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import insert, select

from .config import get_settings
from .db import Base, Session, engine, init_db

log = logging.getLogger(__name__)
TELEGRAM_FILE_LIMIT = 49 * 1024 * 1024


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _sqlite_path() -> str | None:
    url = get_settings().database_url
    if url.startswith("sqlite"):
        path = url.split("///", 1)[-1]
        return path if path and path != ":memory:" else None
    return None


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _sqlite_backup(source: str, target: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "copy.db"
        src = sqlite3.connect(source)
        dst = sqlite3.connect(raw)
        try:
            src.backup(dst)          # consistent snapshot while the app keeps running
        finally:
            dst.close()
            src.close()
        with open(raw, "rb") as fin, gzip.open(target, "wb", compresslevel=6) as fout:
            shutil.copyfileobj(fin, fout)


async def _json_backup(target: Path) -> None:
    data = {"format": "giftrent-json-v1", "created_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    async with Session() as session:
        for table in Base.metadata.sorted_tables:
            rows = (await session.execute(select(table))).mappings().all()
            data["tables"][table.name] = [dict(row) for row in rows]
    payload = json.dumps(data, default=_json_default, ensure_ascii=False).encode()
    await asyncio.to_thread(_write_gzip, target, payload)


def _write_gzip(target: Path, payload: bytes) -> None:
    with gzip.open(target, "wb", compresslevel=6) as fout:
        fout.write(payload)


def _prune(folder: Path, keep: int) -> None:
    files = sorted(folder.glob("giftrent-*.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[max(1, keep):]:
        try:
            old.unlink()
        except OSError:
            pass


async def make_backup() -> Path:
    settings = get_settings()
    folder = Path(settings.backup_dir)
    folder.mkdir(parents=True, exist_ok=True)
    sqlite_path = _sqlite_path()
    if sqlite_path:
        target = folder / f"giftrent-{_stamp()}.db.gz"
        await asyncio.to_thread(_sqlite_backup, sqlite_path, target)
    else:
        target = folder / f"giftrent-{_stamp()}.json.gz"
        await _json_backup(target)
    _prune(folder, settings.backup_keep)
    log.info("Backup written: %s (%d bytes)", target, target.stat().st_size)
    return target


async def send_to_admins(bot, path: Path, caption: str = "") -> int:
    """Send the backup file to every admin; returns how many received it."""
    from aiogram.types import FSInputFile
    if bot is None or path.stat().st_size > TELEGRAM_FILE_LIMIT:
        return 0
    sent = 0
    for admin_id in get_settings().admin_ids:
        try:
            await bot.send_document(admin_id, FSInputFile(path), caption=caption or f"💾 {path.name}",
                                    disable_notification=True)
            sent += 1
        except Exception as exc:  # noqa: BLE001 — one admin failing must not stop the others
            log.warning("Backup not sent to admin %s: %s", admin_id, exc)
    return sent


async def backup_loop(ctx) -> None:
    settings = get_settings()
    if settings.backup_interval_hours <= 0:
        return
    interval = settings.backup_interval_hours * 3600
    folder = Path(settings.backup_dir)
    # first backup shortly after start unless a fresh one already exists
    newest = max((p.stat().st_mtime for p in folder.glob("giftrent-*.gz")), default=0) if folder.exists() else 0
    wait = max(60.0, interval - (datetime.now().timestamp() - newest)) if newest else 60.0
    while True:
        await asyncio.sleep(wait)
        try:
            path = await make_backup()
            if settings.backup_send_to_admins:
                await send_to_admins(ctx.bot, path)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Backup failed")
        wait = interval


# ---------------------------------------------------------------------------- restore (JSON)
def _coerce(table, row: dict) -> dict:
    out = {}
    for column in table.columns:
        if column.name not in row:
            continue
        value = row[column.name]
        if value is not None and column.type.python_type is datetime and isinstance(value, str):
            value = datetime.fromisoformat(value)
        out[column.name] = value
    return out


async def restore_json(path: str) -> dict:
    await init_db()
    with gzip.open(path, "rb") as fin:
        data = json.loads(fin.read())
    if data.get("format") != "giftrent-json-v1":
        raise SystemExit("Unknown backup format")
    counts = {}
    async with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = (await conn.execute(select(table).limit(1))).first()
            if existing:
                raise SystemExit(f"Table {table.name} is not empty — restore only into an empty database")
            rows = [_coerce(table, r) for r in data["tables"].get(table.name, [])]
            if rows:
                await conn.execute(insert(table), rows)
            counts[table.name] = len(rows)
    return counts


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "now":
        print(asyncio.run(make_backup()))
    elif len(sys.argv) == 3 and sys.argv[1] == "restore":
        print(asyncio.run(restore_json(sys.argv[2])))
    else:
        print("Usage: python -m app.backup now | restore <file.json.gz>")
        sys.exit(2)
