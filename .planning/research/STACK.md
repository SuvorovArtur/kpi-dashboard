# Technology Stack — Social Health Index Milestone

**Project:** KPI Dashboard (SocPulse) — Social Health Index milestone
**Researched:** 2026-04-06
**Confidence:** HIGH (all recommendations verified against official docs or existing codebase patterns)

---

## Constraint Summary

The stack is fixed: React 19 + Vite 8 + TypeScript + Supabase. No new backends, no state managers, no ORM migration. Every addition must integrate into the existing hook-based data layer (`useAppSettings`, `useKpiData`, `useSocialMonitor` patterns).

---

## Recommended Stack by Feature Area

### 1. Composite Index Calculation Engine

**Where it runs:** Supabase PostgreSQL — a `plpgsql` stored function called via `supabase.rpc()`.

**Why not the frontend:** The index aggregates five data sources (appeals, KPIs, ISN sentiment, attendance, tg_issues). Computing this in React means fetching five tables and calculating in-browser on every render. A SQL function computes once at query time, respects RLS, and returns a single typed result. The existing codebase already calls `supabase.rpc('get_chat_message_counts')` and `supabase.rpc('get_unanalyzed_messages', {...})` — this pattern is established and understood.

**Why not an Edge Function:** Edge Functions add cold-start latency (~200-400ms) and require Deno runtime knowledge. For a pure aggregation query that does no I/O outside the database, a database function with zero network hops is strictly better.

**Implementation pattern:**

```sql
-- Stored in Supabase SQL editor, called via rpc('calculate_shi', { p_settlement, p_date_from, p_date_to })
CREATE OR REPLACE FUNCTION calculate_shi(
  p_settlement TEXT,
  p_date_from  DATE,
  p_date_to    DATE
) RETURNS TABLE (
  settlement       TEXT,
  shi_score        NUMERIC,
  appeals_score    NUMERIC,
  kpi_score        NUMERIC,
  isn_score        NUMERIC,
  attendance_score NUMERIC,
  tg_issues_score  NUMERIC,
  computed_at      TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
DECLARE
  w_appeals    NUMERIC := 0.30;
  w_kpi        NUMERIC := 0.25;
  w_isn        NUMERIC := 0.20;
  w_attendance NUMERIC := 0.15;
  w_tg         NUMERIC := 0.10;
BEGIN
  -- Weights loaded from app_settings table to allow admin configuration
  SELECT COALESCE(value::NUMERIC, 0.30) INTO w_appeals FROM app_settings WHERE key = 'shi_weight_appeals';
  -- ... repeat for others
  RETURN QUERY
    SELECT
      p_settlement,
      ROUND(
        w_appeals * <appeals_normalized> +
        w_kpi     * <kpi_normalized>     +
        w_isn     * <isn_normalized>     +
        w_attendance * <attendance_norm> +
        w_tg      * <tg_issues_norm>,
        2
      ),
      -- ... component scores
      NOW();
END;
$$;
```

The function reads weights from `app_settings` at call time, so admin changes are reflected immediately without a deploy. This reuses the existing `app_settings` table that `useAppSettings` already manages.

**Confidence: HIGH** — `supabase.rpc()` is documented at supabase.com/docs/reference/javascript/rpc. `app_settings` upsert pattern already exists in `useAppSettings.ts`.

---

### 2. Index Weight Configuration UI

**Library:** None needed. Build with existing primitives.

**Why:** The project uses CSS Modules + no component library. The admin UI for weights is a set of range sliders or number inputs with a live sum validator (must equal 1.0). This is 50-80 lines of React with `useState` — no library adds value.

**Pattern:** Mirror `useAppSettings` write path — `update(key, value)` already handles upsert with conflict resolution. Admin saves each weight key (`shi_weight_appeals`, `shi_weight_kpi`, etc.) as string values in `app_settings`. The existing `getNumber(key)` reader handles the type conversion.

**Confidence: HIGH** — Existing `useAppSettings.ts` already has full read/write capability for this pattern.

---

### 3. Per-Settlement Score Aggregation (Scheduled)

**Mechanism:** `pg_cron` (already enabled on Supabase hosted plans).

**Why:** Per-settlement scores need to be pre-computed and stored so the Overview dashboard can load instantly (no on-demand aggregation for 5-10 settlements on every page load). `pg_cron` runs a SQL job on a schedule (e.g., every 15 minutes) that calls `calculate_shi` for each settlement and upserts results into a `shi_snapshots` table. Zero additional infrastructure.

**Why not Edge Function cron:** Supabase also supports scheduling Edge Functions via pg_cron. For a pure SQL calculation, there is no reason to leave the database. The Edge Function path requires Deno, HTTP round-trip, and secret management for the service role key. The pg_cron → SQL function path has none of these.

