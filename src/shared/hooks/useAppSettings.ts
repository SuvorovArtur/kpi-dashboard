import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface AppSetting {
  key: string;
  value: string;
  label: string | null;
}

interface UseAppSettingsResult {
  settings: Map<string, AppSetting>;
  get: (key: string) => string | undefined;
  getNumber: (key: string) => number;
  update: (key: string, value: string) => Promise<void>;
  isLoading: boolean;
}

export function useAppSettings(): UseAppSettingsResult {
  const [settings, setSettings] = useState<Map<string, AppSetting>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (!error && data) {
      const map = new Map<string, AppSetting>();
      for (const row of data) {
        map.set(row.key, row as AppSetting);
      }
      setSettings(map);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const get = useCallback((key: string) => settings.get(key)?.value, [settings]);

  const getNumber = useCallback((key: string) => {
    const val = settings.get(key)?.value;
    return val ? parseFloat(val) : 0;
  }, [settings]);

  const update = useCallback(async (key: string, value: string) => {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  return { settings, get, getNumber, update, isLoading };
}
