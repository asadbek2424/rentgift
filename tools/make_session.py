"""Create USERBOT_SESSION for the separate Telegram account that has CardXabar connected.

Run on YOUR computer (Windows / Mac / Linux):
    pip install telethon
    python tools/make_session.py

It asks for api_id and api_hash (from https://my.telegram.org → API development tools), the phone number
of the separate account, the login code Telegram sends you and the 2-step password (if set).
It prints one long line — put it into Railway as USERBOT_SESSION.

⚠ That line is a full login to the account. Never share it, never commit it to GitHub.
"""

import asyncio

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main() -> None:
    api_id = int(input("api_id: ").strip())
    api_hash = input("api_hash: ").strip()
    async with TelegramClient(StringSession(), api_id, api_hash, device_model="GiftRent notices") as client:
        me = await client.get_me()
        session = client.session.save()
        print("\nLogged in as:", me.first_name, f"(id {me.id})")
        print("\nUSERBOT_SESSION=" + session)
        print("\nCopy the whole value after 'USERBOT_SESSION=' into Railway → Variables.")


if __name__ == "__main__":
    asyncio.run(main())
