# Coding Conventions

**Analysis Date:** 2026-04-06

## Naming Patterns

**Files:**
- Component files: PascalCase (`Login.tsx`, `Sidebar.tsx`, `DataTable.tsx`)
- Hook files: camelCase with `use` prefix (`useAuth.tsx`, `useKpiData.ts`, `useDateRange.ts`)
- Utility/helper files: camelCase (`formatters.ts`, `geocode.ts`, `kpi-helpers.ts`)
- CSS Module files: PascalCase matching component (`Card.module.css`, `DataTable.module.css`)
- Configuration files: camelCase or kebab-case (`theme.ts`, `kpi-config.ts`)

**Functions:**
- React components: PascalCase (`function Login()`, `export function Card()`)
- Regular functions: camelCase (`function phoneToEmail()`, `function loadProfile()`)
- Handler functions: camelCase with verb prefix (`handleSubmit`, `handleSort`, `handleAnalyze`)
- Callbacks: camelCase with callback suffix or simple verb (`onMessage`, `onSort`, `onRowClick`)

**Variables:**
- State variables: camelCase (`const [phone, setPhone] = useState('')`)
- Constants: UPPER_SNAKE_CASE for module-level constants (`ALERT_CHAT_ID`, `ANALYSIS_INTERVAL`)
- Map/Record objects: camelCase (`const accentMap`, `const statusGroups`, `const addrKey`)
- Boolean variables: `is` or `has` prefix (`isLoading`, `isAdmin`, `canEdit`, `hasError`)

**Types:**
- Interface names: PascalCase (`CardProps`, `UseKpiDataResult`, `DataTableProps`)
- Type aliases: PascalCase (`Status`, `Trend`, `AppealRow`)
- Generic type parameters: Single uppercase letter (`<T>`, `<T extends Record<string, unknown>>`)
- Props interfaces: `{ComponentName}Props` or `{HookName}Props` pattern

**UI/Domain Entities:**
- Mapped enums/lookups: camelCase records (`const accentMap`, `const STATUS_GROUPS`)
- Event handler parameters: specific names (`e: FormEvent`, `event: NewMessage`, `props: any`)

## Code Style

**Formatting:**
- ESLint with TypeScript support enabled
- Config: `eslint.config.js` using flat config format
- Target: ES2023 with JSX React
- No explicit Prettier config; relies on ESLint defaults

**Linting Rules:**
- `@eslint/js` recommended config
- `typescript-eslint` recommended config
- `react-hooks` recommended rules (hooks warnings)
- `react-refresh` Vite plugin rules
- Strict TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`

**Imports:**
- ES modules (`type: "module"` in package.json)
- Relative imports for local code (`'../shared/hooks'`, `'../../shared/ui'`)
- Named imports preferred (`import { Card, KpiCard } from '../../shared/ui'`)
- Type imports: inline with `type` keyword (`import type { Session, User } from '@supabase/supabase-js'`)
- Absolute imports not configured; use relative paths throughout

## Import Organization

**Order (based on observed patterns):**
1. React and built-in hooks (`import { useState, useEffect }`)
2. External libraries (`import { BrowserRouter } from 'react-router-dom'`)
3. Type imports (`import type { Session } from '@supabase/supabase-js'`)
4. Local components and hooks (`import { Sidebar } from '../shared/ui'`)
5. Utilities and services (`import { supabase } from '../shared/lib/supabase'`)
6. Types and interfaces (`import type { Appeal } from '../../shared/types'`)
7. Styles (CSS modules last) (`import styles from './Card.module.css'`)

**Path Aliases:**
- None configured; all imports are relative paths
- Consistent use of `../` and `../../` patterns throughout codebase

## Error Handling

**Patterns:**
- Async functions return errors as values: `Promise<string | null>` (see `useAuth.signIn`)
- Try/catch for Supabase queries with explicit error type checking:
  ```typescript
  try {
    const { data, error } = await supabase.from('table').select('*');
    if (error) throw error;
  } catch (err) {
    setError(err instanceof Error ? err : new Error(String(err)));
  }
  ```
- Component error state: `useState<Error | null>(null)` pattern
- Toast notifications for user-facing errors: `{ message: string; type: 'success' | 'error' }`
- Direct error message display in UI (see `Appeals.tsx` for sentiment analysis errors)

## Logging

**Framework:** Native `console` methods

**Patterns:**
- Python code uses `print()` with descriptive prefixes: `print(f"[bot] MSG {chat_id}: {text}")`
- React/TypeScript: No observed structured logging; mostly for debug
- Single comment in codebase: `// Convert -100XXXXXXXXXX → XXXXXXXXXX for t.me/c/ format` in SocialMonitor

