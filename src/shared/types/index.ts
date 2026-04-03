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
  id: string;
  date: string;
  category: string;
  territory: string;
  status: 'new' | 'in_progress' | 'delayed' | 'resolved' | 'repeated';
  responseHours?: number;
  hasPhotoBefore: boolean;
  hasPhotoAfter: boolean;
  source: 'ецур' | 'мцур' | 'telegram' | 'phone' | 'eds';
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
