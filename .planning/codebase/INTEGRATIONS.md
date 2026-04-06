# External Integrations

**Analysis Date:** 2026-04-06

## APIs & External Services

**Supabase (Database, Auth, Functions, RPC):**
- Primary backend for all data operations
  - SDK: `@supabase/supabase-js` 2.101.1
  - Auth: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (environment variables)
  - Connection: `src/shared/lib/supabase.ts`

**DeepSeek API (Message Analysis):**
- Sentiment and message analysis for appeals and ISN data
  - SDK: Raw HTTP via `httpx` (Python, in `tg-bot/analyzer.py`)
  - Config: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (from `tg-bot/config.py`)
  - Model: Claude or compatible LLM for batch message analysis

**Telegram (Social Media Monitoring):**
- Message collection from monitored chats and channels
  - SDK: `telethon` (Python Telegram client)
  - Connection: `tg-bot/bot.py` - TelegramClient with API credentials
  - Config: `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` (from `tg-bot/config.py`)
  - Features:
    - Listen to new messages in configured chats/channels
    - Participant/subscriber count tracking
    - Channel statistics collection
    - Alert delivery to designated chat

**Nominatim (Geocoding):**
- EU-based geocoding service for address → coordinates
  - Called via: Supabase Edge Function `geocode` (invoked from `src/shared/lib/geocode.ts`)
  - Handles: GPS extraction from descriptions, address resolution (street + house + settlement)
  - Batch processing: 50 appeals per batch

## Data Storage

**Databases:**
- PostgreSQL (via Supabase)
  - Connection: Supabase client with anon key
  - Tables:
    - `kpi_definitions` - KPI metadata and targets (`src/shared/hooks/useKpiData.ts`)
    - `kpi_values` - Time-series KPI data points
    - `appeals` - Municipal appeals/requests with geocoding status (`src/shared/hooks/useAppeals.ts`)
    - `user_profiles` - User accounts, roles, display names (`src/shared/hooks/useAuth.tsx`)
    - `territories` - Geographic divisions/districts (`src/shared/hooks/useTerritories.ts`)
    - `attendance_records` - Daily attendance fact values (`src/shared/hooks/useAttendance.ts`)
    - `attendance_plans` - Monthly attendance targets
    - `app_settings` - Configuration key-value store (`src/shared/hooks/useAppSettings.ts`)
    - `staff` - Staff metrics (headcount, vacancies, turnover)
    - `roadmap_items` - Initiative tracking and scheduling
    - `tg_chats` - Monitored Telegram chats/channels
    - `tg_messages` - Individual Telegram messages
    - `tg_issues` - Extracted problems from message threads
    - `tg_issue_messages` - Links between issues and messages
    - `tg_news` - Extracted news/updates from channels
    - `tg_analysis_log` - Bot analysis run history
    - `tg_channel_stats` - Daily subscriber/post counts per channel

**File Storage:**
- Not explicitly configured; file export handled client-side:
  - Excel export via XLSX library (`src/shared/utils/export.ts`)
  - PDF export via html2canvas + jsPDF (`src/shared/utils/export.ts`)
  - No persistent file storage backend detected

**Caching:**
- None detected - all queries direct to Supabase

## Authentication & Identity

**Auth Provider:**
- Supabase Auth
  - Implementation: Email + password authentication via `supabase.auth.signInWithPassword()`
  - Session management: Browser localStorage (handled by Supabase client)
  - Context: `src/shared/hooks/useAuth.tsx` - AuthProvider with session state
  - User profile: Loaded from `user_profiles` table after signin
  - Roles:
    - `admin` - Full access (user management, KPI editing, settings)
    - `editor` - Can edit data (KPI values, territories)
    - `viewer` - Read-only access

**User Management:**
- Supabase Edge Function `manage-user` (`src/pages/Settings/Settings.tsx`)
  - Actions: `create` (new user with email/password), `delete` (remove user)
  - Accessible to admin role only

## RPC Functions (Server-Side Logic)

**Supabase RPC Procedures:**
- `get_chat_message_counts()` - Returns total and today message counts per monitored chat
  - Called from: `src/shared/hooks/useSocialMonitor.ts`
