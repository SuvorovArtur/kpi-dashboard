# Architecture Patterns

**Domain:** Municipal social health index dashboard (composite scoring + real-time alerting)
**Researched:** 2026-04-06

---

## Current Architecture Baseline

The existing app is a React 19 + Vite SPA with four well-defined layers:

```
Pages (feature modules)
  └── Shared Hooks (data access / domain logic)
       └── Supabase client (auth + DB queries)
            └── Supabase PostgreSQL (source of truth)
```

All calculation today happens **in-browser in useMemo**: appeals KPIs, ISN, sentiment are re-derived on every page render from raw rows fetched from Supabase. No pre-computed scores exist in the database. No server-side logic beyond Supabase auth and row access.

The VPS (socpulse.ru) runs a Python Telegram bot (Telethon + DeepSeek) that writes messages and analysis results to Supabase.

---

## Recommended Architecture for the New Milestone

### Core Design Decision: Scoring Lives in PostgreSQL, Not the Browser

**Why not keep it in the browser (current pattern):**
- Per-settlement composite index requires joining 4+ tables (appeals, kpi_values, tg_messages, attendance) simultaneously. Fetching all raw data to the client is expensive and brittle.
- Alerting thresholds must fire even when no user has the dashboard open. Client-side evaluation cannot do this.
- Multiple users with different date ranges would produce inconsistent index snapshots.

**Why not an Edge Function (Supabase Deno):**
- Edge Functions are stateless and request-scoped. They work for webhooks (Telegram send) but are wrong for aggregation that must run on a schedule.
- Edge Functions cannot hold a pg connection long enough for multi-table aggregation without hitting cold-start and timeout limits for batch jobs.

**Verdict: PostgreSQL function + pg_cron for score computation; Edge Function only for outbound Telegram dispatch.**

This is the standard Supabase pattern for scheduled aggregation: pg_cron triggers a SQL function that writes materialized rows, a second pg_cron job invokes pg_net to call the Edge Function for alerting.

---

## Component Map

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                         │
│                                                              │
│  OverviewPage          SettlementDrillDown                   │
│    useHealthIndex()      useHealthIndex(settlementId)        │
│                                                              │
│  SettingsPage/Weights                                        │
│    useIndexWeights()   (admin write via supabase.from)       │
└──────────────┬───────────────────────────────────────────────┘
               │  Supabase JS client (select, realtime channel)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL                                         │
│                                                              │
│  [Tables]                                                    │
│  appeals            kpi_values          tg_messages          │
│  territories        index_weights       attendance_records   │
│                                                              │
│  [Computed]                                                  │
│  settlement_health_scores  ← written by calculate_shi()      │
│    (id, settlement_id, period, score, component_scores,      │
│     computed_at)                                             │
│                                                              │
│  [Scheduled jobs – pg_cron]                                  │
│  every 15 min → calculate_shi()   ← aggregates, writes rows  │
│  after calculate_shi → check_alert_thresholds()              │
│      │                                                       │
│      │ if threshold crossed → pg_net HTTP POST               │
│      ▼                                                       │
└──────────────┬───────────────────────────────────────────────┘
               │  HTTP webhook (pg_net)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: send-telegram-alert                 │
│                                                              │
│  Receives: { settlement, score, delta, breach_type }         │
│  Sends:    Telegram Bot API message to leadership group      │
│  Returns:  { ok: true } logged to cron.job_run_details       │
└──────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `settlement_health_scores` table | Pre-computed SHI per settlement per period | Written by `calculate_shi()`, read by `useHealthIndex` hook |
| `index_weights` table | Admin-configurable weights (appeals_w, kpi_w, sentiment_w, etc.) | Written by Settings page, read by `calculate_shi()` |
| `calculate_shi()` SQL function | Reads raw data + weights, writes score rows | Invoked by pg_cron; reads appeals, kpi_values, tg_messages, attendance |
| `check_alert_thresholds()` SQL function | Compares latest scores to thresholds, fires HTTP when breached | Invoked by pg_cron after score refresh; calls pg_net → Edge Function |
| `send-telegram-alert` Edge Function | Stateless webhook: formats and sends Telegram message | Receives HTTP from pg_net; calls Telegram Bot API |
| `useHealthIndex(settlementId?)` hook | Fetches pre-computed scores; subscribes to realtime | Reads `settlement_health_scores`; uses Supabase realtime channel |
| `useIndexWeights()` hook | Reads/writes admin weight config | Reads/writes `index_weights` table |
| OverviewPage | Renders settlement scorecards grid | Consumes `useHealthIndex()` |
| SettlementDrillDown | Detail view: score breakdown + trend | Consumes `useHealthIndex(id)`, `useAppeals`, `useKpiData` |
| Settings/Weights tab | Admin UI to configure formula weights | Consumes `useIndexWeights()` |

