import { useState, useEffect, useCallback } from 'react';

export interface Toast {
  message: string;
  type: 'success' | 'error';
}

export function useToast(dismissMs = 3000) {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), dismissMs);
    return () => clearTimeout(t);
  }, [toast, dismissMs]);

  const showToast = useCallback((value: Toast | null) => {
    setToast(value);
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  return { toast, showToast, clearToast } as const;
}
