# KPI Dashboard — SocPulse

## What This Is

A unified management portal for rural territories of Mytishchi Urban District. Aggregates citizen complaints, institutional KPIs, social media sentiment, and infrastructure metrics into a single operational dashboard with a composite Social Health Index per settlement. Target users: district leadership, Deputy Head of Administration (rural territories), department heads.

## Core Value

Real-time awareness of settlement-level social health — leadership sees problems as they emerge, not after they escalate.

## Requirements

### Validated

- ✓ Email/password authentication with role-based access (viewer/editor/admin) — existing
- ✓ Appeals data display with date filtering and territory breakdown — existing
- ✓ KPI tracking with configurable targets, thresholds, and trend indicators — existing
- ✓ ISN (sentiment index) calculation from Telegram bot data — existing
- ✓ Geographic heatmap of appeals with geocoding and district boundary — existing
- ✓ Social media monitoring page (Telegram groups) — existing
- ✓ Attendance tracking integration (Yandex Vector) — existing
- ✓ CSV/Excel import for appeals data — existing
- ✓ PDF/image export for reports — existing
- ✓ Russian locale formatting throughout — existing
- ✓ Telegram bot for message collection and DeepSeek/Claude analysis — existing (tg-bot/)
- ✓ Lazy-loaded SPA with sidebar navigation — existing

### Active

- [ ] Social Health Index — composite weighted metric per settlement aggregating complaints, response times, satisfaction, ecology, infrastructure
- [ ] Configurable index weights — admin UI to adjust formula weights as priorities shift
- [ ] Per-settlement scoring — individual Social Health Index score for each rural settlement
- [ ] Unified dashboard overview — single view aggregating all data sources (appeals, KPIs, sentiment, heatmap, attendance)
- [ ] Real-time Telegram alerting — push alerts to leadership Telegram group when complaint spikes or index thresholds breached
- [ ] tg-monitor feed integration — real-time complaint layer from Telegram monitoring as live data source
- [ ] KPI scorecards per institution — performance cards for MBU MTH, MKU Ecology, Rural Territories Admin with trend analysis
- [ ] Geographic drill-down — click settlement on map to see detailed metrics and index breakdown
- [ ] Role-based views — different dashboard layouts for leadership vs department heads vs operators
- [ ] Trend analysis and period comparison — compare settlement health across weeks/months

### Out of Scope

- Mobile native app — web-first, responsive design sufficient for tablet use
- Public-facing portal — internal tool for administration only
- Automated response system — dashboard is for monitoring, not automated action
- Multi-district support — single district (Mytishchi) only
- Historical data migration — start from current data, no backfill of legacy systems

## Context

- **Existing infrastructure:** Supabase (PostgreSQL) for data, React 19 + Vite 8 + TypeScript frontend, Telegram bot (Telethon + DeepSeek) running on VPS (185.225.34.215, socpulse.ru)
- **Data sources already flowing:** Appeals from Excel imports, KPI targets from settings, Telegram group messages via tg-bot, attendance from Yandex Vector integration
- **Institutions tracked:** MBU MTH (municipal services), MKU Ecology Management, Rural Territories Administration
- **Settlements:** Multiple rural settlements within Mytishchi district (Pogonny, Fedoskino, etc.)
- **Codebase state:** ~1500 lines of codebase documentation in .planning/codebase/. Well-structured React SPA with shared hooks pattern, CSS Modules, no global state manager. Pages: Overview, KpiDetail, Appeals, ISN, Attendance, SocialMonitor, HeatMap, Settings

## Constraints

- **Tech stack**: React 19 + Vite + TypeScript frontend, Supabase backend — no migration
- **Hosting**: VPS at socpulse.ru — single server deployment
- **Language**: UI must be in Russian, code comments/variables in English
- **Data**: Supabase is the single source of truth — all data flows through it
- **Auth**: Supabase Auth — role system already implemented (viewer/editor/admin)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Weighted formula for Social Health Index | Simpler than ML-based, leadership can understand and adjust | — Pending |
| Per-settlement granularity (not district-wide) | Enables targeted intervention, identifies specific problem areas | — Pending |
| Telegram for alerting (not email/SMS) | Already using Telegram bots, leadership active in TG groups | — Pending |
| Admin-configurable weights | Priorities shift seasonally (ecology in summer, heating in winter) | — Pending |
| Supabase as sole backend | Already invested, handles auth + DB + edge functions | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-06 after initialization*
