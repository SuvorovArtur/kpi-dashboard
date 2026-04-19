import asyncio
import sys
from telethon import TelegramClient
from config import TG_API_ID, TG_API_HASH, TG_SESSION

async def main():
    client = TelegramClient(TG_SESSION, TG_API_ID, TG_API_HASH)
    phone = sys.argv[1] if len(sys.argv) > 1 else input('Phone: ')
    await client.connect()
    if not await client.is_user_authorized():
        await client.send_code_request(phone)
        code = sys.argv[2] if len(sys.argv) > 2 else input('Code: ')
        try:
            await client.sign_in(phone, code)
        except Exception:
            password = sys.argv[3] if len(sys.argv) > 3 else input('2FA Password: ')
            await client.sign_in(password=password)
    me = await client.get_me()
    print(f'OK: {me.first_name} (@{me.username})')
    await client.disconnect()

asyncio.run(main())
