import { useState, useEffect, useMemo } from 'react';
import type { Appeal } from '../types';
import appealsData from '../../data/appeals.json';

interface UseAppealsParams {
  territory?: string;
  category?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface UseAppealsResult {
  data: Appeal[];
  isLoading: boolean;
  error: Error | null;
}

export function useAppeals(params: UseAppealsParams = {}): UseAppealsResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const data = useMemo(() => {
    let filtered = appealsData as Appeal[];
    if (params.territory) filtered = filtered.filter(d => d.territory === params.territory);
    if (params.category) filtered = filtered.filter(d => d.category === params.category);
    if (params.status) filtered = filtered.filter(d => d.status === params.status);
    if (params.dateFrom) filtered = filtered.filter(d => d.date >= params.dateFrom!);
    if (params.dateTo) filtered = filtered.filter(d => d.date <= params.dateTo!);
    return filtered;
  }, [params.territory, params.category, params.status, params.dateFrom, params.dateTo]);

  return {
    data: isLoading ? [] : data,
    isLoading,
    error,
  };
}
