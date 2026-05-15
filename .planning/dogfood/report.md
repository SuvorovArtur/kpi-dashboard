# Dogfood Report — socpulse.ru

**Session:** `socpulse`
**Target:** https://socpulse.ru (prod)
**Date:** 2026-04-20
**Tester account:** `+79778252955` (logs in as `79778252955@socpulse.ru`, profile display_name: "Ольга")
**Output:** `.planning/dogfood/` — `screenshots/`, `videos/`, `report.md`

## Summary

| Severity | Count |
|---|---|
| HIGH | 5 |
| MEDIUM | 5 |
| LOW | 2 |
| **Total** | **12** |

**Pages visited:** Login, Overview (`/`), Appeals (`/appeals`), ISN (`/isn`), Attendance (`/attendance`), Social Monitor (`/social`), Map (`/map`), Settings (`/settings`), Staff (`/staff`), Territories (`/territories`), Roadmap (`/roadmap`).

**Pages with sidebar link:** 7 of 11 — Staff / Territories / Roadmap have routes but are **unreachable from navigation** (HIGH).

---

## ISSUE-001 — Deployed login label mismatch with source code

**Severity:** HIGH
**Area:** Auth / prod-vs-source drift
**Repro video:** N/A (static)
**Screenshot:** `screenshots/landing.png`

Deployed Login form labels its identifier field as **"Телефон"** and returns `"Неверный телефон или пароль"` on failure. Source at `src/pages/Login/Login.tsx:40` has `<label>Email</label>` with `type="email"` and error copy `"Неверный email или пароль"`. Deployed JS bundle is from pre-rebrand phase and never rebuilt/pushed after the source fix.

**Impact:** Returning users told "the field is Email" see "Телефон" and get confused; developers grepping source for user-reported strings find nothing.

**Fix:** `npm run build && rsync dist/ root@185.225.34.215:/var/www/kpi-dashboard/` — trivial, already documented in `~/.claude/projects/.../memory/deploy_target.md`.

---

## ISSUE-002 — Password must include leading `+` — zero guidance

**Severity:** HIGH
**Area:** Auth / UX
**Repro video:** N/A (verified via fetch hook)
**Screenshot:** `screenshots/login-empty-submit.png`

The "Телефон" input strips `+` before prepending `@socpulse.ru`, so both `89778252955` and `+79778252955` map to the same Supabase account `79778252955@socpulse.ru`. But **the password is stored with the `+` literal** (`+79778252955`). A user who enters phone `89778252955` and password `89778252955` gets "Неверный телефон или пароль" with no hint that the password is a differently-formatted representation of the same number.

**Intercepted payload evidence:**
```
input: phone=89778252955, pass=89778252955
sent:  {"email":"89778252955@socpulse.ru","password":"89778252955"}
result: FAIL

input: phone=+79778252955, pass=+79778252955
sent:  {"email":"79778252955@socpulse.ru","password":"+79778252955"}
result: SUCCESS
```

**Impact:** Undiscoverable auth. Any user who lost their sticky-note is locked out.

**Fix:** Either (a) always normalize BOTH email and password inputs server-side before compare (not feasible retroactively), or (b) reset passwords to the normalized phone without `+` and tell users the format. Also add a "Формат: +7XXXXXXXXXX" placeholder.

---

## ISSUE-003 — Double percent sign on 5 KPI cards across 3 pages

**Severity:** HIGH
**Area:** Visuals / KpiCard component
**Repro video:** N/A (static, visible on load)
**Screenshots:**
- `screenshots/overview.png` — "Горячие адреса" shows **27% %**
- `screenshots/appeals.png` — "Отложенные" shows **1,4% %**, "Повторные" shows **0,0% %**
- `screenshots/isn.png` — "Острые обращения" shows **19.2% %**

The KpiCard component renders `{value}{unit}`. For percentage KPIs the value string already contains `%` (e.g. `"27%"`) AND the unit prop is also `"%"`, producing `27% %`. Bug lives in whichever page passes pre-formatted percent values.

**Impact:** Main dashboard looks broken. First thing a non-technical stakeholder sees.

**Fix:** Either strip trailing `%` from value in `src/shared/ui/KpiCard/KpiCard.tsx`, or audit each consumer and pass raw number with `unit="%"` (never `value="27%"` + `unit="%"` at same time).

---

## ISSUE-004 — Negative time "через -22м назад" on Social Monitor analyzer status

**Severity:** HIGH
**Area:** Copywriting / functional
**Repro video:** N/A (static)
**Screenshot:** `screenshots/social.png`

