import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { geocodeAppeals } from '../lib/geocode';
import type { Appeal } from '../types';

interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
  appeal: Appeal;
}

interface UseHeatmapDataResult {
  points: HeatmapPoint[];
  allAppeals: Appeal[];
  isLoading: boolean;
  geocoding: { active: boolean; done: number; total: number };
  error: Error | null;
  startGeocoding: () => void;
}

export function useHeatmapData(params: {
  dateFrom?: string;
  dateTo?: string;
  direction?: string;
}): UseHeatmapDataResult {
  const [allAppeals, setAllAppeals] = useState<Appeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [geocoding, setGeocoding] = useState({ active: false, done: 0, total: 0 });
  const geocodingRef = useRef(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const CHUNK = 1000;
      const acc: Appeal[] = [];
      for (let offset = 0; ; offset += CHUNK) {
        let query = supabase.from('appeals').select('*');
        if (params.dateFrom) query = query.gte('date', params.dateFrom);
        if (params.dateTo) query = query.lte('date', params.dateTo);
        if (params.direction) query = query.eq('direction', params.direction);
        query = query.order('date', { ascending: false }).range(offset, offset + CHUNK - 1);

        const { data, error: err } = await query;
        if (err) throw err;
        const chunk = (data ?? []) as Appeal[];
        acc.push(...chunk);
        if (chunk.length < CHUNK) break;
      }
      setAllAppeals(acc);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [params.dateFrom, params.dateTo, params.direction]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const points: HeatmapPoint[] = allAppeals
    .filter((a): a is Appeal & { lat: number; lng: number } => a.lat != null && a.lng != null)
    .map(a => ({ lat: a.lat, lng: a.lng, intensity: 1, appeal: a }));

  const startGeocoding = useCallback(async () => {
    if (geocodingRef.current) return;
    const ungeocodedAppeals = allAppeals.filter(a => a.lat == null && a.lng == null);
    if (ungeocodedAppeals.length === 0) return;

    geocodingRef.current = true;
    setGeocoding({ active: true, done: 0, total: ungeocodedAppeals.length });

    try {
      await geocodeAppeals(
        ungeocodedAppeals,
        (done, total) => setGeocoding({ active: true, done, total }),
      );
      await fetchData();
    } finally {
      geocodingRef.current = false;
      setGeocoding({ active: false, done: 0, total: 0 });
    }
  }, [allAppeals, fetchData]);

  return { points, allAppeals, isLoading, geocoding, error, startGeocoding };
}
