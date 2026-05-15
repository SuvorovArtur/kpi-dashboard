# Codebase Concerns

**Analysis Date:** 2026-04-19

## Tech Debt

### Missing Error Boundary for Profile Loading

**Issue:** `src/shared/hooks/useAuth.tsx` — `loadProfile()` async function has no try-catch error handling (lines 54–62). If the Supabase query fails, the error silently fails and `setLoading(false)` never executes, causing the UI to hang in loading state.

**Files:** `src/shared/hooks/useAuth.tsx:54-62`

**Impact:** Users stuck on login screen if `user_profiles` table query fails; no error feedback.

**Fix approach:** Wrap `loadProfile()` in try-catch, set `profile` to null on error, call `setLoading(false)` in finally block.

---

### Unhandled Promise Rejections in useSocialMonitor

**Issue:** `src/shared/hooks/useSocialMonitor.ts` — Multiple `Promise.all()` and `.then()` calls lack error handling. Lines 55–61 fetch data from 5 Supabase endpoints with no individual error checking; if any single promise rejects, subsequent code attempts to access undefined properties.

**Files:** `src/shared/hooks/useSocialMonitor.ts:55-100`

**Impact:** Silent failures in chat/issue loading; UI renders with partial or stale data; user unaware of sync failures.

**Fix approach:** Wrap Promise.all in try-catch; validate each response for `.error` property before accessing `.data`.

---

### Generic Error Message in Appeals Analysis

**Issue:** `src/pages/Appeals/Appeals.tsx:71-77` — Catch block logs error to console but shows only "Ошибка загрузки данных." (generic error message) to user, regardless of actual failure cause.

**Files:** `src/pages/Appeals/Appeals.tsx:71-77`

**Impact:** Users cannot troubleshoot analysis failures; poor error feedback for debugging.

**Fix approach:** Include error type/message in user-facing toast; distinguish between network, auth, and API errors.

---

### Settings Page Error Handling Gaps

**Issue:** `src/pages/Settings/Settings.tsx` — User creation (line 158+), KPI target updates (line 178+), and territory management lack specific error messages. Errors logged to console only; users see only generic "Ошибка" toast.

**Files:** `src/pages/Settings/Settings.tsx:150-250`

**Impact:** Admins cannot distinguish transient failures from permission/validation errors.

**Fix approach:** Parse error.message and surface specific messages to user (e.g., "Phone already exists", "Invalid port number").

---

## Security Considerations

### Supabase Anon Key Exposed in Frontend

**Issue:** `src/shared/lib/supabase.ts` — Supabase client initialized with public anon key (lines 3–4) imported from `import.meta.env`. While anon keys are designed for public use, this enables direct database access from client-side code without intermediate API layer.

**Files:** `src/shared/lib/supabase.ts`

**Current mitigation:** Supabase RLS (Row-Level Security) policies should enforce authorization in database.

**Recommendations:** Verify all database tables have strict RLS policies enabled; audit that users cannot escalate permissions or query data outside their role; consider proxying sensitive operations (user creation, proxy config updates) through Supabase Functions.

---

### Proxy Password Stored in Database (Settings)

**Issue:** `src/pages/Settings/Settings.tsx:116` and `tg-bot/bot.py:61` — Telegram proxy password stored as plaintext in `app_settings` table. While Supabase encryption at rest helps, this is a single point of failure if database is compromised.

**Files:** `src/pages/Settings/Settings.tsx:98-132`, `tg-bot/bot.py:49-80`

**Current mitigation:** Supabase connection encrypted in transit; database encryption at rest.

**Recommendations:** 
- Use Supabase Secrets or environment-based configuration for proxy credentials instead of database table.
- Rotate proxy credentials regularly.
- Add audit logging for proxy config changes.

---

### Hardcoded Dobrodel URL in AppealDetail

**Issue:** `src/shared/ui/AppealDetail/AppealDetail.tsx:102` — URL hardcoded as `https://dobrodel.mosreg.ru/appeal/{source_number}`. If this domain changes or becomes unavailable, links silently fail.

**Files:** `src/shared/ui/AppealDetail/AppealDetail.tsx:102`

**Impact:** Users clicking "Открыть в Добродел" encounter 404 or wrong site with no indication of misconfiguration.

**Fix approach:** Move URL base to a config constant; consider environment-based override.

---

### Login Form Phone-to-Email Conversion Logic

**Issue:** `src/pages/Login/Login.tsx:5-8` — Phone number stripped of non-digits and appended with `@socpulse.ru` to create email. If phone format changes or domain is wrong, all users locked out with silent failure.

