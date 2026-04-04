import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { StaffMetrics } from '../types';

interface UseStaffResult {
  data: StaffMetrics[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useStaff(): UseStaffResult {
  const [data, setData] = useState<StaffMetrics[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: rows, error: err } = await supabase
        .from('staff_metrics')
        .select('*')
        .order('date', { ascending: true });
      if (err) throw err;

      setData(
        (rows ?? []).map((r: Record<string, unknown>) => ({
          date: r.date as string,
          totalStaff: r.total_staff as number,
          aup: r.aup as number,
          workers: r.workers as number,
          vacancies: r.vacancies as number,
          vacanciesOver30d: r.vacancies_over_30d as number,
          turnoverPercent: r.turnover_percent as number,
          avgWorkerSalary: r.avg_worker_salary as number,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
