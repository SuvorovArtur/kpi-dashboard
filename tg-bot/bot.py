#!/usr/bin/env python3
"""
SocPulse Telegram Monitor — Pyrogram port.

Listens to configured chats, saves messages to Supabase, periodically
analyzes them via DeepSeek.

Proxy is configured via Supabase `app_settings` (keys tg_proxy_*),
editable from the web Settings page — no VPS access required.
Config changes are picked up within ~60s via systemd restart loop.

Ported from Telethon to Pyrogram to align with visor's working stack.
Pyrogram session files are NOT compatible with Telethon's — re-login
required on first run (python3 auth.py).
"""
import asyncio
import os
import sys
from datetime import datetime

from pyrogram import Client, filters, idle
from pyrogram.enums import ParseMode

from config import TG_API_ID, TG_API_HASH, TG_SESSION, ANALYSIS_INTERVAL
import db
import analyzer
from alerts import ALERT_CHAT_ID


# Keys stored in Supabase app_settings
PROXY_KEYS = (
    'tg_proxy_type',
    'tg_proxy_host',
    'tg_proxy_port',
    'tg_proxy_secret',       # present for hot-reload signature parity; MTProto not supported by Pyrogram
    'tg_proxy_username',
    'tg_proxy_password',
)


def fetch_proxy_config() -> tuple[dict, tuple]:
    """Read proxy keys from Supabase app_settings. Return (config_dict, signature)."""
    try:
        rows = db.get_client().table('app_settings').select('key,value').in_('key', list(PROXY_KEYS)).execute().data or []
    except Exception as e:
        print(f"[bot] Proxy config fetch failed: {e}")
        return {}, tuple()
    cfg = {r['key']: (r.get('value') or '') for r in rows}
    sig = tuple(sorted((k, cfg.get(k, '')) for k in PROXY_KEYS))
    return cfg, sig


_proxy_signature: tuple = tuple()


def build_client() -> Client:
    """Build Pyrogram Client, optionally through a proxy from DB settings."""
    global _proxy_signature
    cfg, sig = fetch_proxy_config()
    _proxy_signature = sig

    t = (cfg.get('tg_proxy_type') or '').strip().lower()
    host = (cfg.get('tg_proxy_host') or '').strip()
    port_raw = (cfg.get('tg_proxy_port') or '').strip()
    port = int(port_raw) if port_raw.isdigit() else 0
    user = (cfg.get('tg_proxy_username') or '').strip() or None
    pwd = cfg.get('tg_proxy_password') or None

    kwargs: dict = {}
    if t and host and port:
        if t in ('socks5', 'socks4', 'http'):
            proxy_dict = {'scheme': t, 'hostname': host, 'port': port}
            if user:
                proxy_dict['username'] = user
            if pwd:
                proxy_dict['password'] = pwd
            kwargs['proxy'] = proxy_dict
            auth_note = f" (auth={user})" if user else ""
            print(f"[bot] Proxy: {t.upper()} {host}:{port}{auth_note}")
        elif t == 'mtproto':
            print("[bot] WARN: Pyrogram does not support MTProto proxies — running direct")
        else:
            print(f"[bot] WARN: unknown tg_proxy_type={t!r} — running direct")
    else:
        print("[bot] Proxy: none (direct connection)")

    return Client(TG_SESSION, api_id=TG_API_ID, api_hash=TG_API_HASH, **kwargs)


def proxy_config_changed() -> bool:
    """Return True if proxy config in DB differs from what client was built with."""
    _, sig = fetch_proxy_config()
    return bool(sig) and sig != _proxy_signature


app = build_client()
monitored_chat_ids: set[int] = set()


def load_chats():
    """Load monitored chats from Supabase."""
    global monitored_chat_ids
    chats = db.get_active_chats()
    monitored_chat_ids = {c['chat_id'] for c in chats}
    print(f"[bot] Monitoring {len(monitored_chat_ids)} chats: {monitored_chat_ids}")


