# Architecture

**Analysis Date:** 2026-04-19

## Pattern Overview

**Overall:** Feature-slice vertical with hooks-based data fetching

**Key Characteristics:**
- React frontend with route-based code splitting
- Supabase for authentication, database, and serverless functions
- Data fetching via custom React hooks (useKpiData, useAppeals, useSocialMonitor)
- Python bot (`tg-bot/`) runs separately, writes to shared Supabase database
- No Redux/Zustand — state management via Context API + local component state
- CSS Modules for styling with CSS variables for theming

## Layers

**Presentation (UI Components):**
- Purpose: Render visual elements, handle user interactions
- Location: `src/shared/ui/` (reusable), `src/pages/*/` (page-specific)
- Contains: React components, CSS modules, icon usage via lucide-react
- Depends on: `shared/types` for data shapes, `shared/utils` for formatting
- Used by: Pages, other UI components

**Pages (Route-Level Features):**
- Purpose: Assemble UI components + hooks into complete feature screens
- Location: `src/pages/{FeatureName}/{FeatureName}.tsx`
- Contains: Layout composition, tab/filter state, event handlers
- Depends on: `shared/hooks` for data, `shared/ui` for components
- Used by: Routes (`src/app/routes.tsx`)

**Hooks (Data Access & State):**
- Purpose: Fetch data from Supabase, cache results, expose refetch capability
- Location: `src/shared/hooks/`
- Contains: `useKpiData`, `useAppeals`, `useSocialMonitor`, `useAuth`, `useAppSettings`, `useTerritories`, `useAttendance`, `useStaff`, `useRoadmap`, `useDateRange`, `useToast`
- Depends on: `shared/lib/supabase` for client, `shared/types` for interfaces
- Used by: Pages, other hooks

**Core Libraries:**
- Purpose: Shared utilities and infrastructure
- Location: `src/shared/lib/`, `src/shared/utils/`, `src/shared/types/`, `src/shared/config/`
- Contains:
  - `supabase.ts`: Supabase client initialization
  - `kpi-helpers.ts`: Status/trend calculations (getKpiStatus, getTrend, calculateISN)
  - `formatters.ts`: Number/date formatting
  - `export.ts`: Excel export utilities
  - `kpi-config.ts`: Territory and category constants
  - `settlement-coords.ts`: Mapping coordinates (13KB data)
  - `geocode.ts`: Address geocoding
- Depends on: External packages (supabase-js, date-fns, etc.)
- Used by: Hooks, pages, utilities

**Authentication & Settings:**
- Purpose: User session management, role-based access control, application settings
- Location: `src/shared/hooks/useAuth.tsx`, `src/shared/hooks/useAppSettings.ts`
- Pattern: Context-based (AuthProvider wraps app)
- Features:
  - AuthContext provides session, profile (display_name, role), canEdit flag, isAdmin flag
  - useAppSettings reads app_settings Supabase table (territory coords, proxy config, etc.)
  - Roles: 'viewer' (read-only), 'editor' (edit appeals/settings), 'admin' (full access)
- Depends on: Supabase auth, user_profiles table, app_settings table
- Used by: App.tsx, all pages requiring auth-aware UI

**Routing:**
- Purpose: Map URLs to page components with lazy loading
- Location: `src/app/App.tsx`, `src/app/routes.tsx`
- Pattern:
  - BrowserRouter wraps entire app
  - AuthGate redirects to /login if not authenticated
  - AppLayout renders Sidebar + main content
  - Routes loaded lazily with Suspense fallback
- Entry points:
  - `/` → Overview (dashboard home)
  - `/kpi` → KpiDetail (detailed KPI tracking)
  - `/appeals` → Appeals (citizen complaint management)
  - `/social` → SocialMonitor (Telegram bot monitoring)
  - `/map` → HeatMap (geographic visualization)
  - `/isn` → ISN (sentiment analysis index)
  - `/attendance` → Attendance (attendance tracking)
  - `/settings` → Settings (admin panel)
  - `/login` → Login (authentication)

## Data Flow

**API → Hook → Page → UI:**

1. Page component calls hook (e.g., `useAppeals({ dateFrom, dateTo })`)
2. Hook initializes state (data, isLoading, error)
3. Hook effect runs fetchData() on mount/param change
4. fetchData() builds Supabase query with filters, executes, sets state
5. Page receives hook result, derives computed state (filters, aggregations)
6. Page renders UI components, passes data and callbacks
7. UI components render with formatting utilities (formatNumber, formatDate)

**Example: Appeals page**
```
Appeals.tsx calls useAppeals({ dateFrom, dateTo })
  → useAppeals.fetchData() queries supabase.from('appeals').select('*')
  → Appeal[] returned, mapped to Appeal interface
  → Appeals.tsx computes appeal stats (total, delayed, repeated %, ISN)
  → DataTable, KpiCard, Chart components render with formatted data
```

**State Management:**

- **Local component state:** Filters, tab selection, form inputs (useState)
- **Hook state:** Data cache, loading/error flags
- **Context state:** Auth (session, profile, permissions), potentially settings
- **URL state:** Date range, filters persisted via route parameters (potential improvement)
- **Server state:** Supabase is source of truth; hooks fetch on mount + when params change

