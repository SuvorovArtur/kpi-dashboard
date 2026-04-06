# Codebase Structure

**Analysis Date:** 2026-04-06

## Directory Layout

```
kpi-dashboard/
├── src/
│   ├── main.tsx                    # React app entry point, mounts to #root
│   ├── index.css                   # Global styles: CSS custom properties for theme
│   ├── app/
│   │   ├── App.tsx                 # Root component: routing, auth, layout
│   │   ├── App.module.css          # Layout styles (sidebar, main)
│   │   └── routes.tsx              # Route definitions (lazy-loaded pages)
│   ├── pages/                      # Feature pages (one directory per page)
│   │   ├── Overview/               # Dashboard with KPI cards
│   │   ├── KpiDetail/              # KPI trends and targets
│   │   ├── Appeals/                # Appeals table, geocoding, analysis
│   │   ├── ISN/                    # Sentiment analysis (ИСН)
│   │   ├── HeatMap/                # Geographic heatmap with Leaflet
│   │   ├── SocialMonitor/          # Social media monitoring
│   │   ├── Attendance/             # Yandex Vector attendance tracking
│   │   ├── Staff/                  # Staff metrics (vacancies, turnover)
│   │   ├── Territories/            # Territory management
│   │   ├── Roadmap/                # Project roadmap timeline
│   │   ├── Settings/               # Admin: KPI targets, users, territories
│   │   └── Login/                  # Authentication page
│   ├── shared/
│   │   ├── hooks/                  # Custom data hooks (useKpiData, useAppeals, etc.)
│   │   ├── ui/                     # Reusable UI components (design system)
│   │   ├── types/                  # TypeScript type definitions
│   │   ├── lib/                    # Library functions (Supabase, geocoding, etc.)
│   │   ├── utils/                  # Utility functions (formatters, export, etc.)
│   │   ├── config/                 # Static configuration (territories, thresholds)
│   │   └── assets/                 # Static files (images, icons)
│   ├── data/                       # Data fixtures or seed data (if any)
│   └── scripts/                    # Build/utility scripts
├── public/                         # Static assets served as-is
├── vite.config.ts                  # Vite build configuration
├── tsconfig.json                   # TypeScript base config
├── tsconfig.app.json               # TypeScript app config (strict mode)
├── tsconfig.node.json              # TypeScript config for Vite
├── package.json                    # Dependencies: React 19, Vite, Supabase, Leaflet
└── .eslintrc.cjs                   # ESLint config
```

## Directory Purposes

**`src/app/`:**
- Purpose: Application shell - routing, layout, and global providers
- Contains: Root App component, route definitions, layout styling
- Key files: `App.tsx` (auth gate + layout), `routes.tsx` (lazy-loaded page routes)
- Does NOT contain: Page logic, feature components belong in `src/pages/`

**`src/pages/`:**
- Purpose: Feature pages, each self-contained with own state, hooks, and styles
- Contains: One directory per page (e.g., Appeals/, Overview/, Settings/)
- Each page directory contains:
  - `[PageName].tsx`: Main page component
  - `[PageName].module.css`: Page-specific styles
  - `components/`: Sub-components used only by this page
  - `utils.ts`: Page-specific utility functions (e.g., status grouping logic)
- Pattern: Pages are composed from shared UI components + page-specific logic

**`src/shared/hooks/`:**
- Purpose: Data fetching and state management layer
- Contains: One hook per data domain (useKpiData, useAppeals, useSocialMonitor, etc.)
- Exports: `index.ts` barrels all hooks for re-export
- Pattern: Each hook returns `{ data, isLoading, error, refetch }`
- Dependencies: Supabase client, shared types

**`src/shared/ui/`:**
- Purpose: Reusable presentational components (design system)
- Contains: 16+ component directories (Card, KpiCard, Chart, DataTable, Sidebar, Header, etc.)
- Each component:
  - Has its own directory with `[Component].tsx` and `[Component].module.css`
  - Exports via barrel: `src/shared/ui/index.ts`
  - Is presentational (no data fetching, no side effects)
  - Accepts data via props and callbacks
- Pattern: All pages import from `shared/ui` barrel: `import { Card, KpiCard, Chart } from '../../shared/ui'`

**`src/shared/types/`:**
- Purpose: Centralized TypeScript type definitions
- Key file: `index.ts` exports all types
- Types:
  - `KpiDefinition`: KPI metadata (id, name, unit, thresholds, frequency)
  - `KpiDataPoint`: Single KPI measurement (date, value, territory)
  - `Appeal`: Citizen appeal record (address, status, sentiment, metadata)
  - `StaffMetrics`: HR data (vacancies, turnover, salary)
  - `RoadmapItem`: Project task
  - `Status`: Union type 'green' | 'yellow' | 'red' (for KPI status)
  - `Trend`: Direction 'up' | 'down' | 'flat'
  - `Column`: Generic DataTable column definition

**`src/shared/lib/`:**
- Purpose: Reusable library functions and client initialization
- Key files:
  - `supabase.ts`: Initialize Supabase client (environment-based)
  - `geocode.ts`: Convert address → [lat, lng] (external API call)
  - `settlement-coords.ts`: Pre-computed settlement coordinates lookup
  - `chart-theme.ts`: Recharts theme configuration

**`src/shared/utils/`:**
- Purpose: Utility functions for formatting, export, calculations
- Key files:
  - `formatters.ts`: formatNumber, formatPercent, formatDate (Russian locale)
  - `export.ts`: exportToCsv, exportToPdf (html2canvas + jspdf)
  - `kpi-helpers.ts`: KPI status/trend calculation logic

