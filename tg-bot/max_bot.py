"""max_bot — forwards priority-7+ Octobot incidents into the MAX team chat.

Responsibilities:
  1. Poll octobot_incidents for new priority>=7 rows that don't yet have a
     max_tasks row; forward each as a message with 3 inline buttons.
  2. Long-poll MAX /updates for message_callback events; on click, update
     the max_tasks row, append a max_task_events entry, and edit the original
     message via POST /answers to reflect the new state.
  3. Every DIGEST_INTERVAL seconds (default 6h) send a digest listing:
       - tasks still in status='new' (not accepted)
       - tasks in status='in_work' with <24h to deadline_at

Env (via /etc/tg-bot/max.env or similar):
  MAX_BOT_TOKEN       — MAX Bot API access token (sent as Authorization header)
  MAX_TEAM_CHAT_ID    — chat_id of the team chat (integer, may be negative)
  SUPABASE_URL, SUPABASE_KEY — reused from tg-bot
  DEADLINE_DAYS       — default 3
  DIGEST_INTERVAL     — default 21600 seconds (6h)
  POLL_INCIDENTS_INTERVAL — default 30 seconds
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from supabase import create_client, Client

MAX_API = "https://platform-api.max.ru"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MAX_BOT_TOKEN = os.getenv("MAX_BOT_TOKEN", "").strip()
MAX_TEAM_CHAT_ID = int(os.getenv("MAX_TEAM_CHAT_ID", "0"))
MAX_STAROSTY_CHAT_ID = int(os.getenv("MAX_STAROSTY_CHAT_ID", "0"))  # 0 = monitoring disabled
BOT_USER_ID = int(os.getenv("BOT_USER_ID", "0"))  # own user_id — to ignore self-messages
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_MODEL = os.getenv("OCTOBOT_DEEPSEEK_MODEL", "deepseek-chat")
DEADLINE_DAYS = int(os.getenv("DEADLINE_DAYS", "3"))
DIGEST_INTERVAL = int(os.getenv("DIGEST_INTERVAL", str(6 * 3600)))
POLL_INCIDENTS_INTERVAL = int(os.getenv("POLL_INCIDENTS_INTERVAL", "30"))
MIN_PRIORITY = int(os.getenv("MIN_PRIORITY", "7"))
MIN_STAROSTY_LEN = int(os.getenv("MIN_STAROSTY_LEN", "20"))
# Comma-separated MAX user_ids that are allowed to assign tasks to other members.
# Anyone not in this list self-assigns on «В работу» — same behavior as before.
MAX_ADMIN_USER_IDS: set[int] = set()
_raw_admins = os.getenv("MAX_ADMIN_USER_IDS", "").strip()
if _raw_admins:
    for _tok in _raw_admins.split(","):
        _tok = _tok.strip()
        if _tok.lstrip("-").isdigit():
            MAX_ADMIN_USER_IDS.add(int(_tok))

if not MAX_BOT_TOKEN or not MAX_TEAM_CHAT_ID or not SUPABASE_URL or not SUPABASE_KEY:
    print("[max-bot] FATAL: MAX_BOT_TOKEN / MAX_TEAM_CHAT_ID / SUPABASE_URL / SUPABASE_KEY must be set")
    sys.exit(1)

db: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _headers() -> dict[str, str]:
    return {"Authorization": MAX_BOT_TOKEN, "Content-Type": "application/json"}


def _tg_message_url(chat_id: int | None, message_id: int | None, username: str | None) -> str | None:
    """Build a deep link to a specific Telegram message, or None if we can't."""
    if not chat_id or not message_id:
        return None
    if username:
        return f"https://t.me/{username}/{message_id}"
    # Private / supergroup: strip -100 prefix (Telegram's channel format)
    raw = abs(chat_id)
    stripped = raw - 1_000_000_000_000 if raw > 1_000_000_000_000 else raw
    return f"https://t.me/c/{stripped}/{message_id}"


def _md_escape_link_text(s: str) -> str:
    """Escape chars that break markdown inline links inside [text](url)."""
    return s.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def _format_incident(inc: dict[str, Any], task_id: int, deadline: datetime, tg_url: str | None) -> str:
    prio = inc.get("priority") or "?"
    topic = inc.get("topic") or "—"
    locality = inc.get("locality") or ""
    address = inc.get("address") or ""
    loc_parts = [p for p in [locality, address] if p]
    loc_line = ", ".join(loc_parts) or "—"
    summary = (inc.get("summary") or "").strip()
    first_author = inc.get("first_author") or "—"
    deadline_txt = deadline.astimezone().strftime("%d.%m.%Y %H:%M")

    lines = [
        f"🚨 *Инцидент #{inc['id']}* · приоритет *{prio}*",
        f"🏷 {topic}",
        f"📍 {loc_line}",
    ]
    if summary:
        lines.append("")
        truncated = summary[:3500]
        if tg_url:
            lines.append(f"[{_md_escape_link_text(truncated)}]({tg_url})")
        else:
            lines.append(truncated)
    lines.append("")
    lines.append(f"👤 Первый автор: {first_author}")
    lines.append(f"⏰ Дедлайн: {deadline_txt} (через {DEADLINE_DAYS} дн.)")
    lines.append(f"🔗 task #{task_id}")
    return "\n".join(lines)


