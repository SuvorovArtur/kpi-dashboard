# External Integrations

**Analysis Date:** 2026-04-19

## APIs & External Services

**Supabase (Primary Backend):**
- Database and authentication provider
  - SDK/Client: `@supabase/supabase-js` 2.101.1
  - Auth: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (environment variables)
  - Used in: `src/shared/lib/supabase.ts` (main client initialization)
  - Real-time subscriptions for auth state changes
  - RPC calls for aggregation: `get_chat_message_counts()`, `get_unanalyzed_messages()`

**Telegram API:**
- Real-time message monitoring and analysis
  - Client: Telethon (Python)
  - Auth: TG_API_ID, TG_API_HASH from environment
  - Session: TG_SESSION file-based token
  - Features:
    - Incoming message listening via `@client.on(events.NewMessage)`
    - Message metadata extraction (sender, date, reply_to)
    - Participant/subscriber count fetching
    - Proxy support (SOCKS5, HTTP, MTProto) configured via Supabase `app_settings`
  - Location: `tg-bot/bot.py`
  - Monitored chats loaded from `tg_chats` Supabase table
  - Messages saved to `tg_messages` table via custom `db` module

**DeepSeek LLM:**
- Message analysis and problem detection
  - Endpoint: `https://api.deepseek.com/chat/completions`
  - Auth: DEEPSEEK_API_KEY environment variable
  - Model: DEEPSEEK_MODEL (configurable)
  - Client: httpx (async HTTP)
  - Purpose: Analyze Telegram messages for issues, threads, severity scoring, location detection
  - Input: Formatted message batches with chat context
  - Output: JSON with threads, issues, severity scores, alerts
  - Used in: `tg-bot/analyzer.py`, part of periodic analysis job
  - System prompt: Russian language, municipal issue detection for Mytishchi region

## Data Storage

**Databases:**
- Supabase PostgreSQL
  - Connection: Supabase client with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  - Client: `@supabase/supabase-js` (JavaScript/TypeScript frontend) + custom `db` module (Python backend)
  - Tables used:
    - `kpi_definitions` - KPI metadata (IDs, names, types)
    - `kpi_values` - Time-series KPI data points (date, value, territory, notes)
    - `appeals` - Municipal appeals/complaints (direction, status, sentiment, curator, executor)
    - `user_profiles` - User roles and permissions (display_name, role)
    - `tg_chats` - Monitored Telegram chats (chat_id, title, type, subscribers, is_active)
    - `tg_messages` - Raw Telegram messages (chat_id, message_id, date, sender_name, text, reply_to_id)
    - `tg_issues` - Detected issues from message analysis (title, summary, severity, status, message_count, location, direction)
    - `tg_issue_messages` - Junction table linking issues to messages (issue_id, message_id)
    - `tg_news` - Channel news summaries (chat_id, message_id, text, photo_url, summary, topic, location, severity, channel_name, post_url)
    - `tg_channel_stats` - Channel growth tracking (chat_id, date, subscribers, posts_found)
    - `tg_analysis_log` - Analysis job logs (started_at, finished_at, status, threads_found, alerts_found, queue_size)
    - `app_settings` - Application settings including proxy config (key, value)
    - `heatmap_data` - Geographic heatmap metrics (territory, latitude, longitude, metric_value)
    - `staff_data` - Staff information and KPIs
    - `territories` - Geographic territories/regions
    - `roadmap_milestones` - Project roadmap items

**File Storage:**
- Local filesystem only
  - Frontend: Session files for Telethon (`.tg_session`)
  - Export: Client-side PDF/image export via html2canvas + jsPDF

**Caching:**
- None explicit (Supabase handles query caching at the database level)
- React state management via hooks (useKpiData, useAppeals, useSocialMonitor, etc.)
- In-memory chat counts cache in `useSocialMonitor` hook (Map<chatId, {total, today}>)

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (built-in PostgreSQL auth)
  - Implementation: Email + password
  - Methods:
    - `supabase.auth.signInWithPassword(email, password)` in `src/shared/hooks/useAuth.tsx`
    - `supabase.auth.signOut()` for logout
    - `supabase.auth.getSession()` on app load
    - `supabase.auth.onAuthStateChange()` for listening to auth events
  - User profiles loaded from `user_profiles` table
  - Role-based access:
    - `admin` - Full edit access
    - `editor` - Edit access
    - `viewer` - Read-only (default)
  - Session persistence: Browser storage (Supabase SDK default)
  - Provider: `src/shared/hooks/useAuth.tsx` (AuthContext + useAuth hook)

