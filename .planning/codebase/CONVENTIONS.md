# Coding Conventions

**Analysis Date:** 2026-04-19

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `Card.tsx`, `Sidebar.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useKpiData.ts`, `useTerritories.ts`)
- Utilities: camelCase (e.g., `kpi-helpers.ts`, `formatters.ts`)
- CSS Modules: [component-name].module.css (e.g., `Card.module.css`, `Sidebar.module.css`)
- Types/interfaces: Separate `.tsx` file or co-located in component file (e.g., `useAuth.tsx` exports `AuthState` interface)
- Pages: PascalCase matching route structure (e.g., `Overview.tsx`, `Attendance.tsx`, `SocialMonitor.tsx`)

**Functions:**
- Functional components: PascalCase exported at module level
- Hook functions: camelCase starting with `use` prefix (e.g., `useKpiData`, `useToast`)
- Helper functions: camelCase (e.g., `getKpiStatus`, `calculateISN`, `copyToClipboard`)
- Event handlers: camelCase prefixed with `handle` or `on` (e.g., `handleExpand`, `onNavigate`, `onRemove`)

**Variables:**
- State variables: camelCase (e.g., `isLoading`, `error`, `collapsed`)
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `DEFAULT_PLAN`, `TARGET_PCT`)
- Boolean prefixes: `is`, `has`, `can` (e.g., `isLoading`, `hasError`, `canEdit`)
- Arrays: plural form or descriptive camelCase (e.g., `items`, `navItems`, `data`, `definitions`)

**Types:**
- Interfaces: PascalCase with descriptive names (e.g., `CardProps`, `UseKpiDataResult`, `AuthState`)
- Type unions: PascalCase or UPPER_CASE_UNION (e.g., `Status = 'green' | 'yellow' | 'red'`)
- Generic parameters: Single uppercase letter or descriptive PascalCase (e.g., `T`, `Item`)

## Code Style

**Formatting:**
- No explicit formatter configured in package.json (Prettier not present)
- ESLint configured with recommended TypeScript ESLint rules
- Indentation: 2 spaces (observed in CSS modules and TS files)
- Line length: Generally fits under 100 characters (observed pattern)
- Semicolons: Always present (TypeScript strict mode enforces)

**Linting:**
- Tool: ESLint 9.39.4 with typescript-eslint
- Config: `eslint.config.js` (flat config format)
- Extends:
  - `js.configs.recommended`
  - `tseslint.configs.recommended`
  - `reactHooks.configs.flat.recommended`
  - `reactRefresh.configs.vite`
- Key rules: React Hooks ESLint plugin enabled (validates hook dependencies)
- No custom ESLint overrides observed; uses defaults

**TypeScript Strictness:**
- Target: ES2023
- Module: ESNext
- **Strict mode: ENABLED** (`"strict": true`)
- Additional strict checks enabled:
  - `noUnusedLocals: true` — Requires all variables to be used
  - `noUnusedParameters: true` — Requires all function parameters to be used
  - `noFallthroughCasesInSwitch: true` — Prevents unintended fallthrough
  - `noUncheckedSideEffectImports: true` — Warns about side-effect imports
  - `erasableSyntaxOnly: true` — Only TypeScript syntax that can be erased
  - `verbatimModuleSyntax: true` — Preserves module syntax exactly
- JSX: `react-jsx` (automatic JSX runtime)

## Import Organization

**Order (observed pattern):**
1. React hooks and core React imports
   ```typescript
   import { useState, useEffect, useCallback, useMemo } from 'react';
   import { lazy, Suspense, Component } from 'react';
   ```

2. External library imports
   ```typescript
   import { BrowserRouter, useNavigate, Routes, Route, Navigate } from 'react-router-dom';
   import { createClient } from '@supabase/supabase-js';
   import clsx from 'clsx';
   ```

3. Internal imports (absolute paths)
   ```typescript
   import { Sidebar } from '../shared/ui';
   import { useAppSettings } from '../shared/hooks';
   import { supabase } from '../shared/lib/supabase';
   import type { Appeal } from '../shared/types';
   ```

4. CSS modules (last)
   ```typescript
   import styles from './Card.module.css';
   ```

**Type imports:** 
- Use `type` keyword for type-only imports to enable tree-shaking
- Example: `import type { Toast } from './useToast';`
- Example: `import type { Appeal } from '../../shared/types';`

**Path aliases:**
- No path aliases configured (`tsconfig.app.json` does not define `compilerOptions.paths`)
- All imports use relative paths like `../shared/ui`, `../../shared/hooks`

**Barrel exports:**
- Used in `src/shared/hooks/index.ts` to re-export all hooks:
  ```typescript
  export { useKpiData } from './useKpiData';
  export { useAppeals } from './useAppeals';
  export { useAuth } from './useAuth';
  // etc.
  ```
- Used in `src/shared/ui/index.ts` to re-export all components:
  ```typescript
  export { Card } from './Card/Card';
  export { Sidebar } from './Sidebar/Sidebar';
  export { DataTable } from './DataTable/DataTable';
  // etc.
  ```
- Benefits: Centralized re-exports, clean import statements at page level

## Error Handling

**Patterns:**
- Try-catch blocks with Error type narrowing:
  ```typescript
  try {
    const { data, error } = await supabase.from('table').select('*');
    if (error) throw error;
    // Process data
  } catch (err) {
    setError(err instanceof Error ? err : new Error(String(err)));
  }
  ```

- Supabase error checking before throwing:
  ```typescript
  const { error } = await supabase.from('table').delete().eq('id', id);
  if (error) throw error;
  ```