- `get_unanalyzed_messages(msg_limit: int)` - Retrieves messages pending sentiment analysis
  - Called from: `src/shared/hooks/useSocialMonitor.ts`

## Edge Functions (Serverless)

**Geocoding Function:**
- `geocode` - Batch geocoding of appeals
  - Endpoint: Invoked via `supabase.functions.invoke('geocode', { body: { limit: 50 } })`
  - Called from: `src/shared/lib/geocode.ts`
  - Process: Handles GPS extraction from descriptions, then Nominatim resolution
  - Returns: `{ geocoded: number, total: number }`

**Sentiment Analysis Function:**
- `analyze-sentiment` - Batch NLP sentiment scoring
  - Endpoint: Invoked via `supabase.functions.invoke('analyze-sentiment', { body: { batch_size: N } })`
  - Called from: `src/pages/Appeals/Appeals.tsx`, `src/pages/ISN/ISN.tsx`
  - Returns: Analysis results (sentiment scores, classification)

**User Management Function:**
- `manage-user` - Create/delete users
  - Endpoint: Invoked via `supabase.functions.invoke('manage-user', { body: { action, ... } })`
  - Called from: `src/pages/Settings/Settings.tsx`
  - Actions:
    - `create`: `{ action: 'create', email, password, display_name, role }`
    - `delete`: `{ action: 'delete', user_id }`

## Monitoring & Observability

**Error Tracking:**
- Not configured; errors logged to console

**Logs:**
- Supabase tables:
  - `tg_analysis_log` - Bot analysis runs with status, threads found, alerts generated
  - Application logs: Browser console only

## CI/CD & Deployment

**Hosting:**
- Static frontend deployment (Vite produces SPA)
- Bot deployment: Standalone Python process (systemd or manual)

**CI Pipeline:**
- Not configured in repo

## Webhooks & Callbacks

**Incoming:**
- Telegram event listeners (real-time message handling in bot)
  - `@client.on(events.NewMessage(incoming=True))` in `tg-bot/bot.py`
  - Triggers: Message saving, reply tracking, sender identification

**Outgoing:**
- Alert messages sent back to Telegram chat (`ALERT_CHAT_ID`)
  - From: `tg-bot/bot.py` periodic analysis task
  - Delivery: Parsed as markdown to designated chat

## Data Exchange Patterns

**Frontend → Supabase:**
- Direct client queries via Supabase client library
  - All CRUD on tables (select, insert, update, upsert, delete)
  - Filtered queries by date range, direction, territory, status
  - Example: `supabase.from('appeals').select('*').gte('date', dateFrom).lte('date', dateTo)`

**Bot → Supabase:**
- Direct connection from Python process
  - Message insertion: `db.save_message()`
  - Bulk updates via `table().update().execute()`
  - Analysis log recording: Status, thread count, alerts generated

**Bot ← Telegram:**
- Real-time listener pattern via `telethon`
  - Event-driven message collection
  - Periodic participant count updates (every 30 min)

**Frontend → Edge Functions:**
- Request/response over HTTP (Supabase SDK wraps)
  - Geocoding, sentiment analysis, user management
  - Async batch processing with progress feedback

## Environment Configuration

**Required env vars:**

**Frontend (.env):**
- `VITE_SUPABASE_URL` - Base URL of Supabase project
- `VITE_SUPABASE_ANON_KEY` - Public key for client auth

**Bot (tg-bot/.env):**
- `SUPABASE_URL`, `SUPABASE_KEY` - Database connection
- `TG_API_ID`, `TG_API_HASH` - Telegram app credentials
- `TG_SESSION` - Session file name (persists login)
- `ANALYSIS_INTERVAL` - Seconds between analysis runs (e.g., 1800 for 30 min)
- `DEEPSEEK_API_KEY` - DeepSeek/LLM API authentication
- `DEEPSEEK_MODEL` - Model identifier
- `ALERT_CHAT_ID` - Telegram chat ID for alerts

**Secrets location:**
- `.env` files (local, not committed)
- Supabase: RLS policies and auth tokens managed via dashboard

---

*Integration audit: 2026-04-06*