---

## Data Flow

### Score Computation Flow (server-side, every 15 min)

```
pg_cron trigger
  → calculate_shi()
      reads: appeals (last N days, grouped by settlement)
      reads: kpi_values (current period, by territory)
      reads: tg_messages (sentiment scores, last N days)
      reads: attendance_records (current month)
      reads: index_weights (current admin config)
      computes: weighted_score = Σ(component_i × weight_i) / Σ(weight_i)
      writes: upsert into settlement_health_scores
  → check_alert_thresholds()
      compares: current score vs previous score, vs fixed thresholds
      if delta > spike_threshold OR score < critical_floor:
        pg_net.http_post → Edge Function URL
  → Edge Function: send-telegram-alert
      formats Russian-language message
      POST to Telegram Bot API (sendMessage to group chat ID)
```

### Dashboard Read Flow (browser)

```
User opens Overview
  → useHealthIndex() hook mounts
      supabase.from('settlement_health_scores').select('*')
        .eq('period', current_period)
        .order('computed_at', desc)
      subscribes: supabase.channel('health-scores').on('postgres_changes', ...)
  → scores arrive → OverviewPage renders settlement scorecards
  → Supabase Realtime pushes row-change event when pg_cron next writes
  → hook updates state, page re-renders without full refetch
```

### Weight Update Flow (admin)

```
Admin changes weight slider in Settings
  → useIndexWeights().update(weights) called
      supabase.from('index_weights').upsert(newWeights)
  → Next pg_cron run reads updated weights automatically
  → No cache invalidation needed (weights read fresh each run)
```

---

## Database Schema (new tables only)

```sql
-- Pre-computed scores (written by PostgreSQL function, read by browser)
CREATE TABLE settlement_health_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id text NOT NULL REFERENCES territories(id),
  period        text NOT NULL,          -- 'YYYY-MM-DD' or 'YYYY-WW'
  score         numeric(5,2) NOT NULL,  -- 0.00 – 100.00
  component_scores jsonb NOT NULL,      -- { appeals: 72, kpi: 85, sentiment: 68, ... }
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, period)
);

-- Admin-configurable formula weights
CREATE TABLE index_weights (
  id            serial PRIMARY KEY,
  component     text NOT NULL UNIQUE,   -- 'appeals', 'kpi', 'sentiment', 'ecology'
  weight        numeric(4,2) NOT NULL DEFAULT 1.0,
  label         text NOT NULL,          -- Russian display label
  updated_at    timestamptz DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id)
);
```

---

## Patterns to Follow

### Pattern 1: Materialized Score Rows (not materialized views)

Use regular table rows instead of PostgreSQL MATERIALIZED VIEW for the score cache. Reason: Supabase Realtime works on table row changes (via logical replication), not on MATERIALIZED VIEW refreshes. A regular table upsert triggers Realtime; a MATERIALIZED VIEW refresh does not. This means the browser gets live push updates automatically when pg_cron rewrites rows.

### Pattern 2: Single Hook Per Data Domain

Mirror existing codebase convention. Create `useHealthIndex` as a new file in `shared/hooks/` following the exact same pattern as `useKpiData`: useState + useCallback + useEffect + supabase.channel subscription. Return `{ data, isLoading, error, refetch }`.

### Pattern 3: Weights as Database Config, Not Code Constants

Store weights in `index_weights` table rather than hardcoded TypeScript constants. The formula is invoked in SQL where it reads weights at execution time. This avoids deployment for weight changes and enables the admin UI to take effect immediately on the next scheduled run.

### Pattern 4: Edge Function for Outbound-Only Alerting

The Edge Function does exactly one thing: receive a structured payload and send a Telegram message. No database reads, no aggregation. Keep it under 50 lines. This limits blast radius if Telegram API changes or credentials rotate.

### Pattern 5: Composite Score Formula

```
SHI = (w_a * score_appeals + w_k * score_kpi + w_s * score_sentiment + w_e * score_ecology)
      / (w_a + w_k + w_s + w_e)
```

