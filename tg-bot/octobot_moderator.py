"""Octobot: auto-moderator for city chats.

Pipeline for each inbound message:
  1. Trivial pre-filter (length, smileys, '+1').
  2. OpenAI text-embedding-3-small → vector(1536).
  3. pgvector search: top-k open incidents within window.
  4. If sim >= THRESHOLD_DUPLICATE → register confirmation (no LLM call).
  5. If sim in [CANDIDATE, DUPLICATE) → Grok disambiguates (match vs new).
  6. Else → Grok classifies with empty open_incidents.
     - noise  → log, skip
     - match  → register confirmation
     - new_incident → INSERT, embed normalized string, escalate if needed

Spec: /01 - PROJECTS/Авто-модератор чатов/Авто-модератор чатов — спецификация.md
"""
import asyncio
import json
import os
import re
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

import db

# ==============================================================================
# Configuration (all tunable via env or Supabase app_settings later)
# ==============================================================================

THRESHOLD_DUPLICATE = float(os.getenv("OCTOBOT_THRESHOLD_DUPLICATE", "0.88"))
THRESHOLD_CANDIDATE = float(os.getenv("OCTOBOT_THRESHOLD_CANDIDATE", "0.72"))
OPEN_WINDOW_DAYS    = int(os.getenv("OCTOBOT_OPEN_WINDOW_DAYS", "7"))
MIN_TEXT_LEN        = int(os.getenv("OCTOBOT_MIN_TEXT_LEN", "10"))

EMBED_MODEL         = os.getenv("OCTOBOT_EMBED_MODEL", "text-embedding-3-small")
GROK_MODEL          = os.getenv("OCTOBOT_GROK_MODEL", "grok-4")  # fallback: grok-beta
OPENAI_API_KEY      = os.getenv("OPENAI_API_KEY", "")
XAI_API_KEY         = os.getenv("XAI_API_KEY", "")

OPENAI_URL          = "https://api.openai.com/v1/embeddings"
XAI_URL             = "https://api.x.ai/v1/chat/completions"

TRIVIAL_PATTERNS = re.compile(
    r"^\s*(\+\d*|ok|ок|da|да|no|нет|\W+|[а-яa-z]{1,3})\s*$",
    re.IGNORECASE,
)


# ==============================================================================
# Grok classification prompt (from spec section 6)
# ==============================================================================

GROK_SYSTEM = (
    "Ты — классификатор сообщений из городского чата. Возвращаешь строго один "
    "JSON-объект без markdown. Никаких обёрток, комментариев или пояснений."
)

GROK_PROMPT_TEMPLATE = """\
# РОЛЬ
Классифицируешь ОДНО сообщение из городского чата и решаешь, описывает ли оно
новую проблему или повторяет одну из уже известных.

# ЛОГИКА
1. Категория: complaint | request | suggestion | gratitude | discussion | spam | flood | toxic.
   Если НЕ complaint/request/suggestion → verdict="noise".
2. Для complaint/request/suggestion извлечь:
   topic: дороги | ЖКХ-вода | ЖКХ-тепло | ЖКХ-электро | мусор | благоустройство |
          освещение | транспорт | животные | безопасность | парки | школы |
          медицина | прочее
   address: нормализованный адрес (улица + дом) или null
   urgency_markers: список явных маркеров срочности
   affected_scale: "один житель" | "подъезд/дом" | "квартал" | "район"
3. Сопоставление с open_incidents.
   match если: (a) topic совпадает ТОЧНО И (b) адрес совпадает (тот же дом) И
   (c) суть совпадает по смыслу.
   Если match → verdict="match", верни incident_id самого свежего подходящего.
4. Приоритет 1-10 только для new_incident:
   10 ЧС · 9 массовая авария · 8 авария дома · 7 сбой >24ч · 6 локальная ·
   5 стандартная ЖКХ · 4 мелкая · 3 запрос · 2 предложение · 1 благодарность.
   +1 если угроза детям/пожилым/инвалидам ИЛИ массовость.
5. escalate_to: emergency (9-10) | head (7-8) | department (5-6) | log_only (1-4).

# ФОРМАТ ОТВЕТА
Строго один JSON-объект, без markdown:

Шум:
{{"verdict": "noise", "category": "spam|flood|toxic|discussion|gratitude", "reason": "<кратко>"}}

Повтор:
{{"verdict": "match", "incident_id": <id>, "match_confidence": 0.0-1.0, "match_reason": "<почему>"}}

Новый инцидент:
{{"verdict": "new_incident", "category": "complaint|request|suggestion",
  "topic": "<из списка>", "address": "<или null>",
  "urgency_markers": ["..."], "affected_scale": "<или null>",
  "priority": <1-10>, "escalate_to": "emergency|head|department|log_only",
  "summary": "<1 предложение от 3-го лица, деловым языком>",
  "confidence": 0.0-1.0}}

# ПРАВИЛА
- Только JSON. Никаких обёрток.
- При сомнении между match и new_incident → match, если match_confidence >= 0.75.
- Нормализуй адрес: "Силикатная 25" / "ул. Силикатная, д. 25" → "ул. Силикатная, 25".
- Не выдумывай адрес. Нет в тексте — null.

# ВХОД
{input_json}
"""


