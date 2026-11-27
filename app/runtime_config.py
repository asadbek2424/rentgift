"""Settings an admin may change from the panel at runtime (no redeploy).

Values from Railway/.env are the defaults. An override is stored in the ``settings`` table as ``cfg:<key>`` and
applied onto the live Settings object, so every part of the app sees it immediately. Secrets (tokens, wallet,
mnemonic, userbot session, ADMIN_IDS, DATABASE_URL) are deliberately NOT here — they stay in Railway only.
Safety limits (MAX_TX_*) can only be lowered below the Railway value, never raised.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import delete, select

from .config import Settings, get_settings
from .db import Session, Setting, set_setting

log = logging.getLogger(__name__)
PREFIX = "cfg:"
LOG_KEY = "cfg_log"
LOG_KEEP = 100

# key, type, group, label, help, extra
FIELDS: list[dict] = [
    # --- Bot ma'lumoti
    {"key": "app_name", "type": "str", "group": "bot", "label": "Bot nomi (APP_NAME)", "max_len": 32,
     "help": "Mini App sarlavhasi, bot xabarlari, TON hamyon ulanayotganda ko'rinadigan nom va bot menyusidagi tugma matni."},
    {"key": "support_username", "type": "username", "group": "bot", "label": "Yordam akkaunti (SUPPORT_USERNAME)",
     "help": "Mijozlar «Admin bilan chat» tugmasini bosganda ochiladigan Telegram akkaunt. @ siz yozing. Bo'sh bo'lsa tugma ko'rinmaydi."},
    {"key": "channel_username", "type": "username", "group": "bot", "label": "Yangiliklar kanali (CHANNEL_USERNAME)",
     "help": "Profil sahifasidagi «Yangiliklar kanali» havolasi. @ siz yozing. Bo'sh bo'lsa ko'rinmaydi."},
    {"key": "channel_popup", "type": "bool", "group": "bot", "label": "Kanalga taklif oynasi (CHANNEL_POPUP)",
     "help": "Mini App ochilganda, kirish animatsiyasidan keyin «Kanalimizga qo'shiling» oynasi chiqadi (yuqoridagi kanal uchun). "
     "Mijoz yopsa, 24 soatgacha qayta chiqmaydi; kanalga a'zo bo'lganlarga umuman chiqmaydi (bot kanalda admin bo'lsa)."},
    {"key": "offer_url", "type": "url", "group": "bot", "label": "Ommaviy oferta havolasi (OFFER_URL)",
     "help": "Foydalanish shartlari sahifasi. https:// bilan boshlanishi kerak. Profil sahifasida «Ommaviy oferta» bo'lib chiqadi."},
    {"key": "default_lang", "type": "choice", "group": "bot", "label": "Standart til (DEFAULT_LANG)", "choices": ["uz", "ru", "en"],
     "help": "Telegram tili aniqlanmagan yangi mijozlar uchun til. Mijoz keyin o'zi o'zgartira oladi."},
    # --- To'lov
    {"key": "payment_window_minutes", "type": "int", "group": "pay", "label": "To'lov muddati, daqiqa (PAYMENT_WINDOW_MINUTES)",
     "min": 5, "max": 1440, "help": "Buyurtma yoki balans to'ldirish yaratilgandan keyin mijoz shuncha daqiqa ichida pul o'tkazishi kerak. "
     "Vaqt tugasa, buyurtma bekor bo'ladi va gift boshqalarga bo'shaydi. Odatda 30."},
    {"key": "unique_amount_max", "type": "int", "group": "pay", "label": "Noyob summa qo'shimchasi, so'm gacha (UNIQUE_AMOUNT_MAX)",
     "min": 0, "max": 999, "help": "Har buyurtmaga +1 … shu songacha so'm qo'shiladi (masalan 5 000 → 5 023). Bank xabaridagi summa orqali "
     "bot qaysi mijoz to'laganini taniydi. 0 = o'chiq (unda avto-tasdiq aniq ishlamaydi). Odatda 99."},
    {"key": "max_open_orders_per_user", "type": "int", "group": "pay", "label": "Bir mijozga ochiq buyurtmalar (MAX_OPEN_ORDERS_PER_USER)",
     "min": 1, "max": 20, "help": "Bitta mijoz bir vaqtda nechta to'lanmagan buyurtma ochib qo'ya oladi. Giftlarni «band qilib» qo'yishning oldini oladi. Odatda 3."},
    {"key": "card_last4", "type": "last4", "group": "pay", "label": "Karta oxirgi 4 raqami (CARD_LAST4)",
     "help": "CardXabar xabarlaridan faqat shu karta bo'yicha kirimlar hisoblanadi (masalan 4625). Bo'sh = hamma kartalar."},
    # --- Balans
    {"key": "topup_min_uzs", "type": "int", "group": "balance", "label": "Minimal to'ldirish, so'm (TOPUP_MIN_UZS)", "min": 1000, "max": 100_000_000,
     "help": "Mijoz balansini bir martada eng kamida shuncha so'mga to'ldira oladi."},
    {"key": "topup_max_uzs", "type": "int", "group": "balance", "label": "Maksimal to'ldirish, so'm (TOPUP_MAX_UZS)", "min": 1000, "max": 1_000_000_000,
     "help": "Bir martada eng ko'pi bilan shuncha so'm. Katta summalarni cheklash firibgarlik xavfini kamaytiradi."},
    # --- Avto-tasdiq
    {"key": "auto_confirm_payments", "type": "bool", "group": "auto", "label": "Avtomatik to'lov tasdig'i (AUTO_CONFIRM_PAYMENTS)",
     "help": "Yoqilgan bo'lsa: CardXabar xabaridagi summa bitta ochiq buyurtmaga aniq mos kelsa, to'lov o'zi tasdiqlanadi va ijara boshlanadi. "
     "O'chirilgan bo'lsa: har bir to'lovni admin qo'lda tasdiqlaydi (xabar baribir adminga keladi)."},
    {"key": "card_notify_bots", "type": "usernames", "group": "auto", "label": "Bank xabar botlari (CARD_NOTIFY_BOTS)",
     "help": "Kirim xabarlarini yuboradigan botlar, vergul bilan (masalan CardXabarBot). O'zgartirilsa, userbot avtomatik qayta ulanadi."},
    {"key": "card_notify_late_minutes", "type": "int", "group": "auto", "label": "Kech kelgan pulni kutish, daqiqa (CARD_NOTIFY_LATE_MINUTES)",
     "min": 0, "max": 10080, "help": "Buyurtma vaqti tugab bekor bo'lgandan keyin ham shuncha daqiqa ichida pul kelsa, admin «To'lovni qabul qilish» "
     "tugmali xabar oladi. Odatda 120."},
    # --- Xavfsizlik chegarasi
    {"key": "max_tx_overpay_percent", "type": "float", "group": "safety", "label": "Narx oshishiga ruxsat, % (MAX_TX_OVERPAY_PERCENT)",
     "min": 0, "cap_env": True, "help": "Marketapp so'ragan summa mijozga aytilgan narxdan shuncha foizdan ko'p bo'lsa, tizim hamyonda imzolashni "
     "TAQIQLAYDI (masalan gift egasi narxni oshirgan bo'lsa). Panelda faqat KAMAYTIRISH mumkin — oshirish faqat Railway'da."},
    {"key": "max_tx_fee_ton", "type": "float", "group": "safety", "label": "Tarmoq komissiyasi chegarasi, TON (MAX_TX_FEE_TON)",
     "min": 0, "cap_env": True, "help": "Har bir tranzaksiyada blokcheyn komissiyasi uchun qo'shimcha ruxsat etilgan TON. Panelda faqat KAMAYTIRISH mumkin."},
    # --- Hot rejim
    {"key": "auto_rent", "type": "bool", "group": "hot", "label": "To'lovdan keyin avtomatik ijaraga olish (AUTO_RENT)",
     "help": "Faqat WALLET_MODE=hot bo'lganda ishlaydi: to'lov tasdiqlanishi bilan server o'zi Marketapp'da ijaraga oladi, admin hech narsa bosmaydi. "
     "TON Connect rejimida ta'siri yo'q."},
    # --- Zaxira
    {"key": "backup_interval_hours", "type": "float", "group": "backup", "label": "Zaxira oralig'i, soat (BACKUP_INTERVAL_HOURS)",
     "min": 0, "max": 168, "help": "Har necha soatda baza nusxasi olinadi. 0 = avtomatik zaxira o'chiq. Odatda 24."},
    {"key": "backup_keep", "type": "int", "group": "backup", "label": "Saqlanadigan nusxalar soni (BACKUP_KEEP)",
     "min": 1, "max": 100, "help": "Serverda nechta oxirgi zaxira fayli qoladi; eskilari o'chiriladi."},
    {"key": "backup_send_to_admins", "type": "bool", "group": "backup", "label": "Zaxirani adminlarga yuborish (BACKUP_SEND_TO_ADMINS)",
     "help": "Har bir zaxira fayli adminlarga Telegram'da yuboriladi. Server diski o'chib ketsa ham nusxa sizda qoladi. Tavsiya: yoqilgan."},
]
GROUPS = [
    {"id": "bot", "title": "Bot ma'lumoti", "hint": "Mijozlar ko'radigan nom, yordam va havolalar"},
    {"id": "pay", "title": "To'lov", "hint": "Karta orqali to'lov qoidalari"},
    {"id": "balance", "title": "Balans", "hint": "Ilova balansini to'ldirish chegaralari"},
    {"id": "auto", "title": "Avto-tasdiq (CardXabar)", "hint": "Bank xabarlari orqali to'lovni avtomatik tasdiqlash"},
    {"id": "safety", "title": "Xavfsizlik chegarasi", "hint": "Hamyondan ortiqcha pul ketishidan himoya"},
    {"id": "hot", "title": "Hot rejim", "hint": "Server o'zi imzolaydigan hamyon rejimi"},
    {"id": "backup", "title": "Zaxira nusxa", "hint": "Baza nusxalari"},
]
BY_KEY = {f["key"]: f for f in FIELDS}
_env: dict = {}   # values that came from Railway/.env (captured once, before any override is applied)


class ConfigError(ValueError):
    def __init__(self, key: str, message: str):
        super().__init__(message)
        self.key = key


def _capture_env(settings: Settings) -> None:
    if not _env:
        _env.update({f["key"]: getattr(settings, f["key"]) for f in FIELDS})


def env_value(key: str):
    _capture_env(get_settings())
    return _env[key]


def parse(key: str, raw) -> object:
    """Validate a value coming from the panel; returns the typed value or raises ConfigError (Uzbek message)."""
    f = BY_KEY.get(key)
    if f is None:
        raise ConfigError(key, "Bu sozlamani paneldan o'zgartirib bo'lmaydi")
    kind = f["type"]
    text = str(raw if raw is not None else "").strip()
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if text.lower() in ("1", "true", "yes", "on", "ha"):
            return True
        if text.lower() in ("0", "false", "no", "off", "yo'q", ""):
            return False
        raise ConfigError(key, "Ha yoki yo'q bo'lishi kerak")
    if kind in ("int", "float"):
        try:
            number = int(text.replace(" ", "")) if kind == "int" else float(text.replace(",", ".").replace(" ", ""))
        except ValueError:
            raise ConfigError(key, "Son kiriting") from None
        if "min" in f and number < f["min"]:
            raise ConfigError(key, f"Kamida {f['min']}")
        if "max" in f and number > f["max"]:
            raise ConfigError(key, f"Ko'pi bilan {f['max']}")
        if f.get("cap_env") and number > float(env_value(key)):
            raise ConfigError(key, f"Faqat kamaytirish mumkin: Railway'dagi qiymat {env_value(key)} dan oshmasin")
        return number
    if kind == "choice":
        if text not in f["choices"]:
            raise ConfigError(key, "Ro'yxatdan tanlang: " + ", ".join(f["choices"]))
        return text
    if kind == "username":
        text = text.lstrip("@")
        if text and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", text):
            raise ConfigError(key, "Telegram username noto'g'ri (5–32 belgi, harf/raqam/_)")
        return text
    if kind == "usernames":
        names = [n.strip().lstrip("@") for n in text.split(",") if n.strip()]
        if not names:
            raise ConfigError(key, "Kamida bitta bot username kiriting")
        for n in names:
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", n):
                raise ConfigError(key, f"@{n} — username noto'g'ri")
        return ",".join(names)
    if kind == "url":
        if text and not re.fullmatch(r"https://[^\s<>\"']{4,300}", text):
            raise ConfigError(key, "https:// bilan boshlanadigan to'liq havola kiriting")
        return text
    if kind == "last4":
        if text and not re.fullmatch(r"\d{4}", text):
            raise ConfigError(key, "Aniq 4 ta raqam yoki bo'sh")
        return text
    # str
    if not text:
        raise ConfigError(key, "Bo'sh bo'lishi mumkin emas")
    if len(text) > f.get("max_len", 200):
        raise ConfigError(key, f"Ko'pi bilan {f.get('max_len', 200)} belgi")
    return text


def _encode(value) -> str:
    return json.dumps(value, ensure_ascii=False)


async def load_overrides() -> dict:
    async with Session() as session:
        rows = (await session.execute(select(Setting).where(Setting.key.like(PREFIX + "%")))).scalars().all()
    out = {}
    for row in rows:
        key = row.key[len(PREFIX):]
        if key in BY_KEY:
            try:
                out[key] = json.loads(row.value)
            except ValueError:
                continue
    return out


async def apply_all() -> dict:
    """Called at startup: put stored overrides onto the live settings (invalid ones are skipped)."""
    settings = get_settings()
    _capture_env(settings)
    overrides = await load_overrides()
    for key, value in overrides.items():
        try:
            setattr(settings, key, parse(key, value))
        except ConfigError as exc:
            log.warning("Ignoring stored setting %s: %s", key, exc)
    if overrides:
        log.info("Admin-panel settings applied: %s", ", ".join(sorted(overrides)))
    return overrides


async def _log(admin_id: int, key: str, old, new) -> None:
    async with Session() as session:
        row = await session.get(Setting, LOG_KEY)
        items = json.loads(row.value) if row and row.value else []
        items.insert(0, {"at": datetime.now(timezone.utc).isoformat(), "admin": admin_id, "key": key, "old": old, "new": new})
        await set_setting(session, LOG_KEY, json.dumps(items[:LOG_KEEP], ensure_ascii=False))


async def save(values: dict, admin_id: int) -> list[str]:
    """Validate everything first, then store and apply. Returns the keys that actually changed."""
    settings = get_settings()
    _capture_env(settings)
    parsed = {key: parse(key, raw) for key, raw in values.items()}
    lo = parsed.get("topup_min_uzs", settings.topup_min_uzs)
    hi = parsed.get("topup_max_uzs", settings.topup_max_uzs)
    if lo > hi:
        raise ConfigError("topup_max_uzs", "Maksimal summa minimaldan kichik bo'lmasin")
    changed = []
    for key, value in parsed.items():
        old = getattr(settings, key)
        if old == value:
            continue
        async with Session() as session:
            await set_setting(session, PREFIX + key, _encode(value))
        setattr(settings, key, value)
        await _log(admin_id, key, old, value)
        changed.append(key)
    if changed:
        log.info("Admin %s changed settings: %s", admin_id, ", ".join(changed))
    return changed


async def reset(key: str, admin_id: int) -> None:
    if key not in BY_KEY:
        raise ConfigError(key, "Noma'lum sozlama")
    settings = get_settings()
    _capture_env(settings)
    old = getattr(settings, key)
    async with Session() as session:
        await session.execute(delete(Setting).where(Setting.key == PREFIX + key))
        await session.commit()
    setattr(settings, key, _env[key])
    if old != _env[key]:
        await _log(admin_id, key, old, _env[key])


async def describe() -> dict:
    settings = get_settings()
    _capture_env(settings)
    overrides = await load_overrides()
    async with Session() as session:
        row = await session.get(Setting, LOG_KEY)
        history = json.loads(row.value) if row and row.value else []
    fields = [{**{k: v for k, v in f.items()}, "value": getattr(settings, f["key"]), "env": _env[f["key"]],
               "overridden": f["key"] in overrides} for f in FIELDS]
    return {"groups": GROUPS, "fields": fields, "history": history[:30]}
