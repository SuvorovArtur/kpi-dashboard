"""One-shot helper to create/refresh the Pyrogram session file.

Run interactively on the host that will execute bot.py:
    python3 auth.py

Uses the same proxy config as bot.py (Supabase app_settings keys tg_proxy_*),
so it works from the VPS where Telegram DC IPs are blocked directly.

Pyrogram will prompt for phone number, SMS code, and (if set) 2FA password.
Creates ./<TG_SESSION>.session which bot.py will reuse on subsequent runs.
"""
import asyncio

from pyrogram import Client

from config import TG_API_ID, TG_API_HASH, TG_SESSION
import db


PROXY_KEYS = (
    'tg_proxy_type',
    'tg_proxy_host',
    'tg_proxy_port',
    'tg_proxy_username',
    'tg_proxy_password',
)


def load_proxy() -> dict | None:
    """Load proxy config from Supabase app_settings, same as bot.py."""
    try:
        rows = db.get_client().table('app_settings').select('key,value').in_('key', list(PROXY_KEYS)).execute().data or []
    except Exception as e:
        print(f"[auth] proxy config fetch failed: {e}")
        return None
    cfg = {r['key']: (r.get('value') or '') for r in rows}
    t = (cfg.get('tg_proxy_type') or '').strip().lower()
    host = (cfg.get('tg_proxy_host') or '').strip()
    port_raw = (cfg.get('tg_proxy_port') or '').strip()
    port = int(port_raw) if port_raw.isdigit() else 0
    user = (cfg.get('tg_proxy_username') or '').strip() or None
    pwd = cfg.get('tg_proxy_password') or None

    if t in ('socks5', 'socks4', 'http') and host and port:
        d = {'scheme': t, 'hostname': host, 'port': port}
        if user:
            d['username'] = user
        if pwd:
            d['password'] = pwd
        auth_note = f" (auth={user})" if user else ""
        print(f"[auth] Proxy: {t.upper()} {host}:{port}{auth_note}")
        return d
    print("[auth] Proxy: none (direct connection — will fail from blocked networks)")
    return None


async def main() -> None:
    kwargs: dict = {}
    proxy = load_proxy()
    if proxy:
        kwargs['proxy'] = proxy
    async with Client(TG_SESSION, api_id=TG_API_ID, api_hash=TG_API_HASH, **kwargs) as app:
        me = await app.get_me()
        print(f'OK: {me.first_name} (@{me.username})')


if __name__ == '__main__':
    asyncio.run(main())
