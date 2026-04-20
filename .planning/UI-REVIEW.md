---
generated: 2026-04-19
scope: whole-portal retroactive audit
overall_score: 14/24
screenshots: not captured (no dev server at localhost:3000 or localhost:5173)
---

# UI Review — KPI Dashboard (МБУ МТХ / SocPulse)

## Overall Score: 14/24

| Pillar | Score | One-liner |
|---|---|---|
| Copywriting | 3/4 | Labels are clear and contextually appropriate in Russian; a few places have orphaned or inconsistent microcopy |
| Visuals | 2/4 | Functional visual structure but no icons on several key actions, duplicated inline detail patterns, and SVG chart lacks aria context |
| Color | 2/4 | The design token system is partially broken — Settings/Roadmap pages use a phantom `--color-primary: #3b82f6` (blue) that is never declared in the root theme, producing blue accents on a teal-branded product |
| Typography | 2/4 | Font size scale runs from 8px to 32px with 13 discrete sizes across CSS files; heading font (Bebas Neue) applied inconsistently across pages |
| Spacing | 3/4 | Section-level rhythm is consistent at 24px; inner gaps use 6/8/10/12/16px semi-arbitrarily without a declared scale |
| Experience Design | 2/4 | Loading and error states are present but incomplete; mobile is genuinely broken at sidebar level; no confirmation dialogs for destructive actions; only 4 aria-labels in the entire codebase |

---

## Per-Page Quick Assessment

