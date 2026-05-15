# Codebase Structure

**Analysis Date:** 2026-04-19

## Directory Layout

```
kpi-dashboard/
├── index.html                    # HTML entry point, mounts React app
├── package.json                  # Dependencies, build scripts
├── tsconfig.json                 # TypeScript project references
├── vite.config.ts                # Vite build config with manual chunks for react/charts/supabase
│
├── src/
│   ├── main.tsx                  # React DOM root, renders App
│   ├── index.css                 # Global styles, CSS variables (colors, fonts)
│   ├── app/
│   │   ├── App.tsx               # Root component: Router, AuthProvider, ErrorBoundary, AppLayout
│   │   ├── App.module.css        # Layout grid (sidebar + main)
│   │   └── routes.tsx            # Route definitions, lazy-loaded pages, Suspense boundary
│   │
│   ├── pages/                    # Route-level feature components
│   │   ├── Overview/
│   │   │   ├── Overview.tsx       # Dashboard home: KPI summary cards, appeals stats
│   │   │   ├── Overview.module.css
│   │   │   └── components/        # Page-specific subcomponents (if needed)
│   │   ├── KpiDetail/
│   │   │   ├── KpiDetail.tsx      # Detailed KPI tracking, territory breakdown
│   │   │   ├── KpiDetail.module.css
│   │   │   └── components/
│   │   ├── Appeals/
│   │   │   ├── Appeals.tsx        # Citizen complaints management, filtering, analysis
│   │   │   ├── Appeals.module.css
│   │   │   └── components/
│   │   ├── SocialMonitor/         # NEW: Telegram bot monitoring (feature branch)
│   │   │   ├── SocialMonitor.tsx  # Main page: tabs (issues/chats/channels), stats, filters
│   │   │   ├── IssueCard.tsx      # Card component for displaying issue details
│   │   │   ├── ChatCard.tsx       # Card component for chat entry
│   │   │   ├── ChannelNewsCard.tsx # Channel news display
│   │   │   ├── TgNewsCard.tsx     # Telegram news widget
│   │   │   ├── social-monitor-helpers.ts  # Helpers (STATUS_LABELS, timeAgo, etc.)
│   │   │   └── SocialMonitor.module.css
│   │   ├── HeatMap/
│   │   │   ├── HeatMap.tsx        # Geographic visualization using Leaflet + heatLayer
│   │   │   └── HeatMap.module.css
│   │   ├── ISN/
│   │   │   ├── ISN.tsx            # Sentiment analysis dashboard (appeals-based)
│   │   │   └── ISN.module.css
│   │   ├── Attendance/
│   │   │   ├── Attendance.tsx      # Yandex Vector attendance tracking
│   │   │   └── Attendance.module.css
│   │   ├── Territories/
│   │   │   ├── Territories.tsx     # Territory-specific KPI breakdown
│   │   │   └── Territories.module.css
│   │   ├── Staff/
│   │   │   ├── Staff.tsx           # Staff metrics (turnover, vacancies, salary)
│   │   │   ├── Staff.module.css
│   │   │   └── components/
│   │   ├── Roadmap/
│   │   │   ├── Roadmap.tsx         # Project roadmap (Gantt-like)
│   │   │   ├── Roadmap.module.css
│   │   │   └── components/
│   │   ├── Settings/
│   │   │   ├── Settings.tsx        # Admin panel: app settings, KPI edit, data import
│   │   │   ├── Settings.module.css
│   │   │   └── components/         # EditKpiModal, SettingsForm, etc.
│   │   └── Login/
│   │       ├── Login.tsx           # Phone/password form, brute-force lock
│   │       └── Login.module.css
│   │
│   ├── shared/
│   │   ├── ui/                     # Reusable UI components (headless, styled with CSS modules)
│   │   │   ├── index.ts            # Barrel export of all UI components
│   │   │   ├── Card/
│   │   │   │   ├── Card.tsx        # Wrapper with shadow, padding, optional title
│   │   │   │   ├── Card.module.css
│   │   │   │   └── Card.test.tsx   # (if test files exist)
│   │   │   ├── KpiCard/
│   │   │   │   ├── KpiCard.tsx     # Status indicator, current value, target, trend
│   │   │   │   └── KpiCard.module.css
│   │   │   ├── Chart/
│   │   │   │   ├── Chart.tsx       # Recharts wrapper (LineChart, BarChart, etc.)
│   │   │   │   ├── Chart.module.css
│   │   │   │   └── chart-theme.ts  # Recharts color config
│   │   │   ├── DataTable/
│   │   │   │   ├── DataTable.tsx   # Sortable, filterable table with Column definitions
│   │   │   │   ├── DataTable.module.css
│   │   │   │   └── types.ts        # Column<T> interface (exported in ui/index.ts)
│   │   │   ├── DateRangePicker/
│   │   │   │   ├── DateRangePicker.tsx  # From/To date inputs with preset buttons
│   │   │   │   └── DateRangePicker.module.css
│   │   │   ├── Sidebar/
│   │   │   │   ├── Sidebar.tsx     # Navigation, user profile, sign out
│   │   │   │   ├── Sidebar.module.css
│   │   │   │   └── types.ts        # NavItem interface
│   │   │   ├── Header/
│   │   │   │   ├── Header.tsx      # Page title, optional action buttons
│   │   │   │   └── Header.module.css
│   │   │   ├── Toast/
│   │   │   │   ├── Toast.tsx       # Success/error message popup
│   │   │   │   └── Toast.module.css
│   │   │   ├── Skeleton/
│   │   │   │   ├── Skeleton.tsx    # Loading placeholder (variants: card, chart, row)
│   │   │   │   └── Skeleton.module.css
│   │   │   ├── EmptyState/
│   │   │   │   ├── EmptyState.tsx  # "No data" / "Error" fallback UI
│   │   │   │   └── EmptyState.module.css
│   │   │   ├── SlideOver/
│   │   │   │   ├── SlideOver.tsx   # Right-side panel for details/editing
│   │   │   │   └── SlideOver.module.css
│   │   │   ├── AppealDetail/       # NEW: Detail view for appeals
│   │   │   │   ├── AppealDetail.tsx
│   │   │   │   └── AppealDetail.module.css
│   │   │   ├── Tooltip/
│   │   │   │   ├── Tooltip.tsx     # Hover tooltip
│   │   │   │   └── Tooltip.module.css
│   │   │   ├── Badge/
│   │   │   │   ├── Badge.tsx       # Label / tag
│   │   │   │   └── Badge.module.css
│   │   │   ├── ProgressBar/
│   │   │   │   ├── ProgressBar.tsx # Linear progress indicator
│   │   │   │   └── ProgressBar.module.css
│   │   │   └── XlsxImport/
│   │   │       ├── XlsxImport.tsx  # File upload, XLSX parsing
│   │   │       └── XlsxImport.module.css
│   │   │
│   │   ├── hooks/                  # Data-fetching and state management hooks
│   │   │   ├── index.ts            # Barrel export (useKpiData, useAppeals, etc.)
│   │   │   ├── useAuth.tsx         # Auth context provider + hook (session, profile, signIn/Out)
│   │   │   ├── useAppeals.ts       # Fetch appeals from supabase, cache, refetch
│   │   │   ├── useKpiData.ts       # Fetch KPI definitions and values
│   │   │   ├── useSocialMonitor.ts # Fetch chats, issues, analysis status from tg_* tables
│   │   │   ├── useAppSettings.ts   # Read app_settings table (constants, config)
│   │   │   ├── useTerritories.ts   # Territory list and data
│   │   │   ├── useAttendance.ts    # Yandex Vector attendance data
│   │   │   ├── useStaff.ts         # Staff metrics
│   │   │   ├── useRoadmap.ts       # Project roadmap items
│   │   │   ├── useDateRange.ts     # Local state for date range with presets
│   │   │   ├── useHeatmapData.ts   # Fetch + geocode appeals for map visualization
│   │   │   └── useToast.ts         # Toast notification state
│   │   │
│   │   ├── lib/                    # Infrastructure and utilities
│   │   │   ├── supabase.ts         # Supabase client instantiation (uses VITE env vars)
│   │   │   ├── geocode.ts          # Address → lat/lng conversion
│   │   │   ├── chart-theme.ts      # Recharts color palette
│   │   │   └── settlement-coords.ts # Hardcoded settlement coordinates (13KB)
│   │   │
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript interfaces: Appeal, KpiDefinition, KpiDataPoint, etc.
│   │   │
│   │   ├── utils/
│   │   │   ├── formatters.ts       # formatNumber, formatPercent, formatDate (date-fns)
│   │   │   ├── kpi-helpers.ts      # getKpiStatus, getTrend, calculateISN, copyToClipboard
│   │   │   └── export.ts           # Excel export via xlsx package
│   │   │
│   │   └── config/
│   │       ├── kpi-config.ts       # Territories, appeal categories, KPI thresholds (constants)
│   │       └── theme.ts            # Color definitions for charts
│   │
│   ├── data/                       # Static data files (if any)
│   ├── assets/                     # Images, SVGs, fonts
│   └── scripts/                    # Utility scripts (migrations, seed data, etc.)
│
├── tg-bot/                         # Python Telegram monitor (separate from React)
│   ├── bot.py                      # Main loop: listens to Telegram chats via Telethon
│   ├── analyzer.py                 # DeepSeek integration: analyzes messages, groups into issues
│   ├── db.py                       # Supabase client helper (not visible in git status)
│   ├── config.py                   # TG_API_ID, TG_API_HASH, DEEPSEEK_API_KEY (not visible)
│   ├── alerts.py                   # Alert logic (not visible)
│   ├── .env                        # Environment variables (not committed)
│   └── requirements.txt            # Python dependencies (not visible)
│
├── config/                         # Project configuration
│   └── (Vite, TypeScript configs referenced from root)
│
├── public/                         # Static assets served as-is
│   └── favicon.svg
│
├── docs/                           # Documentation
└── dist/                           # Build output (generated by vite build)
```

