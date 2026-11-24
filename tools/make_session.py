"""Create USERBOT_SESSION for the separate Telegram account that has CardXabar connected.

Run on YOUR computer (Windows / Mac / Linux):
    pip install telethon qrcode
    python tools/make_session.py

Two ways to log in:
  1) QR code (recommended): scan it in the Telegram app of the separate account:
     Settings → Devices → Link Desktop Device.
  2) Phone + login code (the code comes inside Telegram, in the "Telegram" service chat).

It prints one long line — put it into Railway as USERBOT_SESSION.
⚠ That line is a full login to the account. Never share it, never commit it to GitHub.
"""

import asyncio
import getpass

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.sessions import StringSession


def show_qr(url: str) -> None:
    try:
        import qrcode

        import qrcode.image.svg

        qr = qrcode.QRCode(border=2, image_factory=qrcode.image.svg.SvgPathImage)
        qr.add_data(url)
        try:
            qr.print_ascii(invert=True)
        except Exception:  # Windows console can't draw it — open as a picture instead
            import os
            import webbrowser

            qr.make_image().save("login_qr.svg")
            webbrowser.open("file://" + os.path.abspath("login_qr.svg"))
            print("QR brauzerda ochildi (login_qr.svg). Kirgandan keyin faylni o'chiring.")
    except ImportError:
        print("(QR chizish uchun: pip install qrcode)")
    print("Havola:", url)


async def login_qr(client: TelegramClient) -> None:
    qr = await client.qr_login()
    while True:
        print("\nAlohida akkaunt Telegram ilovasida: Settings → Devices → Link Desktop Device → shu QR'ni skanerlang\n")
        show_qr(qr.url)
        try:
            await qr.wait(timeout=60)
            return
        except asyncio.TimeoutError:
            print("\nQR eskirdi, yangisi chiqarilmoqda...")
            await qr.recreate()
        except SessionPasswordNeededError:
            await client.sign_in(password=getpass.getpass("2FA parol (bulutli parol): "))
            return


async def login_phone(client: TelegramClient) -> None:
    while True:
        phone = input("Alohida akkaunt telefon raqami (+998901234567), BOT TOKEN EMAS: ").strip().replace(" ", "")
        if ":" in phone:
            print("  Bu bot token. CardXabar ulangan akkaunt telefonini yozing.")
            continue
        if phone.lstrip("+").isdigit():
            break
        print("  Raqam noto'g'ri. Masalan: +998901234567")
    sent = await client.send_code_request(phone)
    kind = type(sent.type).__name__.replace("SentCodeType", "")
    where = {"App": "Telegram ilovasiga ('Telegram' rasmiy chati)", "Sms": "SMS", "Call": "qo'ng'iroq",
             "FlashCall": "qo'ng'iroq", "EmailCode": "login e-pochtangizga"}.get(kind, kind)
    print(f"Kod yuborildi: {where}")
    code = input("Kod: ").strip()
    try:
        await client.sign_in(phone, code, phone_code_hash=sent.phone_code_hash)
    except SessionPasswordNeededError:
        await client.sign_in(password=getpass.getpass("2FA parol (bulutli parol): "))


async def main() -> None:
    api_id = int(input("api_id: ").strip())
    api_hash = input("api_hash: ").strip()
    mode = input("Kirish usuli: 1 = QR kod (tavsiya), 2 = telefon + kod [1]: ").strip() or "1"
    client = TelegramClient(StringSession(), api_id, api_hash, device_model="GiftRent notices")
    await client.connect()
    try:
        if mode == "2":
            await login_phone(client)
        else:
            await login_qr(client)
        me = await client.get_me()
        if me.bot:
            print("Bu bot akkaunt — yaramaydi.")
            return
        print("\nKirildi:", me.first_name, f"(id {me.id})")
        print("\nUSERBOT_SESSION=" + client.session.save())
        print("\n'USERBOT_SESSION=' dan keyingi butun satrni Railway → Variables'ga qo'ying. Hech kimga bermang!")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