**`src/shared/config/`:**
- Purpose: Application configuration constants
- Key files:
  - `kpi-config.ts`: Territories list, appeal categories, KPI thresholds (green/yellow/red)
  - `theme.ts`: Theme-related config (if any)

**`src/assets/`:**
- Purpose: Static images, icons, or other media (if used; lucide-react is primary icon source)

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React app bootstrap, mounts to `#root` element
- `src/index.css`: Global CSS variables (colors, fonts, reset styles)
- `src/app/App.tsx`: Root component, contains Router, AuthProvider, layout structure
- `src/app/routes.tsx`: All page routes with lazy loading and Suspense boundaries

**Configuration:**
- `tsconfig.app.json`: Strict TypeScript settings, ES2023 target
- `vite.config.ts`: Vite bundler config
- `.eslintrc.cjs`: ESLint rules
- `package.json`: React 19, Vite 8, TypeScript 5.9, Supabase, Leaflet, Recharts

**Core Logic:**
- `src/shared/hooks/useKpiData.ts`: Fetch KPI definitions and values with date/territory filters
- `src/shared/hooks/useAppeals.ts`: Fetch appeal records with status/direction filters
- `src/shared/hooks/useAuth.tsx`: Authentication context and session management
- `src/shared/hooks/useDateRange.ts`: Date range picker state management
- `src/shared/lib/supabase.ts`: Supabase client instantiation

**Testing:**
- No test files detected. No testing framework in dependencies.

## Naming Conventions

**Files:**
- Components: PascalCase (e.g., `Card.tsx`, `KpiCard.tsx`, `DateRangePicker.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useKpiData.ts`, `useAppeals.ts`)
- Utilities: camelCase (e.g., `formatters.ts`, `export.ts`)
- Styles: [Component].module.css (CSS Modules, paired with component)
- Pages: PascalCase (e.g., `Overview.tsx`, `Appeals.tsx`, `HeatMap.tsx`)

**Directories:**
- Feature pages: PascalCase (e.g., `src/pages/Appeals/`, `src/pages/Overview/`)
- Shared domains: lowercase (e.g., `src/shared/ui/`, `src/shared/hooks/`)
- Component directories: PascalCase matching component name (e.g., `src/shared/ui/Card/`)

**React Components:**
- Exported as named exports: `export function Card(...) { }`
- Props interfaces: `interface CardProps { ... }`
- Exported from barrel files: `export { Card } from './Card/Card'`

**Variables & Functions:**
- camelCase: `const kpiValue = ...`, `function calculateStatus(...) { }`
- Constants: UPPER_SNAKE_CASE only for truly immutable config (e.g., `const GRADIENT: Record<number, string> = { ... }`)
- Booleans prefix with `is` or `has`: `isLoading`, `hasError`, `canEdit`

**Types:**
- PascalCase: `KpiDefinition`, `Appeal`, `StaffMetrics`
- Union types: camelCase lowercase literals: `'green' | 'yellow' | 'red'`
- Interfaces: Suffix with explicit type if needed (rarely used, prefer types)

## Where to Add New Code

**New Feature Page:**
1. Create directory: `src/pages/[FeatureName]/`
2. Create component: `src/pages/[FeatureName]/[FeatureName].tsx`
3. Create styles: `src/pages/[FeatureName]/[FeatureName].module.css`
4. Optional sub-components: `src/pages/[FeatureName]/components/[ComponentName].tsx`
5. Optional utilities: `src/pages/[FeatureName]/utils.ts`
6. Add route to `src/app/routes.tsx` with lazy loading
7. Add nav item to `src/app/App.tsx` in `navItems` array

**New Shared Hook (Data Fetching):**
1. Create file: `src/shared/hooks/use[Domain].ts`
2. Define interface: `Use[Domain]Params` and `Use[Domain]Result`
3. Implement: useEffect + useState pattern with try/catch for Supabase query
4. Export `refetch` function for manual re-query
5. Add export to `src/shared/hooks/index.ts`
6. Usage in pages: `const { data, isLoading, error, refetch } = use[Domain](params)`

**New Shared UI Component:**
1. Create directory: `src/shared/ui/[ComponentName]/`
2. Create component: `src/shared/ui/[ComponentName]/[ComponentName].tsx`
3. Create styles: `src/shared/ui/[ComponentName]/[ComponentName].module.css`
4. Define props interface: `interface [ComponentName]Props { ... }`
5. Add export to `src/shared/ui/index.ts`
6. Usage in pages: `import { [ComponentName] } from '../../shared/ui'`

**New Utility Function:**
- Shared formatters: Add to `src/shared/utils/formatters.ts`
- Shared calculations: Create `src/shared/utils/[domain].ts` or add to `kpi-helpers.ts`
- Shared constants: Add to `src/shared/config/[domain].ts`

**New Type:**
- Add to `src/shared/types/index.ts`
- Export from barrel for app-wide access

## Special Directories

**`src/shared/ui/`:**
- Purpose: Design system components
- Generated: No (hand-written)
- Committed: Yes
- Note: All components are presentational. No business logic. Styled with CSS Modules and CSS custom properties.

**`public/`:**
- Purpose: Static assets served as-is by Vite
- Generated: No
- Committed: Yes (typically static files like favicon, manifest)

**`dist/`:**
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)

**`node_modules/`:**
- Purpose: Package dependencies
- Generated: Yes (by npm install)
- Committed: No

---

*Structure analysis: 2026-04-06*
