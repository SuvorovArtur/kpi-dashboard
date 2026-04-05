import { supabase } from './supabase';

/**
 * Геокодинг через Supabase Edge Function (Nominatim с EU-сервера).
 * Обрабатывает обращения батчами по 50, приоритет:
 * 1) GPS-координаты из описания
 * 2) Nominatim по улица+дом+н.п.
 */
export async function geocodeAppeals(
  _appeals: unknown[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let totalGeocoded = 0;
  let batch = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    onProgress?.(totalGeocoded, totalGeocoded + 1);

    const { data, error } = await supabase.functions.invoke('geocode', {
      body: { limit: 50 },
    });

    if (error || !data) break;

    const { geocoded, total } = data as { geocoded: number; total: number };
    totalGeocoded += geocoded;

    onProgress?.(totalGeocoded, totalGeocoded);

    // No more appeals to process
    if (total === 0) break;

    // Safety: max 10 batches per run (500 appeals)
    if (batch++ >= 10) break;
  }

  return totalGeocoded;
}
