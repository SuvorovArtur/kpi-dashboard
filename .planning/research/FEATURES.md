# Feature Landscape

**Domain:** Municipal social health index dashboard (internal government tool)
**Project:** SocPulse — KPI Dashboard for Mytishchi Urban District
**Researched:** 2026-04-06

---

## Context

This is a subsequent milestone on top of an existing React+Supabase dashboard. The following features are already shipped and NOT listed below as table stakes:

- Email/password auth with viewer/editor/admin roles
- Appeals data with date filtering and territory breakdown
- KPI tracking with configurable targets and thresholds
- ISN (Telegram sentiment index) calculation and display
- Geographic heatmap of appeals with geocoding
- Social media monitoring page (Telegram groups)
- Attendance tracking (Yandex Vector)
- CSV/Excel import and PDF/image export
- Russian locale formatting throughout
- Sidebar SPA navigation with lazy loading

All features below pertain to the active milestone: Social Health Index, unified dashboard, and real-time alerting.

---

## Table Stakes

Features that users of a composite-index monitoring system will expect. Missing any of these and the tool fails its core purpose.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Composite Social Health Index score per settlement | The core product promise — one number that summarizes settlement health so leadership can triage fast | Medium | Weighted linear aggregation is the industry standard (UNECE, ONS Health Index). Formula: normalized(complaints) + normalized(response_time) + normalized(satisfaction) + normalized(ecology) + normalized(infrastructure), each with configurable weight |
| Admin-configurable index weights | Composite indices with fixed weights are opaque and lose trust quickly. Priorities shift seasonally (heating in winter, ecology in summer) | Medium | Admin-only UI. Store weights in Supabase, invalidate cached scores on save. Weights must sum to 1.0 or 100% — validate this |
| Per-settlement score history / trend line | A single snapshot is useless for management — direction matters as much as level. "Is Pogonny getting worse or better?" | Medium | Time-series view, last 30/90 days minimum. Line chart per settlement |
| Unified overview dashboard | Leadership's first screen. Aggregates all data sources into a single operational view: index scores, top KPIs, complaint spike status, latest sentiment | High | Must replace or augment the current Overview page. Card-based layout. Most critical info at top |
| Index breakdown per settlement | When a settlement scores poorly, leadership needs to know which sub-dimension is the problem (complaints? response time? ecology?) | Medium | Expandable detail card or modal per settlement. Bar chart showing each dimension's contribution |
| Geographic drill-down | Click on settlement in heatmap and see its full index breakdown and metric detail. DISHA (India national scheme monitor) established this as the standard UX for multi-settlement government tools | Medium | Integrates with existing HeatMap page. Side panel or modal on settlement click |
| KPI scorecards per institution | MBU MTH, MKU Ecology, Rural Territories Admin each need their own performance card. Leadership tracks institutional accountability by institution, not just by territory | Medium | Trend indicator (up/down), target vs. actual, period comparison |
| Period comparison | Compare settlement health across calendar periods (this month vs. last month, this week vs. same week last year) | Medium | Needed for reporting cycles. Date range pickers already exist in the codebase |
| Real-time complaint spike alerting | If complaint volume spikes above threshold, leadership must know before it escalates. This is the "awareness before escalation" core value stated in PROJECT.md | Medium | Supabase realtime subscription or scheduled Supabase Edge Function polling. Telegram sendMessage API to leadership group |
| Index threshold breach alerting | When a settlement's Social Health Index drops below a configured floor, send alert. Distinct from spike alert — this catches slow degradation | Low | Reuses same alerting infrastructure as spike alerts. Configurable floor per settlement or global |

---

## Differentiators

Features that distinguish this tool from generic KPI dashboards and deliver specific value for district management.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Seasonal weight presets | Leadership can save named weight configurations ("Summer (ecology priority)", "Winter (heating priority)") and switch with one click | Low | Extend the weight admin UI. Store named presets in Supabase. Low complexity, high perceived value |
| Settlement health ranking table | Sort all settlements by index score, change since last period, and worst dimension. Drives meeting agendas — "Pogonny is #1 risk, here's why" | Low | Simple sorted table with conditional formatting. Feeds naturally from existing per-settlement scores |
| Alert fatigue suppression (cooldown period) | Alerting systems that fire too often get muted. Add a configurable cooldown window so the same alert doesn't fire more than once per N hours | Low | Simple timestamp check before sending. Research shows this is the #1 cause of alert systems being disabled |
| Complaint spike detection with baseline comparison | Alert only when complaints exceed not a fixed number but a rolling 7-day or 30-day baseline by N%. Avoids false positives in naturally high-complaint periods | Medium | Rolling window query in Supabase. More accurate than raw count threshold |
| Annotation layer on trend charts | Allow editors to mark events on the trend timeline (e.g., "heating outage in Fedoskino", "road repair started"). Explains anomalies in historical data | Medium | Supabase table for annotations. Click on chart to add marker with text |
| tg-monitor live feed as real-time complaint layer | Integrate the live Telegram monitoring feed as a distinct data source in the index calculation — not just historical Excel imports | High | Requires Supabase Edge Function or webhook from VPS tg-monitor process. Significantly improves index freshness |
| Role-differentiated layouts | Leadership (viewer) sees summary cards and settlement ranking. Department heads see their institutional KPIs front and center. Admins see configuration panels. Research consistently shows role-based layouts reduce cognitive load and improve adoption | Medium | Conditional rendering based on existing role system (viewer/editor/admin). Not separate routes — same route, different layout composition |

---

## Anti-Features

