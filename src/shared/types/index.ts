export interface KpiDefinition {
  id: string;
  name: string;
  unit: '%' | 'шт' | 'час' | '%/кв';
  direction: 'lower' | 'higher';
  formula: string;
  source: string;
  responsible: string;
  frequency: 'weekly' | 'monthly' | 'quarterly';
  current: number;
  d90: number;
  d180: number;
  d360: number;
  base: number;
}

export interface KpiDataPoint {
  date: string;
  kpiId: string;
  value: number;
  territory?: string;
  note?: string;
}

export interface Appeal {
  id: number;
  ecur_number: string;
  source_number: string | null;
  date: string;
  direction: string;
  synth_group: string | null;
  fact: string | null;
  subtopic: string | null;
  status: string;
  curator: string | null;
  executor: string | null;
  omsu: string | null;
  source: string | null;
  is_spam: boolean;
  message_type: string | null;
  description: string | null;
  address: string | null;
  district: string | null;
  settlement: string | null;
  street: string | null;
  house: string | null;
  tu_to: string | null;
  sector: string | null;
  sentiment_score: number | null;
  is_repeated: boolean;
  lat: number | null;
  lng: number | null;
}

export interface StaffMetrics {
  date: string;
  totalStaff: number;
  aup: number;
  workers: number;
  vacancies: number;
  vacanciesOver30d: number;
  turnoverPercent: number;
  avgWorkerSalary: number;
}

export interface RoadmapItem {
  id: string;
  track: 'tu' | 'mbu';
  title: string;
  startDate: string;
  endDate: string;
  status: 'done' | 'in_progress' | 'planned';
  linkedKpis?: string[];
}

export type Status = 'green' | 'yellow' | 'red';
export type Trend = 'up' | 'down' | 'flat';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
}

export interface Column<T = Record<string, unknown>> {
  key: keyof T & string;
  title: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
}