Analyzer status bar: `Последний: 8м назад` / `Следующий: -22м назад`. A "next run" can't be in the past. This means the scheduled run is overdue by 22 minutes but the timer formatter just prepends `-` instead of handling "overdue" as its own state ("Запуск просрочен на 22 мин").

Also the dot next to "Анализатор" is grey — no colour-coded state (running/overdue/idle/error).

**Impact:** Support users seeing this think the clock is broken; they don't realize the analyzer itself is stuck.

**Fix:** In `src/pages/SocialMonitor/SocialMonitor.tsx` (or helper that formats `nextRun`), branch on `nextRunDelta < 0` and render "Просрочен N мин" with warning colour, not a minus sign.

---

## ISSUE-005 — Three source pages are routable but unreachable from navigation

**Severity:** HIGH
**Area:** Navigation / UX
**Repro video:** N/A (absent in UI, verified via direct URL)
**Screenshots:** `screenshots/staff.png`, `screenshots/territories.png`, `screenshots/roadmap.png`

Sidebar nav shows **7 items** (Обзор / Обращения / ИСН / Яндекс Вектор / Соцсети / Карта / Настройки). Routes `/staff`, `/territories`, `/roadmap` render full pages with titles "КАДРЫ", "ТЕРРИТОРИИ", "ДОРОЖНАЯ КАРТА" and empty-state CTAs. No sidebar entry, no button, no link anywhere points to them. Users cannot discover these features.

Sidebar also fails to highlight the active route when these orphan pages load — "Обзор" stays selected.

**Impact:** 27% of the app is invisible to end-users.

**Fix:** Decide whether these pages are promoted to nav or deprecated. If kept — add sidebar items in `src/shared/ui/Sidebar/Sidebar.tsx` + wire active-state logic to match `location.pathname`. If dropped — remove routes from `src/app/routes.tsx`.

---

## ISSUE-006 — Buttons on Settings and Roadmap are brand-breaking blue (#3b82f6)

**Severity:** MEDIUM
**Area:** Color / design tokens
**Repro video:** N/A (static)
**Screenshots:** `screenshots/settings.png`, `screenshots/roadmap.png`