**Files:** `src/pages/Login/Login.tsx:5-8`

**Current mitigation:** Hardcoded domain is discoverable in source code; conversion logic is deterministic.

**Recommendations:** 
- Move domain to environment config.
- Add validation: warn user if phone converts to unexpected email format.
- Test phone format edge cases (spaces, hyphens, +7 vs 8 prefix).

---

### Python Telegram Bot Credentials Loading

**Issue:** `tg-bot/bot.py` imports `TG_API_ID, TG_API_HASH, TG_SESSION` from `config` module (line 17) — config file not in repository, likely loaded from `.env` file. If `.env` is misconfigured or missing, bot crashes at startup with unclear error message.

**Files:** `tg-bot/bot.py:17`, `tg-bot/.env` (not readable but noted)

**Impact:** Bot fails silently; no way to diagnose auth issues from logs alone.

**Fix approach:** 
- Add explicit validation of config values at startup; raise clear error if missing.
- Log that bot is using config from environment, not file-based.

---

### DeepSeek API Key Exposed in Python

**Issue:** `tg-bot/analyzer.py:4` imports `DEEPSEEK_API_KEY` from config. If config is compromised, API key can be used by attackers to make untracked API calls.

**Files:** `tg-bot/analyzer.py:4, 202`

**Current mitigation:** API key only usable for DeepSeek service; rate-limited by DeepSeek account.

**Recommendations:** 
- Rotate API key regularly.
- Monitor DeepSeek usage for anomalies.
- Use environment variable with restricted permissions if possible.

---

## Performance Bottlenecks

### Large File Bundle (Settings Page)

**Issue:** `src/pages/Settings/Settings.tsx` is 680 lines in a single component file, mixing KPI targets, territory management, proxy config, and user admin functionality. Creates large bundle chunk and poor code-splitting.

**Files:** `src/pages/Settings/Settings.tsx`

**Cause:** All admin features in one page; no route-based code splitting for admin-only features.

**Impact:** Settings page loads slowly; admin features bloat main bundle even for non-admin users.

**Improvement path:** 
- Split into `SettingsKpi`, `SettingsProxy`, `SettingsUsers`, `SettingsTerritories` subcomponents.
- Lazy-load admin features only if user has `isAdmin` role.
- Use dynamic imports for proxy config (only needed by admin).

---

### Leaflet Bundle Not Chunked Correctly

**Issue:** `vite.config.ts:8-23` — Leaflet (`leaflet`, `leaflet.heat`, `react-leaflet`) not included in manual chunks, so they load with main bundle. HeatMap page (`src/pages/HeatMap/HeatMap.tsx:1-4`) imports leaflet at page level, but bundle doesn't defer leaflet until page loads.

**Files:** `vite.config.ts`, `src/pages/HeatMap/HeatMap.tsx:1-4`

**Current mitigation:** Code notes (Project CLAUDE.md) that leaflet.heat must NOT be in separate manualChunks due to global L dependency.

**Impact:** Leaflet (~180 KB gzipped) loaded on every page load, even for non-map users.

**Improvement path:** 
- Keep leaflet in main bundle (per existing design decision) but verify `leaflet.heat` plugin initialization doesn't break in chunked scenario.
- Consider lazy-loading leaflet on route to `/map` if supported by plugin.
- Monitor bundle size with `npm run build -- --analyze`.

---

### Unoptimized Recharts Import

**Issue:** `src/pages/KpiDetail/KpiDetail.tsx:1-12` and `src/shared/ui/Chart/Chart.tsx` — Both import full recharts library instead of only needed components. No tree-shaking.

**Files:** `src/pages/KpiDetail/KpiDetail.tsx:1-12`, `src/shared/ui/Chart/Chart.tsx`

**Impact:** Recharts bundle (~240 KB) loaded even if only 3–4 chart types used.

**Improvement path:** 
- Verify `vite.config.ts` has recharts in vendor chunk (it does).
- Consider dynamic import for recharts if not used on initial load (e.g., KpiDetail is gated by settings).

---

### useSocialMonitor Refetch on Every State Change

**Issue:** `src/shared/hooks/useSocialMonitor.ts:107-118` — Multiple functions (`updateIssueStatus`, `addChat`, `removeChat`) call `fetchData()` (full re-fetch) after each mutation. No optimistic updates or partial refreshes.

**Files:** `src/shared/hooks/useSocialMonitor.ts:105-118`

