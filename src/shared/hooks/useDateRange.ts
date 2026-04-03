import { useState, useCallback } from 'react';

interface DateRange {
  from: string;
  to: string;
}

export function useDateRange(initial?: DateRange) {
  const defaultRange: DateRange = {
    from: '2025-10-01',
    to: '2026-09-30',
  };
  const [range, setRange] = useState<DateRange>(initial || defaultRange);
  const reset = useCallback(() => setRange(defaultRange), []);
  return { range, setRange, reset };
}