| Page | Copy | Visuals | Color | Type | Space | UX | Notes |
|---|---|---|---|---|---|---|---|
| Login | 3 | 3 | 3 | 3 | 3 | 2 | No lockout-persist, form submission has no loading spinner on the form itself |
| Overview | 3 | 3 | 3 | 2 | 3 | 3 | `isLoading = false` hardcoded; appeal detail is duplicated from Appeals page |
| KpiDetail | 3 | 2 | 2 | 2 | 2 | 2 | TERRITORY_OPTIONS hardcoded; uses both `--color-primary: #0d9488` and `--color-primary: #3b82f6` (same var, different values across files) |
| ISN | 3 | 2 | 3 | 2 | 3 | 2 | Auto-analysis starts on mount with minimal dep array (suppressed lint); score buttons have no aria labels |
| Attendance | 3 | 2 | 3 | 2 | 3 | 2 | SVG chart: tooltip is hover-only, no keyboard/touch; delete button label is "x" |
| Appeals | 3 | 2 | 3 | 2 | 3 | 3 | Filter buttons can overflow viewport with many directions; appeal detail in slide-over is duplicated vs Overview's inline version |
| HeatMap | 3 | 3 | 3 | 2 | 3 | 2 | Map has no aria-label; legend is visual-only (color gradient without text values) |
| SocialMonitor | 3 | 2 | 2 | 2 | 2 | 2 | Emoji used as status signal (✓ / ⚠ / !) without text fallback; `any` type on stats; gap between stat row is 12px vs 16px elsewhere |
| Staff | 3 | 2 | 2 | 2 | 2 | 2 | `--color-primary` resolves to teal here but hardcoded salary target of 200 in chart data |
| Territories | 3 | 2 | 2 | 2 | 3 | 2 | `--color-text-tertiary` referenced but not in root; comparison table can overflow on narrow screens |
| Roadmap | 3 | 2 | 1 | 2 | 2 | 2 | Filter tab "ТУ" has no label expansion; `--color-primary: #3b82f6` makes Add/Save buttons blue — alien to brand |
| Settings | 3 | 2 | 1 | 2 | 2 | 2 | Worst color offender: "Изменить" / "Добавить" / "Сохранить" buttons are blue (#3b82f6) while identical actions on other pages are teal |

---

## Pillar Details

### 1. Copywriting — 3/4

Justification: Russian labels are clear and domain-appropriate. No Lorem/TODO text in UI. A handful of inconsistencies and missing microcopy in edge states drop this from a 4.

**Findings:**

- [MEDIUM] `src/pages/Attendance/Attendance.tsx:144,182` — Delete button text is `"x"` (Latin character) with no aria-label and no visible label. The "OK" save button is equally bare. A user cannot tell these apart from close/cancel buttons in the same component. Fix: Replace `"x"` with `"Удалить"` (or at minimum `aria-label="Удалить запись"`); replace `"OK"` with `"Сохранить"`.

- [MEDIUM] `src/pages/Overview/Overview.tsx:168` — `const isLoading = false` is hardcoded, so the loading skeleton block (lines 170–185) is dead code. The UI never shows a loading state for the Overview page. Fix: Derive `isLoading` from `useAppeals` hook result.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.tsx:101–110` — ISS traffic-light banner uses `"✓"`, `"⚠"`, and `"!"` as the sole status signal inside `.issSignal`. These are emoji/text characters rendered as visual icons — they carry no screen-reader meaning and will display inconsistently cross-platform. Fix: Add a text label inside the signal element (e.g. `"Норма"`, `"Внимание"`, `"Критично"`) and hide it visually if desired.

- [LOW] `src/pages/SocialMonitor/SocialMonitor.tsx:218` — Error toast on failed chat add shows only `"Ошибка"` (a single word). Same pattern appears at line 259 for channels. Fix: Surface the actual error message — `setToast({ message: err instanceof Error ? err.message : 'Ошибка добавления', type: 'error' })`.

- [LOW] `src/pages/Roadmap/Roadmap.tsx:127` — The "Добавить" button header button label changes to `"Отмена"` on click, which is the standard pattern but the form title `"Новый пункт дорожной карты"` duplicates the button's intent. Minor polish: remove the redundant form title or make it more specific (e.g. `"Новая задача для МБУ МТХ"`).

---

### 2. Visuals — 2/4

Justification: Pages follow a consistent card-based structure, icons from Lucide are used thoughtfully in some places. However: appeal detail layout is duplicated across three pages with slight differences, action buttons across the app lack icons, the custom SVG attendance chart is hand-rolled at fixed pixel coordinates without responsive scaling, and there are no empty-state illustrations anywhere.

**Findings:**

- [HIGH] `src/pages/Overview/Overview.tsx:365–397` and `src/pages/Appeals/Appeals.tsx:329–411` — The appeal detail shown in the Overview slide-over is a manually coded field list that differs from the one in Appeals.tsx (Appeals has "Тип сообщения", "Сектор", "Факт"; Overview does not). There is also `src/shared/ui/AppealDetail/AppealDetail.tsx` which exists as a third variant. Three separate implementations of the same visual pattern. Fix: Converge on `AppealDetail` shared component; delete the inline versions.

- [HIGH] `src/pages/Attendance/Attendance.tsx:298–364` — The SVG chart uses a fixed `viewBox="0 0 600 150"` coordinate space. It renders via `className={styles.chart}` but if the container is narrower than 600px (mobile, collapsed sidebar) the SVG scales down and the hardcoded font sizes (8px, 9px, 10px) become illegible. Fix: Either switch to Recharts for this chart (already a project dependency) or ensure `preserveAspectRatio="none"` with `font-size` expressed as percentage of the viewBox height.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.tsx:503` — The "Отключить" (disconnect chat) button has no icon and uses a text-only gray label that blends with secondary text at a glance. Fix: Add a `Trash2` icon from Lucide and apply a subtle red hover treatment (the CSS already has `.chatRemoveBtn:hover { color: #dc2626 }` — just adding an icon clarifies affordance).

- [MEDIUM] `src/app/App.tsx:47–53` — The sidebar collapse button (`«`/`»`) uses Unicode arrow characters as labels. Its position (`left: 230px` fixed) is hardcoded and does not respond when the sidebar collapses (`left: 60px` at 1024px breakpoint) — but there is no media query override at smaller widths. Fix: Use a Lucide `ChevronLeft`/`ChevronRight` icon; position dynamically via JS or CSS custom property tied to sidebar state.

- [LOW] No empty-state illustrations anywhere. `src/shared/ui/EmptyState/EmptyState.tsx` is used but appears to be text-only. For an internal dashboard this is acceptable, but the "Нет подключённых чатов" and similar states feel abrupt. Low priority.

---

### 3. Color — 2/4

Justification: The root design token system in `src/index.css` is clean and purposeful. However a systemic defect exists: multiple page stylesheets reference CSS variables (`--color-primary`, `--color-surface`, `--color-bg-hover`, `--color-text-tertiary`, `--color-primary-light`, `--color-primary-hover`) that are **never declared** in `src/index.css`. The fallback values in these references are inconsistent — `--color-primary` resolves to `#3b82f6` (blue) in Settings/Roadmap but to `#0d9488` (teal) in KpiDetail/Staff. This means the Settings and Roadmap pages have visually alien blue buttons that have no relationship to the brand palette.

**Findings:**

- [HIGH] `src/pages/Settings/Settings.module.css:74,76,198,207` and `src/pages/Roadmap/Roadmap.module.css:37,43` — `.btnEdit`, `.btnAdd`, `.btnSave` use `var(--color-primary, #3b82f6)`. Since `--color-primary` is not in `:root`, the fallback `#3b82f6` (a Tailwind blue-500) is used. This makes all Settings page buttons blue — visually disconnected from the teal brand. Fix: Replace all fallback references to `#3b82f6` with `var(--color-teal, #0E5C5D)`, or declare `--color-primary: var(--color-teal)` in `src/index.css`.

- [HIGH] `src/pages/Settings/Settings.module.css:53,57,147,184` and similar in Overview, Territories, Roadmap — `--color-surface` and `--color-bg-hover` and `--color-text-tertiary` are referenced with fallback values (`#fff`, `#f9fafb`, `#9ca3af`) but are not declared. These happen to match the intent but create phantom variables. Fix: Add these four missing tokens to `src/index.css`: `--color-surface: #FFFFFF`, `--color-bg-hover: #F9FAFB`, `--color-text-tertiary: #9CA3AF`.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.module.css:18–28` and `ISN.module.css` — Status colors for traffic-light components use raw hex (`#f0fdf4`, `#fefce8`, `#fef2f2`, `#bbf7d0`, `#fde68a`, `#fecaca`) rather than tokens. These match Tailwind's green-50/yellow-50/red-50 palette but are not related to the declared `--color-status-green/yellow/red`. Fix: Either declare tinted background tokens (`--color-status-green-bg: #f0fdf4` etc.) or use inline opacity on the existing status colors.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.tsx:14–20` — `STATUS_COLORS` and `severityColor()` use raw hex strings (`#dc2626`, `#ca8a04`, `#16a34a`, `#9ca3af`) as JavaScript values applied via `style={{ color: ... }}`. These are not token-referenced. Fix: Reference CSS custom properties via `getComputedStyle` or use CSS class variants instead of inline styles for status colors.

- [LOW] `src/pages/Appeals/Appeals.module.css:241–244` — The `.analyzeBtn` uses `--color-orange` as both border and background, producing a fully orange button. On other pages the orange accent (`--color-orange: #FFB460`) is used only for trend indicators. This is the only orange primary action button in the product. Consider whether this intentional distinction (orange = "AI action") should be documented or standardized.

---

### 4. Typography — 2/4

Justification: The font family setup is correct — Bebas Neue for headings, Lato/Inter for body. But in practice, font-size values range from 8px (SVG tick labels in Attendance chart) to 32px (page headers), with 13 distinct sizes observed. Several pages use Bebas Neue in unexpected places (`.statValue` on SocialMonitor stat cards) or omit it where it would be expected (section titles use `font-weight: 600` on the body font instead of the heading font). There are also accessibility concerns with sub-11px text in charts and badges.

**Findings:**

- [HIGH] `src/pages/Attendance/Attendance.tsx:339,348,357,358` — SVG text nodes use `fontSize="8"`, `fontSize="9"`, `fontSize="10"` (unitless, meaning SVG user units mapped to pixels at zoom 1). At small viewport widths the SVG scales and these labels become illegible (effectively 4–5px at mobile width). Fix: These sizes are below the WCAG minimum legible threshold. Either use Recharts for the chart (which handles responsive text) or render axis labels outside the SVG as HTML.

- [HIGH] `src/pages/SocialMonitor/SocialMonitor.module.css:86–93` — `.statValue` uses `font-size: 28px; font-family: var(--font-heading)` (Bebas Neue). The stat card label uses `font-size: 11px; text-transform: uppercase`. The 28px/11px pairing (ratio 2.5x) is more aggressive than the KpiCard component which uses its own typography. The SocialMonitor stat cards are home-grown while other pages use the shared `KpiCard` component — the result is an inconsistent number rendering style.

- [MEDIUM] `src/shared/ui/Header/Header.module.css:17` — Page titles render at 32px uppercase Bebas Neue, which gives strong visual anchoring. However `src/pages/Overview/Overview.module.css:80–85` defines `.trendTitle` with `font-family: var(--font-body); font-size: 15px; font-weight: 600` — section titles inside cards use body font at 600 weight instead of heading font. This is consistent within itself but creates a split between "page-level" and "section-level" heading styles with no documented rule.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.module.css:293,535` — `.chatBarSenders` at `font-size: 9px` and `.chatBarDate` at `font-size: 9px` are below readable threshold on non-retina screens. Fix: Raise to minimum 11px.

- [LOW] `src/index.css:47–50` — `h1–h6` are mapped to `font-weight: 400` globally (Bebas Neue doesn't have meaningful weight variation, so this is intentional). But custom section title elements (`<h3 className={styles.sectionTitle}>`) in every page override this with `font-weight: 600` on the body font — the semantic heading and visual heading are disconnected. Consider whether section titles should use `<span>` or `<p>` elements instead to avoid implicit heading hierarchy conflicts.

---

### 5. Spacing — 3/4

Justification: Page-level rhythm is well-controlled — all pages use `gap: 24px` between sections in the main column, and card padding is delegated to the shared `Card` component. Inner card spacing is consistent at 16px for form fields and 8px for list items. The deductions come from arbitrary micro-gap values (2px, 6px, 10px) not on an 8px base grid, and from the absence of a declared spacing scale token.

**Findings:**

- [MEDIUM] `src/pages/Overview/Overview.module.css:91` — `.periodTabs` has `gap: 4px`, but identical tab patterns in SocialMonitor use `gap: 2px` (`src/pages/SocialMonitor/SocialMonitor.module.css:147`) and Attendance uses the same tab structure. Three tab components, three different internal gaps. Fix: Extract tab gap to a CSS variable or rely on a shared tab component with a single gap value.

- [MEDIUM] `src/pages/SocialMonitor/SocialMonitor.module.css:66–69` — `.statsRow` uses `gap: 12px` while the equivalent KPI row on Overview/Appeals pages uses `gap: 16px`. These are visually the same pattern (cards in a row). Fix: Standardize card-row gap to `16px` throughout.

- [MEDIUM] `src/app/App.module.css:13–14` — Main content area has `padding: 24px 40px`. At the 1024px breakpoint this drops to `padding: 16px`. There is no intermediate breakpoint for ~1280px screens, producing a relatively abrupt density jump. Not critical for an internal tool but noticeable.

- [LOW] `src/pages/SocialMonitor/SocialMonitor.module.css:270,280,285` — Inside `.issueExpanded`, the message list uses `gap: 4px` while the action buttons use `gap: 6px`. Within a single card's expanded state, three different micro-gap values exist (4, 6, 10). Fix: Use 8px consistently for all intra-card element gaps.

- [LOW] Missing a spacing token layer. All spacing is hard-coded pixel values. For a codebase of this size it's manageable but if components are ever extracted or a dark-mode density toggle added, there is no scale to reference.

---

### 6. Experience Design — 2/4

Justification: The application has loading states (Skeleton components), error states (EmptyState + Toast), and basic Supabase error handling. However: the sidebar has no mobile breakpoint and is unusable on a phone; there are no confirmation dialogs for destructive actions (delete territory, delete roadmap item, disconnect chat); the entire app has only 4 `aria-label` attributes; and the `isLoading = false` hardcode on Overview means users get no feedback during data load.

**Findings:**

- [HIGH] Sidebar: no mobile breakpoint exists. `src/shared/ui/Sidebar/Sidebar.module.css` defines widths of 240px (expanded) and 64px (collapsed) with no `@media` rule. `src/app/App.module.css:42–50` has a 1024px breakpoint that reduces main padding but does not collapse or hide the sidebar. On a 375px screen the sidebar + main together render a horizontal layout that is unusable. Fix: At ≤768px, render the sidebar as a bottom navigation strip or an off-canvas overlay triggered by a hamburger button. This is the highest-impact mobile fix.

- [HIGH] No confirmation for destructive actions. `src/pages/Roadmap/Roadmap.tsx:238–240`, `src/pages/Staff/Staff.tsx:61–70`, `src/pages/Settings/Settings.tsx:98–105`, `src/pages/SocialMonitor/SocialMonitor.tsx:200–201` — all delete/remove operations fire immediately on button click. A mis-click deletes a territory, staff record, or roadmap item with no way to undo. Fix: Add a simple confirm step — either `window.confirm()` as a stopgap or a shared `ConfirmDialog` component.

- [HIGH] Accessibility: `src/shared/ui/Sidebar/Sidebar.tsx:63–77` — nav items are `<button>` elements without `aria-label`. In collapsed state the text label is hidden (`!collapsed && <span>`), leaving screen readers with only the icon and no label. `src/app/App.tsx:51` has `aria-label` on the collapse button — that's good. But the 8 nav items in collapsed mode have no accessible name. Fix: Always render `aria-label={item.label}` on nav button elements.

- [MEDIUM] `src/pages/ISN/ISN.tsx:117–121` — `useEffect` auto-starts analysis when `unanalyzed > 0`, with the comment `// intentionally minimal deps — run once when unanalyzed detected`. This means loading the ISN page can silently trigger background API calls (Supabase function invocation) without user consent. Users have no UI indication that analysis is auto-running until the progress state updates. Fix: Either add an explicit "Запустить" button only (remove auto-start), or show an immediate "Автоанализ запущен..." indicator on page load.

- [MEDIUM] `src/pages/Overview/Overview.tsx:168` — `const isLoading = false` hardcoded. The five KPI cards render immediately without a skeleton state, then potentially reflow once `useAppeals` resolves. Fix: Derive isLoading from `useAppeals`.

- [LOW] `src/pages/HeatMap/HeatMap.tsx:493–502` — The map legend is purely visual: a CSS gradient bar labeled only "Низкая / Средняя / Высокая". There are no numeric values on the gradient. Users cannot tell what density counts as "высокая". Fix: Add appeal count labels at gradient endpoints (e.g. "1" and "N+").

---

## Top 10 Prioritized Fixes

Ranked by impact × effort (HIGH impact, LOW effort listed first).

1. **[HIGH, small] Add missing CSS tokens to `src/index.css`** — Settings and Roadmap pages display blue (#3b82f6) buttons because `--color-primary` is undeclared. Fix: Add `--color-primary: var(--color-teal)`, `--color-surface: #FFFFFF`, `--color-bg-hover: #F9FAFB`, `--color-text-tertiary: #9CA3AF` to `:root` in `src/index.css`. This instantly fixes the visual brand break on 2 pages with a 5-line change.

2. **[HIGH, small] Fix hardcoded `isLoading = false` in Overview** — `src/pages/Overview/Overview.tsx:168`. Replace with `const { data: appeals, isLoading } = useAppeals(...)`. The skeleton infrastructure is already in place; it just needs to be wired up.

3. **[HIGH, small] Add `aria-label` to Sidebar nav buttons in collapsed state** — `src/shared/ui/Sidebar/Sidebar.tsx:63`. Add `aria-label={item.label}` to the nav button element. One attribute, solves keyboard/screen-reader navigation for the entire app's navigation.

4. **[HIGH, medium] Sidebar mobile layout** — Currently 240px or 64px fixed, no mobile breakpoint. At ≤768px, add a bottom navigation bar or an overlay sidebar. This is the top mobile usability fix. Affects every page.

5. **[HIGH, small] Add confirmation step before destructive actions** — `Roadmap.tsx:238`, `Staff.tsx:61`, `Settings.tsx:98`, `SocialMonitor.tsx:200`. Replace instant-delete with `if (!window.confirm('Удалить?')) return;` as a minimum viable guard. Can be upgraded to a modal later.

6. **[HIGH, medium] Consolidate three appeal detail implementations** — `Overview.tsx:365–397`, `Appeals.tsx:329–411`, and `src/shared/ui/AppealDetail/AppealDetail.tsx` implement the same pattern with diverging fields. Remove inline versions and use `AppealDetail` everywhere.

7. **[MEDIUM, small] Fix sub-11px text in SocialMonitor CSS** — `SocialMonitor.module.css:293,535`: raise `.chatBarSenders` and `.chatBarDate` from `9px` to `11px`. One-line changes.

8. **[MEDIUM, small] Replace "x" / "OK" button labels in Attendance** — `Attendance.tsx:144,181,182`. Replace bare "x" delete with `aria-label` and replace "OK" save with "Сохранить". No visual impact, fixes accessibility.

9. **[MEDIUM, medium] Replace hand-rolled SVG attendance chart with Recharts** — `Attendance.tsx:298–364`. The custom SVG chart uses pixel-coordinate math and produces illegible 8px text on mobile. The recharts `LineChart` is already imported in KpiDetail and would produce a responsive, accessible chart with minimal code.

10. **[MEDIUM, small] Standardize card-row gap to 16px** — SocialMonitor stat row uses 12px gap (`SocialMonitor.module.css:69`) while equivalent rows on Overview and Appeals use 16px. Change one line.

---

## Design System Gaps

These are concepts used across multiple pages that should be formalized as tokens or shared components but currently are not.

- **Missing token: `--color-primary`** — Referenced in 12+ CSS files with two conflicting fallback values (`#3b82f6` and `#0d9488`). Should be declared as `var(--color-teal)` in `:root`.

- **Missing token: `--color-surface`** — Referenced in 9 CSS files as `var(--color-surface, #fff)`. Equivalent to `--color-card-bg` already in `:root`. Should unify: either remove `--color-surface` references or declare it.

- **Missing token: `--color-text-tertiary`** — Referenced in 8 CSS files. Should be `#9CA3AF` and declared in `:root`.

- **Missing token: `--color-bg-hover`** — Referenced in 4 CSS files with `#f9fafb` fallback. Should be declared.

- **Missing tokens: status tinted backgrounds** — `--color-status-green-bg` (`#f0fdf4`), `--color-status-yellow-bg` (`#fefce8`), `--color-status-red-bg` (`#fef2f2`) — used literally in SocialMonitor and ISN traffic-light banners.

- **Missing component: `ConfirmDialog`** — Four pages implement destructive delete with no confirmation. A single shared `ConfirmDialog` component would standardize this.

- **Missing component: `StatusTrafficLight`** — Both ISN and SocialMonitor implement identical "traffic light banner" (green/yellow/red status block with signal icon + label + sub-text). The CSS is duplicated almost verbatim (`ISN.module.css:trafficCard` and `SocialMonitor.module.css:issBlock`). Should be a shared component.

- **Missing component: `AppealDetailPanel`** — Three parallel implementations of appeal field display (Overview inline, Appeals slide-over, `AppealDetail` shared UI). The shared component exists but is underused.

- **Missing spacing scale** — Values 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 40, 48px all appear in CSS. No declared spacing token layer. For a small codebase this is livable; document the intended scale (suggest: 4/8/12/16/24/32/48).

---

## Mobile Responsiveness

Owner flagged mobile as a known issue. Findings confirm it is genuinely broken in one structural way and degraded in several others.

**Structural break:**

- The Sidebar component has no mobile behavior. At screen widths below ~700px, the 64px collapsed sidebar + 16px main padding leaves ~296px for content — enough for a single card but not the default 5-column KPI row grids that appear on Overview and Appeals. The KPI grids have responsive breakpoints (down to 1-column at 600px) which would work, but the sidebar itself consumes 64px unconditionally. There is no hamburger menu, bottom nav, or overlay sidebar at any mobile breakpoint.

**Degraded but functional:**

- Most page grids collapse to 1-column below 600px — coverage is reasonably thorough.
- DateRangePicker preset buttons (`src/shared/ui/DateRangePicker/DateRangePicker.tsx`) have no wrapping/overflow behavior; on narrow screens the 5 preset buttons will overflow the header row.
- `src/shared/ui/Header/Header.module.css` has `flex-wrap: wrap` which allows the right-side controls to drop below the title — this is acceptable.
- HeatMap at `src/pages/HeatMap/HeatMap.module.css` has a fixed-height map container. The map controls/filters above it wrap correctly but the map itself has no touch-zoom indicator.
- The Attendance SVG chart uses a fixed 600px-wide viewBox. At 375px device width the SVG scales to ~55% and all chart text becomes unreadably small.
- `src/app/App.module.css` only has one breakpoint at 1024px — there is no 768px or 480px breakpoint for the app shell.

**Recommended mobile-first fix order:**

1. Sidebar: bottom-tab nav at ≤768px (5–6 most-used items)
2. Attendance chart: switch to Recharts
3. DateRangePicker: allow button wrapping
4. App shell: add 768px padding breakpoint

---

## Cross-Reference with Known Concerns

The following findings from `.planning/codebase/CONCERNS.md` overlap with this UI audit and are **not re-stated in detail above** — refer to CONCERNS.md for full analysis:

- **Login lockout not persisted** (CONCERNS.md: "Login Lockout Not Persisted") — This is also a UX concern: users who refresh during a lockout get no feedback that they were locked out. The UI audit agrees this needs fixing but defers to CONCERNS.md for the storage approach.

- **Generic error messages** (CONCERNS.md: "Generic Error Message in Appeals Analysis", "Settings Page Error Handling Gaps") — Confirmed from code review. This audit notes the pattern affects UX (users cannot self-diagnose) but defers to CONCERNS.md for the error-handling implementation approach.

- **No ARIA labels on status buttons in SocialMonitor** (CONCERNS.md: "No ARIA Labels on Status Buttons") — Confirmed and listed under Experience Design pillar above.

- **Attendance chart tooltip hover-only** (CONCERNS.md: "Attendance Chart Tooltip Only on Hover") — Confirmed. Listed under Visuals pillar above.

- **HeatMap SVG not labeled** (CONCERNS.md: "Heatmap SVG Not Labeled") — Confirmed. Listed under Experience Design pillar above.

- **No per-page ErrorBoundary** (CONCERNS.md: "No Error Boundary for Individual Pages") — Not re-stated above, but this is a UX concern: a crash on any page takes down the entire shell.

Items in this audit **not in CONCERNS.md** (new findings):

- `--color-primary: #3b82f6` phantom token causing blue buttons on Settings/Roadmap
- Three duplicate appeal-detail implementations
- `isLoading = false` hardcode in Overview
- Sidebar collapse button position not mobile-aware
- ISS and ИСН traffic-light being implemented twice as near-identical components
- DateRangePicker overflow on mobile
