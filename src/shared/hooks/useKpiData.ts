import { useState, useEffect, useMemo } from 'react';
import type { KpiDefinition, KpiDataPoint } from '../types';
import kpiDefinitions from '../../data/kpi-definitions.json';
import kpiValues from '../../data/kpi-values.json';

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
}

export function useKpiData(params: UseKpiDataParams = {}): UseKpiDataResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const data = useMemo(() => {
    let filtered = kpiValues as KpiDataPoint[];
    if (params.kpiId) filtered = filtered.filter(d => d.kpiId === params.kpiId);
    if (params.territory) filtered = filtered.filter(d => d.territory === params.territory);
    if (params.dateFrom) filtered = filtered.filter(d => d.date >= params.dateFrom!);
    if (params.dateTo) filtered = filtered.filter(d => d.date <= params.dateTo!);
    return filtered;
  }, [params.kpiId, params.territory, params.dateFrom, params.dateTo]);

  return {
    data: isLoading ? [] : data,
    definitions: isLoading ? [] : (kpiDefinitions as KpiDefinition[]),
    isLoading,
    error,
  };
}
