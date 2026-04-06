# Codebase Concerns

**Analysis Date:** 2026-04-06

## Tech Debt

**Untyped Data Mappings (Type Safety Risk):**
- Issue: Multiple `.map()` operations use `any` types instead of proper interface definitions
- Files: 
  - `src/shared/hooks/useSocialMonitor.ts:65,82,88,91,95,127,133,186,201,224`
  - `src/shared/ui/Chart/Chart.tsx:64`
  - `src/pages/SocialMonitor/SocialMonitor.tsx:423,469`
- Impact: Runtime type errors possible when Supabase API response structure changes. Data casting silently fails without warnings.
- Fix approach: Create typed interfaces for all Supabase response objects. Replace `(c: any)` with properly typed parameters using mapped types from interfaces like `TgChat`, `TgMessage`, `TgIssue`. See `useKpiData.ts` for correct pattern using `Record<string, unknown>`.

**Missing Error Handling in Async Operations:**
- Issue: Several async callbacks in `useSocialMonitor.ts` (updateIssueStatus, addChat, removeChat, updateChatId, addChat for channels) lack try-catch or error propagation
- Files: `src/shared/hooks/useSocialMonitor.ts:106-143`
- Impact: UI receives no feedback when database operations fail. Silent failures lead to inconsistent state between UI and backend.
- Fix approach: Wrap all `supabase.from().update/insert/delete()` calls in try-catch. Return error objects or throw typed errors. Update components using these functions to handle error states.

**Geocoding Safety Issue:**
- Issue: `geocodeAppeals()` function has infinite loop protection at 10 batches but no timeout per batch. API calls can hang indefinitely.
- Files: `src/shared/lib/geocode.ts:17-35`
- Impact: Browser freezes if Supabase Edge Function is slow or unresponsive. User cannot cancel long-running geocoding.
- Fix approach: Add request timeout (30s per batch), cancellation token support, and progress callback. Implement proper cleanup in case of errors.

**Profile Loading Without Error Handling:**
- Issue: `loadProfile()` in `useAuth.tsx` does not handle database errors. If `user_profiles` query fails, auth context shows loading=false but profile=null indefinitely.
- Files: `src/shared/hooks/useAuth.tsx:54-62`
- Impact: User appears logged-in but cannot access features requiring profile data. No error UI shown.
- Fix approach: Add try-catch to loadProfile. Set an error state or retry mechanism. Show error toast if profile cannot load.

## Known Bugs

**Race Condition in HeatMap Geocoding:**
- Symptoms: Multiple rapid clicks on "Start Geocoding" button trigger parallel geocoding processes. Data state becomes inconsistent.
- Files: `src/shared/hooks/useHeatmapData.ts:61-79`
- Trigger: Click "Geocoding" button twice within 100ms
- Workaround: Disable button while geocodingRef.current is true, but current code doesn't fully prevent re-entry
- Fix: Ensure button is disabled while `geocoding.active === true`, or use Promise-based locking instead of ref flag

**Bot Event Loop Hanging:**
- Symptoms: Telegram bot occasionally freezes, stops responding to new messages after ~24 hours
- Files: `tg-bot/bot.py:107-162` (periodic_tasks loop)
- Trigger: Analysis or participant update takes longer than expected, blocks sleep(60)
- Root cause: Synchronous task scheduling with no timeout for async operations
- Fix approach: Use asyncio.wait_for() with timeout for each major operation. Implement watchdog timer. Consider separate asyncio tasks instead of sequential checking.

**Analyzer Message Over-Processing:**
- Symptoms: Messages sometimes analyzed twice or skipped entirely
- Files: `tg-bot/analyzer.py:357-359`
- Trigger: If analysis fails after message marking but before completion, message is marked analyzed but issue never saved
- Root cause: mark_analyzed() called before analysis completes; no transactional atomicity
- Workaround: Re-run analysis manually to catch missed messages
- Fix approach: Move mark_analyzed() to END of successful analysis block. Use database transaction or versioning to prevent double-analysis.