"Изменить" buttons across all Settings KPI-target rows are **blue** (#3b82f6). Same for Roadmap's "Все" active tab fill and "+ Добавить" outline. Brand primary is teal (see `src/index.css` or Sidebar active state). Likely caused by `--color-primary` being undeclared and falling back to a Tailwind blue default in those CSS-modules. (Cross-ref: `.planning/UI-REVIEW.md` finding — same root cause.)

**Impact:** Product looks unfinished; two of the most frequently-visited admin pages use the wrong accent.

**Fix:** Add `--color-primary: var(--color-teal);` to `:root` in `src/index.css`. Single-line fix, affects both pages.

---

## ISSUE-007 — Cryptic column headers `D90 / D180 / D360` in Settings KPI-targets table

**Severity:** MEDIUM
**Area:** Copywriting
**Repro video:** N/A (static)
**Screenshot:** `screenshots/settings.png`

Settings → "Целевые значения KPI" table has columns labeled `D90`, `D180`, `D360`. No explanatory header, no tooltip, no row label. Users guess "days"? "D-series"? "Deltas"?

**Fix:** Rename to `"90 дней"`, `"180 дней"`, `"360 дней"` OR add a "Горизонт целей" subtitle + tooltip on each `D*` header.

---

## ISSUE-008 — Attendance day-edit panel uses unlabeled `x` and ambiguous `OK`

**Severity:** MEDIUM
**Area:** Copywriting / a11y
**Repro video:** N/A (static)
**Screenshot:** `screenshots/attendance.png`

Bottom of Attendance calendar: `День 20 — / 50 92% [OK] [x]`.
- `x` is a bare Latin letter, no `aria-label`. In context it's unclear whether it means close, cancel, or delete.
- `OK` is inconsistent with the site-wide save pattern ("Сохранить" elsewhere).
- The editable number between "День 20" and "/ 50" shows `—` (em-dash) as placeholder — users cannot tell a field is there without clicking. Cross-ref: `.planning/UI-REVIEW.md:Copywriting`.

**Fix:** `x` → "Отмена" + `aria-label="Отменить изменение"`. `OK` → "Сохранить". Dash placeholder → numeric input with `placeholder="Кол-во"`.

---

## ISSUE-009 — Empty/orphan tab button on ISN period selector

**Severity:** MEDIUM
**Area:** Visuals
**Repro video:** N/A (static)
**Screenshot:** `screenshots/isn.png`

ISN page: to the LEFT of `День / Неделя / Месяц / Квартал / Год / Всё` there's a **blank button (no text, empty box)**. Either a leftover render target, a misplaced icon, or a broken translation key. Not present on other pages that reuse the same tab row (Overview, Appeals, HeatMap — all 6-tab).

**Fix:** Inspect `src/pages/ISN/ISN.tsx` for a preceding period option being rendered as empty. Likely fallthrough on a conditional that should have been removed.

---

## ISSUE-010 — H1 title is a full sentence on every page

**Severity:** MEDIUM
**Area:** Typography / information density
**Repro video:** N/A (static)
**Screenshots:** all

Every page renders the same massive uppercase H1:
- Overview: "ДАШБОРД УПРАВЛЕНИЯ ПО РАЗВИТИЮ СЕЛЬСКИМИ ТЕРРИТОРИЯМИ" (paragraph-length)
- Appeals: "ОБРАЩЕНИЯ"
- ISN: "ИНДЕКС СОЦИАЛЬНОГО НАПРЯЖЕНИЯ"
- Social Monitor: "МОНИТОРИНГ СОЦСЕТЕЙ"
- Attendance: "ВЫХОД СОТРУДНИКОВ НА ЛИНИЮ"
- HeatMap: "КАРТА ОБРАЩЕНИЙ"
- Settings: "НАСТРОЙКИ"

Overview's is wildly out of proportion — wraps to 2 lines on a 1280px viewport and eats 80px of above-the-fold space for something users saw in the sidebar brand 2 seconds ago. Rest are fine but create inconsistent H1 weight across the app.

**Fix:** Overview specifically — replace H1 with a short tagline or the current month/period label; move brand name fully into the sidebar. Audit other page H1s for being too long.

---

## ISSUE-011 — `<=` rendered as ASCII, not `≤`

**Severity:** LOW
**Area:** Typography
**Repro video:** N/A (static)
**Screenshot:** `screenshots/appeals.png`

KpiCard subtitles on Appeals show `Цель: <= 20`, `Цель: <= 10%`, `Цель: <= 5%` as ASCII less-than-equals. Proper Unicode is `≤` (U+2264).

**Fix:** Replace `<=` with `≤` in the card prop string (likely `src/pages/Appeals/Appeals.tsx` constants).

---

## ISSUE-012 — Date suffix "г." feels dated

**Severity:** LOW
**Area:** Copywriting
**Repro video:** N/A (static)
**Screenshots:** all pages

Every page shows `понедельник, 20 апреля 2026 г.` below the H1. The trailing `"г."` (год) is a Soviet-era stylistic mark — modern Russian UI rarely uses it. Either drop the `г.` or change format to `20 апр 2026` / `Сегодня, 20 апреля`.

**Fix:** Change date formatter in `src/shared/ui/Header` (or wherever that line is rendered).

---

## Nice-to-have observations (not graded issues)

- **Profile name leaks:** Sidebar shows "Ольга" while I logged in as a different phone number. The `user_profiles` row for account `79778252955` has `display_name = 'Ольга'`. Not a bug per se — just an artifact of test data. Worth noting for a real rollout.
- **HeatMap direction pills:** 16 category pills in 4 rows take ~140px of height above the map. A collapsed multi-select dropdown would give the map more canvas.
- **Social Monitor stat "ОСТРЫЕ 100% (6 из 11)":** The percent and fraction disagree visually. The 100% probably refers to "100% of issues flagged acute are currently open" but the adjacent "6 из 11" reads as "55%" and the cognitive math is jarring. Worth re-wording.
- **"Анализ ИСН" and "Геокодировать (11)" buttons** share the same orange tint — unclear whether this signals "pending work" or is a brand accent. On Appeals it sits next to the primary teal CTA; on HeatMap it's alone. Intent unclear.
- **Period selector state** differs: active tab on Overview (Неделя highlighted) vs Appeals (nothing highlighted) vs ISN (empty first tab). Cross-page inconsistency even though all use the same component.

## Top 5 prioritized fixes (impact × effort)

1. **ISSUE-003 doubled %** — one-hour code fix, visible on main dashboard, 5 KPI cards affected → **fix first**.
2. **ISSUE-006 blue buttons** — one-line CSS token → **fix with #3**.
3. **ISSUE-001 deploy drift** — literally a deploy command.
4. **ISSUE-005 hidden pages** — decide product intent, then either add nav or delete routes.
5. **ISSUE-004 negative time** — small formatter fix, high confidence rate of confusing support tickets.
