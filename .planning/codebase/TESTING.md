# Testing Patterns

**Analysis Date:** 2026-04-06

## Test Framework

**Current Status:**
- **No test framework configured** - Project has no Jest, Vitest, or other test runner
- **No test files detected** - Zero `.test.ts`, `.spec.ts`, `.test.tsx`, or `.spec.tsx` files in codebase
- **Development environment**: Vite with React 19.2.4

**Recommended Setup (not yet implemented):**
- Vitest recommended for Vite-based projects
- @testing-library/react for component testing
- TypeScript strict mode already enabled

**Run Commands (future):**
```bash
npm run test              # Once configured
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

## Test File Organization

**Current Pattern:**
- No organized test structure exists
- No `__tests__` directories
- No separate `/tests` folder

**Recommended Pattern (not yet implemented):**
- Co-locate tests with source files: `Component.tsx` + `Component.test.tsx`
- Central test utilities in `src/shared/testing/` directory
- Fixtures and test data in `src/shared/testing/fixtures/`

## Test Structure

**No existing tests to document, but based on code patterns, tests would likely follow:**

**Hook Testing Pattern (for custom hooks):**
```typescript
import { renderHook, act } from '@testing-library/react';
import { useKpiData } from '../hooks/useKpiData';

describe('useKpiData', () => {
  it('should fetch KPI definitions and data', async () => {
    const { result } = renderHook(() => useKpiData({ kpiId: 'kpi-1' }));
    
    expect(result.current.isLoading).toBe(true);
    
    await act(async () => {
      // Wait for data
    });
    
    expect(result.current.data).toHaveLength(0); // or > 0
    expect(result.current.error).toBeNull();
  });
});
```

**Component Testing Pattern (for UI components):**
```typescript
import { render, screen } from '@testing-library/react';
import { Card } from '../Card';

describe('Card', () => {
  it('should render with title', () => {
    render(
      <Card title="Test Title">
        <div>Content</div>
      </Card>
    );
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });
  
  it('should apply accent class', () => {
    const { container } = render(
      <Card accent="teal">Content</Card>
    );
    
    expect(container.querySelector('.accentTeal')).toBeInTheDocument();
  });
});
```

## Mocking Strategy

**No mocking framework currently configured, but based on patterns:**

**Supabase Mocking (critical for data hooks):**
```typescript
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue({
      data: mockData,
      error: null,
    }),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({
      data: mockData,
      error: null,
    }),
  },
}));
```

**Context Provider Mocking:**
- `AuthProvider` would need mock setup with valid session/profile
- Wrap test components with `<AuthProvider>` for tests requiring auth state

**What to Mock:**
- Supabase client calls (all database operations)
- External API calls (DeepSeek/sentiment analysis)
- Leaflet/map instances (expensive to initialize)
- Firebase operations
- Telethon Telegram client (in Python tests)

**What NOT to Mock:**
- Utility functions (`formatNumber`, `formatDate`, `formatPercent`)
- Custom hooks when testing components that use them
- React hooks (`useState`, `useContext`, `useCallback`)
- CSS Module imports

## Fixtures and Factories

**No fixture files currently exist, but would follow patterns:**

**Test Data Location:**
- `src/shared/testing/fixtures/` (recommended)
- Type-safe factories for common entities:

```typescript
// src/shared/testing/fixtures/appeal.ts
import type { Appeal } from '../../types';

export function createMockAppeal(overrides?: Partial<Appeal>): Appeal {
  return {
    id: 1,
    ecur_number: 'TEST-001',
    source_number: null,
    date: '2026-04-06',
    direction: 'incoming',
    synth_group: null,
    fact: null,
    subtopic: null,
    status: 'В работе',
    curator: null,
    executor: null,
    omsu: null,
    source: null,
    is_spam: false,
    message_type: null,
    description: 'Test appeal',
    address: null,
    district: null,
    settlement: null,
    street: null,
    house: null,
    tu_to: null,
    sector: null,
    sentiment_score: null,
    is_repeated: false,
    lat: null,
    lng: null,
    ...overrides,
  };
}