## Security Considerations

**Supabase Anonymous Key in Frontend:**
- Risk: `VITE_SUPABASE_ANON_KEY` is exposed in browser JavaScript. Anyone with browser access can make arbitrary Supabase queries using RLS policies as sole protection.
- Files: `src/shared/lib/supabase.ts:3-4`
- Current mitigation: Supabase RLS policies on tables enforce row-level access control. Auth context requires valid session.
- Recommendations: 
  1. Verify all critical tables have RLS policies enabled (user_profiles, kpi_values, appeal_updates, tg_issues)
  2. Add rate limiting on Supabase functions (analyze-sentiment, geocode)
  3. Consider service role proxy for sensitive operations instead of direct frontend access
  4. Audit that auth.users table cannot be queried directly by anon key

**Missing CSRF Protection on Settings Changes:**
- Risk: Settings updates (`useAppSettings.ts:43-50`) and KPI edits (`Settings.tsx:62-69`) have no CSRF token validation
- Files: `src/shared/hooks/useAppSettings.ts`, `src/pages/Settings/Settings.tsx:62-160`
- Current mitigation: Supabase auth tokens, but if session is compromised, attacker can modify settings
- Recommendations:
  1. Implement nonce-based CSRF tokens for form submissions
  2. Add request signing to sensitive operations
  3. Require re-authentication for critical setting changes

**Telegram Chat ID Validation:**
- Risk: Chat IDs are not validated before storing. Invalid or user-controlled chat IDs could cause bot crashes or unexpected behavior.
- Files: `src/pages/SocialMonitor/SocialMonitor.tsx:245-254`, `tg-bot/bot.py:21-26`
- Current mitigation: Chat ID format check in channel add (numeric vs username), but no validation on server side
- Recommendations:
  1. Validate chat ID format before storing: must be numeric or valid @username
  2. Test bot access to chat before confirming add
  3. Rate limit chat addition endpoint

## Performance Bottlenecks

**N+1 Query in SocialMonitor Chat Stats:**
- Problem: `fetchChatStats()` calls fetch twice for every chat (stats + recent messages). With 20+ chats, triggers 40+ DB queries.
- Files: `src/shared/hooks/useSocialMonitor.ts:150-155` (Promise.all with nested queries per chat)
- Cause: Stats and message counts loaded separately per chat in map loop
- Improvement path:
  1. Use single RPC to get all chat stats with aggregates
  2. Cache chat statistics with 5-min TTL
  3. Implement pagination for "recent messages" instead of full list

**Large Array Mappings Without Memoization:**
- Problem: `SocialMonitor.tsx` re-renders entire issue list and chat list on every data change
- Files: `src/pages/SocialMonitor/SocialMonitor.tsx:49-50,99,369` (map() without React.memo on children)
- Cause: No list virtualization; renders all 100+ issues even if user scrolls to 10
- Impact: Sluggish scrolling, memory leak risk on mobile
- Fix approach: Use react-window or react-virtuoso for virtualized lists. Memoize issue/chat card components.

**Promise.all Without Error Boundary:**
- Problem: If one of 6 Promise.all queries fails, entire UI shows error. No partial data display.
- Files: `src/shared/hooks/useSocialMonitor.ts:55-62`
- Impact: One slow/failing endpoint blocks display of all other data
- Fix approach: Use Promise.allSettled() instead. Render partial data with error UI per section.

**Geocoding Batch Processing Unbounded:**
- Problem: `geocodeAppeals()` processes in batches but with no rate limiting. 10 batches × 50 appeals = 500 API calls if all ungeocoded.
- Files: `src/shared/lib/geocode.ts:34-35`
- Impact: Can exhaust Supabase Edge Function quota, cause rate limiting
- Fix approach: Add delay between batches (500ms), respect Supabase rate limit headers, implement exponential backoff

