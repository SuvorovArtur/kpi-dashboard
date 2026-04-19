# Testing Patterns

**Analysis Date:** 2026-04-19

## Current State: NO TESTS

**Status:** The codebase contains **zero test files**. No testing framework is configured.

**Evidence:**
- `package.json` contains no test-related scripts (`npm test`, `npm run test`, etc.)
- No test files found in `src/` directory (search for `*.test.*` and `*.spec.*` found only node_modules)
- No testing dependencies in `devDependencies`: No Jest, Vitest, React Testing Library, Cypress, Playwright, etc.
- No test configuration files: No `jest.config.js`, `vitest.config.ts`, `playwright.config.ts`, etc.

## Implications

**Risk areas (untested):**
- All hooks (`src/shared/hooks/`): `useKpiData.ts`, `useAppeals.ts`, `useAuth.tsx`, `useTerritories.ts`, `useAttendance.ts`, etc.
- All UI components (`src/shared/ui/`): `Card.tsx`, `DataTable.tsx`, `Sidebar.tsx`, `Toast.tsx`, etc.
- All utility functions (`src/shared/utils/`): `kpi-helpers.ts`, `calculateISN()`, `getKpiStatus()`, etc.
- Complex business logic in pages: `Overview.tsx`, `Appeals.tsx`, `Attendance.tsx`, `SocialMonitor.tsx`
- Supabase integration: Database queries, error handling, authentication flows
- Data transformations: CSV export, date filtering, sorting, pagination

**Code that could break silently:**
- Custom calculation functions like `calculateISN()` (weighted index formula)
- Error boundary error handling in `src/app/App.tsx`
- CSV export logic in `DataTable.tsx` (quote escaping, comma handling)
- Role-based access control in `useAuth.tsx` (canEdit, isAdmin derivation)
- Complex state management in hooks with multiple async operations

## Recommended Testing Strategy

### Phase 1: Unit Tests (Foundation)

**Framework recommendation:** Vitest (lightweight, Vite-integrated, fast)

**Priority areas:**
1. **Utility functions** (`src/shared/utils/`)
   - `calculateISN()` — complex formula, critical for KPI calculation
   - `getKpiStatus()` — status determination logic
   - `getProgressToTarget()` — percentage calculation
   - `getTrend()`, `getTrendValue()` — trend analysis

2. **Hook logic** (test in isolation with mocking)
   - `useAppSettings()` — state management for app-wide settings
   - `useToast()` — toast lifecycle and cleanup
   - `useDateRange()` — date range state and updates

3. **Business logic utilities**
   - Date calculations in `Attendance.tsx` helpers
   - Status grouping in `Appeals.tsx`
   - Validation functions

### Phase 2: Component Tests

**Use:** React Testing Library with Vitest

**Scope:**
- Simple presentational components: `Card.tsx`, `Badge.tsx`, `ProgressBar.tsx`
- Components with user interactions: `DataTable.tsx` (sorting, pagination), `Toast.tsx` (auto-dismiss)
- Form components: `DateRangePicker.tsx`, `XlsxImport.tsx`

**Approach:**
- Test rendered output and user interactions
- Mock child components in complex hierarchies
- Test CSS class application via `clsx` utilities

### Phase 3: Integration Tests

**Scope:**
- Hook + Supabase integration (mocked DB)
- Multi-component page flows
- Auth flow: login → authenticated state → logout

**Setup:**
- Mock Supabase client (`supabase` from `src/shared/lib/supabase.ts`)
- Mock fetch calls
- Verify data flows through hooks to components

### Phase 4: E2E Tests (Future)

**Framework:** Playwright or Cypress (not needed immediately)

**Scope:**
- Full user journeys: Login → Navigate → View Data → Export CSV
- Cross-browser compatibility
- Responsive design

## Hook Testing Pattern (Template)

Based on observed hook structure, tests would follow this pattern:

```typescript
// Example: useKpiData.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useKpiData } from './useKpiData';

// Mock Supabase
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        data: mockData,
        error: null,
      }),
    })),
  },
}));

describe('useKpiData', () => {
  it('should fetch and return KPI data', async () => {
    const { result } = renderHook(() => useKpiData());
    
    // Initially loading
    expect(result.current.isLoading).toBe(true);
    
    // After fetch completes
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch errors', async () => {
    // Mock error scenario
    // Assert error state and UI response
  });

  it('should filter by parameters', async () => {
    const { result } = renderHook(() => 
      useKpiData({ kpiId: 'test-id', territory: 'test-territory' })
    );
    
    // Verify correct filters applied
  });

  it('should support refetch', async () => {
    const { result } = renderHook(() => useKpiData());
    result.current.refetch();
    // Verify refetch triggers new fetch
  });
});
```

## Utility Function Testing Pattern (Template)

```typescript
// Example: kpi-helpers.test.ts
import { calculateISN, getKpiStatus, getProgressToTarget } from './kpi-helpers';

describe('calculateISN', () => {
  it('should calculate weighted ISN correctly', () => {
    const scores = [5, 6, 7, 8, 9];
    const result = calculateISN(scores);
    // ISN_w = Σ(s²) / Σ(s) = (25+36+49+64+81) / (5+6+7+8+9) = 255/35 = 7.3
    expect(result).toBe(7.3);
  });

  it('should return 0 for empty scores', () => {
    expect(calculateISN([])).toBe(0);
  });

  it('should handle single score', () => {
    expect(calculateISN([5])).toBe(5);
  });
});

describe('getKpiStatus', () => {
  it('should return green when meeting target', () => {
    expect(getKpiStatus(95, 100, 'higher')).toBe('green');
  });

  it('should return yellow at 70% of target', () => {
    expect(getKpiStatus(70, 100, 'higher')).toBe('yellow');
  });

  it('should return red below 70% of target', () => {
    expect(getKpiStatus(50, 100, 'higher')).toBe('red');
  });
});
```

## Component Testing Pattern (Template)

```typescript
// Example: Card.test.tsx
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('should render children', () => {
    render(<Card>Test content</Card>);
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    render(<Card title="Test Title">Content</Card>);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('should apply accent class', () => {
    const { container } = render(<Card accent="teal">Content</Card>);
    expect(container.firstChild).toHaveClass('accentTeal');
  });

  it('should apply custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
```

## Mocking Strategy

**What to mock:**
- Supabase client (`src/shared/lib/supabase.ts`)
- Network requests (use MSW - Mock Service Worker)
- React Router (useNavigate, useLocation)
- Third-party libraries with side effects (Leaflet, Recharts)

**What NOT to mock:**
- Internal utility functions (test directly)
- React hooks from `react` (use actual hooks)
- CSS Modules (import normally in tests)

## Current Gaps

**High priority to test:**
1. `calculateISN()` — Complex mathematical formula, core to "ISN" KPI page
2. `useKpiData()` — Fetches and transforms all KPI definitions and values
3. `useAuth()` — Authentication state, role checking (canEdit, isAdmin)
4. `useAppeals()` — Large data fetch with multiple nullable fields
5. `DataTable.tsx` — Sorting logic, pagination, CSV export with quote escaping

**Medium priority:**
- Form validation (XlsxImport file parsing)
- Date range calculations (Attendance page)
- Geographic filtering and repeated address detection

**Low priority (until needed):**
- Visual regression testing
- E2E user flows
- Accessibility (a11y) testing

## Configuration Recommendation

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/main.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**package.json scripts to add:**
```json
{
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage"
}
```

---

*Testing analysis: 2026-04-19*
