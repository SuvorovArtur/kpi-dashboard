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

// Hard upper bound for a single chunk fetch. If Supabase / Cloudflare hangs,
// we abort the request, surface an error, and stop hammering — users see a
// clear failure state instead of an infinite skeleton.
const REQUEST_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms / 1000}s`)), ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
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

        const { data: rows, error: err } = await withTimeout(query, REQUEST_TIMEOUT_MS, 'appeals chunk');
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
