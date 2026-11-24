"""Tiny i18n: nested JSON files in /locales shared by the bot and the Mini App."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parent.parent / "locales"
LANGS = ("uz", "ru", "en")
FLAGS = {"uz": "🇺🇿", "ru": "🇷🇺", "en": "🇬🇧"}


@lru_cache
def _load(lang: str) -> dict:
    return json.loads((LOCALES_DIR / f"{lang}.json").read_text(encoding="utf-8"))


def normalize(lang: str | None, default: str = "uz") -> str:
    if lang:
        code = lang.lower()[:2]
        if code in LANGS:
            return code
    return default


def _lookup(data: dict, key: str):
    node = data
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def t(lang: str | None, key: str, **params) -> str:
    code = normalize(lang)
    text = _lookup(_load(code), key) or _lookup(_load("en"), key) or key
    if params:
        try:
            return text.format(**params)
        except (KeyError, IndexError, ValueError):
            return text
    return text


def guess_lang(telegram_code: str | None, default: str = "uz") -> str:
    """Telegram's language_code → uz/ru/en (Kazakh/Kyrgyz/Tajik users usually read Russian)."""
    code = (telegram_code or "").lower()[:2]
    if code in LANGS:
        return code
    if code in {"kk", "ky", "tg", "be", "uk"}:
        return "ru"
    return default


def flatten(data: dict, prefix: str = "") -> dict[str, str]:
    out = {}
    for key, value in data.items():
        full = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(flatten(value, full + "."))
        else:
            out[full] = value
    return out
