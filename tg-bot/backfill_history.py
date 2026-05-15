#!/usr/bin/env python3
"""One-shot backfill — pull messages missed during a VPN/proxy outage.

Usage on the VPS:
  systemctl stop tg-bot
  cd /opt/tg-bot && venv/bin/python backfill_history.py [--since 2026-04-26T03:00 | --hours 32]
  systemctl start tg-bot

Reads tg_chats.is_active, walks chat history newest→oldest, stops at
either --since (UTC ISO) or the latest tg_messages.date already in DB
(per chat) — whichever is later. Saves messages via db.save_message and
hands each one to octobot_moderator.process_message exactly like the
live handler does.

Safe to run multiple times — save is an upsert on (chat_id, message_id).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone

from pyrogram import Client

from config import TG_API_ID, TG_API_HASH, TG_SESSION
import db
import octobot_moderator
from bot import build_client  # reuses proxy config from app_settings


PER_CHAT_HARD_CAP = 5000  # don't accidentally drain a year of history


def _parse_since(arg_since: str | None, arg_hours: int | None) -> datetime | None:
    if arg_since:
        s = arg_since.replace('Z', '+00:00')
        return datetime.fromisoformat(s).astimezone(timezone.utc)
    if arg_hours:
        return datetime.now(tz=timezone.utc).fromtimestamp(
            datetime.now(tz=timezone.utc).timestamp() - arg_hours * 3600,
            tz=timezone.utc,
        )
    return None


def _last_seen_per_chat() -> dict[int, datetime]:
    """For every active chat, return the latest message date already in DB."""
    out: dict[int, datetime] = {}
    chats = db.get_active_chats()
    for c in chats:
        chat_id = c['chat_id']
        res = db.get_client().table('tg_messages') \
            .select('date').eq('chat_id', chat_id) \
            .order('date', desc=True).limit(1).execute()
        if res.data:
            d = res.data[0]['date']
            out[chat_id] = datetime.fromisoformat(d.replace('Z', '+00:00')).astimezone(timezone.utc)
    return out


async def backfill_chat(app: Client, chat_id: int, chat_title: str, cutoff: datetime) -> int:
    """Walk history newest→oldest, stop when date <= cutoff. Returns count saved."""
    saved = 0
    skipped = 0
    print(f"[backfill] {chat_title} ({chat_id}): cutoff={cutoff.isoformat()}")
    try:
        async for msg in app.get_chat_history(chat_id, limit=PER_CHAT_HARD_CAP):
            msg_dt = msg.date  # pyrogram returns aware datetime
            if msg_dt is None:
                continue
            if msg_dt.tzinfo is None:
                msg_dt = msg_dt.replace(tzinfo=timezone.utc)
            if msg_dt <= cutoff:
                break

            text = msg.text or msg.caption or ''
            if not text or len(str(text).strip()) < 5:
                skipped += 1
                continue

            sender_name = None
            sender = msg.from_user
            sender_uid = None
            if sender:
                first = sender.first_name or ''
                last = sender.last_name or ''
                sender_name = f"{first} {last}".strip() or sender.username
                sender_uid = sender.id

            reply_to_id = msg.reply_to_message_id

            try:
                db.save_message(
                    chat_id=chat_id,
                    message_id=msg.id,
                    date=msg_dt.astimezone(timezone.utc).isoformat(),
                    sender_name=sender_name,
                    text=str(text)[:2000],
                    reply_to_id=reply_to_id,
                )
                saved += 1
            except Exception as e:
                print(f"[backfill] save error mid={msg.id}: {e}")
                continue

            try:
                incoming = octobot_moderator.IncomingMessage(
                    chat_id=chat_id,
                    message_id=msg.id,
                    text=str(text),
                    author=sender_name,
                    author_tg_id=sender_uid,
                    reply_to_id=reply_to_id,
                    sent_at=msg_dt,
                    source='telegram',
                )
                # Backfill is sync-style: await each one to keep load predictable
                await octobot_moderator.process_message(incoming)
            except Exception as e:
                print(f"[backfill] octobot hook error mid={msg.id}: {e}")
    except Exception as e:
        print(f"[backfill] chat {chat_id} aborted: {type(e).__name__}: {e}")

    print(f"[backfill] {chat_title} ({chat_id}): saved={saved}, skipped(no text)={skipped}")
    return saved


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--since', help='UTC ISO datetime to start from (e.g. 2026-04-26T03:00)')
    parser.add_argument('--hours', type=int, help='Lookback window in hours (alternative to --since)')
    args = parser.parse_args()
    print(f"[backfill] starting; --since={args.since} --hours={args.hours}", flush=True)

    explicit_cutoff = _parse_since(args.since, args.hours)
    print(f"[backfill] explicit cutoff: {explicit_cutoff}", flush=True)
    last_seen = _last_seen_per_chat()
    print(f"[backfill] last-seen per chat resolved for {len(last_seen)} chats", flush=True)
    chats = db.get_active_chats()
    if not chats:
        print('[backfill] no active chats', flush=True)
        return

    print(f"[backfill] active chats:    {len(chats)}", flush=True)

    app = build_client()
    async with app:
        total_saved = 0
        for c in chats:
            chat_id = c['chat_id']
            chat_title = c.get('title') or c.get('chat_title') or str(chat_id)
            per_chat_known = last_seen.get(chat_id)
            # cutoff = max(explicit, per_chat_last_seen). If neither — go back 7 days.
            candidates = [d for d in (explicit_cutoff, per_chat_known) if d]
            if candidates:
                cutoff = max(candidates)
            else:
                cutoff = datetime.now(tz=timezone.utc).fromtimestamp(
                    datetime.now(tz=timezone.utc).timestamp() - 7 * 86400, tz=timezone.utc,
                )
            try:
                total_saved += await backfill_chat(app, chat_id, chat_title, cutoff)
            except Exception as e:
                print(f"[backfill] chat {chat_id} error: {type(e).__name__}: {e}")

    print(f"[backfill] DONE — total saved: {total_saved}")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