Features to explicitly NOT build in this milestone, and why.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| ML-based index scoring | Black-box models destroy trust with government officials who need to explain scores to citizens and auditors. Linear weighted average is transparent, auditable, and understood | Stick with weighted linear aggregation with visible formula |
| Automated response or ticket dispatch | PROJECT.md explicitly out-of-scope. Monitoring tool, not action tool. Scope creep here risks delaying index delivery | Alert informs a human, human decides action |
| Public-facing dashboard or portal | Internal tool. Adding public output requires separate auth flows, data sanitization, accessibility compliance, and political review | If public reporting is needed later, export to PDF/image (already exists) |
| Email or SMS alerting channels | Leadership already uses Telegram actively. Adding channels multiplies maintenance surface and fragments attention. Telegram is the right channel | Telegram only. Keep the stack coherent |
| Multi-district support | Single district scope keeps data model simple. Multi-tenancy would require schema changes to Supabase that break existing queries | Single-district. If expansion needed, revisit at a major version |
| Real-time websocket data streaming | Overkill for a municipal operations tool. Polling every 30-60 seconds via Supabase Realtime or scheduled functions is sufficient and vastly simpler | Supabase Realtime subscriptions on relevant tables, or Edge Function cron polling |
| Native mobile app | Web-first with responsive design handles tablet use. A native app doubles the codebase with no clear value for internal tool users who are at desks or carrying tablets | Responsive web only. Already stated in PROJECT.md out-of-scope |
| Historical data migration / backfill | Backfilling creates false precision for old periods where data quality is unknown. Index values computed from incomplete historical data mislead trend analysis | Display "data available from [date]" on trend charts. No backfill |
| Granularity below settlement level | Building or street-level data is not available from current sources. Designing for it creates false expectation | Settlement is the atomic unit. Do not design schemas or UI for sub-settlement breakdowns |

---

## Feature Dependencies

```
Configurable weights ──────────────────────────────┐
                                                    ↓
Per-settlement data sources (complaints, KPIs) ──→ Composite Index Score ──→ Settlement history / trend
                                                    ↓
                                                Index breakdown per settlement
                                                    ↓
                                            Geographic drill-down (HeatMap integration)
                                                    ↓
                                        Unified overview dashboard (consumes all above)

Composite Index Score ──→ Index threshold breach alert
Appeals volume data ──────→ Complaint spike detection ──→ Spike alert → Telegram notification
Both alerts ──────────────────────────────────────────→ Alert cooldown suppression

tg-monitor live feed ──→ Real-time complaint layer ──→ Composite Index Score (improves freshness)

Role system (existing) ──→ Role-differentiated layouts
KPI scorecards ──────────→ Unified overview dashboard
```

**Critical path:** Configurable weights + per-settlement score calculation must land before everything else. The overview dashboard and drill-down are both consumers of index scores. Alerts are consumers of both index scores and complaint volume.

---

## MVP Recommendation

For this milestone, prioritize in this order:

**Must ship (core index functionality):**
1. Composite Social Health Index score per settlement (with formula)
2. Admin-configurable weights UI
3. Index breakdown per settlement (bar chart per dimension)
4. Settlement health ranking table (simple sorted table, very low cost, high value)
5. Per-settlement score trend line (last 30/90 days)

**Must ship (alerting):**
6. Complaint spike alert → Telegram (uses existing tg-bot infrastructure)
7. Index threshold breach alert → Telegram (reuses alert infrastructure)
8. Alert cooldown suppression (prevents alert fatigue, small effort)

**Must ship (unified view):**
9. Unified overview dashboard (replaces/upgrades current Overview page)
10. Geographic drill-down (extends existing HeatMap, side panel on settlement click)
11. KPI scorecards per institution

**Defer to next milestone:**
- tg-monitor live feed integration (High complexity, separate service integration)
- Annotation layer on trend charts (valuable but not blocking)
- Seasonal weight presets (nice-to-have, extend weight admin later)
- Role-differentiated layouts (functional without it, add after core stabilizes)
- Complaint spike detection with rolling baseline (ship with simple threshold first, upgrade to rolling window later)

---

## Sources

- [Measuring the Health of Populations: Explaining Composite Indicators — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4140376/)
- [UNECE Guidelines: Composite Indices and Dashboards](https://unece.org/sites/default/files/2024-07/TaskForce_CH6_draft_version_v3.1_20240701.pdf)
- [ONS Health Index Methods and Development](https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/healthandwellbeing/methodologies/healthindexmethodsanddevelopment2015to2019)
- [City Health Dashboard Metrics](https://www.cityhealthdashboard.com/metrics)
- [DISHA Dashboard — Settlement-level geographic drill-down](https://socialcops.com/case-studies/disha-dashboard/)
- [8 Local Government Public Dashboard Examples — Envisio](https://envisio.com/blog/8-local-government-public-dashboard-examples/)
- [Role-Based Dashboards for Analytics — ZealousWeb](https://www.zealousweb.com/blog/role-based-dashboards-for-business-analytics/)
- [Social Determinants of Health: Review of Publicly Available Indices — NCBI](https://www.ncbi.nlm.nih.gov/books/NBK592585/)
- Alert fatigue patterns: [Stop Drowning in Alerts — Hyperping Blog](https://hyperping.com/blog/devops-alert-management)
- [Telegram Bot API — threshold alert integration](https://core.telegram.org/bots/api)

**Confidence levels:**
- Table stakes features: HIGH — consistent across government dashboard research, composite index literature, and project requirements
- Differentiators: MEDIUM — derived from domain patterns, may need validation with actual leadership users
- Anti-features: HIGH — explicitly confirmed by project constraints and research on alert fatigue / ML trust issues in government