# ==============================================================================
# Data structures
# ==============================================================================

@dataclass
class IncomingMessage:
    chat_id: int
    message_id: int
    text: str
    author: str | None = None
    author_tg_id: int | None = None
    reply_to_id: int | None = None
    sent_at: datetime | None = None
    source: str = "telegram"


@dataclass
class Similar:
    id: int
    topic: str
    address: str | None
    summary: str
    priority: int
    status: str
    created_at: str
    confirmations_count: int
    sim: float


# ==============================================================================
# API clients (thin wrappers, module-level reusable httpx client)
# ==============================================================================

_http: httpx.AsyncClient | None = None
_http_slow: httpx.AsyncClient | None = None

def _get_http() -> httpx.AsyncClient:
    """Default client — fast timeout, for OpenAI embeddings."""
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    return _http


def _get_http_slow() -> httpx.AsyncClient:
    """Longer-timeout client for Grok classification calls (can take 30-60s)."""
    global _http_slow
    if _http_slow is None:
        _http_slow = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0))
    return _http_slow


async def _retry_post(client: httpx.AsyncClient, url: str, *, headers: dict, json_body: dict,
                       max_attempts: int = 3, label: str = "http") -> httpx.Response:
    """Post with retries on timeout or 5xx, exponential backoff."""
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            r = await client.post(url, headers=headers, json=json_body)
            if r.status_code < 500:
                return r
            # 5xx → retry
            last_exc = RuntimeError(f"{label} {r.status_code}: {r.text[:160]}")
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError) as e:
            last_exc = e
        if attempt < max_attempts:
            delay = 1.5 ** attempt
            print(f"[octobot] {label} attempt {attempt} failed ({type(last_exc).__name__}); retrying in {delay:.1f}s")
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc


