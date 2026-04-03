import { useState, useEffect, useMemo } from 'react';
import type { RoadmapItem } from '../types';
import roadmapData from '../../data/roadmap.json';

interface UseRoadmapParams {
  track?: 'tu' | 'mbu';
}

interface UseRoadmapResult {
  data: RoadmapItem[];
  isLoading: boolean;
  error: Error | null;
}

export function useRoadmap(params: UseRoadmapParams = {}): UseRoadmapResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const data = useMemo(() => {
    let filtered = roadmapData as RoadmapItem[];
    if (params.track) filtered = filtered.filter(d => d.track === params.track);
    return filtered;
  }, [params.track]);

  return {
    data: isLoading ? [] : data,
    isLoading,
    error,
  };
}
