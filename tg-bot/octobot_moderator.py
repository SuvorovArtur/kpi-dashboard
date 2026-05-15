"""Octobot: auto-moderator for city chats.

Pipeline for each inbound message:
  1. Trivial pre-filter (length, smileys, '+1').
  2. OpenAI text-embedding-3-small → vector(1536).
  3. pgvector search: top-k open incidents within window.
  4. If sim >= THRESHOLD_DUPLICATE → register confirmation (no LLM call).
  5. If sim in [CANDIDATE, DUPLICATE) → classifier disambiguates (match vs new).
  6. Else → classifier classifies with empty open_incidents.
     - noise  → log, skip
     - match  → register confirmation
     - new_incident → INSERT, embed normalized string, escalate if needed

Spec: /01 - PROJECTS/Авто-модератор чатов/Авто-модератор чатов — спецификация.md
"""
import asyncio
import hashlib
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
THRESHOLD_CANDIDATE = float(os.getenv("OCTOBOT_THRESHOLD_CANDIDATE", "0.62"))
# Post-verdict dedup: normalized(new)↔normalized(existing) check just before INSERT.
# Catches duplicates that slipped through the raw↔normalized first pass.
THRESHOLD_POSTCHECK = float(os.getenv("OCTOBOT_THRESHOLD_POSTCHECK", "0.82"))
OPEN_WINDOW_DAYS    = int(os.getenv("OCTOBOT_OPEN_WINDOW_DAYS", "7"))
MIN_TEXT_LEN        = int(os.getenv("OCTOBOT_MIN_TEXT_LEN", "10"))