## Directory Purposes

**`src/app/`:**
- Purpose: Application shell (routing, auth, error handling)
- Contains: Root component, route definitions, global layout
- Key files: `App.tsx` (renders Sidebar + main), `routes.tsx` (lazy-loaded pages)

**`src/pages/`:**
- Purpose: Feature screens corresponding to router paths
- Contains: Page components with layout, hooks, state management
- Naming: PascalCase (Overview, Appeals, etc.), one dir per route
- Key files: `[Page].tsx` (main component), `[Page].module.css` (styles), `components/` (sub-components)

**`src/shared/ui/`:**
- Purpose: Reusable, framework-agnostic UI components
- Contains: Buttons, cards, tables, forms, modals
- Naming: PascalCase directories matching component name
- Key pattern: Each component is `[Name]/[Name].tsx` + `[Name].module.css`
- Exports: Barrel export in `index.ts` for convenience

**`src/shared/hooks/`:**
- Purpose: Data fetching, state management, side effects
- Contains: Custom hooks that query Supabase
- Naming: camelCase starting with `use` (useKpiData, useAppeals, etc.)
- Key pattern: Each hook returns `{ data, isLoading, error, refetch? }`

**`src/shared/lib/`:**
- Purpose: Infrastructure and shared utilities
- Contains: Supabase client, geocoding, chart theme, settlement data
- Key files:
  - `supabase.ts`: Singleton Supabase client
  - `settlement-coords.ts`: Hardcoded coordinates for all settlements (large data, could be moved to DB)

