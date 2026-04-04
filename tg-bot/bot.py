#!/usr/bin/env python3
"""
SocPulse Telegram Monitor
Listens to configured chats, saves messages to Supabase,
periodically analyzes them via DeepSeek.
"""
import asyncio
from datetime import datetime

from telethon import TelegramClient, events
from config import TG_API_ID, TG_API_HASH, TG_SESSION, ANALYSIS_INTERVAL
import db
import analyzer


client = TelegramClient(TG_SESSION, TG_API_ID, TG_API_HASH)
monitored_chat_ids: set[int] = set()


def load_chats():
    """Load monitored chats from Supabase."""
    global monitored_chat_ids
    chats = db.get_active_chats()
    monitored_chat_ids = {c['chat_id'] for c in chats}
    print(f"[bot] Monitoring {len(monitored_chat_ids)} chats: {monitored_chat_ids}")


@client.on(events.NewMessage(incoming=True))
async def on_message(event):
    """Handle incoming messages from monitored chats."""
    chat_id = event.chat_id

    if chat_id not in monitored_chat_ids:
        return

    if not event.text or len(event.text.strip()) < 5:
        return

    sender_name = None
    try:
        sender = await event.get_sender()
        if sender:
            sender_name = getattr(sender, 'first_name', '') or ''
            last = getattr(sender, 'last_name', '') or ''
            if last:
                sender_name = f"{sender_name} {last}".strip()
            if not sender_name:
                sender_name = getattr(sender, 'username', None)
    except Exception:
        pass

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
            text=event.text[:2000],
            reply_to_id=reply_to_id,
        )
        print(f"[bot] MSG {chat_id}: {event.text[:60]}")
    except Exception as e:
        print(f"[bot] Save error: {e}")


async def periodic_tasks():
    """Reload chats and run analysis periodically."""
    analysis_timer = 0
    while True:
        await asyncio.sleep(60)
        analysis_timer += 60

        try:
            load_chats()
        except Exception as e:
            print(f"[bot] Reload error: {e}")

        if analysis_timer >= ANALYSIS_INTERVAL:
            analysis_timer = 0
            try:
                print("[bot] Running analysis...")
                count = analyzer.process_batch()
                if count > 0:
                    print(f"[bot] Analysis: {count} threads")
            except Exception as e:
                print(f"[bot] Analysis error: {e}")


print("=" * 50)
print("  SocPulse Telegram Monitor")
print("=" * 50)

client.start()
me = client.loop.run_until_complete(client.get_me())
print(f"[bot] Logged in as: {me.first_name} (@{me.username})")

load_chats()

client.loop.create_task(periodic_tasks())
print(f"[bot] Listening... (analysis every {ANALYSIS_INTERVAL}s)")

client.run_until_disconnected()
