"""One-shot helper to create/refresh the Pyrogram session file.

Run interactively on the host that will execute bot.py:
    python3 auth.py

Pyrogram will prompt for phone number, SMS code, and (if set) 2FA password.
Creates ./<TG_SESSION>.session which bot.py will reuse on subsequent runs.
"""
import asyncio

from pyrogram import Client

from config import TG_API_ID, TG_API_HASH, TG_SESSION


async def main() -> None:
    async with Client(TG_SESSION, api_id=TG_API_ID, api_hash=TG_API_HASH) as app:
        me = await app.get_me()
        print(f'OK: {me.first_name} (@{me.username})')


if __name__ == '__main__':
    asyncio.run(main())
