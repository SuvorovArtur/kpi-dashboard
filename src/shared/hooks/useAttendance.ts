import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface AttendanceRecord {
  date: string;
  fact: number;
  plan: number;
}

export interface AttendancePlan {
  year: number;
  month: number;
  planValue: number;
}

const DEFAULT_PLAN = 50;

export function useAttendance() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [plans, setPlans] = useState<AttendancePlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const [recRes, planRes] = await Promise.all([
      supabase.from('attendance_records').select('date, fact, plan').order('date'),
      supabase.from('attendance_plans').select('year, month, plan_value'),
    ]);
    if (recRes.data) setRecords(recRes.data as AttendanceRecord[]);
    if (planRes.data) setPlans(planRes.data.map((p: any) => ({ year: p.year, month: p.month, planValue: p.plan_value })));
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getPlan = useCallback((year: number, month: number): number => {
    return plans.find(p => p.year === year && p.month === month)?.planValue ?? DEFAULT_PLAN;
  }, [plans]);

  const saveRecord = useCallback(async (date: string, fact: number, plan: number) => {
    const { error } = await supabase.from('attendance_records').upsert({ date, fact, plan }, { onConflict: 'date' });
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  const deleteRecord = useCallback(async (date: string) => {
    const { error } = await supabase.from('attendance_records').delete().eq('date', date);
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  const savePlan = useCallback(async (year: number, month: number, value: number) => {
    const { error } = await supabase.from('attendance_plans').upsert(
      { year, month, plan_value: value },
      { onConflict: 'year,month' }
    );
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  // Helper: get record for a specific date
  const getRecord = useCallback((date: string): AttendanceRecord | undefined => {
    return records.find(r => r.date === date);
  }, [records]);

  // Helper: get records for a month
  const getMonthRecords = useCallback((year: number, month: number): Map<number, AttendanceRecord> => {
    const map = new Map<number, AttendanceRecord>();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    for (const r of records) {
      if (r.date.startsWith(prefix)) {
        const day = parseInt(r.date.slice(8, 10), 10);
        map.set(day, r);
      }
    }
    return map;
  }, [records]);

  return { records, plans, isLoading, getPlan, saveRecord, deleteRecord, savePlan, getRecord, getMonthRecords, refetch: fetchData };
}