## Fragile Areas

**Leaflet Map Initialization:**
- Files: `src/pages/HeatMap/HeatMap.tsx:67-80, 103-175`
- Why fragile: Multiple refs and DOM manipulations. Map instance can be created before mapRef.current is ready. No cleanup on unmount if DOM element removed.
- Safe modification: Always check mapInstanceRef.current before operations. Add AbortController for async setup. Test with rapid mount/unmount cycles.
- Test coverage: No unit tests for map lifecycle. Integration tests only via Storybook.

**Settlement Coordinates Hardcoded:**
- Files: `src/shared/lib/settlement-coords.ts` (191 lines of static coordinates)
- Why fragile: If geographic boundaries change or new settlements added, must edit code and redeploy. No admin UI to manage.
- Safe modification: Consider moving to Supabase table with migration. Add validation that coordinates are within expected bounds.
- Dependency: Used by address resolution and area filtering

**Issues Deduplication Logic:**
- Files: `tg-bot/analyzer.py:395-412` (merge_overlapping_threads, deduplication in process_batch)
- Why fragile: Matching existing issues by ID requires active_issues list. If analyzer crashes before saving, duplicates possible.
- Safe modification: Use database transactions or log pending updates. Test with concurrent runs.
- Test coverage: No unit tests for deduplication scenarios

**Auth Context Loading State:**
- Files: `src/shared/hooks/useAuth.tsx:26-62`
- Why fragile: If loadProfile() is slow, entire app shows nothing (null children). No loading UI for profile.
- Safe modification: Show authenticated loading state (skeleton) instead of null. Add timeout on profile fetch (30s max).

## Scaling Limits

**Supabase Row Count Limits:**
- Current capacity: Appeals table likely has 100k+ rows. Monthly queries at current volume (~500/day) = 15k rows/month
- Limit: Supabase free tier or Pro tier limits on row count. Performance degrades at 1M+ rows without proper indexing.
- Scaling path:
  1. Ensure indexes on `appeals.date`, `appeals.direction`, `tg_messages.chat_id`
  2. Archive old appeals (>1 year) to separate table
  3. Implement read replicas for heavy reporting queries
  4. Use database views for aggregated stats

**Telegram Message Storage:**
- Current capacity: If 30 chats × 1000 messages/day = 30k messages/day. Monthly = 900k rows/month.
- Limit: Message deduplication and storage becomes expensive. Queue processing can lag.
- Scaling path:
  1. Implement message pruning (delete messages >6 months old)
  2. Add message compression in database (store text preview only, full text in separate cold table)
  3. Separate hot message table (1 week) from cold archive
  4. Rate limit message insert to prevent table bloat

**Analysis Queue Processing:**
- Current capacity: Analyzer processes 200 messages per batch, runs every 30 minutes. Max 2800 messages/day analyzed.
- Limit: If chat volume grows to 5000+/day, queue backs up. Analysis lag increases.
- Scaling path:
  1. Increase batch size dynamically based on queue depth
  2. Run multiple analyzer workers in parallel
  3. Use job queue system (Bull, RQ) instead of cron-like loop
  4. Implement priority queue for critical chats

## Dependencies at Risk

**Telethon Library Stability:**
- Risk: Telethon is community-maintained, not official Telegram client. Telegram API changes can break compatibility.
- Impact: Bot may fail to connect or miss messages after Telegram API update
- Current mitigation: Version pinned in requirements.txt
- Migration plan: Monitor Telethon releases monthly. Maintain changelog of breaking API changes. Consider python-telegram-bot as fallback if Telethon becomes unmaintained.

**DeepSeek API Availability:**
- Risk: DeepSeek is external service. API outages or rate limits will block analysis.
- Impact: Social monitoring becomes unavailable. No offline fallback.
- Current mitigation: Error handling in analyzer.py tries/except
- Migration plan: Implement local LLM fallback (ollama) for non-critical analysis. Cache recent issue labels for quick tagging. Add retry logic with exponential backoff.

