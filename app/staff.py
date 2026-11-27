"""Admins and operators added from the admin panel (by Telegram ID), on top of ADMIN_IDS / OPERATOR_IDS.

Those from Railway/.env are "main" owners: they can't be removed from the panel, so nobody can lock the owner out.
Panel-added people are stored in the ``settings`` table and applied to the live settings at startup and on change,
so the bot (notifications, admin buttons, /admin, /panel) and the panel see them immediately.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from .config import get_settings
from .db import Session, Setting, User, set_setting

log = logging.getLogger(__name__)
KEY = "staff_extra"
_env: dict[str, list[int]] = {}


class StaffError(Exception):
    pass


def _capture_env() -> None:
    if not _env:
        s = get_settings()
        _env["admins"], _env["operators"] = list(s.admin_ids), list(s.operator_ids)


async def _load() -> list[dict]:
    async with Session() as session:
        row = await session.get(Setting, KEY)
    try:
        items = json.loads(row.value) if row and row.value else []
    except ValueError:
        items = []
    return [i for i in items if isinstance(i, dict) and isinstance(i.get("id"), int) and i.get("role") in ("owner", "operator")]


def _apply(items: list[dict]) -> None:
    _capture_env()
    s = get_settings()
    admins = list(_env["admins"]) + [i["id"] for i in items if i["role"] == "owner" and i["id"] not in _env["admins"]]
    operators = [i for i in list(_env["operators"]) + [i["id"] for i in items if i["role"] == "operator"] if i not in admins]
    s.admin_ids, s.operator_ids = admins, list(dict.fromkeys(operators))


async def apply_all() -> None:
    _apply(await _load())


async def _store(items: list[dict]) -> None:
    async with Session() as session:
        await set_setting(session, KEY, json.dumps(items))
    _apply(items)


async def describe() -> list[dict]:
    _capture_env()
    s = get_settings()
    extra = {i["id"]: i for i in await _load()}
    async with Session() as session:
        people = {u.id: u for u in (await session.execute(select(User).where(User.id.in_(s.staff_ids)))).scalars()}
    out = []
    for uid in s.staff_ids:
        u = people.get(uid)
        name = " ".join(p for p in ((u.first_name, u.last_name) if u else ()) if p).strip()
        fixed = uid in _env["admins"] or (uid in _env["operators"] and uid not in extra)
        out.append({"id": uid, "role": s.role_of(uid), "name": name or (f"@{u.username}" if u and u.username else ""),
                    "username": u.username if u else "", "fixed": fixed, "startedBot": u is not None,
                    "addedBy": extra.get(uid, {}).get("by"), "addedAt": extra.get(uid, {}).get("at")})
    return out


async def add(user_id: int, role: str, by: int) -> None:
    if role not in ("owner", "operator"):
        raise StaffError("Rol noto'g'ri")
    if not 0 < user_id < 10**13:
        raise StaffError("Telegram ID noto'g'ri")
    _capture_env()
    if user_id in _env["admins"]:
        raise StaffError("Bu ID allaqachon asosiy admin (ADMIN_IDS)")
    items = [i for i in await _load() if i["id"] != user_id]
    items.append({"id": user_id, "role": role, "by": by, "at": datetime.now(timezone.utc).isoformat()})
    await _store(items)


async def remove(user_id: int, by: int) -> None:
    _capture_env()
    if user_id == by:
        raise StaffError("O'zingizni o'chira olmaysiz")
    if user_id in _env["admins"] or (user_id in _env["operators"] and user_id not in {i["id"] for i in await _load()}):
        raise StaffError("Bu ID Railway'dagi ADMIN_IDS / OPERATOR_IDS da — faqat o'sha yerdan o'chiriladi")
    items = await _load()
    if user_id not in {i["id"] for i in items}:
        raise StaffError("Topilmadi")
    await _store([i for i in items if i["id"] != user_id])
