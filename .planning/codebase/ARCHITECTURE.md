# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Layered component-based architecture with separation of concerns across pages, shared utilities, and data fetching hooks. The application follows a React Router-based Single Page Application (SPA) pattern with lazy-loaded pages, context-based authentication, and Supabase as the primary data source.

**Key Characteristics:**
- Component-driven UI with shared design system (`shared/ui`)
- Data access abstraction through custom hooks (`shared/hooks`)
- Context-based authentication with role-based access control
- Modular page structure with loose coupling to shared services
- Type-safe data flow with TypeScript and Supabase type inference
- CSS Module-based styling with CSS custom properties for theming

## Layers

**Page Layer:**
- Purpose: User-facing feature implementations. Each page is a complete feature with its own state management, data fetching, and business logic.
- Location: `src/pages/[PageName]/`
- Contains: Page components, page-specific sub-components, page-specific styles, utility functions unique to that page
- Depends on: Shared hooks, shared UI components, shared types, shared utilities
- Used by: App routing system

**Shared Hooks Layer (Data & State):**
- Purpose: Encapsulates all data fetching, caching, and state management logic. Each hook manages a specific domain (KPI, Appeals, Staff, etc.) and handles loading, error states, and refetch operations.
- Location: `src/shared/hooks/`
- Contains: Custom React hooks for data access and state, no JSX, pure logic
- Depends on: Supabase client, shared types
- Used by: All page components

**Shared UI Layer (Components):**
- Purpose: Reusable presentation components organized as a design system. Components are presentational (props-based) with no business logic or data fetching.
- Location: `src/shared/ui/`
- Contains: Card, KpiCard, Chart, DataTable, DateRangePicker, Sidebar, Header, etc.
- Depends on: Shared utilities (formatters), lucide-react icons, clsx for styling
- Used by: Page components

**Shared Libraries Layer:**
- Purpose: Cross-cutting utility functions and configuration.
- Location: `src/shared/lib/`, `src/shared/utils/`, `src/shared/config/`
- Modules:
  - `supabase.ts`: Supabase client initialization (environment-based configuration)
  - `geocode.ts`: Address-to-coordinates conversion
  - `settlement-coords.ts`: Pre-computed coordinates for settlements
  - `formatters.ts`: Localization helpers (Russian locale numbers, dates, durations)
  - `export.ts`: CSV and PDF export utilities
  - `kpi-helpers.ts`: KPI calculation and status logic
  - `theme.ts`: Theming utilities

**Types & Configuration Layer:**
- Purpose: Centralized type definitions and application configuration constants.
- Location: `src/shared/types/`, `src/shared/config/`
- Exports:
  - `types/index.ts`: Core domain types (KpiDefinition, Appeal, StaffMetrics, RoadmapItem, Status, Trend)
  - `config/kpi-config.ts`: Territories, appeal categories, KPI thresholds

**Routing & Entry Point Layer:**
- Purpose: Application bootstrap, routing configuration, and global context providers.
- Location: `src/main.tsx`, `src/app/App.tsx`, `src/app/routes.tsx`
- Responsibilities: React root mounting, BrowserRouter setup, authentication gate, lazy route loading, global layout structure

## Data Flow

**Authentication Flow:**

1. User visits app → `App.tsx` mounts `AuthProvider`
2. `AuthProvider` (in `useAuth.tsx`) loads session from Supabase on mount
3. If session exists, loads user profile from `user_profiles` table
4. Sets context with `session`, `profile`, `canEdit`, `isAdmin` flags
5. `AuthGate` renders either login page or authenticated layout based on session

**Page Data Flow (Example: Appeals):**

1. Page component (`Appeals.tsx`) mounts with routing parameters
2. Calls `useDateRange()` hook for date selection state
3. Calls `useAppeals(params)` hook with date/direction filters
4. Hook: Checks cache, triggers `supabase.from('appeals').select('*').eq/gte/lte...`
5. Hook returns `{ data, isLoading, error, refetch }`
6. Page reads data, computes derived values, renders UI
7. User interacts → state updates → re-fetch triggered via `refetch()` callback

**KPI Calculation Pattern:**

1. Pages calculate aggregate KPIs from raw data (not pre-computed):
   - Appeals count, per-capita rate, delayed percentage, repetition rate
   - ISN (sentiment index) and acute percentage from sentiment scores
   - Status determination based on thresholds (green/yellow/red)
2. KPI values are computed in `useMemo` to prevent recalculation
3. Display derives trends by comparing KPI across time periods (7d, 30d, 90d)

**State Management:**