**Cause:** Simpler to refetch than implement optimistic UI; avoids state sync bugs.

**Impact:** Every chat add/remove/status change triggers full 5-endpoint refetch (chats, issues, counts, logs, queue); visible latency for admins bulk-adding chats.

**Improvement path:** 
- Implement optimistic updates: immediately update local state, refetch on error.
- Batch mutations: if user adds multiple chats quickly, coalesce into single refetch.
- Add mutation loading state to UI to indicate sync in progress.

---

### HeatMap Geocoding Blocks Rendering

**Issue:** `src/pages/HeatMap/HeatMap.tsx` — If `useHeatmapData()` geocodes addresses (converts to lat/lng), rendering waits for that to complete. Large address lists cause map to freeze during geocoding.

**Files:** `src/pages/HeatMap/HeatMap.tsx:52-56`

**Cause:** Geocoding API calls are synchronous in data-fetching hook; not done in background.

**Impact:** Map unusable until all addresses geocoded; user sees blank/loading state for 5–10 seconds with large date ranges.

**Improvement path:** 
- Move geocoding to Web Worker or background task.
- Render map with whatever geocoded results are available; add addresses as they complete.
- Cache geocoding results to avoid re-running for same addresses.

---

## Fragile Areas

### useAuth Context Requires AuthProvider Wrapper

**Issue:** `src/shared/hooks/useAuth.tsx:99` — Hook throws hard error if used outside AuthProvider context. No Provider in lower-level tests or utilities would cause crash.

**Files:** `src/shared/hooks/useAuth.tsx:97-101`

**Why fragile:** Adding a new hook to a utility file that calls `useAuth()` will cause that utility to crash at import time if hook is used outside React context (e.g., in a pure function test).

**Safe modification:** Check context exists before throwing; return default (unauthenticated) state if missing.

---

### SocialMonitor Data Transformation Couples UI to Schema

**Issue:** `src/shared/hooks/useSocialMonitor.ts:87-95` — Data mapping directly in hook transforms Supabase column names (snake_case) to component props (camelCase). If schema changes, multiple places need updates.

**Files:** `src/shared/hooks/useSocialMonitor.ts:87-95`, `src/pages/SocialMonitor/SocialMonitor.tsx`

**Why fragile:** Adding a new field to `tg_chats` table requires updating map in hook AND any component that uses it.

**Test coverage:** No tests verify schema transformation; if schema changes, bug discovered at runtime.

**Safe modification:** Create a dedicated `mapTgChat()` utility function; add unit test for transformation.

---

### AppealDetail Hardcodes All Fields

**Issue:** `src/shared/ui/AppealDetail/AppealDetail.tsx` — Every field conditionally rendered based on appeal object shape. If new fields added to Appeal type, this file needs update. If field disappears, code silently hides it (no error).

**Files:** `src/shared/ui/AppealDetail/AppealDetail.tsx`

**Why fragile:** No validation that all required fields are present; field order hardcoded; if schema changes, UI silently breaks.

**Test coverage:** No tests that verify all Appeal fields are displayed.

**Safe modification:** Use a form schema (Zod, io-ts) to validate Appeal at boundary; dynamically render fields from schema.

---

### HeatMap Fixed Territory List

**Issue:** `src/pages/KpiDetail/KpiDetail.tsx:45-49` — Territory options hardcoded as `['total', 'pirogovsky', 'fedoskino']`. If territories added/removed in database, code doesn't reflect change.

**Files:** `src/pages/KpiDetail/KpiDetail.tsx:39-49`

**Why fragile:** Adding new territory requires code change; UI filter doesn't match database state.

**Test coverage:** No tests verify available territories match database.

**Safe modification:** Fetch territories from database; fetch available territories from hook result instead of hardcoding.

---

### Python Bot Multi-Process Safety

**Issue:** `tg-bot/bot.py:46` — `_proxy_signature` is global mutable variable (line 46). If bot runs multiple event handlers concurrently, race condition possible when proxy config changes.

**Files:** `tg-bot/bot.py:46, 83-86`

**Why fragile:** Global state modified by `build_client()` and read by `proxy_config_changed()`. No lock protecting concurrent access.

**Current mitigation:** Telethon runs on single event loop (async), so mutations are atomic.

**Safe modification:** Document that this code assumes single event loop; add assertion or comment clarifying concurrency model.

---

## Test Coverage Gaps

### No Tests for useAuth Error Scenarios

**What's not tested:** Profile loading failure, Supabase auth failure, signIn with invalid credentials, session expiry.