@app.on_message(filters.incoming)
async def on_message(client: Client, message):
    """Handle incoming messages from monitored chats."""
    chat_id = message.chat.id

    if chat_id not in monitored_chat_ids:
        return

    text = message.text or message.caption
    if not text or len(str(text).strip()) < 5:
        return

    sender_name = None
    sender = message.from_user
    if sender:
        first = sender.first_name or ''
        last = sender.last_name or ''
        sender_name = f"{first} {last}".strip() or sender.username

    reply_to_id = message.reply_to_message_id or None

    date_str = message.date.isoformat() if message.date else datetime.utcnow().isoformat()

    try:
        db.save_message(
            chat_id=chat_id,
            message_id=message.id,
            date=date_str,
            sender_name=sender_name,
            text=str(text)[:2000],
            reply_to_id=reply_to_id,
        )
        print(f"[bot] MSG {chat_id}: {str(text)[:60]}")
    except Exception as e:
        print(f"[bot] Save error: {e}")


async def update_chat_participants():
    """Fetch participant/subscriber counts from Telegram and update DB."""
    chats = db.get_active_chats()
    print(f"[bot] Updating participants for {len(chats)} chats...")
    for chat_info in chats:
        try:
            chat = await app.get_chat(chat_info['chat_id'])
            count = getattr(chat, 'members_count', None) or 0
            print(f"[bot] {chat_info['title']}: {count} members")
            if count > 0:
                db.get_client().table('tg_chats').update(
                    {'subscribers': count}
                ).eq('chat_id', chat_info['chat_id']).execute()

                if chat_info.get('type') == 'channel':
                    today = datetime.utcnow().strftime('%Y-%m-%d')
                    db.get_client().table('tg_channel_stats').upsert({
                        'chat_id': chat_info['chat_id'],
                        'date': today,
                        'subscribers': count,
                    }, on_conflict='chat_id,date').execute()
        except Exception as e:
            print(f"[bot] Participants error ({chat_info['title']}): {e}")


async def periodic_tasks():
    """Reload chats, check proxy config, run analysis periodically."""
    analysis_timer = 0
    participants_timer = 0
    while True:
        await asyncio.sleep(60)
        analysis_timer += 60
        participants_timer += 60

        try:
            load_chats()
        except Exception as e:
            print(f"[bot] Reload error: {e}")

        # Hot-reload proxy: if UI saved new settings, exit so systemd restarts us with them.
        try:
            if proxy_config_changed():
                print("[bot] Proxy config changed in DB — exiting for systemd restart.")
                sys.stdout.flush()
                os._exit(0)
        except Exception as e:
            print(f"[bot] Proxy-check error: {e}")

        if participants_timer >= 1800:
            participants_timer = 0
            try:
                await update_chat_participants()
            except Exception as e:
                print(f"[bot] Participants update error: {e}")

        if analysis_timer >= ANALYSIS_INTERVAL:
            analysis_timer = 0
            try:
                print("[bot] Running analysis...")
                count, pending_alerts = analyzer.process_batch()
                if count > 0:
                    print(f"[bot] Analysis: {count} threads")
                for alert_text in pending_alerts:
                    try:
                        await app.send_message(ALERT_CHAT_ID, alert_text, parse_mode=ParseMode.MARKDOWN)
                        print(f"[bot] Alert sent to {ALERT_CHAT_ID}")
                    except Exception as e:
                        print(f"[bot] Alert send error: {e}")
            except Exception as e:
                print(f"[bot] Analysis error: {e}")


async def main():
    print("=" * 50)
    print("  SocPulse Telegram Monitor (Pyrogram)")
    print("=" * 50)

    await app.start()
    me = await app.get_me()
    print(f"[bot] Logged in as: {me.first_name} (@{me.username})")

    # Prime Pyrogram's peer cache: without this, get_chat and update resolvers
    # fail with CHANNEL_INVALID for chats not yet "seen" by this session.
    # Telethon does this implicitly; Pyrogram requires an explicit dialog walk.
    primed = 0
    async for _ in app.get_dialogs():
        primed += 1
    print(f"[bot] Peer cache primed: {primed} dialogs")

    load_chats()
    await update_chat_participants()

    asyncio.create_task(periodic_tasks())
    print(f"[bot] Listening... (analysis every {ANALYSIS_INTERVAL}s)")

    await idle()
    await app.stop()


if __name__ == '__main__':
    app.run(main())