**`src/shared/types/`:**
- Purpose: TypeScript interfaces and type definitions
- Contains: Appeal, KpiDefinition, KpiDataPoint, StaffMetrics, RoadmapItem, Status, Trend
- Key pattern: Exported from `index.ts`, imported throughout codebase for type safety

**`src/shared/utils/`:**
- Purpose: Pure utility functions
- Contains: Formatters (number, date), KPI calculations, export helpers
- Key files:
  - `kpi-helpers.ts`: getKpiStatus, getTrend, calculateISN, copyToClipboard
  - `formatters.ts`: formatNumber (1000 → '1 000'), formatDate (date-fns with locale)

**`src/shared/config/`:**
- Purpose: Application constants and configuration
- Contains: Territory list, appeal categories, KPI thresholds
- Key files:
  - `kpi-config.ts`: Territories (pirogovsky, fedoskino, total), appeal categories, threshold values
  - `theme.ts`: Color constants for charts

**`tg-bot/`:**
- Purpose: Separate Python service for Telegram monitoring
- Contains: bot.py (listener), analyzer.py (DeepSeek analysis)
- Relationship: Writes to same Supabase database (tg_chats, tg_issues, tg_messages, tg_analysis_log)
- Runs: Outside React environment; can be deployed to VPS/Docker separately

