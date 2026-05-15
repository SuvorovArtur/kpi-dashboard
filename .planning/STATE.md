# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-06)

**Core value:** Real-time awareness of settlement-level social health
**Current focus:** Project initialization — requirements definition

## Current Status

**Workflow:** `/gsd-new-project` in progress
**Stage:** Step 7 — Defining Requirements (paused for user clarification)
**Last action:** Research completed, feature scoping started

## Completed Steps

- ✓ Codebase mapped (7 documents, 1542 lines) — `.planning/codebase/`
- ✓ PROJECT.md created with validated + active requirements
- ✓ config.json created (YOLO, coarse, parallel, balanced model profile)
- ✓ Research completed (4 parallel agents) — `.planning/research/`
  - STACK.md — zero new npm packages, SHI in PostgreSQL + pg_cron
  - FEATURES.md — 10 table stakes, 7 differentiators, 9 anti-features
  - ARCHITECTURE.md — PostgreSQL scoring, Realtime push, Edge Function alerts
  - PITFALLS.md — 13 pitfalls (direction inversion, alert fatigue, TG rate limits)
  - SUMMARY.md — synthesized findings

## Pending Steps

- ○ Define v1 requirements (scope features by category)
- ○ Create REQUIREMENTS.md with REQ-IDs
- ○ Create ROADMAP.md (spawn gsd-roadmapper)
- ○ Generate CLAUDE.md with GSD guidance

## Key Research Findings

- SHI calculation must live in PostgreSQL (`plpgsql` function via `supabase.rpc()`)
- pg_cron writes to `settlement_health_scores` every 15 min
- Supabase Realtime pushes score updates to browser (regular table, NOT materialized view)
- Alert delivery: Edge Function or aiohttp in existing tg-bot
- Only new dependency: `aiohttp >= 3.9` on Python bot
- Critical pitfall: direction inversion for "lower is better" metrics
- Telegram throttling risk in Russia (April 2026) — design swappable delivery layer

## Config Summary

| Setting | Value |
|---------|-------|
| Mode | YOLO |
| Granularity | Coarse (3-5 phases) |
| Parallelization | Yes |
| Commit docs | Yes |
| Model profile | Balanced (Sonnet) |
| Research | Yes |
| Plan check | Yes |
| Verifier | Yes |

## Resume Instructions

To continue: `/gsd-new-project` — will resume at requirements definition (Step 7).
User was about to scope features by category when they paused.

---
*Last updated: 2026-04-06 after research completion*