- Authentication: React Context (`AuthProvider`)
- Page state: useState (local component state)
- Data fetching state: Custom hooks with `useState` + `useCallback`
- No global state manager (no Redux, Zustand, etc.)
- Refetch pattern: Each hook exports `refetch` function for manual re-query

## Key Abstractions

**Authentication/Authorization:**
- Abstraction: `AuthContext` + `useAuth()` hook
- Pattern: React Context Provider
- Implementation: `src/shared/hooks/useAuth.tsx`
- Usage: Wrap app with `AuthProvider`, consume with `const { session, canEdit, isAdmin } = useAuth()`
- Provides: Session, user profile, role-based access flags, sign in/out methods

**Data Access:**
- Abstraction: Domain-specific custom hooks (useKpiData, useAppeals, useStaff, etc.)
- Pattern: useEffect + useState for fetch/cache, useCallback for lazy fetch
- Implementation: `src/shared/hooks/use*.ts`
- Advantages: Encapsulation of query logic, consistent loading/error handling, easy refetch
- Query parameters standardized: `dateFrom`, `dateTo`, filters as optional params

**UI Components:**
- Abstraction: Presentational components with consistent prop interfaces
- Pattern: Functional components, CSS Modules for style scoping
- Design tokens: CSS custom properties in `:root` (colors, fonts)
- Composition: Components export from barrel file `src/shared/ui/index.ts`
- Examples: `Card` wraps any content with optional title and accent color, `KpiCard` displays metric with status badge

**Formatting & Localization:**
- Abstraction: Pure functions in `shared/utils/formatters.ts`
- Pattern: Intl.NumberFormat, date-fns for Russian locale handling
- Functions: `formatNumber`, `formatPercent`, `formatDate`, `formatHours`
- Usage: All pages use these for consistent display across UI

**Geocoding & Mapping:**
- Abstraction: Lookup functions in `shared/lib/`
- `geocode.ts`: Converts address to [lat, lng] (calls external API)
- `settlement-coords.ts`: Pre-computed settlement coordinates for fast lookup
- Usage: HeatMap page uses these to convert appeal addresses to map points

## Entry Points

**Main App Entry:**
- Location: `src/main.tsx`
- Triggers: Browser loads index.html
- Responsibilities: Mount React app to DOM element with `createRoot`, render `App` component

**App Component:**
- Location: `src/app/App.tsx`
- Triggers: Mounted by main.tsx
- Responsibilities:
  - Render `BrowserRouter`
  - Provide `AuthProvider` context
  - Render `AuthGate` (login/authenticated routes)
  - If authenticated: Render `AppLayout` (sidebar + main content area)

**Route Configuration:**
- Location: `src/app/routes.tsx`
- Exports: `AppRoutes()` component with all page routes
- Lazy loading: All pages imported with `lazy()` and wrapped in `Suspense`
- Routes:
  - `/` → Overview (dashboard with KPI cards, appeals summary)
  - `/kpi` → KpiDetail (detailed KPI trends and settings, conditionally shown)
  - `/appeals` → Appeals (appeals table, analysis, import)
  - `/isn` → ISN (sentiment analysis, acute appeals monitoring)
  - `/attendance` → Attendance (Yandex Vector tracking data)
  - `/social` → SocialMonitor (social media monitoring)
  - `/map` → HeatMap (geographic heatmap of appeals)
  - `/settings` → Settings (KPI targets, territories, user management, admin only)

## Error Handling

**Strategy:** Distributed error handling at hook level with UI toast notifications at page level.

**Patterns:**
- Hooks return `{ error: Error | null }` tuple for consumer to handle
- Pages display `Toast` component with error message on failure
- Network errors caught in try/catch within fetch callbacks
- Supabase errors propagated as-is (include context in message)
- No global error boundary (each page responsible for error UI)
- Fallback values: Missing KPI definitions use hardcoded targets, missing settings use defaults

## Cross-Cutting Concerns

**Logging:** No structured logging. Development uses browser console. No APM integration detected.

**Validation:** TypeScript provides compile-time validation. Supabase schemas provide runtime validation on insert/update. No client-side form validation library.

**Authentication:** Supabase Auth (session-based) + custom user_profiles table for role/display_name. AuthProvider gates access to all pages except /login. Roles: viewer (read-only), editor (can modify settings), admin (full access including user management).

**Styling:** Global CSS custom properties in `index.css` for colors/fonts. CSS Modules per component for scoped styles. No CSS-in-JS library. Responsive design via @media queries in component stylesheets.

---

*Architecture analysis: 2026-04-06*