**Leaflet.heat Library:**
- Risk: npm package unmaintained since 2020. No TypeScript types, potential security vulnerabilities.
- Impact: Heatmap visualization breaks with Leaflet version changes
- Current mitigation: Fixed version in package.json
- Migration plan: Evaluate MapGL or Mapbox for heatmap. Implement custom heatmap rendering if needed.

**Supabase Breaking Changes:**
- Risk: Supabase API v1 → v2 migration may break supabase-js client
- Impact: Entire app authentication and data access fails
- Current mitigation: Version pinned to ^2.101.1
- Migration plan: Monitor Supabase release notes. Test major version upgrades in staging. Keep upgrade timeline in ROADMAP.

## Missing Critical Features

**No Offline Support:**
- Problem: App requires real-time connection to Supabase. No cached data if connection lost.
- Blocks: Mobile use in areas with spotty connectivity. Desktop use during maintenance windows.
- Approach: Implement local storage cache for critical tables (KPI definitions, recent appeals). Use service worker for offline read-only mode.

**No Data Export with History:**
- Problem: CSV/PDF export shows only current filtered view. Historical exports cannot be compared.
- Blocks: Analysis of trends over time. Audit trail of KPI changes.
- Approach: Store export snapshots with timestamp. Implement diff view for exports.

**No Real-Time Alerts for Critical Issues:**
- Problem: ISS index and critical social issues require manual dashboard refresh to detect
- Blocks: Rapid response to escalations
- Approach: Implement WebSocket subscription for critical issues. Send push notifications when severity >= 8.

**No Bulk Edit for Appeals:**
- Problem: Changing status/direction requires editing one appeal at a time
- Blocks: Workflow efficiency for large bulk updates
- Approach: Add checkbox selection and bulk action menu

## Test Coverage Gaps

**No Tests for Geocoding:**
- What's not tested: Batch processing, error recovery, rate limiting, coordinate validation
- Files: `src/shared/lib/geocode.ts`, `src/shared/hooks/useHeatmapData.ts`
- Risk: Geocoding can fail silently, leaving coordinates null. No test coverage for edge cases.
- Priority: High (affects core feature: heatmap)

**No Tests for Deduplication Logic:**
- What's not tested: Merge scenarios, existing_issue_id matching, escalation detection
- Files: `tg-bot/analyzer.py:265-312` (merge_overlapping_threads)
- Risk: Duplicate issues can be created. False escalations possible.
- Priority: High (affects data quality)

**No Tests for Auth Flow:**
- What's not tested: Session expiry, profile loading errors, concurrent login attempts
- Files: `src/shared/hooks/useAuth.tsx`
- Risk: User locked out if session corrupted. No error recovery path.
- Priority: High (affects critical feature: authentication)

**No Tests for Supabase RLS Policies:**
- What's not tested: User cannot modify other users' data, anon key cannot write to sensitive tables
- Files: Database layer (not in code repo)
- Risk: Security vulnerabilities if RLS misconfigured. Data leakage.
- Priority: Critical (security)

**No Integration Tests for SocialMonitor:**
- What's not tested: End-to-end flow: add chat → receive messages → analyze → create issue → update status
- Files: `src/pages/SocialMonitor/SocialMonitor.tsx` (entire feature)
- Risk: Breaking changes in useSocialMonitor hooks not caught until production
- Priority: Medium (affects monitoring feature)

**No Tests for Race Conditions:**
- What's not tested: Concurrent fetchData calls, simultaneous issue updates, parallel geocoding
- Files: All hooks using `useCallback` with fetch patterns
- Risk: Data corruption from race conditions in high-traffic scenarios
- Priority: Medium (affects reliability)

---

*Concerns audit: 2026-04-06*