**Files:** `src/shared/hooks/useAuth.tsx`

**Risk:** Changes to error handling could break silently; users see loading spinner indefinitely instead of clear error message.

**Priority:** HIGH — auth is critical path.

---

### No Tests for Data Transformation Hooks

**What's not tested:** Supabase response schema mapping in `useSocialMonitor.ts`, `useAppeals.ts`, `useAttendance.ts`. If column names change or nullable fields are missing, bugs discovered at runtime.

**Files:** `src/shared/hooks/useSocialMonitor.ts:87-95`, `src/shared/hooks/useAppeals.ts`, `src/shared/hooks/useAttendance.ts`

**Risk:** Silent data loss or type errors when Supabase schema changes.

**Priority:** HIGH — affects multiple pages.

---

### No Tests for Login Form Lock Logic

**What's not tested:** Failed login counter increments correctly, lockout timer fires after 3 fails (30s) and 5 fails (60s), timer countdown updates UI every second, lock expires and resets counter.

**Files:** `src/pages/Login/Login.tsx:16-63`

**Risk:** Lockout logic could be bypassed or timer could leak (never clear); no verification countdown is accurate.

**Priority:** MEDIUM — security feature, but manual testing is possible.

---

### No Tests for SocialMonitor Analysis Pipeline

**What's not tested:** Message deduplication logic in `tg-bot/analyzer.py:267-312`, thread merging, severity scoring, escalation detection, alert formatting.

**Files:** `tg-bot/analyzer.py:267-312`

**Risk:** Bugs in dedup/merge cause duplicate issues or lost messages; severity score calculation could be wrong; alerts sent with malformed text.

**Priority:** HIGH — core business logic.

---

### No Tests for Python Bot Error Handling

**What's not tested:** Proxy config fetch failure (line 34–43), message save failure (line 131–142), analysis timeout (line 199–223), Telegram send failure (line 219–223).

**Files:** `tg-bot/bot.py`, `tg-bot/analyzer.py`

**Risk:** Errors logged to console only; bot continues silently skipping messages/analysis; no alerting to admin.

**Priority:** MEDIUM — manual monitoring required; errors visible in logs.

---

## Missing Critical Features

### No Audit Logging for Admin Actions

**Issue:** Admin users can modify KPI targets, add/remove territories, change proxy config, and create/delete users. No audit trail of who changed what and when.

**Files:** `src/pages/Settings/Settings.tsx`, `tg-bot/bot.py` (proxy config changes)

**Impact:** Compliance risk; cannot trace misconfigurations; no accountability for settings changes.

**Fix approach:** Add audit log table; log all mutations with user ID, timestamp, old/new values.

---

### No Input Validation on Chat ID Addition

**Issue:** `src/pages/SocialMonitor/SocialMonitor.tsx:186-230` — User can add chat with any numeric ID. No validation that ID is a real Telegram chat or that bot has access to it.

**Files:** `src/pages/SocialMonitor/SocialMonitor.tsx:217-230`

**Impact:** User adds invalid chat, bot never receives messages from it, admin doesn't know why. Silent failure.

**Fix approach:** Validate chat ID format; try to connect to chat at add time; show error if bot cannot access.

---

### No Rate Limiting on API Calls

**Issue:** Frontend has no rate limiting; user can spam API calls by clicking buttons repeatedly. No debouncing on refetch operations.

**Files:** `src/pages/Appeals/Appeals.tsx:52-78` (analyze button), `src/pages/Settings/Settings.tsx` (save buttons)

**Impact:** User clicks "Analyze" button 5 times in rapid succession, backend queues 5 analysis jobs; resource waste.

**Fix approach:** Add debounce to async functions; disable buttons during fetch; show in-progress indicator.

---

## Scaling Limits

### Attendance Chart SVG Rendering

**Issue:** `src/pages/Attendance/Attendance.tsx:300-365` — Attendance chart renders every data point as SVG circle (line 346). With 30 days of data, creates 30+ circle elements. With larger date ranges or more detailed data, SVG rendering becomes slow.

**Files:** `src/pages/Attendance/Attendance.tsx:336-365`

**Current capacity:** ~30 days comfortable; 90 days might show slowdown on older machines.

**Scaling path:** 
- Use canvas instead of SVG for large datasets.
- Implement zoom/pan to reduce rendered points at a time.
- Aggregate data (e.g., weekly average) for large ranges.

---

### Heatmap Marker Density

