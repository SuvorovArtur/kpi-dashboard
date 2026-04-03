import { useState, useEffect } from 'react';
import type { StaffMetrics } from '../types';
import staffData from '../../data/staff.json';

interface UseStaffResult {
  data: StaffMetrics[];
  isLoading: boolean;
  error: Error | null;
}

export function useStaff(): UseStaffResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  return {
    data: isLoading ? [] : (staffData as StaffMetrics[]),
    isLoading,
    error,
  };
}