## Key File Locations

**Entry Points:**
- `index.html`: Browser entry, mounts React app to `<div id="root">`
- `src/main.tsx`: React root, imports App and index.css, calls createRoot
- `src/app/App.tsx`: Application shell, wraps with BrowserRouter + AuthProvider
- `src/app/routes.tsx`: Route definitions, lazy-loaded pages with Suspense

**Configuration:**
- `vite.config.ts`: Build config, defines manual chunks (vendor-react, vendor-charts, vendor-supabase)
- `tsconfig.json`: TypeScript project references (app, node configs)
- `tsconfig.app.json`: App-specific TypeScript settings (not visible)
- `package.json`: Dependencies (react 19.2, react-router 7.14, recharts 3.8, leaflet 1.9, supabase-js 2.101)
- `index.css`: Global styles, CSS variables (colors, fonts, resets)

**Core Logic:**
- `src/shared/lib/supabase.ts`: Supabase client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- `src/shared/types/index.ts`: All TypeScript interfaces (Appeal, KpiDefinition, etc.)
- `src/shared/utils/kpi-helpers.ts`: KPI calculations and status logic
- `src/shared/hooks/useAuth.tsx`: Auth context, session management, role checking

**Testing:**
- No test files visible in current branch; coverage TBD
- Test location pattern (if added): `src/**/*.test.tsx` or `tests/**/*.test.tsx`

## Naming Conventions

**Files:**
- React components: PascalCase (Overview.tsx, KpiCard.tsx)
- Utilities/hooks: camelCase (kpi-helpers.ts, useKpiData.ts)
- Styles: [ComponentName].module.css (Overview.module.css)
- Constants/config: kebab-case or camelCase (kpi-config.ts, settlement-coords.ts)

**Directories:**
- Feature pages: PascalCase (Overview/, Appeals/, SocialMonitor/)
- Shared layers: lowercase (ui/, hooks/, lib/, types/, utils/, config/)
- Component subdirs: PascalCase (Card/, KpiCard/, DataTable/)

**Components:**
- Exported as named exports: `export function Overview() {}`
- Default exports in lazy-loaded pages: `export default function SocialMonitor() {}`
- TypeScript props interfaces: `[ComponentName]Props` pattern (optional, not enforced)

**Hooks:**
- Always start with `use`: useKpiData, useAppeals, useSocialMonitor, useAuth
- Return interface pattern: `Use[Name]Result` (UseKpiDataResult, UseAppealsResult)

**Interfaces:**
- Singular domain nouns: Appeal, KpiDefinition, KpiDataPoint, StaffMetrics, TgChat, TgIssue
- Exported from `src/shared/types/index.ts`
- Used throughout for type safety

## Where to Add New Code

