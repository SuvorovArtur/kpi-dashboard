import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { KpiDefinition, KpiDataPoint } from '../types';

interface UseKpiDataParams {
  kpiId?: string;
  territory?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface UseKpiDataResult {
  data: KpiDataPoint[];
  definitions: KpiDefinition[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useKpiData(params: UseKpiDataParams = {}): UseKpiDataResult {
  const [data, setData] = useState<KpiDataPoint[]>([]);
  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch definitions
      const { data: defs, error: defErr } = await supabase
        .from('kpi_definitions')
        .select('*');
      if (defErr) throw defErr;

      // Fetch values with filters
      let query = supabase.from('kpi_values').select('*');
      if (params.kpiId) query = query.eq('kpi_id', params.kpiId);
      if (params.territory) query = query.eq('territory', params.territory);
      if (params.dateFrom) query = query.gte('date', params.dateFrom);
      if (params.dateTo) query = query.lte('date', params.dateTo);
      query = query.order('date', { ascending: true });

      const { data: values, error: valErr } = await query;
      if (valErr) throw valErr;

      setDefinitions(defs as KpiDefinition[]);
      setData(
        (values ?? []).map((v: Record<string, unknown>) => ({
          date: v.date as string,
          kpiId: v.kpi_id as string,
          value: v.value as number,
          territory: v.territory as string | undefined,
          note: v.note as string | undefined,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [params.kpiId, params.territory, params.dateFrom, params.dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, definitions, isLoading, error, refetch: fetchData };
}