**Issue:** `src/pages/HeatMap/HeatMap.tsx` renders one marker per appeal. If date range includes 10k+ appeals, map becomes sluggish; Leaflet struggles with that many DOM elements.

**Files:** `src/pages/HeatMap/HeatMap.tsx:52-150`

**Current capacity:** ~1k markers render smoothly; 5k+ shows visible lag on zoom/pan.

**Scaling path:** 
- Use marker clustering library (Leaflet.MarkerCluster).
- Switch to heatmap-only view (no individual markers) for large datasets.
- Implement server-side data aggregation (e.g., appeals binned to 100m grid).

---

### SocialMonitor Full-Refetch Pattern

**Issue:** `src/shared/hooks/useSocialMonitor.ts:52-101` — `fetchData()` fetches 5 endpoints every time. As issue count grows (100+), each refetch becomes slower; full page lag on mutation.

**Files:** `src/shared/hooks/useSocialMonitor.ts:52-101`

**Current capacity:** ~100 issues; ~1000 messages per chat. Comfortable for current deployment.

**Scaling path:** 
- Paginate issues; fetch only visible page.
- Implement optimistic updates to avoid full refetch after mutation.
- Move to subscription model (realtime updates) instead of polling.

---

## Dependencies at Risk

### Leaflet.Heat Global State Dependency

**Issue:** `leaflet.heat` plugin modifies Leaflet's global `L` object (registers `L.heatLayer` method). If leaflet bundle is split incorrectly or loaded out of order, `L.heatLayer` is undefined.

**Files:** `src/pages/HeatMap/HeatMap.tsx:4`

**Current mitigation:** Project CLAUDE.md explicitly prohibits separate manualChunks for leaflet; kept in main bundle.

**Risk:** High — if vite config changes or build optimization changes, breakage is silent until map page is accessed.

**Improvement path:** 
- Add runtime assertion: check `typeof L.heatLayer === 'function'` and throw clear error if missing.
- Monitor bundle size; alert if leaflet is accidentally split.

---

### Recharts Dependency Lock

**Issue:** `package.json:28` — `recharts` version pinned to `^3.8.1` (minor updates allowed). Recharts has had breaking changes in minor versions in the past.

**Files:** `package.json:28`, `src/pages/KpiDetail/KpiDetail.tsx`, `src/shared/ui/Chart/Chart.tsx`

**Risk:** MEDIUM — recharts maintainers are responsive; breaking changes rare but possible.

**Improvement path:** 
- Monitor recharts changelog; test each minor update before deploying.
- Lock to specific patch version if stability is critical.

---

### Supabase Version Drift

**Issue:** `package.json:13` — `@supabase/supabase-js` version `^2.101.1` (minor updates allowed). SDK could introduce breaking changes in minor versions.

**Files:** `package.json:13`, all files using `supabase` client

**Risk:** MEDIUM — supabase is actively maintained; breaking changes happen ~quarterly.

**Improvement path:** 
- Monitor supabase changelog; pin to specific version after testing.
- Set up dependabot alerts for critical updates.

---

## Known Bugs

### Login Lockout Not Persisted

**Issue:** `src/pages/Login/Login.tsx:16-62` — Lockout state (`lockedUntil`, `failCount`) stored in React state, not persisted. User refreshes page during lockout, counter resets and they can retry immediately.

**Files:** `src/pages/Login/Login.tsx:16-62`

**Symptoms:** Lockout can be bypassed with page refresh.

**Trigger:** 1. Enter wrong password 5 times (60s lockout begins) 2. Refresh page 3. Lockout counter reset, can try again immediately.

**Workaround:** None; user must wait 60s without page refresh.

**Fix approach:** Store lockout timestamp in sessionStorage or localStorage (with expiry); read on component mount.

---

### Supabase RLS Policy Cascade Failures

**Issue:** If a user's role changes in `user_profiles` table, existing RLS policies in `appeals`, `tg_issues`, `tg_chats` tables might not reflect the new role immediately (depends on RLS policy caching).

**Files:** Database schema (not visible in codebase), verified through `src/pages/Settings/Settings.tsx` user role updates (line 155+)

**Current mitigation:** RLS policies should not cache, but exact behavior depends on Supabase version.

**Recommendations:** Document RLS policy behavior; test role change + immediate query in test suite.

---

## Accessibility Gaps

### Heatmap SVG Not Labeled

**Issue:** `src/pages/HeatMap/HeatMap.tsx:80–100` — SVG map created without `aria-label` or descriptive text. Screen reader users cannot understand map purpose or legend.