## Comments

**When to Comment:**
- Minimal use; code is generally self-documenting
- Comments for non-obvious logic or data transformations
- Comments for integration-specific workarounds (e.g., phone number formatting)

**JSDoc/TSDoc:**
- Minimal use observed
- Python docstrings: Simple triple-quoted strings at module level (`"""..."""`)
- No observed TypeScript JSDoc annotations

## Function Design

**Size:** 
- Average functions: 20-50 lines for hooks and utilities
- Largest observed: ~85 lines (Appeals page's overall analytics calculation)
- UI components: 30-100 lines typical

**Parameters:**
- Props objects over positional parameters (all React components use destructured props)
- Hook result objects with consistent naming: `{ data, isLoading, error, refetch }`
- Callback functions optional in props with `?:` syntax

**Return Values:**
- Hooks return objects with consistent shape:
  ```typescript
  interface UseKpiDataResult {
    data: KpiDataPoint[];
    definitions: KpiDefinition[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
  }
  ```
- Components return JSX (implicit React.ReactNode)
- Utility functions return typed values (strings, numbers, arrays, objects)

## Module Design

**Exports:**
- Named exports for functions and components
- Default export rarely used (only `index.tsx` as entry point)
- Type exports use `export type { }` syntax
- Barrel files in `shared/ui/index.ts`, `shared/hooks/index.ts` aggregate related exports

**Barrel Files:**
- `src/shared/ui/index.ts`: Aggregates all UI components and component-specific types
- `src/shared/hooks/index.ts`: Aggregates all custom hooks (8 hooks exported)
- `src/shared/types/index.ts`: Central repository for type definitions
- Direct imports from barrel files encouraged: `import { Card, KpiCard } from '../../shared/ui'`

## Record Types and Enums

**Record Mapping Pattern:**
- Used for UI state mapping (accent colors, status colors):
  ```typescript
  const accentMap: Record<string, string> = {
    teal: styles.accentTeal,
    orange: styles.accentOrange,
    red: styles.accentRed,
    neutral: styles.accentNeutral,
  };
  ```
- Status group lookups: `const STATUS_GROUPS: Record<string, string[]>`
- Accessed via bracket notation in conditional rendering

**Union Types:**
- Status: `type Status = 'green' | 'yellow' | 'red'`
- Trend: `type Trend = 'up' | 'down' | 'flat'`
- Chart types: `type: 'line' | 'bar' | 'area' | 'pie' | 'radar' | 'horizontal-bar'`

## Styling Conventions

**CSS Modules:**
- All component styles use CSS Modules with `.module.css` extension
- Class names in camelCase: `styles.card`, `styles.header`, `styles.title`
- Variant classes for conditionals: `styles.accentTeal`, `styles.sortActive`
- Use `clsx` utility for conditional class merging:
  ```typescript
  className={clsx(styles.card, accent && accentMap[accent], className)}
  ```

**Theme Colors:**
- Centralized in `src/shared/config/theme.ts`
- Constants: `colors.teal`, `colors.tealLight`, `colors.orange`, `colors.red`
- CSS variables used in charts: `var(--color-teal)`, `var(--color-status-green)`
- Locale-specific formatting: `toLocaleDateString('ru-RU')` for Russian date/number formats

## State Management

**Pattern:** React Context + Hooks (no Redux/Zustand)

- `AuthProvider` wraps app with user session state
- Custom hooks encapsulate data fetching (`useKpiData`, `useAppeals`, `useTerritories`)
- Local component state: `useState` for UI toggles and form inputs
- Date range state: `useDateRange` custom hook with preset support

## Type Safety

**TypeScript strict mode enabled:**
- `noUnusedLocals`, `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `noUncheckedSideEffectImports`
- Type assertions rare; proper typing preferred
- Generic constraints: `<T extends Record<string, unknown>>`

---

*Convention analysis: 2026-04-06*
