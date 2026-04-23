import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Appeal } from '../types';

interface UseAppealsParams {
  direction?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface UseAppealsResult {
  data: Appeal[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useAppeals(params: UseAppealsParams = {}): UseAppealsResult {
  const [data, setData] = useState<Appeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const CHUNK = 1000;
      const acc: Appeal[] = [];
      for (let offset = 0; ; offset += CHUNK) {
        let query = supabase.from('appeals').select('*');
        if (params.direction) query = query.eq('direction', params.direction);
        if (params.status) query = query.eq('status', params.status);
        if (params.dateFrom) query = query.gte('date', params.dateFrom);
        if (params.dateTo) query = query.lte('date', params.dateTo);
        query = query.order('date', { ascending: false }).range(offset, offset + CHUNK - 1);

        const { data: rows, error: err } = await query;
        if (err) throw err;
        const chunk = (rows ?? []) as Appeal[];
        acc.push(...chunk);
        if (chunk.length < CHUNK) break;
      }
      setData(acc);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [params.direction, params.status, params.dateFrom, params.dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