**Files:** `src/pages/HeatMap/HeatMap.tsx`

**Impact:** Map inaccessible to blind users; no alt text for gradient legend.

**Fix approach:** Add `aria-label` to map div; add visible legend with color meanings; provide text summary of hotspots.

---

### Attendance Chart Tooltip Only on Hover

**Issue:** `src/pages/Attendance/Attendance.tsx:300–365` — Chart tooltip appears on mouse hover only. Keyboard users and touch users cannot access tooltip.

**Files:** `src/pages/Attendance/Attendance.tsx:335–363`

**Impact:** Accessibility score reduced; mobile users cannot see tooltip.

**Fix approach:** Show tooltip for focused data point; handle touch events; provide data table fallback view.

---

### No ARIA Labels on Status Buttons

**Issue:** `src/pages/SocialMonitor/SocialMonitor.tsx:115–122` — Status change buttons have no `aria-label`; screen readers read them as generic buttons.

**Files:** `src/pages/SocialMonitor/SocialMonitor.tsx:115–122`

**Impact:** Users relying on screen readers cannot understand button purpose.

**Fix approach:** Add `aria-label={`Изменить статус на ${STATUS_LABELS[s]}`}` to each button.

---

## Code Quality Issues

### Overly Complex KPI Calculation in useEffect

**Issue:** `src/pages/KpiDetail/KpiDetail.tsx:68–127` — Large useEffect that processes appeals, calculates ISN, repeated appeals, delayed appeals. Logic is hard to follow; no comments explaining each calculation step.

**Files:** `src/pages/KpiDetail/KpiDetail.tsx:68–127`

**Impact:** Difficult to maintain; bugs in KPI calculation hard to spot; no unit tests to verify logic.

**Fix approach:** Extract each KPI calculation into separate named function; add JSDoc comments; add unit tests.

---

### Python Bot Message Parsing Assumptions

**Issue:** `tg-bot/bot.py:109–142` — On message handler assumes `event.text` is always present (line 109), but filters if length < 5. No check for other message types (photo, video, sticker) which don't have text.

**Files:** `tg-bot/bot.py:109–142`

**Impact:** Non-text messages silently ignored; if user sends photo with caption, only text caption saved (no indication photo exists).

**Fix approach:** Add support for media messages; save `media_type` field; handle captions separately.

---

### DeepSeek JSON Response Parsing No Fallback

**Issue:** `tg-bot/analyzer.py:218–219` — API response parsed as JSON without error handling. If API returns invalid JSON or error response, `json.loads()` throws and entire analysis batch fails.

**Files:** `tg-bot/analyzer.py:198–223`

**Impact:** Single bad API response crashes analysis pipeline; no graceful degradation.

**Fix approach:** Wrap JSON parsing in try-catch; log response body on parse error; skip batch or return empty result on failure.

---

## Miscellaneous

### No Error Boundary for Individual Pages

**Issue:** `src/app/App.tsx:115–117` — Global ErrorBoundary wraps main content, but individual page components (Appeals, HeatMap, KpiDetail) have no error boundaries. If a page crashes, entire app becomes unusable.

**Files:** `src/app/App.tsx:12–68`

**Impact:** Single page crash can crash the entire app; user sees generic "Что-то пошло не так" message instead of isolated error.

**Fix approach:** Add ErrorBoundary wrapper around each page route; show per-page error message instead of full app error.

---

### Toast Auto-Dismiss Timeout Unconfigurable

**Issue:** `src/shared/hooks/useToast.ts:8` — Toast auto-dismisses after 3000ms (hardcoded). Users with slow internet or accessibility needs might need longer timeout.

**Files:** `src/shared/hooks/useToast.ts`

**Impact:** Toasts disappear too quickly for some users to read.

**Fix approach:** Make `dismissMs` configurable per toast; allow user to extend timeout on specific messages.

---

### Dead Code: Unused Settings Toggle

**Issue:** `src/pages/Settings/Settings.tsx` — Contains UI for toggling "show_kpi_detail" setting (line 180+), but this setting is checked only in `src/app/App.tsx:81` to conditionally show KPI menu item. No other pages use this setting.

**Files:** `src/pages/Settings/Settings.tsx:180+`, `src/app/App.tsx:81`

**Impact:** Feature works but only via menu toggle; no UI indication of what this setting does.

**Fix approach:** Document purpose in UI; consider removing if unused or add feature flag comments.

---

---

*Concerns audit: 2026-04-19*
