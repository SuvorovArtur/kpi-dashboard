import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Territory {
  id: string;
  name: string;
}

interface UseTerritoriesResult {
  data: Territory[];
  isLoading: boolean;
  error: Error | null;
  add: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refetch: () => void;
}

export function useTerritories(): UseTerritoriesResult {
  const [data, setData] = useState<Territory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: rows, error: err } = await supabase
        .from('territories')
        .select('id, name')
        .order('name');
      if (err) throw err;
      setData(rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const add = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from('territories').insert({ id, name });
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('territories').delete().eq('id', id);
    if (error) throw error;
    await fetchData();
  }, [fetchData]);

  return { data, isLoading, error, add, remove, refetch: fetchData };
}