**Confidence: HIGH** — Supabase Cron is documented at supabase.com/docs/guides/cron and supabase.com/docs/guides/database/extensions/pg_cron. It is available on all hosted Supabase plans including Free tier.

---

### 4. Real-Time Alert Detection (Database Side)

**Mechanism:** Supabase Database Webhook → existing Python tg-bot.

**The flow:**
1. `pg_cron` recomputes SHI snapshot
2. A `AFTER INSERT OR UPDATE` trigger on `shi_snapshots` checks if score crossed threshold
3. If yes, trigger calls `pg_net` to POST to the tg-bot's `/alert` HTTP endpoint on the VPS (185.225.34.215)
4. tg-bot receives POST, formats message, sends to leadership Telegram group

**Alternative via Supabase Database Webhooks (Dashboard UI):** Supabase Database Webhooks are a pg_net wrapper that can call an HTTP endpoint on row change. This is the recommended path because it requires no SQL knowledge to configure — set it up via Supabase Dashboard → Database → Webhooks, point it at `https://socpulse.ru/alert`.

**Why not Supabase Realtime → frontend → Telegram:** Sending Telegram alerts from the browser is insecure (exposes bot token) and requires a browser session to be open. The alert path must be server-side.

**Why not a new microservice:** The tg-bot already runs on the VPS, already has Telethon client authenticated, already sends messages to the leadership group. Adding an HTTP endpoint to the existing bot (`/alert`, POST, bearer token) is a 20-line addition to `bot.py`.

**Confidence: MEDIUM** — Webhook-to-HTTP pattern is confirmed in Supabase docs (supabase.com/docs/guides/database/webhooks). The specific Python bot extension is a design choice, not a documented pattern.

---

### 5. Telegram Alert Sending (Python Bot Extension)

**Library:** `httpx` (already in the bot stack) for the webhook receiver; Telethon (already installed) for sending.

**Why not python-telegram-bot v21:** The bot already uses Telethon as a userbot client. Adding python-telegram-bot creates a second framework with a conflicting asyncio event loop. Telethon's `client.send_message(chat_id, text)` already works in the existing codebase.

**Pattern:**

```python
# Addition to bot.py — minimal HTTP server for internal alerts
from aiohttp import web

async def handle_alert(request):
    token = request.headers.get('Authorization', '')
    if token != f"Bearer {ALERT_TOKEN}":
        return web.Response(status=403)
    body = await request.json()
    msg = format_shi_alert(body)
    await client.send_message(ALERT_CHAT_ID, msg)
    return web.Response(text='ok')

# Start alongside Telethon client
app = web.Application()
app.router.add_post('/alert', handle_alert)
```

