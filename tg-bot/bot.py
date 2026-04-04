#!/usr/bin/env python3
"""
SocPulse Telegram Monitor
Listens to configured chats, saves messages to Supabase,
periodically analyzes them via DeepSeek.
"""
import asyncio
import signal
import sys
from datetime import datetime

from telethon import TelegramClient, events
from config import TG_API_ID, TG_API_HASH, TG_SESSION, ANALYSIS_INTERVAL
import db
import analyzer


client = TelegramClient(TG_SESSION, TG_API_ID, TG_API_HASH)
monitored_chat_ids: set[int] = set()
running = True


async def load_chats():
    """Load monitored chats from Supabase."""
    global monitored_chat_ids
    chats = db.get_active_chats()
    monitored_chat_ids = {c['chat_id'] for c in chats}
    print(f"[bot] Monitoring {len(monitored_chat_ids)} chats: {monitored_chat_ids}")
    return chats


@client.on(events.NewMessage)
async def on_message(event):
    """Handle incoming messages from monitored chats."""
    raw_id = event.chat_id
    # Normalize: Telethon gives negative IDs for channels/supergroups, DB stores positive with 100 prefix
    chat_id = raw_id
    if raw_id and raw_id < 0:
        chat_id = abs(raw_id)  # -1001853464166 → 1001853464166

    if chat_id not in monitored_chat_ids:
        return

    print(f"[bot] MSG from chat {chat_id}: {(event.text or '')[:50]}")

    # Skip empty messages, service messages, media-only
    if not event.text or len(event.text.strip()) < 5:
        return

    sender_name = None
    if event.sender:
        sender = event.sender
        sender_name = getattr(sender, 'first_name', '') or ''
        last = getattr(sender, 'last_name', '') or ''
        if last:
            sender_name = f"{sender_name} {last}".strip()
        if not sender_name:
            sender_name = getattr(sender, 'username', None)

    reply_to_id = None
    if event.reply_to and event.reply_to.reply_to_msg_id:
        reply_to_id = event.reply_to.reply_to_msg_id

    date_str = event.date.isoformat() if event.date else datetime.utcnow().isoformat()

    try:
        db.save_message(
            chat_id=chat_id,
            message_id=event.id,
            date=date_str,
            sender_name=sender_name,
            text=event.text[:2000],  # truncate very long messages
            reply_to_id=reply_to_id,
        )
    except Exception as e:
        print(f"[bot] Error saving message: {e}")


async def analysis_loop():
    """Periodically run DeepSeek analysis on new messages."""
    while running:
        await asyncio.sleep(ANALYSIS_INTERVAL)
        if not running:
            break
        try:
            print(f"[bot] Running analysis...")
            count = analyzer.process_batch()
            if count > 0:
                print(f"[bot] Analysis found {count} issues")
        except Exception as e:
            print(f"[bot] Analysis error: {e}")


async def chat_reload_loop():
    """Periodically reload chat list from Supabase."""
    while running:
        await asyncio.sleep(60)
        if not running:
            break
        try:
            await load_chats()
        except Exception as e:
            print(f"[bot] Chat reload error: {e}")


async def main():
    global running

    print("=" * 50)
    print("  SocPulse Telegram Monitor")
    print("=" * 50)

    if not TG_API_ID or not TG_API_HASH:
        print("[bot] ERROR: Set TG_API_ID and TG_API_HASH in .env")
        sys.exit(1)

    await client.start()
    me = await client.get_me()
    print(f"[bot] Logged in as: {me.first_name} (@{me.username})")

    await load_chats()

    if not monitored_chat_ids:
        print("[bot] WARNING: No chats to monitor. Add chats via dashboard Settings or Supabase.")

    # Start background tasks
    asyncio.create_task(analysis_loop())
    asyncio.create_task(chat_reload_loop())

    print(f"[bot] Listening for messages... (analysis every {ANALYSIS_INTERVAL}s)")
    print("[bot] Press Ctrl+C to stop\n")

    # Handle shutdown
    def shutdown(sig, frame):
        global running
        print("\n[bot] Shutting down...")
        running = False

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    await client.run_until_disconnected()


if __name__ == '__main__':
    asyncio.run(main())
