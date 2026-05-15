# Domain Pitfalls: Social Health Index + Real-Time Alerting

**Domain:** Municipal composite scoring dashboard with Telegram alerting
**Researched:** 2026-04-06
**Project:** KPI Dashboard — SocPulse

---

## Critical Pitfalls

Mistakes that cause rewrites, data distrust, or leadership loss of confidence in the index.

---

### Pitfall 1: Inverting the Direction of "Worse is Higher" Metrics

**What goes wrong:** The Social Health Index formula treats all sub-metrics as "higher = better" by default. Complaints count, response time, and unresolved rate are all *better when low*. If they are fed into the weighted sum without inversion, the index *increases* when the settlement is in trouble — the exact opposite of intended behavior.

**Why it happens:** Developers focus on the formula weights and miss the normalization sign. Appeals count goes from 5 to 50 in July — the index climbs, leadership thinks things are improving.

**Consequences:** Leadership loses trust in the index permanently. Explaining "the formula had the sign wrong" after a crisis is not recoverable. The `KpiDefinition` type already models `direction: 'lower' | 'higher'` — this must be applied to every sub-metric before the weighted sum.

**Prevention:**
- For every sub-metric: if `direction === 'lower'`, normalize as `1 - (value / max_value)` before weighting.
- Add a unit test for each sub-metric that asserts: "when appeals increase, normalized score decreases."
- Document the sign explicitly in the weight configuration UI with a label ("lower is better — inverted automatically").

**Detection (warning signs):**
- Index score rises during the same period complaints data shows a spike.
- Test: seed a settlement with known-bad data (high complaints, zero resolutions) and assert score < 0.3.

**Phase mapping:** Address in the phase that defines the index formula and normalization logic, before any UI is shown to leadership.

---

### Pitfall 2: Computing the Index in the Frontend (Client-Side)

**What goes wrong:** The existing architecture computes KPI aggregates in `useMemo` hooks in the browser. Replicating this for the Social Health Index means: every client computes the score independently, different browser sessions can show different scores (race conditions on data fetch order), the score is not persistable, and Telegram alerts cannot read it.

**Why it happens:** Following the existing pattern without considering that the composite index has cross-domain inputs (appeals + KPIs + sentiment + ecology) that are expensive to fetch all at once.

**Consequences:** Alert logic in the Python bot cannot know the current index. Leadership opens dashboard on two devices and sees different scores. No audit trail of historical index values.

**Prevention:**
- Persist index scores to a `settlement_health_scores` table in Supabase (computed server-side by a scheduled Postgres function or Edge Function).
- Frontend reads pre-computed scores, does not recompute.
- Python bot reads from same table to trigger alerts.
- This is the architecture that lets alerts and dashboard share a single source of truth.

**Detection (warning signs):**
- Index score varies between page refreshes.
- Cannot write "alert when index < 40" because the bot has no access to client-side computed values.

**Phase mapping:** Address at the data model design phase before any formula implementation begins.

---

### Pitfall 3: Alert Fatigue from Flat Thresholds

**What goes wrong:** A single threshold ("alert when index < 50") fires constantly in low-score settlements that are chronically underperforming. Leadership starts ignoring all alerts within a week.

**Why it happens:** Static thresholds feel simple and correct at design time. They do not account for baseline variance per settlement: Fedoskino at 42 is normal, Pogonny at 42 is a crisis.

**Consequences:** The alerting feature becomes the "boy who cried wolf" feature. Leadership disables Telegram notifications. The entire value proposition — real-time awareness — is lost.

**Prevention:**
- Use *relative* thresholds: alert when score drops more than X points from the 30-day moving average for that specific settlement.
- Implement severity tiers: INFO (score dips 5 points), WARNING (score dips 10 points), CRITICAL (score dips 20+ points OR drops below absolute floor of 25).
- Rate-limit alerts: one alert per settlement per 4-hour window regardless of how many triggers occur.
- Add a `last_alerted_at` and `alert_count_today` column to prevent flood.

**Detection (warning signs):**
- In the first week of deployment, the same settlement triggers more than 3 alerts per day.
- Leadership asks "can you turn off the alerts?"