**Library to add:** `aiohttp` (lightweight asyncio-native HTTP server, compatible with Telethon's event loop). Version: `aiohttp>=3.9` (latest stable as of April 2026 is 3.11.x).

**Why aiohttp over FastAPI:** FastAPI's ASGI server (uvicorn) creates its own event loop, which conflicts with Telethon's `client.run_until_disconnected()`. `aiohttp.web` runs inside the same asyncio loop Telethon already owns.

**Confidence: MEDIUM** — aiohttp compatibility with Telethon event loop is a known pattern. aiohttp 3.9+ is the documented stable branch.

---

### 6. React Real-Time UI Updates (SHI Scores on Dashboard)

**Mechanism:** Supabase Realtime — `postgres_changes` channel on `shi_snapshots` table.

**Why:** When pg_cron updates `shi_snapshots`, the Overview dashboard should refresh without a page reload. `supabase.channel().on('postgres_changes', ...)` is the correct mechanism. The project already uses `@supabase/supabase-js 2.101.1` which fully supports this.

**Pattern (new `useSHI` hook):**

```typescript
useEffect(() => {
  const channel = supabase
    .channel('shi-updates')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shi_snapshots' },
      (payload) => {
        setSnapshots(prev =>
          prev.map(s => s.settlement === payload.new.settlement ? payload.new : s)
        );
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, []);
```

**Performance note:** `shi_snapshots` is a small table (one row per settlement, ~10 rows). Every INSERT fires one RLS-checked read per subscribed user. At the expected user count (5-20 concurrent internal users), this is negligible. Subscribe to the whole table, not per-settlement channels.

**Confidence: HIGH** — `postgres_changes` pattern is documented at supabase.com/docs/guides/realtime/postgres-changes. The existing `@supabase/supabase-js` version 2.101.1 supports it.

---

### 7. Score Visualization (Gauge / Radial Display)

**Library:** Recharts 3.8.1 (already installed) via `RadialBarChart` + `PolarAngleAxis`.

**Why not a separate gauge library:** `react-gauge-chart` (last published 2 years ago, unmaintained) and `react-gauge-component` add bundle weight for a component that Recharts can approximate. The existing codebase uses Recharts for all charts — consistency matters more than a perfect gauge shape.

**Pattern:** `RadialBarChart` with `startAngle=180` and `endAngle=0` renders a semicircular gauge. `PolarAngleAxis` sets the 0-100 scale. A centered `Label` shows the score number. This is the shadcn/ui documented radial chart pattern adapted for CSS Modules.

**Confidence: HIGH** — Recharts 3.8.1 is installed. `RadialBarChart` is a documented Recharts component.

---

### 8. Period Comparison and Trend Analysis

**Mechanism:** SQL query with `LAG()` window function via `supabase.rpc('get_shi_trend', { settlement, periods })`.

**Why:** A `LAG(shi_score, 1) OVER (PARTITION BY settlement ORDER BY computed_at)` in the stored function returns previous period score alongside current. The frontend can then compute delta and render a trend arrow. No new library needed — the pattern already exists in `useKpiData.ts` for KPI trend indicators.

**Confidence: HIGH** — Standard PostgreSQL window functions. Pattern mirrors existing KPI trend logic in the codebase.

---

## What NOT to Use

| Option | Reason to Avoid |
|--------|-----------------|
| Zustand / Redux | No global state manager in the project. Adding one for SHI creates inconsistency. Prop drilling or custom hooks cover the scope. |
| React Query / TanStack Query | Would replace existing `useState + useCallback + useEffect` pattern in every hook. Too large a refactor for incremental milestone work. |
| Supabase Edge Functions for index calculation | Cold start latency, Deno runtime, HTTP round-trip — all unnecessary when pure SQL suffices. |
| python-telegram-bot v21 | Conflicts with Telethon's asyncio loop. Telethon already handles sending. |
| External charting library for gauge | `react-gauge-chart` is unmaintained. Recharts RadialBarChart achieves the same result. |
| WebSockets outside Supabase | Supabase Realtime already provides WebSocket infrastructure. Don't duplicate it. |
| Firebase (listed in package.json) | Already flagged as likely legacy/unused. Do not add Firebase dependencies — Supabase is the sole backend per project constraints. |

---

## New Dependencies Required

| Package | Version | Side | Purpose |
|---------|---------|------|---------|
| `aiohttp` | `>=3.9` | Python (tg-bot) | Lightweight HTTP server for alert webhook receiver, compatible with Telethon's event loop |

**No new npm packages required.** All frontend needs are covered by Recharts (already installed) and native Supabase Realtime (already in `@supabase/supabase-js`).

---

## Configuration Additions

**New Supabase objects to create:**

| Object | Type | Purpose |
|--------|------|---------|
| `shi_snapshots` | Table | Stores computed SHI score per settlement per computation run |
| `calculate_shi` | SQL Function | Weighted aggregation, reads weights from `app_settings` |
| `get_shi_trend` | SQL Function | Returns current + previous period scores via LAG() |
| pg_cron job | Cron | Runs `calculate_shi` every 15 minutes for each settlement |
| Database Webhook | Webhook | Fires on `shi_snapshots` INSERT when score breaches threshold, POSTs to `/alert` |

**New `app_settings` keys:**

| Key | Default | Description |
|-----|---------|-------------|
| `shi_weight_appeals` | `0.30` | Weight: complaints volume and response time |
| `shi_weight_kpi` | `0.25` | Weight: institutional KPI score |
| `shi_weight_isn` | `0.20` | Weight: ISN sentiment score |
| `shi_weight_attendance` | `0.15` | Weight: attendance/accessibility metrics |
| `shi_weight_tg_issues` | `0.10` | Weight: Telegram monitoring issue count/severity |
| `shi_alert_threshold` | `3.5` | Score below which alert fires |
| `shi_alert_cooldown_hours` | `4` | Hours between repeated alerts for same settlement |

---

## Sources

- Supabase RPC / Database Functions: https://supabase.com/docs/reference/javascript/rpc
- Supabase pg_cron: https://supabase.com/docs/guides/database/extensions/pg_cron
- Supabase Cron Jobs: https://supabase.com/docs/guides/cron
- Supabase Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- Recharts RadialBarChart: https://recharts.org/en-US/api/RadialBarChart
- aiohttp documentation: https://docs.aiohttp.org/en/stable/
- python-telegram-bot v21 (asyncio): https://docs.python-telegram-bot.org/en/v21.9/
