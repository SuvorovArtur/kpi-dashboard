// Generated from ontology/*.yaml. Hand-edited until codegen catches up.

export type SettlementType =
  | 'городской_округ'
  | 'мкр'
  | 'деревня'
  | 'село'
  | 'посёлок'
  | 'СНТ'
  | 'ДНТ'
  | 'коттеджный_поселок'
  | 'НП';

// GeoJSON Polygon (or null when no boundary saved)
export interface PolygonGeoJSON {
  type: 'Polygon';
  coordinates: number[][][];  // [ring][vertex][lng, lat]
}

export interface Settlement {
  id: string;
  seq: number;
  code: string;                    // МЫТ-НП-NNNN
  name: string;
  type: SettlementType | string;   // string fallback for unknown future types
  parent_id: string | null;
  parent_name: string | null;
  lat: number;
  lng: number;
  bounds_geojson: PolygonGeoJSON | null;
  population: number | null;
  notes: string | null;
  current_starosta_id: string | null;  // reserved for future ontology.starostas
  created_at: string;
  updated_at: string;
}

export interface Kp {
  id: string;
  seq: number;
  number: string;                          // Номер
  settlement: string;                      // Legacy free-text fallback
  settlement_id: string | null;            // FK → ontology.settlements
  settlement_name: string | null;          // Resolved via join
  settlement_type: string | null;
  lat: number;
  lng: number;
  registry_number: string | null;          // Реестровый номер РО
  holder: string | null;                   // Балансодержатель
  has_br_camera: boolean;                  // Камера БР
  photos: string[];                        // Bucket kp-photos
  created_at: string;
  updated_at: string;
}

export interface KpCreateInput {
  settlement: string;
  lat: number;
  lng: number;
  registry_number?: string | null;
}

// UI helper: render «д. Беляниново» from a Settlement record.
// (КП = коттеджный посёлок ⇒ prefix "кот.пос." to avoid collision with
//  «КП» = контейнерная площадка в нашей онтологии.)
export const TYPE_PREFIX: Record<string, string> = {
  городской_округ: 'г.о.',
  мкр: 'мкр.',
  деревня: 'д.',
  село: 'с.',
  'посёлок': 'п.',
  'СНТ': 'СНТ',
  'ДНТ': 'ДНТ',
  'коттеджный_поселок': 'кот.пос.',
  'НП': 'НП',
};

export function settlementLabel(s: Pick<Settlement, 'name' | 'type'>): string {
  const prefix = TYPE_PREFIX[s.type] ?? '';
  return prefix ? `${prefix} ${s.name}` : s.name;
}

// 3-level hierarchy (mirrors ontology.settlement_level in SQL)
export function settlementLevel(type: string): 1 | 2 | 3 | 0 {
  switch (type) {
    case 'городской_округ': return 1;
    case 'мкр':
    case 'деревня':
    case 'село':
    case 'посёлок':         return 2;
    case 'СНТ':
    case 'ДНТ':
    case 'коттеджный_поселок':
    case 'НП':              return 3;
    default:                return 0;
  }
}

export const TYPES_BY_LEVEL: Record<1 | 2 | 3, SettlementType[]> = {
  1: ['городской_округ'],
  2: ['мкр', 'деревня', 'село', 'посёлок'],
  3: ['СНТ', 'ДНТ', 'коттеджный_поселок', 'НП'],
};

export const LEVEL_LABEL: Record<1 | 2 | 3, string> = {
  1: 'L1 · городской округ',
  2: 'L2 · мкр / деревня / село / посёлок',
  3: 'L3 · СНТ / ДНТ / кот.пос. / НП',
};

// Walk up parent_id chain to build a breadcrumb path (deepest last).
export function settlementBreadcrumb(s: Settlement, all: Settlement[]): Settlement[] {
  const byId = new Map(all.map(x => [x.id, x] as const));
  const chain: Settlement[] = [];
  let cur: Settlement | undefined = s;
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    chain.unshift(cur);
    guard.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}
