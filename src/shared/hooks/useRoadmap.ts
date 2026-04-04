import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RoadmapItem } from '../types';

interface UseRoadmapParams {
  track?: 'tu' | 'mbu';
}

interface UseRoadmapResult {
  data: RoadmapItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRoadmap(params: UseRoadmapParams = {}): UseRoadmapResult {
  const [data, setData] = useState<RoadmapItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let query = supabase.from('roadmap').select('*');
      if (params.track) query = query.eq('track', params.track);
      query = query.order('start_date', { ascending: true });

      const { data: rows, error: err } = await query;
      if (err) throw err;

      setData(
        (rows ?? []).map((r: Record<string, unknown>) => ({
          id: r.id as string,
          track: r.track as RoadmapItem['track'],
          title: r.title as string,
          startDate: r.start_date as string,
          endDate: r.end_date as string,
          status: r.status as RoadmapItem['status'],
          linkedKpis: r.linked_kpis as string[] | undefined,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [params.track]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