**Phase mapping:** Address in the alerting implementation phase. Define tier logic before writing the first `send_message()` call.

---

### Pitfall 4: Telegram Bot Event Loop Blocking on Alert Delivery

**What goes wrong:** The existing `bot.py` has a known bug: `periodic_tasks` loop blocks if analysis takes too long (CONCERNS.md documents this — bot hangs after ~24 hours). Adding synchronous alert delivery inside the same loop makes this worse: if Telegram API is slow (rate limiting, RetryAfter), the entire monitoring pipeline stalls.

**Why it happens:** Alert delivery is added as `await send_message(chat_id, text)` directly inside the analysis loop. Telegram imposes ~20 messages/minute per group. If the bot tries to send 5 alerts at once, it hits RetryAfter and the `await` blocks for 30+ seconds.

**Consequences:** Bot freezes. New Telegram messages stop being collected. The real-time feed goes stale silently. The CONCERNS.md already flags this as a known issue that will be amplified.

**Prevention:**
- Fix the existing event loop bug first (use `asyncio.wait_for()` with timeout on all major operations).
- Decouple alert delivery from the monitoring loop: write alert payloads to a `pending_alerts` table in Supabase, process them in a separate async task with its own retry/backoff logic.
- Use Telegram's built-in RetryAfter handling: catch `FloodWaitError`, respect the `retry_after` value, re-queue the alert.
- Never send more than 1 alert per group per 3 seconds (Telegram group limit is ~20/minute).

**Detection (warning signs):**
- Bot stops saving new messages within an hour of deploying alerts.
- `FloodWaitError` in bot logs.

**Phase mapping:** Fix the event loop issue in the same phase as alerting, not after.

---

### Pitfall 5: Sparse or Missing Settlement Data Silently Degrading Scores

**What goes wrong:** Not all settlements have data for all index components. Ecology data might be absent for three months for Fedoskino. If the formula divides by total weight including ecology, that settlement's score is unfairly penalized relative to settlements where ecology reports flow regularly.

**Why it happens:** The weighted sum formula assumes all components are present. When a sub-metric has no data for a period, it is treated as 0 (worst possible score), not as "not applicable."

**Consequences:** Settlements with incomplete data pipelines appear to be in crisis. Leadership focuses resources on data gaps rather than real problems. Trust in index degrades.

**Prevention:**
- Track data availability per settlement per sub-metric per period in the scoring table.
- Use *relative weights* that renormalize to 1.0 when components are missing: if ecology data is absent, redistribute its weight proportionally to available components.
- Show a "data completeness" badge per settlement (e.g., "4 of 5 components available — ecology data missing since March").
- Never display a composite score if fewer than 3 of 5 components have data.

**Detection (warning signs):**
- A settlement has a lower score than it should given manually observed conditions.
- Ecology column is NULL for >50% of rows in recent data.

**Phase mapping:** Address in data model and score computation phase, before geographic drill-down UI is built.

---

## Moderate Pitfalls

---

### Pitfall 6: Weight Configuration UI That Lets Weights Not Sum to 1.0

**What goes wrong:** Admin sets weights: complaints 40%, response time 30%, satisfaction 20%. Forgets ecology (currently 10%). Clicks Save. The formula silently uses weights that sum to 90%, making every score 10% lower than expected. Or the admin sets ecology to 20%, now total is 110%, scores exceed 100%.

**Why it happens:** The weight editor allows free-form numeric input without normalization feedback.

**Prevention:**
- Validate on save: weights must sum to 100% ± 0.1%.
- Show a live "remaining" counter as admin edits weights ("10% unallocated").
- Provide a "normalize automatically" button that redistributes weights proportionally.
- Store weights as decimals (0.4, 0.3, 0.2, 0.1) not percentages, validate `sum === 1.0` in Supabase constraint.

**Phase mapping:** Weight configuration admin UI phase.

---

### Pitfall 7: No Versioning of Index Formula Changes