export function createMockKpiDefinition(overrides?: Partial<KpiDefinition>): KpiDefinition {
  return {
    id: 'kpi-1',
    name: 'Test KPI',
    unit: '%',
    direction: 'higher',
    formula: 'test',
    source: 'test',
    responsible: 'test',
    frequency: 'monthly',
    current: 50,
    d90: 55,
    d180: 60,
    d360: 65,
    base: 45,
    ...overrides,
  };
}
```

## Coverage

**Requirements:**
- Not currently enforced (no coverage tooling configured)
- Recommended minimum: 70% for business logic, 50% for components

**View Coverage (future):**
```bash
npm run test:coverage
# Or with Vitest:
vitest run --coverage
```

**Key areas that should prioritize testing:**
- Data transformation functions (`formatters.ts`, `kpi-helpers.ts`)
- Custom hooks (`useAuth`, `useKpiData`, `useAppeals`)
- Critical business logic (appeals analytics, status grouping)
- Geocoding/address parsing logic

## Test Types

**Unit Tests:**
- Scope: Individual functions, utilities, hooks
- Approach: Test pure functions and hook behavior with mocked dependencies
- Examples: `formatNumber()`, `useKpiData()`, `getStatusGroup()`

**Integration Tests:**
- Scope: Hook + component interactions, data flow through UI
- Approach: Render component with real hook, mock API calls
- Examples: Appeals page with filters, KPI cards with date range changes

**E2E Tests:**
- Framework: Not configured
- Recommendation: Consider Playwright or Cypress for critical user flows
- Candidates: Login flow, appeals filtering, export functionality

**Python/Bot Testing (Telegram monitor):**
- No test framework detected in `tg-bot/`
- Would benefit from: Pytest + async test support (pytest-asyncio)
- Coverage targets: Message saving flow, sentiment analysis, alert handling

## Common Patterns

**Async Testing:**
```typescript
it('should fetch data', async () => {
  const { result } = renderHook(() => useKpiData());
  
  await act(async () => {
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
  
  expect(result.current.data).toBeDefined();
});
```

**Error Testing:**
```typescript
it('should handle fetch errors', async () => {
  jest.mock('../lib/supabase', () => ({
    supabase: {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('DB error'),
      }),
    },
  }));
  
  const { result } = renderHook(() => useKpiData());
  
  await act(async () => {
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
  
  expect(result.current.error).toEqual(new Error('DB error'));
});
```

**State Update Testing:**
```typescript
it('should toggle sidebar collapse state', () => {
  render(<App />);
  const collapseBtn = screen.getByRole('button', { name: /свернуть меню/i });
  
  fireEvent.click(collapseBtn);
  
  expect(container.querySelector('.layout')).toHaveClass('collapsed');
});
```

**Component Interaction Testing:**
```typescript
it('should filter appeals by direction', async () => {
  const { data } = await renderComponent(<Appeals />);
  
  const directionFilter = screen.getByRole('combobox', { name: /направление/i });
  fireEvent.change(directionFilter, { target: { value: 'incoming' } });
  
  await waitFor(() => {
    expect(data).toHaveLength(/* expected count */);
  });
});
```

## Testing Gaps

**Critical Areas Currently Untested:**
1. **Authentication flow** (`useAuth` hook) - No login/logout tests
2. **Data fetching** (`useKpiData`, `useAppeals`) - No mock Supabase tests
3. **Date range filtering** (`useDateRange`) - No preset validation tests
4. **Analytics calculations** (KPI computation, status grouping) - No logic tests
5. **CSV export functionality** (`DataTable.tsx exportCsv`) - No export format tests
6. **Sentiment analysis** (Appeals page analysis invocation) - No API call tests
7. **Geolocation/heatmap** (HeatMap.tsx) - No geocoding or masking tests
8. **Telegram bot** (tg-bot/) - No message handling or database tests

**Recommendations:**
- Start with utility function tests (highest ROI)
- Add hook tests for data fetching logic
- Add component tests for critical UI flows
- Add Python tests for bot message handling and analysis
- Establish testing standards before feature velocity increases

---

*Testing analysis: 2026-04-06*