**New Feature (Full Page):**
1. Create directory: `src/pages/[FeatureName]/`
2. Add main component: `src/pages/[FeatureName]/[FeatureName].tsx`
3. Add styles: `src/pages/[FeatureName]/[FeatureName].module.css`
4. Optional subcomponents: `src/pages/[FeatureName]/components/[ComponentName].tsx`
5. Add route in `src/app/routes.tsx`: lazy-load page, add Route definition
6. Add nav item in `src/app/App.tsx` AppLayout navItems array
7. If data fetching needed: Create hook in `src/shared/hooks/use[Feature].ts`

**New Component (Reusable):**
1. Check if exists in `src/shared/ui/`; if yes, reuse
2. If new: Create `src/shared/ui/[ComponentName]/[ComponentName].tsx`
3. Add styles: `src/shared/ui/[ComponentName]/[ComponentName].module.css`
4. Export from `src/shared/ui/index.ts`
5. Use pattern: import { ComponentName } from '../../shared/ui'

**New Data Hook:**
1. Create `src/shared/hooks/use[Feature].ts`
2. Define interface for params and result (UseFeatureParams, UseFeatureResult)
3. Fetch from Supabase: `const { data, error } = await supabase.from('table').select(...)`
4. Return standard shape: `{ data, isLoading, error, refetch }`
5. Export from `src/shared/hooks/index.ts`

**New Utility Function:**
- Small/formatting: `src/shared/utils/formatters.ts`
- Domain logic: `src/shared/utils/kpi-helpers.ts`
- Pure functions, no side effects

**New Type Definition:**
- Add to `src/shared/types/index.ts`
- Export as named export
- Document with JSDoc comment

**New Configuration:**
- Constants: `src/shared/config/kpi-config.ts`
- Theme/colors: `src/shared/config/theme.ts`
- Or create new file if large/focused (e.g., categories.ts)

## Module Boundaries

**`src/app/` ↔ `src/pages/`:**
- App defines routes, pages are loaded lazily
- Pages import components from shared/ui and shared/hooks
- Pages do NOT import from each other

**`src/pages/` ↔ `src/shared/`:**
- Pages depend on shared/ui (components), shared/hooks (data), shared/utils (logic)
- Pages do NOT define exports for other pages
- If two pages need same component, move to shared/ui

**`src/shared/hooks/` ↔ `src/shared/lib/`:**
- Hooks use lib (e.g., useKpiData imports supabase from lib)
- Lib does NOT import hooks
- Lib is infrastructure, hooks are business logic

**`src/shared/ui/` ↔ `src/shared/hooks/`:**
- UI components are pure (props in, JSX out)
- UI does NOT directly call hooks (pages do)
- Exception: useToast is used in pages, which display Toast components

**No Circular Imports:**
- Pages → shared/ui, shared/hooks, shared/types, shared/utils (one direction)
- Hooks → lib, types, utils (one direction)
- UI → types, utils (no hooks)

## Special Directories

**`src/assets/`:**
- Purpose: Static images, SVGs, fonts
- Generated: No
- Committed: Yes
- Usage: Imported in components via `import logo from '../../assets/logo.svg'`

**`src/data/`:**
- Purpose: Static data files (if any)
- Generated: No
- Committed: Yes
- Note: Minimal usage currently; settlement coords in lib/settlement-coords.ts instead

**`tg-bot/`:**
- Purpose: Separate Python service, monitored separately
- Generated: No (except __pycache__)
- Committed: .py files yes, .env no
- Relationship: Writes to shared Supabase (tg_chats, tg_issues, tg_messages, tg_analysis_log)

**`public/`:**
- Purpose: Static assets served without hashing
- Generated: No
- Committed: Yes (favicon, etc.)
- Usage: favicon.svg linked in index.html

**`dist/`:**
- Purpose: Build output
- Generated: Yes (by `npm run build`)
- Committed: No (.gitignore)
- Contents: Bundled JS, CSS, chunk files, sourcemaps

**`.planning/codebase/`:**
- Purpose: Architecture documentation (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: No
- Committed: Yes
- Note: Created by GSD mapper CLI

---

*Structure analysis: 2026-04-19*