**Authorization:**
- Role-based access control (RBAC)
  - `canEdit` flag: true for admin/editor roles
  - `isAdmin` flag: true for admin only
  - Frontend gates: useAuth().canEdit checks in edit forms
  - Backend: RLS policies on Supabase tables

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, DataDog, or similar)
- Console error logging in frontend hooks (catch blocks)
- Python logging in bot/analyzer (print statements)

**Logs:**
- Frontend: Browser console (development), no centralized logging
- Backend: Stdout/stderr to systemd journal
- Supabase: Built-in query logs, audit trails
- Analysis jobs: `tg_analysis_log` table tracks execution (started_at, finished_at, status, threads_found, alerts_found)

## CI/CD & Deployment

**Hosting:**
- Frontend: Linux server (Nginx)
  - Deploy mechanism: rsync via SSH
  - Server: root@185.225.34.215:/var/www/kpi-dashboard/
  - SSH key: ~/.ssh/id_ed25519
  - Security headers configured via `config/nginx-security-headers.conf`
- Backend (Telegram bot + analyzer): Linux server
  - Managed via systemd (service restart loop for config reloads)
  - Python services with env file: `tg-bot/.env`

**CI Pipeline:**
- None detected in codebase
  - Manual builds: `npm run build` (TypeScript + Vite bundling)
  - Manual tests/lint: `npm run lint`, `npm test` (no test setup found yet)

## Environment Configuration

**Required Environment Variables:**

**Frontend (Vite):**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous API key

**Python Bot/Backend:**
- `TG_API_ID` - Telegram API ID (from my.telegram.org)
- `TG_API_HASH` - Telegram API hash
- `TG_SESSION` - Telethon session file name/path
- `ANALYSIS_INTERVAL` - Interval (seconds) between analysis runs
- `DEEPSEEK_API_KEY` - DeepSeek LLM API key
- `DEEPSEEK_MODEL` - DeepSeek model identifier
- `ALERT_CHAT_ID` - Telegram chat ID for alerts (from alerts module)
- Supabase credentials: Passed via custom `db` module (likely from environment)

**Dynamic Configuration (Supabase app_settings table):**
- `tg_proxy_type` - Proxy type: mtproto, socks5, socks4, http
- `tg_proxy_host` - Proxy hostname
- `tg_proxy_port` - Proxy port number
- `tg_proxy_secret` - MTProto secret
- `tg_proxy_username` - Proxy username (optional)
- `tg_proxy_password` - Proxy password (optional)
- Picked up every ~60 seconds via systemd restart loop

**Secrets Location:**
- Frontend: `.env` file (not committed, Vite loads via import.meta.env)
- Backend: `.env` files in root and `tg-bot/` (Python dotenv conventions)
- Supabase: Stored as settings records in `app_settings` table (editable from Settings page)

## Webhooks & Callbacks

**Incoming:**
- Telegram webhooks: None detected (using polling/long-polling via Telethon)
  - Real-time message handling via `@client.on(events.NewMessage)` decorator

**Outgoing:**
- DeepSeek API calls: Async HTTP POST to `https://api.deepseek.com/chat/completions`
- Telegram alerts: Sends analysis results to ALERT_CHAT_ID (optional outbound message)
- Supabase: RPC calls for analytics
  - `get_chat_message_counts()` - Aggregated message statistics
  - `get_unanalyzed_messages(msg_limit)` - Queue for pending analysis

## Data Flow

**KPI Dashboard Frontend:**
1. User logs in via Supabase Auth
2. App loads user profile from `user_profiles` table
3. Hooks fetch data from Supabase:
   - `useKpiData()` → `kpi_definitions` + `kpi_values`
   - `useAppeals()` → `appeals` table (filtered by direction, status, date)
   - `useSocialMonitor()` → `tg_chats`, `tg_issues`, `tg_news`, analysis logs
4. Data displayed in interactive charts (Recharts), maps (Leaflet), tables

**Telegram Monitoring Pipeline:**
1. Python bot (Telethon client) listens to monitored chats from `tg_chats` table
2. New messages → saved to `tg_messages` (handled in `on_message()` handler)
3. Every ANALYSIS_INTERVAL, batch unanalyzed messages
4. Send batch to DeepSeek API with system prompt (Russian, municipal context)
5. Parse JSON response with detected issues, threads, severity
6. Store/update in `tg_issues` table
7. Update `tg_analysis_log` with execution stats
8. Send high-severity alerts to ALERT_CHAT_ID (optional)
9. Frontend `useSocialMonitor()` fetches and displays active issues

---

*Integration audit: 2026-04-19*
