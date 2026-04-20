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


@app.on_raw_update()
async def on_raw(client, update, users, chats):
    """Extract messages directly from raw MTProto updates.

    pyrotgfork's on_message dispatcher doesn't fire reliably for channel
    messages, so we decode the raw update ourselves. Covers the two types
    Telegram pushes for supergroup/channel posts.
    """
    from pyrogram.raw.types import UpdateNewChannelMessage, UpdateNewMessage, Message as RawMessage, MessageEmpty, MessageService

    if not isinstance(update, (UpdateNewChannelMessage, UpdateNewMessage)):
        return

    msg = update.message
    if isinstance(msg, (MessageEmpty, MessageService)):
        return

    # Extract channel/chat id from peer
    peer = getattr(msg, 'peer_id', None)
    if peer is None:
        return
    # Telegram peer types: PeerChannel, PeerChat, PeerUser
    channel_id = getattr(peer, 'channel_id', None)
    chat_id_raw = getattr(peer, 'chat_id', None)
    user_id = getattr(peer, 'user_id', None)
    if channel_id is not None:
        # Supergroup / channel — store with -100 prefix (Telegram native format)
        chat_id = -(1000000000000 + channel_id)
    elif chat_id_raw is not None:
        chat_id = -chat_id_raw
    elif user_id is not None:
        chat_id = user_id
    else:
        return

    if chat_id not in monitored_chat_ids:
        return

    # Skip our own (outgoing) messages — match old Telethon incoming=True semantics
    if getattr(msg, 'out', False):
        return

    text = getattr(msg, 'message', None) or ''
    if len(text.strip()) < 5:
        return

    # Resolve sender name from users dict (raw updates include this)
    sender_name = None
    from_id = getattr(msg, 'from_id', None)
    sender_uid = getattr(from_id, 'user_id', None) if from_id else None
    if sender_uid and users and sender_uid in users:
        u = users[sender_uid]
        first = getattr(u, 'first_name', '') or ''
        last = getattr(u, 'last_name', '') or ''
        sender_name = f"{first} {last}".strip() or getattr(u, 'username', None)

    reply_to = getattr(msg, 'reply_to', None)
    reply_to_id = getattr(reply_to, 'reply_to_msg_id', None) if reply_to else None

    date_ts = getattr(msg, 'date', None)
    if date_ts:
        date_str = datetime.utcfromtimestamp(date_ts).isoformat()
    else:
        date_str = datetime.utcnow().isoformat()

    try:
        db.save_message(
            chat_id=chat_id,
            message_id=msg.id,
            date=date_str,
            sender_name=sender_name,
            text=text[:2000],
            reply_to_id=reply_to_id,
        )
        print(f"[bot] MSG {chat_id}: {text[:60]}")
    except Exception as e:
        print(f"[bot] Save error: {e}")


@app.on_message()
async def on_message(client: Client, message):
    """Handle incoming messages from monitored chats."""
    chat_id = message.chat.id if message.chat else None
    # Debug: log EVERY dispatched update to know if handler fires at all
    print(f"[bot] DISPATCH chat={chat_id} monitored={chat_id in monitored_chat_ids} "
          f"outgoing={message.outgoing} has_text={bool(message.text or message.caption)}")

    if chat_id not in monitored_chat_ids:
        return

    if message.outgoing:
        # Our own message — skip saving (matches old Telethon incoming=True behavior)
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

    # Prime peer cache via raw getDialogs (bypasses fork bug where Dialog._parse
    # reads wrong attribute name for unread_poll_votes_count).
    try:
        from pyrogram.raw.functions.messages import GetDialogs
        from pyrogram.raw.types import InputPeerEmpty
        r = await app.invoke(GetDialogs(
            offset_date=0, offset_id=0, offset_peer=InputPeerEmpty(),
            limit=200, hash=0,
        ))
        print(f"[bot] Peer cache primed: {len(getattr(r, 'dialogs', []))} dialogs")
    except Exception as e:
        print(f"[bot] Peer cache prime failed: {type(e).__name__}: {e}")

    load_chats()
    await update_chat_participants()

    asyncio.create_task(periodic_tasks())
    print(f"[bot] Listening... (analysis every {ANALYSIS_INTERVAL}s)")

    await idle()
    await app.stop()


if __name__ == '__main__':
    app.run(main())