Each component score is independently normalized to 0–100 before weighting. Normalization is done inside the SQL function using MIN/MAX across all settlements in the same period (relative ranking). This makes weights meaningful regardless of raw data scale differences.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calculating SHI in the Browser

**What:** Fetching all raw data to client, computing score in `useMemo` (current pattern for simpler KPIs)
**Why bad:** Requires fetching 4 tables, slow for >1000 appeals/month, breaks alerting (needs server-side evaluation), produces inconsistent scores across users
**Instead:** Always read from `settlement_health_scores` table; let PostgreSQL do the math

### Anti-Pattern 2: Using Supabase Edge Function as a Cron Scheduler

**What:** Setting up a cron to call an Edge Function that then runs the aggregation query
**Why bad:** Edge Functions are Deno (JS) and stateless; they have cold-start latency, connection pooling overhead for complex multi-table queries, and a 400ms–2s execution floor. pg_cron calling a native SQL function has zero cold-start and runs in the same transaction context as the data.
**Instead:** pg_cron → SQL function for computation; Edge Function only for HTTP side effects (Telegram)

### Anti-Pattern 3: Realtime Channel on Raw Source Tables

**What:** Subscribing `useHealthIndex` to changes in `appeals` or `kpi_values` directly
**Why bad:** Every new appeal row fires a Realtime event, triggering expensive client-side score recalculation. Appeals pages already subscribe to `appeals` table; double-subscription causes connection limit issues.
**Instead:** Subscribe only to `settlement_health_scores` — one event per settlement per 15-min cycle

### Anti-Pattern 4: Storing Alert State in the Browser

**What:** Using React state or localStorage to track "alert already sent for this threshold breach"
**Why bad:** Stateless across page reloads, multiple sessions, and bot restarts
**Instead:** Store `last_alerted_at` and `last_alerted_score` in a `alert_log` table; check in SQL before firing

---

## Build Order (Phase Dependencies)

The components have hard dependencies that dictate sequencing:

```
1. Database Schema
   index_weights table + settlement_health_scores table
   (everything else reads from or writes to these)

2. Score Calculation SQL Function (calculate_shi)
   depends on: schema exists, source tables populated
   can be tested manually with SELECT calculate_shi('2026-04-01')

3. Scheduled Execution (pg_cron job)
   depends on: calculate_shi function exists and is correct
   unsafe to schedule until function is validated

4. useHealthIndex hook (browser)
   depends on: settlement_health_scores table exists with data
   can be built with mock data against empty table

5. Overview page settlement scorecards
   depends on: useHealthIndex hook

6. Settlement drill-down view
   depends on: useHealthIndex hook + existing useAppeals/useKpiData

7. Admin weights UI (Settings tab)
   depends on: index_weights table, useIndexWeights hook
   independent from alerting — can ship before alerting

8. Alert threshold check SQL function
   depends on: settlement_health_scores populated with history (>1 period)
   must come after step 3 has run at least twice

9. Edge Function: send-telegram-alert
   depends on: Telegram bot token + group chat ID available
   independent from scoring — can be tested in isolation

10. pg_cron → pg_net alert wiring
    depends on: steps 8 and 9 both validated
```

---

## Scalability Notes

This is a single-district tool with ~10 settlements, 1000–5000 appeals/month. The architecture described is deliberately simple and does not need sharding, queues, or streaming. The 15-minute recalculation interval is appropriate — sub-minute freshness is not required for municipal operational dashboards.

If the district expands to 50+ settlements or data volume grows 10x, the main scaling lever is reducing `calculate_shi` to run per-settlement in parallel using pg_cron per-row jobs rather than a single function over all settlements. This is a future concern, not a current constraint.

---

## Sources

- Supabase Cron documentation: https://supabase.com/docs/guides/cron
- Supabase pg_cron extension: https://supabase.com/docs/guides/database/extensions/pg_cron
- Supabase Realtime — subscribing to database changes: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase Edge Functions + Telegram bot example: https://supabase.com/docs/guides/functions/examples/telegram-bot
- Supabase scheduling Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- PostgreSQL materialized views vs table denormalization: https://sachinsatpute.medium.com/faster-dashboards-with-postgresql-materialized-views-and-literal-denormalization-ea1f47a86841
- City Health Dashboard metrics architecture: https://www.cityhealthdashboard.com/metrics
- Building real-time notification system with Supabase: https://makerkit.dev/blog/tutorials/real-time-notifications-supabase-nextjs

---

*Architecture research: 2026-04-06*