def _inline_kb(task_id: int, status: str) -> list[list[dict[str, Any]]]:
    """Build inline keyboard appropriate for the current task status."""
    if status == "new":
        return [[
            {"type": "callback", "text": "✅ В работу", "payload": f"accept:{task_id}"},
            {"type": "callback", "text": "🏁 Закрыто", "payload": f"close:{task_id}"},
            {"type": "callback", "text": "⏭ Пропустить", "payload": f"skip:{task_id}"},
        ]]
    if status == "in_work":
        return [[
            {"type": "callback", "text": "🏁 Закрыть", "payload": f"close:{task_id}"},
        ]]
    return []  # done / skipped — no more buttons


def _assign_picker_kb(task_id: int, members: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Keyboard shown to an admin who clicked «В работу»: pick a team member.
    Members packed 2-per-row; trailing cancel button restores the default keyboard."""
    rows: list[list[dict[str, Any]]] = []
    row: list[dict[str, Any]] = []
    for m in members:
        name = (m.get("display_name") or f"id{m['user_id']}")[:30]
        row.append({
            "type": "callback",
            "text": f"👤 {name}",
            "payload": f"assign:{task_id}:{m['user_id']}",
        })
        if len(row) == 2:
            rows.append(row); row = []
    if row:
        rows.append(row)
    rows.append([{
        "type": "callback",
        "text": "↩ Отмена",
        "payload": f"cancel_assign:{task_id}",
    }])
    return rows


def _is_admin(user_id: int | None) -> bool:
    """Admin = user_id listed in MAX_ADMIN_USER_IDS env OR has role='admin' in DB."""
    if user_id is None:
        return False
    if user_id in MAX_ADMIN_USER_IDS:
        return True
    try:
        res = db.table("max_team_members").select("role").eq("user_id", user_id).limit(1).execute()
        return bool(res.data) and (res.data[0].get("role") == "admin")
    except Exception as e:
        print(f"[max-bot] _is_admin db error: {e}")
        return False


def _upsert_member(user_id: int | None, display_name: str | None, promote_to_admin: bool = False):
    """Harvest a member into the roster. Never downgrades an existing admin. Refreshes
    last_seen_at/display_name on every callback so the picker list stays current."""
    if not user_id:
        return
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    try:
        existing = db.table("max_team_members").select("role").eq("user_id", user_id).limit(1).execute()
        if existing.data:
            patch: dict[str, Any] = {"last_seen_at": now_iso, "is_active": True}
            if display_name:
                patch["display_name"] = display_name
            if promote_to_admin and existing.data[0].get("role") != "admin":
                patch["role"] = "admin"
            db.table("max_team_members").update(patch).eq("user_id", user_id).execute()
        else:
            db.table("max_team_members").insert({
                "user_id": user_id,
                "display_name": display_name,
                "role": "admin" if promote_to_admin else "member",
                "is_active": True,
                "first_seen_at": now_iso,
                "last_seen_at": now_iso,
            }).execute()
    except Exception as e:
        print(f"[max-bot] _upsert_member({user_id}) error: {e}")


def _fetch_active_members(limit: int = 20) -> list[dict[str, Any]]:
    """Active roster for the assignee-picker keyboard, most recent first."""
    try:
        res = db.table("max_team_members") \
            .select("user_id, display_name, role") \
            .eq("is_active", True) \
            .order("last_seen_at", desc=True) \
            .limit(limit).execute()
        return res.data or []
    except Exception as e:
        print(f"[max-bot] _fetch_active_members error: {e}")
        return []


def _bootstrap_admins():
    """On startup, make sure MAX_ADMIN_USER_IDS entries exist with role=admin."""
    for uid in MAX_ADMIN_USER_IDS:
        _upsert_member(uid, None, promote_to_admin=True)


async def refresh_team_roster(client: httpx.AsyncClient):
    """Pull the full member list from MAX API and upsert into max_team_members.
    Bots are skipped. Chat owners/admins are auto-promoted to role='admin'."""
    seen = 0
    try:
        # MAX pages results — walk until empty or hard cap.
        marker: int | None = None
        for _ in range(20):  # safety cap: 20 pages × 100 = 2000 members
            params: dict[str, Any] = {"count": 100}
            if marker is not None:
                params["marker"] = marker
            r = await client.get(
                f"{MAX_API}/chats/{MAX_TEAM_CHAT_ID}/members",
                params=params, headers=_headers(), timeout=30.0,
            )
            if r.status_code >= 400:
                print(f"[max-bot] members fetch {r.status_code}: {r.text[:200]}")
                return
            body = r.json() or {}
            members = body.get("members") or []
            for m in members:
                if m.get("is_bot"):
                    continue
                uid = m.get("user_id")
                if not uid:
                    continue
                name = (m.get("name") or
                        " ".join(s for s in [m.get("first_name"), m.get("last_name")] if s) or
                        f"id{uid}")
                promote = bool(m.get("is_admin") or m.get("is_owner"))
                _upsert_member(uid, name.strip(), promote_to_admin=promote)
                seen += 1
            marker = body.get("marker")
            if not marker or not members:
                break
        print(f"[max-bot] roster refresh: {seen} team member(s) upserted from MAX API")
    except Exception as e:
        print(f"[max-bot] refresh_team_roster error: {type(e).__name__}: {e}")


async def max_send_message(client: httpx.AsyncClient, text: str, buttons: list[list[dict[str, Any]]]) -> dict[str, Any] | None:
    body: dict[str, Any] = {"text": text, "format": "markdown", "notify": True}
    if buttons:
        body["attachments"] = [{"type": "inline_keyboard", "payload": {"buttons": buttons}}]
    r = await client.post(
        f"{MAX_API}/messages",
        params={"chat_id": MAX_TEAM_CHAT_ID},
        headers=_headers(),
        json=body,
        timeout=30.0,
    )
    if r.status_code >= 400:
        print(f"[max-bot] send_message {r.status_code}: {r.text[:300]}")
        return None
    return r.json()


async def max_send_dm(client: httpx.AsyncClient, user_id: int, text: str) -> bool:
    """Try to send a direct message to a MAX user. Returns True on HTTP 2xx.
    Silently returns False if the bot doesn't have permission to DM this user —
    the team-chat notification stays the primary channel."""
    try:
        r = await client.post(
            f"{MAX_API}/messages",
            params={"user_id": user_id},
            headers=_headers(),
            json={"text": text, "format": "markdown", "notify": True},
            timeout=15.0,
        )
        if r.status_code >= 400:
            print(f"[max-bot] DM to {user_id} failed {r.status_code}: {r.text[:200]}")
            return False
        return True
    except Exception as e:
        print(f"[max-bot] DM to {user_id} error: {type(e).__name__}: {e}")
        return False


async def max_answer_callback(client: httpx.AsyncClient, callback_id: str, notification: str | None, new_text: str | None, buttons: list[list[dict[str, Any]]]):
    body: dict[str, Any] = {}
    if notification:
        body["notification"] = notification[:200]
    if new_text is not None:
        msg: dict[str, Any] = {"text": new_text, "format": "markdown"}
        msg["attachments"] = [{"type": "inline_keyboard", "payload": {"buttons": buttons}}] if buttons else []
        body["message"] = msg
    r = await client.post(
        f"{MAX_API}/answers",
        params={"callback_id": callback_id},
        headers=_headers(),
        json=body,
        timeout=30.0,
    )
    if r.status_code >= 400:
        print(f"[max-bot] answer_callback {r.status_code}: {r.text[:300]}")


async def fetch_updates(client: httpx.AsyncClient, marker: int | None) -> dict[str, Any]:
    types = "message_callback,message_created" if MAX_STAROSTY_CHAT_ID else "message_callback"
    params: dict[str, Any] = {"timeout": 60, "limit": 100, "types": types}
    if marker is not None:
        params["marker"] = marker
    r = await client.get(f"{MAX_API}/updates", params=params, headers=_headers(), timeout=90.0)
    if r.status_code >= 400:
        print(f"[max-bot] updates {r.status_code}: {r.text[:300]}")
        return {"updates": [], "marker": marker}
    return r.json()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _insert_event(task_id: int, actor_id: int | None, actor_name: str | None, action: str, details: dict[str, Any] | None = None):
    db.table("max_task_events").insert({
        "task_id": task_id,
        "actor_max_user_id": actor_id,
        "actor_display_name": actor_name,
        "action": action,
        "details": details or {},
    }).execute()


def _fetch_task_with_incident(task_id: int) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    t = db.table("max_tasks").select("*").eq("id", task_id).limit(1).execute()
    if not t.data:
        return None, None
    task = t.data[0]
    inc = db.table("octobot_incidents").select("*").eq("id", task["incident_id"]).limit(1).execute()
    incident = inc.data[0] if inc.data else None
    return task, incident


async def max_delete_message(client: httpx.AsyncClient, mid: str) -> bool:
    """DELETE /messages?message_id=<mid>. Returns True on HTTP 200."""
    if not mid:
        return False
    r = await client.delete(
        f"{MAX_API}/messages",
        params={"message_id": mid},
        headers=_headers(),
        timeout=30.0,
    )
    if r.status_code >= 400:
        print(f"[max-bot] delete_message {r.status_code}: {r.text[:300]}")
        return False
    return True


def _chat_username(chat_id: int | None) -> str | None:
    if not chat_id:
        return None
    res = db.table("tg_chats").select("username").eq("chat_id", chat_id).limit(1).execute()
    if not res.data:
        return None
    return (res.data[0] or {}).get("username")


def _rebuild_message_text(inc: dict[str, Any], task: dict[str, Any]) -> str:
    """Text that follows the current task state — header changes per status."""
    deadline = datetime.fromisoformat(task["deadline_at"].replace("Z", "+00:00"))
    tg_url = _tg_message_url(
        inc.get("source_chat_id"),
        inc.get("source_message_id"),
        _chat_username(inc.get("source_chat_id")),
    )
    base = _format_incident(inc, task["id"], deadline, tg_url)
    status = task["status"]
    if status == "in_work":
        who = task.get("assignee_display_name") or "—"
        return base + f"\n\n✅ *В работе* · взял: *{who}*"
    if status == "done":
        who = task.get("closed_by_display_name") or task.get("assignee_display_name") or "—"
        closed = task.get("closed_at", "")
        return base + f"\n\n🏁 *Закрыто* · {who} · {closed[:16].replace('T', ' ') if closed else ''}"
    if status == "skipped":
        who = task.get("closed_by_display_name") or "—"
        return base + f"\n\n⏭ *Пропущено* · {who}"
    return base


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

_mytishi_names: list[str] = []
_mytishi_cache_at: float = 0.0


def _mytishi_settlements(force: bool = False) -> list[str]:
    """Cache the settlement list for 5 minutes."""
    global _mytishi_names, _mytishi_cache_at
    loop = asyncio.get_event_loop()
    now = loop.time()
    if force or not _mytishi_names or now - _mytishi_cache_at > 300:
        res = db.table("mytishi_settlements").select("name").eq("is_active", True).execute()
        _mytishi_names = sorted(
            (r["name"].strip().lower() for r in (res.data or []) if r.get("name")),
            key=len, reverse=True,
        )
        _mytishi_cache_at = now
    return _mytishi_names


def _is_mytishi_incident(inc: dict[str, Any], names: list[str]) -> bool:
    """True if locality/address/summary contains any settlement name from the list."""
    blob = " ".join(str(inc.get(k) or "") for k in ("locality", "address")).lower()
    if not blob.strip():
        return False
    return any(n and n in blob for n in names)


# ---------------------------------------------------------------------------
# Starosty chat classifier (DeepSeek mini-prompt)
# ---------------------------------------------------------------------------

CLASSIFIER_SYSTEM = (
    "Ты — классификатор сообщений из закрытого чата старост ЖК/деревень Городского "
    "округа Мытищи. Возвращаешь СТРОГО один JSON-объект без markdown."
)

CLASSIFIER_PROMPT = """\
Сообщение ниже получено от старосты. Определи, является ли оно обращением,
требующим реакции команды (жалоба / запрос / сообщение о проблеме).

Если это НЕ обращение (приветствие, благодарность, пустой чат, смайл, реклама,
флуд) — верни:
{"verdict": "noise", "reason": "<кратко>"}

Если это обращение — верни:
{
  "verdict": "appeal",
  "topic": "дороги|ЖКХ-вода|ЖКХ-тепло|ЖКХ-электро|мусор|благоустройство|освещение|транспорт|животные|безопасность|парки|школы|медицина|прочее",
  "address": "<нормализованный адрес: улица, дом. null если не упомянут>",
  "locality_hint": "<ЖК / деревня / мкр, если упомянут>",
  "summary": "<1-2 предложения от 3-го лица, деловым языком>",
  "priority": <1-10, где 10=ЧС, 8=серьёзная авария дома, 5=стандартная проблема, 3=запрос>,
  "urgency_markers": ["..."]
}

Только JSON. От старост все обращения важны — не занижай приоритет ниже 3.

# Автор: {author}
# Сообщение:
{text}
"""


async def classify_starosty(client: httpx.AsyncClient, text: str, author: str) -> dict[str, Any]:
    """Classify a starosty-chat message via DeepSeek-chat (was Grok-4 until 2026-05-12)."""
    if not DEEPSEEK_API_KEY:
        return {"verdict": "noise", "reason": "DEEPSEEK_API_KEY not set"}
    prompt = CLASSIFIER_PROMPT.format(author=author or "—", text=text[:2000])
    r = await client.post(
        DEEPSEEK_URL,
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": DEEPSEEK_MODEL,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=60.0,
    )
    if r.status_code >= 400:
        print(f"[max-bot] deepseek {r.status_code}: {r.text[:300]}")
        return {"verdict": "noise", "reason": f"deepseek-{r.status_code}"}
    data = r.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    try:
        return json.loads(content)
    except Exception as e:
        print(f"[max-bot] deepseek parse error: {e}; content={content[:200]}")
        return {"verdict": "noise", "reason": "parse-error"}


async def handle_message_created(client: httpx.AsyncClient, upd: dict[str, Any]):
    """Process a new message from a monitored MAX chat (currently: starost chat)."""
    if not MAX_STAROSTY_CHAT_ID:
        return
    msg = upd.get("message") or {}
    recipient = msg.get("recipient") or {}
    chat_id = recipient.get("chat_id") or recipient.get("user_id")
    if chat_id != MAX_STAROSTY_CHAT_ID:
        return

    body = msg.get("body") or {}
    mid = body.get("mid")
    text = (body.get("text") or "").strip()
    sender = msg.get("sender") or {}
    sender_uid = sender.get("user_id")
    sender_name = sender.get("name") or sender.get("first_name") or (f"id{sender_uid}" if sender_uid else "—")

    if not mid or not text:
        return
    if BOT_USER_ID and sender_uid == BOT_USER_ID:
        return
    if sender.get("is_bot"):
        return
    if len(text) < MIN_STAROSTY_LEN:
        return

    # Dedup by (chat_id, mid)
    existing = db.table("max_messages").select("id").eq("chat_id", chat_id).eq("mid", mid).limit(1).execute()
    if existing.data:
        return

    sent_ts = msg.get("timestamp")
    sent_at = datetime.fromtimestamp(sent_ts / 1000, tz=timezone.utc).isoformat() if sent_ts else datetime.now(tz=timezone.utc).isoformat()
    saved = db.table("max_messages").insert({
        "chat_id": chat_id,
        "mid": mid,
        "sender_user_id": sender_uid,
        "sender_name": sender_name,
        "text": text[:4000],
        "sent_at": sent_at,
        "raw_update": upd,
    }).execute()
    msg_row_id = saved.data[0]["id"] if saved.data else None

    verdict = await classify_starosty(client, text, sender_name)
    v = verdict.get("verdict")

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    if v != "appeal":
        db.table("max_messages").update({"processed_at": now_iso, "verdict": v or "noise"}).eq("id", msg_row_id).execute()
        print(f"[max-bot] starosty msg {mid} → noise ({verdict.get('reason', '')})")
        return

    topic = verdict.get("topic") or "прочее"
    priority = max(3, min(10, int(verdict.get("priority") or 5)))
    inc_row = db.table("octobot_incidents").insert({
        "topic": topic,
        "address": verdict.get("address"),
        "summary": (verdict.get("summary") or text[:500]),
        "priority": priority,
        "escalate_to": ("emergency" if priority >= 9 else "head" if priority >= 7 else "department" if priority >= 5 else "log_only"),
        "status": "new",
        "first_author": sender_name,
        "locality": verdict.get("locality_hint"),
        "urgency_markers": verdict.get("urgency_markers") or [],
        "source_chat_id": chat_id,
        "source_message_mid": mid,
        "source_platform": "max",
    }).execute()
    inc_id = inc_row.data[0]["id"] if inc_row.data else None

    db.table("max_messages").update({
        "processed_at": now_iso, "verdict": "new_incident", "incident_id": inc_id,
    }).eq("id", msg_row_id).execute()
    print(f"[max-bot] starosty → incident #{inc_id} (P{priority} {topic}) from {sender_name}")


async def forward_new_incidents(client: httpx.AsyncClient):
    """Find incidents without a max_tasks row and forward each.

    Rules:
      - For source_platform='tg': require priority>=MIN_PRIORITY AND locality matches Mytishi.
      - For source_platform='max': forward all (these already come from a Mytishi chat
        and were pre-classified as appeals by classify_starosty).
    """
    names = _mytishi_settlements()

    incidents = db.table("octobot_incidents") \
        .select("id, topic, address, summary, priority, locality, first_author, created_at, source_chat_id, source_message_id, source_message_mid, source_platform, in_mytishi, is_city, rural_override, geocoded_at, force_to_max") \
        .or_(f"priority.gte.{MIN_PRIORITY},source_platform.eq.max,force_to_max.eq.true") \
        .order("priority", desc=True).order("created_at", desc=True) \
        .limit(50).execute()

    if not incidents.data:
        return

    # Pull status per prior task so we can distinguish "already in MAX" (new/in_work)
    # from "terminated long ago" (skipped/done) — the latter can be reopened via
    # force_to_max, the former must be left alone.
    existing = db.table("max_tasks").select("id, incident_id, status") \
        .in_("incident_id", [i["id"] for i in incidents.data]).execute()
    prior_by_inc: dict[int, list[dict[str, Any]]] = {}
    for r in (existing.data or []):
        prior_by_inc.setdefault(r["incident_id"], []).append(r)

    chat_ids = {i.get("source_chat_id") for i in incidents.data if i.get("source_chat_id") and i.get("source_platform") == "tg"}
    chats_map: dict[int, str | None] = {}
    if chat_ids:
        chats_res = db.table("tg_chats").select("chat_id, username").in_("chat_id", list(chat_ids)).execute()
        chats_map = {c["chat_id"]: c.get("username") for c in (chats_res.data or [])}

    # Topics that bypass the "city vs rural" gate — user is responsible for these
    # even within the city proper.
    CITY_BYPASS_TOPICS = {"животные", "экология", "мусор", "парки"}
    ACTIVE_STATES = {"new", "in_work"}

    for inc in incidents.data:
        forced = bool(inc.get("force_to_max"))
        prior = prior_by_inc.get(inc["id"], [])
        has_active = any(r["status"] in ACTIVE_STATES for r in prior)
        if has_active:
            # Already in the team chat — don't re-send even when forced.
            continue
        if prior and not forced:
            # Terminal prior (skipped/done) and user didn't re-request → leave alone.
            continue
        if prior and forced:
            # Forced re-send: drop the terminal rows (CASCADE removes max_task_events).
            for r in prior:
                try:
                    db.table("max_tasks").delete().eq("id", r["id"]).execute()
                except Exception as e:
                    print(f"[max-bot] failed to drop old task #{r['id']} for inc #{inc['id']}: {e}")
            print(f"[max-bot] reopening forced incident #{inc['id']} (dropped {len(prior)} prior task row(s))")

        platform = inc.get("source_platform") or "tg"
        if platform == "tg" and not forced:
            # Wait for geocoder; never forward anything outside Mytishi.
            if inc.get("geocoded_at") is None:
                continue
            if inc.get("in_mytishi") is not True:
                continue
            # In-округ: skip anything that's in the city proper, unless either
            #   a) rural_override pattern matched (named ЖК on rural territory), or
            #   b) topic is in the city-bypass whitelist (ecology / stray animals).
            if inc.get("is_city") is True and not inc.get("rural_override"):
                if (inc.get("topic") or "").lower().strip() not in CITY_BYPASS_TOPICS:
                    continue

        deadline = datetime.now(tz=timezone.utc) + timedelta(days=DEADLINE_DAYS)
        row = db.table("max_tasks").insert({
            "incident_id": inc["id"],
            "max_chat_id": MAX_TEAM_CHAT_ID,
            "status": "new",
            "deadline_at": deadline.isoformat(),
        }).execute()
        if not row.data:
            continue
        task_id = row.data[0]["id"]

        tg_url = None
        if platform == "tg":
            tg_url = _tg_message_url(
                inc.get("source_chat_id"),
                inc.get("source_message_id"),
                chats_map.get(inc.get("source_chat_id") or 0),
            )
        text = _format_incident(inc, task_id, deadline, tg_url)
        kb = _inline_kb(task_id, "new")
        sent = await max_send_message(client, text, kb)
        mid = None
        if sent:
            mid = (sent.get("message", {}) or {}).get("body", {}).get("mid")

        db.table("max_tasks").update({"max_message_mid": mid}).eq("id", task_id).execute()
        _insert_event(task_id, None, None, "sent", {"mid": mid})
        print(f"[max-bot] Forwarded incident #{inc['id']} ({platform}) as task #{task_id} (mid={mid})")


async def handle_callback(client: httpx.AsyncClient, upd: dict[str, Any]):
    cb = upd.get("callback") or {}
    callback_id = cb.get("callback_id")
    payload = cb.get("payload") or ""
    # Some MAX updates put user at the top level, some nest it in callback.
    user = cb.get("user") or upd.get("user") or {}
    uid = user.get("user_id") or upd.get("user_id")
    uname = user.get("name") or user.get("first_name") or (f"id{uid}" if uid else "—")
    print(f"[max-bot] callback: payload={payload!r} user_id={uid} name={uname!r}")

    # Harvest clicker into the team roster so admins get a picker with real names.
    _upsert_member(uid, uname if uname != f"id{uid}" else None)

    if ":" not in payload:
        return
    # Payloads may have 2 parts (accept:<tid>, close:<tid>, skip:<tid>, cancel_assign:<tid>)
    # or 3 parts (assign:<tid>:<target_uid>). Parse uniformly.
    parts = payload.split(":")
    action = parts[0]
    try:
        task_id = int(parts[1])
    except (IndexError, ValueError):
        return
    target_uid: int | None = None
    if action == "assign" and len(parts) >= 3:
        try:
            target_uid = int(parts[2])
        except ValueError:
            target_uid = None

    task, inc = _fetch_task_with_incident(task_id)
    if not task or not inc:
        await max_answer_callback(client, callback_id, "Задача не найдена или удалена", None, [])
        return

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    cur_status = task["status"]

    if action == "accept":
        if cur_status != "new":
            await max_answer_callback(client, callback_id,
                f"Уже {cur_status}. Принял: {task.get('assignee_display_name') or '—'}", None, [])
            return
        # Admin branch: open an assignee picker instead of self-assigning.
        if _is_admin(uid):
            members = [m for m in _fetch_active_members() if m.get("user_id") != BOT_USER_ID]
            if members:
                await max_answer_callback(
                    client, callback_id, "Выберите исполнителя",
                    _rebuild_message_text(inc, task), _assign_picker_kb(task_id, members),
                )
                print(f"[max-bot] Task #{task_id} picker opened by admin {uname} ({len(members)} members)")
                return
            # Fall through to self-assign if roster is empty — don't block the admin.
        upd_row = {"status": "in_work", "assignee_max_user_id": uid, "assignee_display_name": uname, "accepted_at": now_iso}
        db.table("max_tasks").update(upd_row).eq("id", task_id).execute()
        task.update(upd_row)
        _insert_event(task_id, uid, uname, "accepted")
        new_text = _rebuild_message_text(inc, task)
        await max_answer_callback(client, callback_id, "Принято в работу", new_text, _inline_kb(task_id, "in_work"))
        print(f"[max-bot] Task #{task_id} accepted by {uname} (user_id={uid})")
        return

    if action == "assign":
        # Admin-only: assign to a specific roster member.
        if not _is_admin(uid):
            await max_answer_callback(client, callback_id, "Только для администратора", None, [])
            return
        if cur_status != "new":
            await max_answer_callback(client, callback_id,
                f"Уже {cur_status}. Принял: {task.get('assignee_display_name') or '—'}", None, [])
            return
        if not target_uid:
            await max_answer_callback(client, callback_id, "Неверный payload assign", None, [])
            return
        tgt = db.table("max_team_members").select("display_name").eq("user_id", target_uid).limit(1).execute()
        tgt_name = (tgt.data[0].get("display_name") if tgt.data else None) or f"id{target_uid}"
        upd_row = {
            "status": "in_work",
            "assignee_max_user_id": target_uid,
            "assignee_display_name": tgt_name,
            "accepted_at": now_iso,
        }
        db.table("max_tasks").update(upd_row).eq("id", task_id).execute()
        task.update(upd_row)
        _insert_event(task_id, uid, uname, "assigned", {"target_user_id": target_uid, "target_name": tgt_name})
        new_text = _rebuild_message_text(inc, task)
        await max_answer_callback(
            client, callback_id, f"Назначено: {tgt_name}", new_text, _inline_kb(task_id, "in_work"),
        )

        # Notify assignee — team chat post + best-effort DM.
        topic = inc.get("topic") or "—"
        locality = inc.get("locality") or inc.get("address") or "—"
        deadline_txt = datetime.fromisoformat(task["deadline_at"].replace("Z", "+00:00")) \
            .astimezone().strftime("%d.%m %H:%M")
        notify_text = (
            f"🔔 *{tgt_name}*, тебе назначен инцидент #{inc['id']}\n"
            f"🏷 {topic}\n"
            f"📍 {locality}\n"
            f"⏰ до {deadline_txt}\n"
            f"Назначил: {uname}"
        )
        try:
            await max_send_message(client, notify_text, [])
        except Exception as e:
            print(f"[max-bot] assign notify (team) error: {type(e).__name__}: {e}")
        await max_send_dm(client, target_uid, notify_text)

        print(f"[max-bot] Task #{task_id} assigned by admin {uname} → {tgt_name} ({target_uid})")
        return

    if action == "cancel_assign":
        # Close the picker — restore the original «new» keyboard.
        if cur_status != "new":
            await max_answer_callback(client, callback_id, f"Уже {cur_status}", None, [])
            return
        new_text = _rebuild_message_text(inc, task)
        await max_answer_callback(client, callback_id, "Отменено", new_text, _inline_kb(task_id, "new"))
        return

    if action == "close":
        if cur_status not in ("new", "in_work"):
            await max_answer_callback(client, callback_id, f"Уже {cur_status}", None, [])
            return
        upd_row = {"status": "done", "closed_at": now_iso,
                   "closed_by_max_user_id": uid, "closed_by_display_name": uname}
        db.table("max_tasks").update(upd_row).eq("id", task_id).execute()
        task.update(upd_row)
        _insert_event(task_id, uid, uname, "closed")
        new_text = _rebuild_message_text(inc, task)
        await max_answer_callback(client, callback_id, "Закрыто", new_text, [])
        print(f"[max-bot] Task #{task_id} closed by {uname}")
        return

    if action == "skip":
        if cur_status != "new":
            await max_answer_callback(client, callback_id, f"Уже {cur_status}", None, [])
            return
        # Acknowledge click (MAX expects a reply within a few seconds).
        await max_answer_callback(client, callback_id, f"Пропущено ({uname})", None, [])
        mid = task.get("max_message_mid")
        if mid:
            await max_delete_message(client, mid)
        # Tombstone: keep the row so the incident is NOT re-forwarded, but drop the mid
        # (message is gone from chat) and mark as skipped for audit.
        db.table("max_tasks").update({
            "status": "skipped",
            "max_message_mid": None,
            "closed_at": now_iso,
            "closed_by_max_user_id": uid,
            "closed_by_display_name": uname,
        }).eq("id", task_id).execute()
        _insert_event(task_id, uid, uname, "skipped")
        print(f"[max-bot] Task #{task_id} skipped (message deleted) by {uname}")


def _state_get(key: str) -> dict[str, Any] | None:
    res = db.table("max_bot_state").select("value").eq("key", key).limit(1).execute()
    return (res.data[0]["value"] if res.data else None)


def _state_set(key: str, value: dict[str, Any]):
    db.table("max_bot_state").upsert({
        "key": key, "value": value, "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }, on_conflict="key").execute()


async def send_digest(client: httpx.AsyncClient):
    now = datetime.now(tz=timezone.utc)
    day_ahead = (now + timedelta(days=1)).isoformat()

    new_tasks = db.table("max_tasks") \
        .select("id, incident_id, deadline_at, sent_at, max_message_mid") \
        .eq("status", "new").order("sent_at", desc=False).limit(30).execute().data or []

    near_deadline = db.table("max_tasks") \
        .select("id, incident_id, assignee_display_name, deadline_at") \
        .eq("status", "in_work").lte("deadline_at", day_ahead) \
        .order("deadline_at", desc=False).limit(30).execute().data or []

    # Always try to clean up the previous digest from the chat, regardless of
    # whether we're about to send a new one — stale digests shouldn't linger.
    prev = _state_get("last_digest")
    prev_mid = (prev or {}).get("mid")
    if prev_mid:
        await max_delete_message(client, prev_mid)
        _state_set("last_digest", {"mid": None, "at": now.isoformat()})

    if not new_tasks and not near_deadline:
        print("[max-bot] digest: nothing to report (previous digest cleared)")
        return

    lines: list[str] = ["📋 *Сводка по задачам*"]

    if new_tasks:
        lines.append("")
        lines.append(f"*Не взяты в работу ({len(new_tasks)}):*")
        inc_ids = [t["incident_id"] for t in new_tasks]
        incs = db.table("octobot_incidents").select("id, topic, locality, priority").in_("id", inc_ids).execute().data or []
        inc_map = {i["id"]: i for i in incs}
        for t in new_tasks:
            i = inc_map.get(t["incident_id"], {})
            topic = i.get("topic", "?")
            loc = i.get("locality") or "—"
            prio = i.get("priority", "?")
            deadline = datetime.fromisoformat(t["deadline_at"].replace("Z", "+00:00"))
            hours_left = int((deadline - now).total_seconds() // 3600)
            lines.append(f"• #{t['incident_id']} · P{prio} · {topic} · {loc} · осталось ~{hours_left}ч")

    if near_deadline:
        lines.append("")
        lines.append(f"*До дедлайна <24ч ({len(near_deadline)}):*")
        inc_ids = [t["incident_id"] for t in near_deadline]
        incs = db.table("octobot_incidents").select("id, topic, locality").in_("id", inc_ids).execute().data or []
        inc_map = {i["id"]: i for i in incs}
        for t in near_deadline:
            i = inc_map.get(t["incident_id"], {})
            topic = i.get("topic", "?")
            loc = i.get("locality") or "—"
            who = t.get("assignee_display_name") or "—"
            deadline = datetime.fromisoformat(t["deadline_at"].replace("Z", "+00:00"))
            hours_left = int((deadline - now).total_seconds() // 3600)
            lines.append(f"• #{t['incident_id']} · {topic} · {loc} · {who} · {hours_left}ч")

    text = "\n".join(lines)
    sent = await max_send_message(client, text, [])
    new_mid = ((sent or {}).get("message", {}) or {}).get("body", {}).get("mid")
    _state_set("last_digest", {"mid": new_mid, "at": now.isoformat()})

    flag_ids = [t["id"] for t in new_tasks] + [t["id"] for t in near_deadline]
    if flag_ids:
        db.table("max_tasks").update({"last_digest_flagged_at": now.isoformat()}).in_("id", flag_ids).execute()
    print(f"[max-bot] digest sent ({len(new_tasks)} new, {len(near_deadline)} near-deadline, mid={new_mid})")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

async def main():
    print("=" * 50)
    print("  MAX Team Bot — Octobot → MAX forwarder")
    print("=" * 50)
    print(f"[max-bot] team chat: {MAX_TEAM_CHAT_ID}, min priority: {MIN_PRIORITY}, deadline: {DEADLINE_DAYS}d, digest: {DIGEST_INTERVAL}s")
    print(f"[max-bot] admins from env: {sorted(MAX_ADMIN_USER_IDS) or 'none (assignment picker disabled until set)'}")
    _bootstrap_admins()

    roster_refresh_interval = int(os.getenv("ROSTER_REFRESH_INTERVAL", "3600"))

    async with httpx.AsyncClient() as client:
        # Prime the roster once at startup so «В работу» picker is populated immediately.
        await refresh_team_roster(client)

        marker: int | None = None
        loop = asyncio.get_event_loop()
        last_incident_poll = 0.0
        # Don't fire digest on startup — wait a full interval
        last_digest = loop.time()
        last_roster_refresh = loop.time()

        while True:
            # Incident polling
            now_s = loop.time()
            if now_s - last_incident_poll >= POLL_INCIDENTS_INTERVAL:
                last_incident_poll = now_s
                try:
                    await forward_new_incidents(client)
                except Exception as e:
                    print(f"[max-bot] forward error: {type(e).__name__}: {e}")

            # Digest
            if now_s - last_digest >= DIGEST_INTERVAL:
                last_digest = now_s
                try:
                    await send_digest(client)
                except Exception as e:
                    print(f"[max-bot] digest error: {type(e).__name__}: {e}")

            # Periodic roster refresh so new joiners show up in the picker.
            if now_s - last_roster_refresh >= roster_refresh_interval:
                last_roster_refresh = now_s
                await refresh_team_roster(client)

            # Long-poll MAX updates (returns within 60s)
            try:
                res = await fetch_updates(client, marker)
                marker = res.get("marker") or marker
                for upd in res.get("updates", []):
                    ut = upd.get("update_type")
                    # DEBUG: log every update's type + chat to diagnose privacy-mode.
                    try:
                        msg = upd.get("message") or {}
                        cid = ((msg.get("recipient") or {}).get("chat_id")
                               or (msg.get("recipient") or {}).get("user_id"))
                        txt = ((msg.get("body") or {}).get("text") or "")[:60]
                        print(f"[max-bot] update: type={ut} chat={cid} text={txt!r}")
                    except Exception:
                        pass
                    if ut == "message_callback":
                        try:
                            await handle_callback(client, upd)
                        except Exception as e:
                            print(f"[max-bot] callback error: {type(e).__name__}: {e}")
                    elif ut == "message_created":
                        try:
                            await handle_message_created(client, upd)
                        except Exception as e:
                            print(f"[max-bot] message_created error: {type(e).__name__}: {e}")
            except httpx.TimeoutException:
                pass
            except Exception as e:
                print(f"[max-bot] updates error: {type(e).__name__}: {e}")
                await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