**What goes wrong:** Admin changes weights in October (ecology 0.1 → 0.3 because it's burning season). Historical index scores now look different when the chart renders historical values using the current formula. Leadership sees that "the September score changed" and concludes the data is unreliable.

**Why it happens:** Historical scores are recomputed on-the-fly using current weights, not stored with the weights that produced them.

**Prevention:**
- Store a `formula_version_id` alongside each computed score row.
- Log weight changes to a `formula_versions` table with `effective_from` timestamp.
- When displaying trends, use the formula version active during each period.
- Show a "formula changed on Oct 5" annotation on the trend chart.

**Phase mapping:** Score persistence and trend analysis phase.

---

### Pitfall 8: Geographic Drill-Down Map Re-Initializing on Every Score Update

**What goes wrong:** The existing HeatMap page has a fragile Leaflet initialization (CONCERNS.md: "Map instance can be created before mapRef.current is ready"). If the new unified dashboard subscribes to real-time score updates and re-renders the map component on each change, the map reinitializes, pan/zoom is lost, and the UI flickers.

**Why it happens:** Settlement score updates trigger parent state change → map component unmounts/remounts → Leaflet re-initializes.

**Prevention:**
- Keep map instance in a `useRef` that survives React re-renders (existing pattern in HeatMap — replicate it).
- Only update marker styles/colors when scores change, never unmount the map container.
- Use `useMemo` to stabilize settlement GeoJSON layer; only re-compute when scores array changes by reference.
- Test: update a settlement score while map is panned to edge — verify position is preserved.

**Phase mapping:** Geographic drill-down phase.

---

### Pitfall 9: Supabase Webhook Fan-Out Dropping Events Under Batch Insert

**What goes wrong:** The Python bot periodically bulk-inserts analyzed issues. Supabase database webhooks (pg_net) have a documented bug: when multiple rows are inserted in a batch, webhooks fire for only *some* of the inserts, not all. This means alerting triggers miss events.

**Why it happens:** pg_net processes up to 200 queued webhook requests at a time. Under load, requests time out and are not retried (at-most-once delivery). Multiple simultaneous triggers from the same table can be silently dropped.

**Prevention:**
- Do not rely solely on Supabase DB webhooks for alert triggers.
- Add a `needs_alert_check` boolean column to `settlement_health_scores`. Python bot sets it to `true` when it computes a new score. A separate polling loop (every 60s) reads `needs_alert_check = true` rows and processes alerts, then sets the flag to `false`.
- This polling pattern is more reliable than webhook-based for alerting, given the existing infrastructure.

**Detection (warning signs):**
- Some score changes that should trigger alerts do not result in Telegram messages.
- pg_net logs show timeout errors.

**Phase mapping:** Alert delivery implementation phase.

---

### Pitfall 10: No Rate Limiting on Score Recomputation

**What goes wrong:** The unified dashboard triggers index recomputation whenever date range changes. If each recomputation queries 5 data sources across multiple settlements with joins, a single date picker interaction fires 20+ Supabase queries simultaneously. On the free/Pro tier, this can exhaust connection pool or trigger rate limits.

**Why it happens:** Following the existing pattern (each hook fetches independently on param change) without considering that the Social Health Index aggregates across all hooks simultaneously.

**Prevention:**
- Debounce date range changes with 500ms delay before triggering score recomputation.
- Pre-aggregate scores server-side on a schedule (every 30 minutes or on data change), so the dashboard reads a snapshot rather than computing live.
- Use a single Supabase RPC call that returns all settlement scores in one round-trip instead of N hook calls.

**Phase mapping:** Unified dashboard and score computation architecture phase.

---

## Minor Pitfalls

---

### Pitfall 11: Russian Locale Score Labels Truncating on Mobile

**What goes wrong:** Settlement names like "сельское поселение Федоскинское" combined with score badges and trend indicators overflow on 375px-width mobile screens. Leadership checking alerts on phones sees a broken layout.

**Prevention:** Design the settlement score card with a max-width constraint on the name field (truncate with `text-overflow: ellipsis`). Test at 375px viewport from the start.

**Phase mapping:** Geographic drill-down and unified dashboard UI phase.

---

### Pitfall 12: Alert Message Text Exceeding Telegram's 4096 Character Limit

**What goes wrong:** If the alert includes index breakdown with all 5 sub-metric scores, settlement history, and recommendation text, it can exceed Telegram's message length limit. The `send_message()` call silently fails or throws.

**Prevention:** Keep alert messages to 3 lines max: settlement name, current score, what changed. Link to the dashboard for details. Test with the longest possible settlement name and maximum decimal precision.

**Phase mapping:** Alert delivery implementation phase.

---

### Pitfall 13: Hardcoded Settlement List Out of Sync with Scoring Formula

**What goes wrong:** `settlement-coords.ts` has 191 lines of static coordinates. The scoring formula will need to enumerate settlements too. If these lists diverge (a new settlement is added to the scoring table but not to `settlement-coords.ts`, or vice versa), geographic drill-down silently shows incomplete coverage.

**Prevention:** Migrate settlement definitions to a Supabase `settlements` table (CONCERNS.md already recommends this). Both the scoring formula and the map layer read from the same authoritative list.

**Phase mapping:** Data model phase, before any settlement-specific feature is built.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Index formula definition | Direction inversion (Pitfall 1) | Unit test each sub-metric direction before wiring UI |
| Score persistence architecture | Client-side computation (Pitfall 2) | Store scores server-side before building UI |
| Alert threshold design | Alert fatigue (Pitfall 3) | Define relative thresholds and tier levels in spec |
| Bot alert delivery | Event loop blocking (Pitfall 4) | Decouple alerts from monitoring loop |
| Score computation with sparse data | Missing data degrading scores (Pitfall 5) | Renormalize weights when components absent |
| Weight configuration UI | Weights not summing to 1 (Pitfall 6) | Live validation and normalization button |
| Trend chart over time | Formula version drift (Pitfall 7) | Store formula_version_id with each score row |
| Map + real-time updates | Leaflet reinit on re-render (Pitfall 8) | Keep map in useRef, update markers only |
| Webhook-triggered alerts | Supabase fan-out drops (Pitfall 9) | Polling pattern with `needs_alert_check` flag |
| Unified dashboard date filter | Query fan-out on date change (Pitfall 10) | Single RPC call + debounce |

---

## Sources

- Stacey Barr: [3 Reasons to Avoid Composite Indexes and Scores](https://www.staceybarr.com/measure-up/3-good-reasons-to-avoid-indexes-and-scores/) — actionability trap
- UNECE: [Composite Indices and Dashboards (2024)](https://unece.org/sites/default/files/2024-07/TaskForce_CH6_draft_20240701.pdf) — normalization and weight methodology
- ArcGIS: [How Calculate Composite Index Works](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-statistics/how-calculate-composite-index-works.htm) — direction inversion pattern
- Supabase: [Database Webhooks](https://supabase.com/docs/guides/database/webhooks) and [pg_net issue #86](https://github.com/supabase/pg_net/issues/86) — fan-out drop bug
- Supabase: [Stacksync CDC Options Comparison](https://www.stacksync.com/blog/supabase-cdc-options-triggers-webhooks-realtime-compared) — at-most-once delivery limitation
- python-telegram-bot: [Avoiding Flood Limits](https://github.com/python-telegram-bot/python-telegram-bot/wiki/Avoiding-flood-limits) — RetryAfter and rate limit handling
- Kentik: [Network Alert Best Practices](https://www.kentik.com/kentipedia/network-monitoring-alerts/) — escalating severity tiers
- Hyperping: [12 DevOps Alert Management Strategies](https://hyperping.com/blog/devops-alert-management) — alert fatigue from flat thresholds
- Medium: [Beyond Dashboards — Actionable Alerts](https://medium.com/@harsh1995hg/beyond-dashboards-creating-actionable-data-alerts-notifications-for-proactive-insights-ff44171a4ad8) — alert content design
- DEV Community: [Common Mistakes in React Admin Dashboards](https://dev.to/vaibhavg/common-mistakes-in-react-admin-dashboards-and-how-to-avoid-them-1i70)
- Project CONCERNS.md: Existing codebase analysis — event loop bug, Leaflet fragility, settlement-coords.ts fragility, N+1 query patterns