**Real-time Updates:**
- Not currently implemented; pages refetch via explicit refetch() callbacks or manual re-trigger
- Potential: Could use Supabase realtime subscriptions (e.g., on tg_issues changes)

## Key Abstractions

**Appeal:**
- Purpose: Represent citizen complaints from ECUR system + enrichments (sentiment, location, status)
- Examples: `src/shared/types/index.ts` (Appeal interface), used by `useAppeals`
- Pattern: Typed interface; components use for table rows, filtering, detail views

**KPI (Key Performance Indicator):**
- Purpose: Track institutional metrics (response time, satisfaction, etc.)
- Examples: ISN (sentiment index), compliance %, staff turnover
- Pattern:
  - Definitions stored in kpi_definitions table (id, name, unit, target targets d90/d180/d360)
  - Values stored in kpi_values table (date, kpi_id, value, territory)
  - Status calculated via getKpiStatus() comparing current to target
  - Trend calculated via getTrend() comparing recent values

**Telegram Issue (TgIssue):**
- Purpose: Represent identified problems in Telegram chats (analyzed by DeepSeek bot)
- Examples: `useSocialMonitor` returns TgIssue[], used by SocialMonitor page
- Pattern: Includes severity (0-10), status (new/watching/escalated/resolved), location, message grouping

**Index Calculations:**
- **ISN (Индекс социальной напряженности - Social Tension Index):** Weighted formula `Σ(s²) / Σ(s)` where s = appeal sentiment scores
- **ISS (Индекс социальных сетей - Social Networks Index):** Similar, applied to Telegram issue severities
- Functions: `calculateISN()` in `src/shared/utils/kpi-helpers.ts`

## Entry Points

**`src/main.tsx`:**
- Location: `src/main.tsx`
- Triggers: Browser loads `/`
- Responsibilities:
  - Import React, ReactDOM, CSS
  - Get root DOM element
  - Render App in StrictMode

**`src/app/App.tsx`:**
- Location: `src/app/App.tsx`
- Triggers: Rendered by main.tsx
- Responsibilities:
  - Wrap with BrowserRouter
  - Provide AuthProvider (Context)
  - Define AuthGate (redirects to /login if not authenticated)
  - Define AppLayout (renders Sidebar + main routes)
  - Handle ErrorBoundary for crash UI

**`index.html`:**
- Location: `index.html`
- Triggers: Browser loads `/`
- Responsibilities:
  - Define `<div id="root">` mount point
  - Load fonts (Bebas Neue, Lato, Inter from Google)
  - Set meta viewport
  - Script tag references `/src/main.tsx` (Vite entry point)

## Error Handling

**Strategy:** Catch-and-display approach

**Patterns:**
- **Boundary level:** ErrorBoundary component in App.tsx catches React rendering errors, displays crash message in Russian
- **Hook level:** useKpiData, useAppeals set error state on catch, page receives it
- **Page level:** If error, page shows <EmptyState> with error message or Toast notification
- **User feedback:** Toast component (showToast({ message, type: 'error' })) for async operation failures

**Example:**
```typescript
const { data, isLoading, error } = useAppeals({ dateFrom, dateTo });
if (error) return <EmptyState title="Ошибка" />;
```

## Cross-Cutting Concerns

**Logging:**
- No structured logging library; console.error() used in ErrorBoundary and catch blocks
- Could benefit from pino/winston for production

**Validation:**
- At Supabase level: tables have NOT NULL constraints, types
- At React level: interfaces (Appeal, KpiDefinition) provide type safety
- At form level: Phone/email validation in Login.tsx; no Zod/Yup currently

**Authentication:**
- Supabase Auth handles credential verification
- Session token stored in browser localStorage (Supabase default)
- useAuth hook syncs session on mount, listens to auth state changes
- Roles checked via user_profiles.role (viewer/editor/admin)
- canEdit = role in ['editor', 'admin']; only editors can modify data/settings

**Authorization:**
- Page-level: Settings page conditionally shown if canEdit
- Feature-level: Some UI buttons (Edit, Delete) hidden if !canEdit
- API-level: Supabase RLS (Row Level Security) policies should enforce, but not visible in codebase

**Internationalization:**
- UI strings hardcoded in Russian (Cyrillic)
- No i18n library (react-i18next, etc.)
- All dates formatted via date-fns with Russian locale
- Numbers formatted via formatNumber utility (1000 → '1 000')

## External System Integration

**Supabase:**
- Database: appeals, kpi_values, kpi_definitions, tg_chats, tg_issues, tg_messages, user_profiles, app_settings tables
- Auth: Email/password + phone-to-email transformation (Login component)
- Functions: analyze-sentiment (invoked from Appeals page)
- Realtime: Not currently used; could enable for live issue updates

**Telegram Bot (Python, `tg-bot/`):**
- Runs separately from React frontend
- bot.py: Listens to Telegram chats via Telethon library
- analyzer.py: DeepSeek API integration; groups messages into issues, scores severity
- Both write to same Supabase database (tg_chats, tg_issues, tg_messages, tg_analysis_log tables)
- React frontend reads via useSocialMonitor hook; displays chats, issues, status

**External APIs:**
- Yandex Vector (attendance tracking) — consumed via Attendance page, exact integration TBD
- DeepSeek (LLM) — used by Python bot for Telegram message analysis
- Google Fonts — loaded from CDN in index.html

---

*Architecture analysis: 2026-04-19*