- State-based error reporting in hooks:
  ```typescript
  const [error, setError] = useState<Error | null>(null);
  // Errors stored in state and returned from hook
  return { data, isLoading, error, refetch };
  ```

- UI-level error boundaries:
  - `ErrorBoundary` class component in `src/app/App.tsx` catches React errors
  - Displays user-friendly error message in Russian
  - Provides reload button for recovery

- Graceful fallbacks:
  - Null coalescing with defaults: `value ?? defaultValue`
  - Optional chaining for nested access: `data?.user?.id`
  - Empty checks: `if (!toast) return;`

## Logging

**Framework:** `console` (browser console)

**Patterns:**
- Minimal logging in production code
- `console.error()` used only in ErrorBoundary for debugging
- Comments explain data selection rationale (e.g., in `useKpiData.ts`: "select(*) is intentional")

**Best practices observed:**
- No debug logging in hooks or components
- Errors logged to console for debugging but not exposed to users
- Production error display through toast/modal UI pattern

## Comments

**When to Comment:**
- Complex business logic explanation (e.g., ISN calculation, repeated addresses, sentiment analysis)
- Data fetching rationale (why all columns selected vs. subset)
- GPS/geocoding priority list (comment block for parsing order)

**Format:**
- Single-line comments: `// Comment text`
- Multi-line comments for complex logic: Inline comments explaining intent
- No JSDoc-style comments observed in hooks/utils

**Examples:**
```typescript
// From useAppeals.ts - explaining why select('*') is used:
// select('*') is intentional: this hook serves Appeals, ISN, Overview, and KpiDetail pages
// which collectively use nearly all Appeal columns (including description, sentiment_score,
// is_spam, is_repeated, fact, message_type, sector, curator, executor, etc.).

// From kpi-helpers.ts - documenting formula:
/**
 * Weighted ISN (Index of Social Tension): ISN_w = Σ(s²) / Σ(s)
 * Gives more weight to higher scores, amplifying acute appeals.
 */
```

## Function Design

**Size:** 
- Hooks: 20-80 lines (typically include setup, fetch, state management)
- Components: 30-100 lines (tend to include layout and event handlers)
- Utilities: 5-50 lines (focused on single calculation)
- Helper functions within hooks: Extracted with `useCallback` for stability

**Parameters:** 
- Functions accept typed objects over multiple primitives (e.g., `params: UseKpiDataParams = {}`)
- Optional parameters default to empty objects `{}` or null
- Component props destructured in function signature
- Event handlers receive event object: `onClick={(e) => { e.stopPropagation(); }}`

**Return Values:**
- Hooks return objects with multiple values:
  ```typescript
  return { data, definitions, isLoading, error, refetch };
  ```
- Components return JSX or null
- Utilities return typed values (number, string, boolean, custom types)
- Functions marked with explicit return type annotations in TypeScript

## Module Design

**Exports:**
- Components: Default or named export (mixed pattern observed)
  - `export function Card(...)` — named export
  - `export default function App(...)` — default export
  - Hooks: Always named export (e.g., `export function useKpiData(...)`)

- Interfaces exported alongside implementations:
  ```typescript
  export interface CardProps { ... }
  export function Card({ ... }: CardProps) { ... }
  ```

- Type exports use `export type`:
  ```typescript
  export type { Toast } from './useToast';
  export type { Column } from './DataTable/DataTable';
  ```

**Barrel Files:**
- Used for organizing re-exports in `shared/hooks` and `shared/ui`
- Pattern: Index file exports from local modules
  ```typescript
  export { useKpiData } from './useKpiData';
  export { useAppeals } from './useAppeals';
  ```
- Benefit: Clean imports at page level: `import { useKpiData, useAppeals } from '../../shared/hooks';`

**Directory Organization:**
- Components grouped by feature in `src/shared/ui/`
- Each component has own directory: `ComponentName/ComponentName.tsx` + `ComponentName.module.css`
- Hooks organized in `src/shared/hooks/` as individual files
- Utilities organized by domain: `kpi-helpers.ts`, `formatters.ts`
- Types in separate `src/shared/types/` directory

## CSS Modules Conventions

**Class naming:**
- camelCase for all class names (e.g., `.card`, `.navItem`, `.accentTeal`)
- State classes: `.presetBtnActive`, `.navItemActive`, `.pctSm`
- Structural classes: `.header`, `.body`, `.title`, `.wrapper`
- Utility classes: `.divider`, `.miniBar`, `.miniBarFill`

**CSS Custom Properties:**
- Uses CSS variables extensively for theming: `var(--color-card-bg)`, `var(--color-border)`
- Color variables: `var(--color-teal)`, `var(--color-orange)`, `var(--color-red)`
- Font variables: `var(--font-heading)`, `var(--font-body)`
- Spacing consistent with Tailwind-like values (4px, 6px, 8px increments)

**Styling patterns:**
- No inline styles in components except for dynamic values
- Dynamic values passed through style prop: `style={{ width: '${w}%', background: color }}`
- Modular structure: Each component file has corresponding .module.css
- Hover/disabled states: `:hover:not(:disabled)`, `:disabled` pseudo-selectors
- Transitions: `transition: background 0.15s ease, color 0.15s ease` for smooth interactions

**Usage in components:**
```typescript
import styles from './Card.module.css';

export function Card({ accent, className }: CardProps) {
  return (
    <div className={clsx(styles.card, accent && accentMap[accent], className)}>
      {/* */}
    </div>
  );
}
```

- Uses `clsx` utility for conditional class composition
- Accent variants mapped to CSS classes: `accentMap['teal']` → `styles.accentTeal`

---

*Convention analysis: 2026-04-19*