EMBED_MODEL         = os.getenv("OCTOBOT_EMBED_MODEL", "text-embedding-3-small")
DEEPSEEK_MODEL      = os.getenv("OCTOBOT_DEEPSEEK_MODEL", "deepseek-chat")
OPENAI_API_KEY      = os.getenv("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY    = os.getenv("DEEPSEEK_API_KEY", "")

# Triage mode: shadow → log only; active → skip full classify when triage
# says noise with high confidence. Default active (calibrated 2026-05-12).
TRIAGE_MODE         = os.getenv("OCTOBOT_TRIAGE_MODE", "active")  # shadow | active | off
TRIAGE_NOISE_CONF   = float(os.getenv("OCTOBOT_TRIAGE_NOISE_CONF", "0.85"))
TRIAGE_QA_SAMPLE    = float(os.getenv("OCTOBOT_TRIAGE_QA_SAMPLE", "0.05"))  # 5% to classify in active

OPENAI_URL          = "https://api.openai.com/v1/embeddings"
DEEPSEEK_URL        = "https://api.deepseek.com/chat/completions"

TRIVIAL_PATTERNS = re.compile(
    r"^\s*(\+\d*|ok|ок|da|да|no|нет|\W+|[а-яa-z]{1,3})\s*$",
    re.IGNORECASE,
)

# ------------------------------------------------------------------
# T0 regex pre-filter — kills obvious noise before any LLM/embed call.
# Logs verdict="noise"/category="prefilter". Bypassed when an emergency
# keyword appears in the text — better waste a classifier call than miss a fire.
# ------------------------------------------------------------------

EMERGENCY_RE = re.compile(
    r"\b(пожар\w*|гори[тм]|горел[аи]?|дым\w*|задымлен\w*|"
    r"потоп\w*|затопил\w*|затопля\w*|залива\w*|залил\w*|прорыв\w*|"
    r"газ|газа|газом|газе|утечк\w*|"
    r"разбой\w*|нападени\w*|грабеж\w*|ограбил\w*|напал[аи]?|"
    r"труп\w*|тел[оа]|погиб\w*|мерт\w*|убит\w*|"
    r"помогите|спасите|скорую|скорая|"
    r"авари\w*|дтп|"
    r"избил\w*|избива\w*|стрел\w+|"
    r"кров[ьи]|"
    r"света\s+нет\w*|без\s+света|"
    r"воды\s+нет\w*|без\s+воды|"
    r"тепла\s+нет\w*|без\s+тепла)\b",
    re.IGNORECASE | re.UNICODE,
)

URL_ONLY_RE = re.compile(r"^\s*(https?://\S+\s*)+$", re.IGNORECASE)
ONLY_NONWORD_RE = re.compile(r"^[\W\s_]+$", re.UNICODE)  # emoji + punct only
MENTION_ONLY_RE = re.compile(r"^\s*@\w+(\s+@\w+)*\s*$")
DIGITS_ONLY_RE = re.compile(r"^[\d\s\.\,\-\+\(\)]+$")

GREETING_RE = re.compile(
    r"^(привет(ствую|ики)?!*|здравствуйте?|здарова|здаров|"
    r"добр(ый|ое)\s+(день|вечер|утро)|с\s+добрым\s+утром|"
    r"hello|hi|hey|good\s+(morning|day|evening|night))"
    r"[\s!\.\,\?\)\(\]]*$",
    re.IGNORECASE | re.UNICODE,
)
THANKS_RE = re.compile(
    r"^(больш(ое|ущее)\s+|огромн(ое|ейшее)\s+)?"
    r"(спасибо\w*|спасибки|благодарю|благодарность|"
    r"пасиб[оа]?|пасиба|спс|сёнкс|сенкс|"
    r"thanks?|thx|ty)"
    r"(\s+(больш(ое|ущее)|огромн(ое|ейшее)|вам|всем|тебе|пребольшое|"
    r"сердечное|за\s+\w+))*"
    r"\W*$",
    re.IGNORECASE | re.UNICODE,
)
ACK_RE = re.compile(
    r"^(ок|окей|ok|okay|good|"
    r"хорошо|ладно|пон+ятно|ясно|"
    r"да|нет|yes|no|yeah|yep|nope|"
    r"норм|нормально|"
    r"плюс|минус|"
    r"\+1?|\-1?)"
    r"[\s!\.\,\?\)\(\]]*$",
    re.IGNORECASE | re.UNICODE,
)

PREFILTER_SHORT_THRESHOLD = 30  # chars; longer = inspect more cautiously


def is_obvious_noise(text: str) -> bool:
    """Pure-regex pre-filter: True if text is clearly conversational noise.

    Emergency keywords (fire/flood/gas/etc) always bypass — better to spend
    a classifier call on a false positive than to silently drop an actual incident.
    """
    if not text:
        return False
    s = text.strip()
    if not s:
        return False
    if EMERGENCY_RE.search(s):
        return False
    # Always-noise (regardless of length): URL-only, mention-only, only-emoji/punct,
    # only-digits — these never describe a city issue on their own.
    if URL_ONLY_RE.match(s):
        return True
    if MENTION_ONLY_RE.match(s):
        return True
    if ONLY_NONWORD_RE.match(s):
        return True
    if DIGITS_ONLY_RE.match(s):
        return True
    # Short conversational filler — only kill if the entire message is a
    # greeting / thanks / acknowledgment.
    if len(s) < PREFILTER_SHORT_THRESHOLD:
        if GREETING_RE.match(s) or THANKS_RE.match(s) or ACK_RE.match(s):
            return True
    return False

# Topic families: one infrastructure failure (boiler/grid outage) surfaces as
# multiple symptom topics — heat, water, electricity. For locality-level dedup
# we treat them as one group so the outage is represented by a single incident,
# not three parallel ones.
TOPIC_FAMILIES: dict[str, str] = {
    "ЖКХ-тепло":   "ЖКХ",
    "ЖКХ-вода":    "ЖКХ",
    "ЖКХ-электро": "ЖКХ",
}


def topic_family_members(topic: str) -> list[str]:
    """Return all topics that share a family with `topic` (including itself).
    For topics without a family, returns just [topic]."""
    fam = TOPIC_FAMILIES.get(topic)
    if not fam:
        return [topic]
    return sorted(t for t, f in TOPIC_FAMILIES.items() if f == fam)


# ==============================================================================
# Classifier prompt (from spec section 6). Driven by DeepSeek-chat.
# ==============================================================================

CLASSIFIER_SYSTEM = (
    "Ты — классификатор сообщений из городского чата. Возвращаешь строго один "
    "JSON-объект без markdown. Никаких обёрток, комментариев или пояснений."
)

CLASSIFIER_PROMPT_TEMPLATE = """\
# РОЛЬ
Классифицируешь ОДНО сообщение из городского чата и решаешь, описывает ли оно
новую проблему или повторяет одну из уже известных.

# ЛОГИКА
1. Категория: complaint | request | suggestion | gratitude | discussion | spam | flood | toxic.
   Если НЕ complaint/request/suggestion → verdict="noise".
2. Для complaint/request/suggestion извлечь:
   topic: дороги | ЖКХ-вода | ЖКХ-тепло | ЖКХ-электро | мусор | экология |
          благоустройство | освещение | транспорт | животные | безопасность |
          парки | школы | медицина | прочее
   address: нормализованный адрес (улица + дом) или null
   locality_hint: ЖК / микрорайон / деревня / улица без дома, если упомянуто (иначе null).
                  Пример: "ЖК Скандинавский", "д. Бородино", "мкр. Сходня".
   urgency_markers: список явных маркеров срочности
   affected_scale: "один житель" | "подъезд/дом" | "квартал" | "район"
3. Сопоставление с open_incidents.
   match если: (a) topic совпадает ТОЧНО И
               (b) локации совпадают по ЛЮБОМУ из вариантов:
                   — одинаковый нормализованный адрес (тот же дом); ИЛИ
                   — у обоих address=null, но упомянут один и тот же ЖК/микрорайон/
                     деревня/улица (проверяй по summary и тексту); ИЛИ
                   — один адрес null, у другого дом — и этот дом явно в пределах
                     упомянутого ЖК/микрорайона; И
               (c) суть совпадает по смыслу.
   Если match → verdict="match", верни incident_id самого свежего подходящего.
   ВАЖНО: четыре жалобы из одного чата про один ЖК/деревню с одной темой — это
   ВСЕГДА один инцидент с подтверждениями, а не четыре отдельных.
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
  "topic": "<из списка>", "address": "<или null>", "locality_hint": "<или null>",
  "urgency_markers": ["..."], "affected_scale": "<или null>",
  "priority": <1-10>, "escalate_to": "emergency|head|department|log_only",
  "summary": "<1 предложение от 3-го лица, деловым языком; ЕСЛИ адрес null — явно упомяни ЖК/микрорайон/деревню в summary>",
  "confidence": 0.0-1.0}}

# ПРАВИЛА
- Только JSON. Никаких обёрток.
- При сомнении между match и new_incident → match, если match_confidence >= 0.70.
- Нормализуй адрес: "Силикатная 25" / "ул. Силикатная, д. 25" → "ул. Силикатная, 25".
- Не выдумывай адрес. Нет в тексте — null.
- Если адрес null, но в тексте есть ЖК/микрорайон/деревня — заполни locality_hint и явно включи его в summary.

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


@dataclass
class LocalityMatch:
    id: int
    topic: str
    address: str | None
    locality: str | None
    summary: str
    priority: int
    status: str
    created_at: str
    confirmations_count: int
    locality_sim: float


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
    """Longer-timeout client for classifier classification calls (can take 30-60s)."""
    global _http_slow
    if _http_slow is None:
        _http_slow = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0))
    return _http_slow


async def _retry_post(client: httpx.AsyncClient, url: str, *, headers: dict, json_body: dict,
                       max_attempts: int = 3, label: str = "http") -> httpx.Response:
    """Post with retries on timeout, 5xx, and 429 (rate limit). Exponential backoff.

    429 added after the May 4-12 incident where xAI started rate-limiting and
    a single 429 burned the whole message. With retry the temporary spike is
    absorbed and only a sustained quota exhaustion bubbles up as an error.
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            r = await client.post(url, headers=headers, json=json_body)
            if r.status_code < 500 and r.status_code != 429:
                return r
            # 5xx or 429 → retry
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


async def classify(msg: IncomingMessage, open_incidents: list[Similar]) -> dict[str, Any]:
    """Run the full classifier prompt and return the parsed JSON verdict.
    Backed by DeepSeek-chat (was Grok-4, swapped on 2026-05-12 — DeepSeek is
    cheaper and the xAI balance had run out)."""
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY not set")
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
    prompt = CLASSIFIER_PROMPT_TEMPLATE.format(input_json=json.dumps(input_payload, ensure_ascii=False, indent=2))

    r = await _retry_post(
        _get_http_slow(),
        DEEPSEEK_URL,
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
        json_body={
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        },
        label="deepseek-classify",
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    # Tolerate occasional stray markdown fences
    content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


# ==============================================================================
# DeepSeek lightweight triage — pre-filters obvious noise to skip classifier.
# Cost ~$0.0001/call vs the full classifier prompt (~$0.0003-0.001/call) —
# still 3-10× cheaper to short-circuit obvious noise with a tiny prompt.
# Returns: {"verdict": "noise"|"appeal", "confidence": 0..1, "reason": "..."}.
# ==============================================================================

DEEPSEEK_TRIAGE_SYSTEM = (
    "Ты — фильтр городских жалоб. Получаешь ОДНО сообщение из чата. "
    "Возвращаешь строго JSON-объект без markdown."
)

DEEPSEEK_TRIAGE_PROMPT = """\
Классифицируй сообщение как `noise` или `appeal`.

NOISE — это:
• благодарности, поздравления, добрые пожелания
• офтоп, обмен мнениями, шутки, эмоции БЕЗ конкретной проблемы
• реклама, спам, флуд
• общие вопросы вне темы города ("кто знает где купить…")
• фотоотчёты "у нас красиво" без жалобы

APPEAL — любая жалоба/заявка/требование решить городскую проблему:
• ЖКХ (вода, тепло, газ, электричество, мусор)
• ЧС/безопасность (пожар, ДТП, аварии, нападения, разбой)
• благоустройство, дороги, освещение
• транспорт, пробки
• экология, шум, загрязнение
• любое сообщение со словами "у нас нет", "не работает", "сломалось", "помогите", "что делать", "куда обращаться", "когда починят"

При сомнении → "appeal" (дальше classifier разберётся).

Формат ответа (только JSON):
{{"verdict": "noise" | "appeal", "confidence": 0.0-1.0, "reason": "<кратко на русском>"}}

# СООБЩЕНИЕ:
{text}
"""


async def deepseek_triage(text: str) -> dict[str, Any]:
    """Cheap noise/appeal classifier. Returns dict with verdict/confidence/reason.
    Raises on API failure — caller is responsible for fallback."""
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY not set")
    prompt = DEEPSEEK_TRIAGE_PROMPT.format(text=text[:1500])
    r = await _retry_post(
        _get_http(),
        DEEPSEEK_URL,
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
        json_body={
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": DEEPSEEK_TRIAGE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 120,
            "response_format": {"type": "json_object"},
        },
        max_attempts=2,
        label="deepseek-triage",
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


# ==============================================================================
# Supabase helpers (built on existing db.get_client())
# ==============================================================================

def _db():
    return db.get_client()


# ------------------------------------------------------------------
# Text cache: hash(normalized text) -> last verdict.
# Caches only `noise` classifier verdicts. Repeated identical noise (e.g. "Спасибо
# большое за быстрый ответ!") then skips embedding+classifier entirely.
# ------------------------------------------------------------------

CACHE_MIN_LEN = 15
CACHE_MAX_LEN = 500
_CACHE_NORM_WS = re.compile(r"\s+")


def _normalize_for_cache(text: str) -> str:
    s = text.strip().lower()
    return _CACHE_NORM_WS.sub(" ", s)


def _text_hash(text: str) -> str:
    return hashlib.sha256(_normalize_for_cache(text).encode("utf-8")).hexdigest()


def _cache_lookup_sync(text_hash: str) -> dict | None:
    res = _db().table("octobot_text_cache").select(
        "text_hash, verdict, category, hits"
    ).eq("text_hash", text_hash).limit(1).execute()
    return res.data[0] if res.data else None


def _cache_record_sync(text_hash: str, verdict: str, category: str | None,
                        raw: dict, sample: str) -> None:
    """Atomic insert-or-bump-hits via Postgres function."""
    try:
        _db().rpc(
            "octobot_text_cache_record",
            {
                "p_hash": text_hash,
                "p_verdict": verdict,
                "p_category": category,
                "p_raw": raw,
                "p_sample": (sample or "")[:200],
            },
        ).execute()
    except Exception as e:
        print(f"[octobot] cache record error: {e}")


def _cache_hit_sync(text_hash: str) -> None:
    try:
        _db().rpc("octobot_text_cache_hit", {"p_hash": text_hash}).execute()
    except Exception as e:
        print(f"[octobot] cache hit bump error: {e}")


def find_similar_sync(embedding: list[float], top_k: int = 3, window_days: int = OPEN_WINDOW_DAYS) -> list[Similar]:
    res = _db().rpc(
        "octobot_find_similar",
        {"query_embedding": embedding, "top_k": top_k, "window_days": window_days},
    ).execute()
    return [Similar(**row) for row in (res.data or [])]


def find_locality_match_sync(
    topics: list[str],
    locality: str,
    window_days: int = OPEN_WINDOW_DAYS,
    trgm_threshold: float = 0.45,
) -> list[LocalityMatch]:
    """Find open incidents matching ANY of `topics` with a similar locality.

    Uses pg_trgm similarity on lower(locality). Accepts a list of topics so
    related-topic families (e.g. all ЖКХ symptoms from one boiler outage) can
    be deduped together.
    """
    if not locality or not topics:
        return []
    res = _db().rpc(
        "octobot_find_locality_match",
        {
            "p_topics": topics,
            "p_locality": locality,
            "p_window_days": window_days,
            "p_trgm_threshold": trgm_threshold,
            "p_top_k": 3,
        },
    ).execute()
    return [LocalityMatch(**row) for row in (res.data or [])]


def log_message_sync(msg: IncomingMessage, verdict: str, incident_id: int | None = None,
                     category: str | None = None, cost_usd: float = 0.0,
                     triage: dict | None = None) -> None:
    payload: dict[str, Any] = {
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
        "classifier_model": DEEPSEEK_MODEL,  # was GROK_MODEL until 2026-05-12
        "sent_at": msg.sent_at.isoformat() if msg.sent_at else None,
    }
    if triage:
        payload.update({
            "triage_model": triage.get("model"),
            "triage_verdict": triage.get("verdict"),
            "triage_confidence": triage.get("confidence"),
            "triage_latency_ms": triage.get("latency_ms"),
            "triage_cost_usd": triage.get("cost_usd"),
            "triage_raw": triage.get("raw"),
        })
    _db().table("octobot_messages").upsert(
        payload, on_conflict="source,chat_id,message_id"
    ).execute()


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
        "locality": result.get("locality_hint"),
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
    triage_meta: dict | None = None  # populated by deepseek_triage when reachable

    def _log(verdict: str, incident_id: int | None = None,
             category: str | None = None, cost: float = 0.0) -> None:
        log_message_sync(msg, verdict, incident_id, category, cost, triage_meta)

    if is_trivial(msg.text):
        await asyncio.to_thread(_log, "noise", None, "trivial", 0.0)
        return "noise"

    if is_obvious_noise(msg.text):
        await asyncio.to_thread(_log, "noise", None, "prefilter", 0.0)
        return "noise"

    # T1 cache lookup: same text already classified as noise → skip embed+classifier.
    cache_hash: str | None = None
    if CACHE_MIN_LEN <= len(msg.text.strip()) <= CACHE_MAX_LEN:
        cache_hash = _text_hash(msg.text)
        cached = await asyncio.to_thread(_cache_lookup_sync, cache_hash)
        if cached and cached["verdict"] == "noise":
            await asyncio.to_thread(_cache_hit_sync, cache_hash)
            await asyncio.to_thread(
                _log, "noise", None,
                f"cache_{cached.get('category') or 'noise'}", 0.0,
            )
            return "noise"

    # T2 DeepSeek triage — cheap noise/appeal pre-classifier.
    # Shadow mode: log result, don't change pipeline. Active mode: skip classifier on
    # confident noise (with a small QA sample still going to classifier).
    skip_to_noise = False
    if TRIAGE_MODE != "off" and DEEPSEEK_API_KEY:
        try:
            t0 = datetime.now(timezone.utc)
            triage_raw = await deepseek_triage(msg.text)
            latency_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
            triage_meta = {
                "model": DEEPSEEK_MODEL,
                "verdict": triage_raw.get("verdict"),
                "confidence": float(triage_raw.get("confidence", 0.0) or 0.0),
                "latency_ms": latency_ms,
                "cost_usd": 0.0001,
                "raw": triage_raw,
            }
            if (TRIAGE_MODE == "active"
                    and triage_meta["verdict"] == "noise"
                    and triage_meta["confidence"] >= TRIAGE_NOISE_CONF):
                # 5% QA sample: still go to classifier for periodic accuracy check.
                import random  # local import; std lib
                if random.random() >= TRIAGE_QA_SAMPLE:
                    skip_to_noise = True
        except Exception as e:
            print(f"[octobot] deepseek triage error: {type(e).__name__}: {e}")

    if skip_to_noise:
        await asyncio.to_thread(_log, "noise", None, "deepseek_noise", triage_meta["cost_usd"])
        if cache_hash:
            await asyncio.to_thread(
                _cache_record_sync, cache_hash, "noise", "deepseek_noise",
                triage_meta["raw"] or {}, msg.text,
            )
        return "noise"

    try:
        # 1. Embed inbound message
        embedding = await openai_embed(msg.text)
        cost_embed = 0.00002  # text-embedding-3-small ~ $0.02 per 1M tokens
        if triage_meta:
            cost_embed += triage_meta.get("cost_usd", 0.0)

        # 2. Top-k similar open incidents
        similar = await asyncio.to_thread(find_similar_sync, embedding, 3, OPEN_WINDOW_DAYS)
        top = similar[0] if similar else None

        # 3. Confident duplicate → register and return
        if top and top.sim >= THRESHOLD_DUPLICATE:
            await asyncio.to_thread(add_confirmation_sync, top.id, msg, top.sim, "embedding")
            await asyncio.to_thread(_log, "match", top.id, None, cost_embed)
            return "match"

        # 4. Gray zone → classifier disambiguates
        if top and top.sim >= THRESHOLD_CANDIDATE:
            verdict = await classify(msg, similar)
            cost_classify = 0.0001  # DeepSeek-chat — see DEEPSEEK_MODEL
            if verdict.get("verdict") == "match":
                inc_id = int(verdict.get("incident_id", top.id))
                conf = float(verdict.get("match_confidence", top.sim))
                await asyncio.to_thread(add_confirmation_sync, inc_id, msg, conf, "classifier")
                await asyncio.to_thread(_log, "match", inc_id, None, cost_embed + cost_classify)
                return "match"
            # fall through to new-incident path with the gray-zone classification

        # 5. Classifier returns new_incident or noise (no open-incidents context)
        if not top or top.sim < THRESHOLD_CANDIDATE:
            verdict = await classify(msg, [])
            cost_classify = 0.0001
        cost = cost_embed + cost_classify

        if verdict.get("verdict") == "noise":
            category = verdict.get("category")
            await asyncio.to_thread(_log, "noise", None, category, cost)
            if cache_hash:
                await asyncio.to_thread(
                    _cache_record_sync, cache_hash, "noise", category, verdict, msg.text
                )
            return "noise"

        if verdict.get("verdict") != "new_incident":
            await asyncio.to_thread(_log, "error", None, "unexpected_verdict", cost)
            return "error"

        # 5a. Low-signal filter: log-only information queries, low-priority suggestions,
        # and "thank you" type messages should be recorded but NOT surface as incidents.
        # Operators only want to act on real problems/requests (priority ≥ 4).
        if verdict.get("escalate_to") == "log_only" or int(verdict.get("priority", 0)) <= 3:
            await asyncio.to_thread(_log, "log_only", None, verdict.get("category"), cost)
            print(f"[octobot] LOG-ONLY skip: priority={verdict.get('priority')} "
                  f"category={verdict.get('category')} topic={verdict.get('topic')}")
            return "log_only"

        # 6. New incident: embed normalized text
        locality = verdict.get("locality_hint")
        address_part = verdict.get("address") or (f"локация: {locality}" if locality else "без адреса")
        normalized = f"{verdict['topic']} | {address_part} | {verdict['summary']}"

        # 6a. Locality match — same topic-family + same ЖК/микрорайон/деревня in window
        # → treat as duplicate even if address or exact symptom differs (e.g. one
        # boiler outage manifests as separate ЖКХ-тепло / ЖКХ-вода / ЖКХ-электро
        # complaints from neighbouring buildings of one ЖК). Uses pg_trgm on locality
        # and the TOPIC_FAMILIES group.
        if locality:
            topics = topic_family_members(verdict["topic"])
            loc_matches = await asyncio.to_thread(
                find_locality_match_sync, topics, locality, OPEN_WINDOW_DAYS
            )
            if loc_matches:
                top_loc = loc_matches[0]
                await asyncio.to_thread(
                    add_confirmation_sync, top_loc.id, msg, float(top_loc.locality_sim), "locality_match"
                )
                await asyncio.to_thread(_log, "match", top_loc.id, verdict.get("category"), cost)
                print(f"[octobot] LOCALITY match: incident {top_loc.id} "
                      f"(topic={verdict['topic']}, locality='{locality}', "
                      f"sim={top_loc.locality_sim:.2f})")
                return "match"

        inc_embedding = await openai_embed(normalized)
        cost += 0.00002  # second embedding

        # 6b. Post-verdict dedup check — normalized(new) ↔ normalized(existing).
        postcheck = await asyncio.to_thread(find_similar_sync, inc_embedding, 5, OPEN_WINDOW_DAYS)
        same_topic = [s for s in postcheck if s.topic == verdict["topic"]]
        if same_topic and same_topic[0].sim >= THRESHOLD_POSTCHECK:
            top_match = same_topic[0]
            await asyncio.to_thread(add_confirmation_sync, top_match.id, msg, top_match.sim, "post_dedup")
            await asyncio.to_thread(_log, "match", top_match.id, verdict.get("category"), cost)
            print(f"[octobot] POST-DEDUP match: incident {top_match.id} "
                  f"(sim={top_match.sim:.3f}, topic={verdict['topic']})")
            return "match"

        inc_id = await asyncio.to_thread(insert_incident_sync, verdict, inc_embedding, normalized, msg)
        await asyncio.to_thread(_log, "new_incident", inc_id, verdict.get("category"), cost)

        print(f"[octobot] NEW incident {inc_id}: {verdict['topic']} · "
              f"{verdict.get('address') or locality or '—'} · priority {verdict['priority']} · {verdict['escalate_to']}")
        return "new_incident"

    except Exception as e:
        traceback.print_exc()
        try:
            await asyncio.to_thread(_log, "error", None, type(e).__name__, 0.0)
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