async def openai_embed(text: str) -> list[float]:
    """Return a vector(1536) embedding for the given text."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not set")
    r = await _retry_post(
        _get_http(),
        OPENAI_URL,
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
        json_body={"model": EMBED_MODEL, "input": text[:8000]},
        label="openai-embed",
    )
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]


async def grok_classify(msg: IncomingMessage, open_incidents: list[Similar]) -> dict[str, Any]:
    """Call Grok with the classifier prompt. Returns the parsed JSON verdict."""
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY not set")
    input_payload = {
        "message": {
            "id": str(msg.message_id),
            "author": msg.author or "unknown",
            "timestamp": (msg.sent_at or datetime.now(timezone.utc)).isoformat(),
            "text": msg.text,
            "reply_to": str(msg.reply_to_id) if msg.reply_to_id else None,
        },
        "open_incidents": [
            {
                "incident_id": str(i.id),
                "topic": i.topic,
                "address": i.address,
                "summary": i.summary,
                "first_seen": i.created_at,
                "confirmations_count": i.confirmations_count,
                "status": i.status,
            }
            for i in open_incidents
        ],
    }
    prompt = GROK_PROMPT_TEMPLATE.format(input_json=json.dumps(input_payload, ensure_ascii=False, indent=2))

    r = await _retry_post(
        _get_http_slow(),
        XAI_URL,
        headers={"Authorization": f"Bearer {XAI_API_KEY}", "Content-Type": "application/json"},
        json_body={
            "model": GROK_MODEL,
            "messages": [
                {"role": "system", "content": GROK_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        },
        label="grok",
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    # Tolerate occasional stray markdown fences
    content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


# ==============================================================================
# Supabase helpers (built on existing db.get_client())
# ==============================================================================

def _db():
    return db.get_client()


def find_similar_sync(embedding: list[float], top_k: int = 3, window_days: int = OPEN_WINDOW_DAYS) -> list[Similar]:
    res = _db().rpc(
        "octobot_find_similar",
        {"query_embedding": embedding, "top_k": top_k, "window_days": window_days},
    ).execute()
    return [Similar(**row) for row in (res.data or [])]


def log_message_sync(msg: IncomingMessage, verdict: str, incident_id: int | None = None,
                     category: str | None = None, cost_usd: float = 0.0) -> None:
    _db().table("octobot_messages").upsert({
        "source": msg.source,
        "chat_id": msg.chat_id,
        "message_id": msg.message_id,
        "author": msg.author,
        "author_tg_id": msg.author_tg_id,
        "text": (msg.text or "")[:4000],
        "reply_to_id": msg.reply_to_id,
        "verdict": verdict,
        "incident_id": incident_id,
        "category": category,
        "processing_cost_usd": round(cost_usd, 6),
        "embedding_model": EMBED_MODEL,
        "classifier_model": GROK_MODEL,
        "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
    }, on_conflict="source,chat_id,message_id").execute()


def add_confirmation_sync(incident_id: int, msg: IncomingMessage, similarity: float, matched_by: str) -> None:
    try:
        _db().table("octobot_confirmations").insert({
            "incident_id": incident_id,
            "source_chat_id": msg.chat_id,
            "source_message_id": msg.message_id,
            "author": msg.author,
            "author_tg_id": msg.author_tg_id,
            "message_text": (msg.text or "")[:2000],
            "similarity": round(similarity, 4),
            "matched_by": matched_by,
        }).execute()
    except Exception as e:
        # UNIQUE(incident_id, author) — same author confirming again is not an error
        if "duplicate key" not in str(e).lower():
            raise


def insert_incident_sync(result: dict[str, Any], embedding: list[float], embedding_text: str, msg: IncomingMessage) -> int:
    res = _db().table("octobot_incidents").insert({
        "topic": result["topic"],
        "address": result.get("address"),
        "summary": result["summary"],
        "priority": int(result["priority"]),
        "escalate_to": result["escalate_to"],
        "status": "open",
        "embedding_text": embedding_text,
        "embedding": embedding,
        "source_chat_id": msg.chat_id,
        "source_message_id": msg.message_id,
        "first_author": msg.author,
        "affected_scale": result.get("affected_scale"),
        "urgency_markers": result.get("urgency_markers"),
    }).execute()
    return int(res.data[0]["id"]) if res.data else 0


# ==============================================================================
# Pipeline entrypoint
# ==============================================================================

def is_trivial(text: str) -> bool:
    if not text:
        return True
    stripped = text.strip()
    if len(stripped) < MIN_TEXT_LEN:
        return True
    if TRIVIAL_PATTERNS.match(stripped):
        return True
    return False


async def process_message(msg: IncomingMessage) -> str:
    """Process one inbound chat message through the moderator pipeline.

    Returns the verdict string: 'noise' | 'match' | 'new_incident' | 'error' | 'skipped'.
    Idempotent per (source, chat_id, message_id) via UPSERT on octobot_messages.
    """
    if is_trivial(msg.text):
        await asyncio.to_thread(log_message_sync, msg, "noise", None, "trivial", 0.0)
        return "noise"

    try:
        # 1. Embed inbound message
        embedding = await openai_embed(msg.text)
        cost_embed = 0.00002  # text-embedding-3-small ~ $0.02 per 1M tokens

        # 2. Top-k similar open incidents
        similar = await asyncio.to_thread(find_similar_sync, embedding, 3, OPEN_WINDOW_DAYS)
        top = similar[0] if similar else None

        # 3. Confident duplicate → register and return
        if top and top.sim >= THRESHOLD_DUPLICATE:
            await asyncio.to_thread(add_confirmation_sync, top.id, msg, top.sim, "embedding")
            await asyncio.to_thread(log_message_sync, msg, "match", top.id, None, cost_embed)
            return "match"

        # 4. Gray zone → Grok disambiguates
        if top and top.sim >= THRESHOLD_CANDIDATE:
            verdict = await grok_classify(msg, similar)
            cost_grok = 0.0005  # rough estimate per call
            if verdict.get("verdict") == "match":
                inc_id = int(verdict.get("incident_id", top.id))
                conf = float(verdict.get("match_confidence", top.sim))
                await asyncio.to_thread(add_confirmation_sync, inc_id, msg, conf, "grok")
                await asyncio.to_thread(log_message_sync, msg, "match", inc_id, None, cost_embed + cost_grok)
                return "match"
            # fall through to new-incident path with the gray-zone classification

        # 5. Grok classifies as new_incident or noise (no open-incidents context)
        if not top or top.sim < THRESHOLD_CANDIDATE:
            verdict = await grok_classify(msg, [])
            cost_grok = 0.0005
        cost = cost_embed + cost_grok

        if verdict.get("verdict") == "noise":
            category = verdict.get("category")
            await asyncio.to_thread(log_message_sync, msg, "noise", None, category, cost)
            return "noise"

        if verdict.get("verdict") != "new_incident":
            await asyncio.to_thread(log_message_sync, msg, "error", None, "unexpected_verdict", cost)
            return "error"

        # 6. New incident: embed normalized text and insert
        normalized = f"{verdict['topic']} | {verdict.get('address') or 'без адреса'} | {verdict['summary']}"
        inc_embedding = await openai_embed(normalized)
        cost += cost_embed

        inc_id = await asyncio.to_thread(insert_incident_sync, verdict, inc_embedding, normalized, msg)
        await asyncio.to_thread(log_message_sync, msg, "new_incident", inc_id, verdict.get("category"), cost)

        print(f"[octobot] NEW incident {inc_id}: {verdict['topic']} · "
              f"{verdict.get('address', '—')} · priority {verdict['priority']} · {verdict['escalate_to']}")
        return "new_incident"

    except Exception as e:
        traceback.print_exc()
        try:
            await asyncio.to_thread(log_message_sync, msg, "error", None, type(e).__name__, 0.0)
        except Exception:
            pass
        return "error"


# ==============================================================================
# Catch-up sweep: process any messages from tg_messages that octobot didn't see
# (e.g. bot restarts, new rollout, missed events)
# ==============================================================================

async def catchup(limit: int = 100) -> int:
    """Process unseen messages from tg_messages. Returns count processed."""
    try:
        # join to find messages not yet in octobot_messages
        query = f"""
            SELECT m.chat_id, m.message_id, m.text, m.sender_name, m.date, m.reply_to_id
            FROM tg_messages m
            LEFT JOIN octobot_messages o
              ON o.source = 'telegram' AND o.chat_id = m.chat_id AND o.message_id = m.message_id
            WHERE o.id IS NULL
              AND m.text IS NOT NULL
              AND length(m.text) >= {MIN_TEXT_LEN}
            ORDER BY m.date DESC
            LIMIT {limit}
        """
        # supabase-py doesn't do raw SQL from client; use REST via rpc placeholder
        # fallback: pull recent messages and filter in Python
        recent = _db().table("tg_messages").select(
            "chat_id, message_id, text, sender_name, date, reply_to_id"
        ).order("date", desc=True).limit(limit).execute().data or []

        seen = _db().table("octobot_messages").select(
            "chat_id, message_id"
        ).order("processed_at", desc=True).limit(limit * 2).execute().data or []
        seen_set = {(s["chat_id"], s["message_id"]) for s in seen}

        unseen = [m for m in recent if (m["chat_id"], m["message_id"]) not in seen_set]

        processed = 0
        for m in unseen:
            if not m.get("text") or len(m["text"]) < MIN_TEXT_LEN:
                continue
            try:
                sent_at = datetime.fromisoformat(m["date"].replace("Z", "+00:00")) if m.get("date") else None
            except Exception:
                sent_at = None
            inc = IncomingMessage(
                chat_id=int(m["chat_id"]),
                message_id=int(m["message_id"]),
                text=m["text"],
                author=m.get("sender_name"),
                reply_to_id=int(m["reply_to_id"]) if m.get("reply_to_id") else None,
                sent_at=sent_at,
                source="telegram",
            )
            await process_message(inc)
            processed += 1
        return processed
    except Exception as e:
        print(f"[octobot] catchup error: {e}")
        return 0
