import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "src", "data");

mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20251001);

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((rand() * (max - min) + min).toFixed(decimals));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. KPI Definitions
// ---------------------------------------------------------------------------
interface KpiDefinition {
  id: string;
  name: string;
  unit: string;
  direction: "lower" | "higher";
  current: number;
  d90: number;
  d180: number;
  d360: number;
  base: number;
  frequency: string;
  responsible: string;
  formula: string;
  source: string;
}

const kpiDefinitions: KpiDefinition[] = [
  {
    id: "outsource_share",
    name: "Доля аутсорса от работ",
    unit: "%",
    direction: "lower",
    current: 75,
    d90: 50,
    d180: 25,
    d360: 10,
    base: 10,
    frequency: "monthly",
    responsible: "Директор МБУ",
    formula: "(Объём аутсорса / Общий объём) × 100",
    source: "Акты выполненных работ",
  },
  {
    id: "delayed_appeals",
    name: "Отложенные обращения",
    unit: "%",
    direction: "lower",
    current: 13,
    d90: 10,
    d180: 7,
    d360: 5,
    base: 5,
    frequency: "weekly",
    responsible: "Нач. отдела",
    formula: "(Отложенные / Всего обращений) × 100",
    source: "ЕЦУР",
  },
  {
    id: "repeated_appeals",
    name: "Повторные обращения",
    unit: "%",
    direction: "lower",
    current: 6,
    d90: 4,
    d180: 3,
    d360: 2,
    base: 2,
    frequency: "monthly",
    responsible: "Нач. отдела",
    formula: "(Повторные / Всего) × 100",
    source: "ЕЦУР",
  },
  {
    id: "appeals_per_1k",
    name: "Обращений на 1000 жителей",
    unit: "шт",
    direction: "lower",
    current: 21,
    d90: 20,
    d180: 15,
    d360: 10,
    base: 10,
    frequency: "monthly",
    responsible: "Зам. главы",
    formula: "Кол-во обращений / (Население / 1000)",
    source: "ЕЦУР + Росстат",
  },
  {
    id: "nps",
    name: "Индекс лояльности (NPS)",
    unit: "%",
    direction: "higher",
    current: -33,
    d90: 10,
    d180: 20,
    d360: 30,
    base: 30,
    frequency: "quarterly",
    responsible: "Зам. главы",
    formula: "% промоутеров - % критиков",
    source: "Опросы населения",
  },
  {
    id: "turnover",
    name: "Текучесть кадров",
    unit: "%/кв",
    direction: "lower",
    current: 0,
    d90: 5,
    d180: 4,
    d360: 3,
    base: 3,
    frequency: "quarterly",
    responsible: "Директор МБУ",
    formula: "(Уволенные / Среднесписочная) × 100",
    source: "Кадровый учёт",
  },
  {
    id: "vacancies_30d",
    name: "Вакансии >30 дней",
    unit: "%",
    direction: "lower",
    current: 0,
    d90: 15,
    d180: 10,
    d360: 10,
    base: 5,
    frequency: "monthly",
    responsible: "Директор МБУ",
    formula: "(Вакансии >30д / Всего вакансий) × 100",
    source: "Кадровый учёт",
  },
  {
    id: "response_time",
    name: "Время реакции (ЕЦУР)",
    unit: "час",
    direction: "lower",
    current: 0,
    d90: 48,
    d180: 24,
    d360: 12,
    base: 8,
    frequency: "weekly",
    responsible: "Нач. отдела",
    formula: "Среднее время до первого ответа",
    source: "ЕЦУР",
  },
  {
    id: "photo_fixation",
    name: "Фотофиксация до/после",
    unit: "%",
    direction: "higher",
    current: 0,
    d90: 50,
    d180: 80,
    d360: 95,
    base: 100,
    frequency: "weekly",
    responsible: "Мастер участка",
    formula: "(Обращения с фото / Всего) × 100",
    source: "Мобильное приложение",
  },
];

// ---------------------------------------------------------------------------
// 2. KPI Values — weekly, 52 weeks, 3 territories
// ---------------------------------------------------------------------------
interface KpiValue {
  date: string;
  kpiId: string;
  value: number;
  territory: string;
}

const FAILURE_KPIS = new Set(["delayed_appeals", "outsource_share"]);
const TERRITORIES = ["pirogovsky", "fedoskino", "total"] as const;
const START_DATE = new Date("2025-10-01");
const TOTAL_WEEKS = 52;

function interpolateTarget(
  kpi: KpiDefinition,
  week: number
): number {
  // Milestones: week 0 = current, week 13 = d90, week 26 = d180, week 52 = d360
  if (week <= 13) {
    const t = week / 13;
    return kpi.current + (kpi.d90 - kpi.current) * t;
  } else if (week <= 26) {
    const t = (week - 13) / 13;
    return kpi.d90 + (kpi.d180 - kpi.d90) * t;
  } else {
    const t = (week - 26) / 26;
    return kpi.d180 + (kpi.d360 - kpi.d180) * t;
  }
}

const kpiValues: KpiValue[] = [];

for (const kpi of kpiDefinitions) {
  for (const territory of TERRITORIES) {
    // Territory offset: sub-territories deviate slightly from total
    const territoryBias =
      territory === "total" ? 0 : territory === "pirogovsky" ? -1.5 : 1.5;

    for (let w = 0; w < TOTAL_WEEKS; w++) {
      const date = addDays(START_DATE, w * 7);
      let target = interpolateTarget(kpi, w);

      // Apply failure spike for specific KPIs at weeks 3-5
      if (FAILURE_KPIS.has(kpi.id) && w >= 3 && w <= 5) {
        const spike = kpi.id === "outsource_share" ? 15 : 8;
        target += spike * (1 - Math.abs(w - 4) / 2);
      }

      // Add noise ±10% of the absolute value range
      const range = Math.abs(kpi.current - kpi.d360) || 10;
      const noise = (rand() - 0.5) * 2 * range * 0.1;

      let value = target + noise + territoryBias;

      // Clamp for percentage KPIs
      if (kpi.unit === "%") {
        if (kpi.id !== "nps") {
          value = Math.max(0, Math.min(100, value));
        } else {
          value = Math.max(-100, Math.min(100, value));
        }
      }
      if (kpi.unit === "час") {
        value = Math.max(0, value);
      }
      if (kpi.unit === "шт") {
        value = Math.max(0, value);
      }

      kpiValues.push({
        date: formatDate(date),
        kpiId: kpi.id,
        value: parseFloat(value.toFixed(1)),
        territory,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Appeals — 500 records
// ---------------------------------------------------------------------------
interface Appeal {
  id: string;
  date: string;
  category: string;
  territory: string;
  status: string;
  responseHours: number;
  hasPhotoBefore: boolean;
  hasPhotoAfter: boolean;
  source: string;
}

const CATEGORIES = [
  "Дороги",
  "Благоустройство",
  "ЖКХ",
  "Экология",
  "Освещение",
  "Содержание территории",
  "Вывоз мусора",
  "Детские площадки",
];

const STATUSES = ["new", "in_progress", "delayed", "resolved", "repeated"];
const STATUS_WEIGHTS = [5, 15, 10, 60, 10];

const SOURCES = ["ецур", "мцур", "telegram", "phone", "eds"];
const SOURCE_WEIGHTS = [40, 25, 20, 10, 5];

const APPEAL_TERRITORIES = ["pirogovsky", "fedoskino"];

const appeals: Appeal[] = [];
const appealStartDate = new Date("2025-10-01");
const appealEndDate = new Date("2026-09-30");
const appealSpanDays = Math.round(
  (appealEndDate.getTime() - appealStartDate.getTime()) / (1000 * 60 * 60 * 24)
);

for (let i = 0; i < 500; i++) {
  const dayOffset = randInt(0, appealSpanDays);
  const date = addDays(appealStartDate, dayOffset);
  // Progress through the year (0..1)
  const progress = dayOffset / appealSpanDays;

  // Photo probability increases over time
  const photoBefore = rand() < 0.5 + 0.4 * progress;
  const photoAfter = rand() < 0.3 + 0.55 * progress;

  appeals.push({
    id: `APP-${String(i + 1).padStart(3, "0")}`,
    date: formatDate(date),
    category: pick(CATEGORIES),
    territory: pick(APPEAL_TERRITORIES),
    status: weightedPick(STATUSES, STATUS_WEIGHTS),
    responseHours: randInt(2, 96),
    hasPhotoBefore: photoBefore,
    hasPhotoAfter: photoAfter,
    source: weightedPick(SOURCES, SOURCE_WEIGHTS),
  });
}

// Sort appeals by date
appeals.sort((a, b) => a.date.localeCompare(b.date));

// ---------------------------------------------------------------------------
// 4. Staff — quarterly data
// ---------------------------------------------------------------------------
const staff = [
  {
    date: "2025-12-31",
    totalStaff: 180,
    aup: 55,
    workers: 125,
    vacancies: 20,
    vacanciesOver30d: 15,
    turnoverPercent: 8,
    avgWorkerSalary: 45000,
  },
  {
    date: "2026-03-31",
    totalStaff: 190,
    aup: 58,
    workers: 132,
    vacancies: 12,
    vacanciesOver30d: 8,
    turnoverPercent: 5,
    avgWorkerSalary: 48000,
  },
  {
    date: "2026-06-30",
    totalStaff: 195,
    aup: 60,
    workers: 135,
    vacancies: 8,
    vacanciesOver30d: 5,
    turnoverPercent: 4,
    avgWorkerSalary: 52000,
  },
  {
    date: "2026-09-30",
    totalStaff: 200,
    aup: 65,
    workers: 135,
    vacancies: 5,
    vacanciesOver30d: 3,
    turnoverPercent: 3,
    avgWorkerSalary: 55000,
  },
];

// ---------------------------------------------------------------------------
// 5. Roadmap
// ---------------------------------------------------------------------------
const roadmap = [
  {
    id: "tu-1",
    track: "tu",
    title: "Аудит текущего состояния ТУ",
    startDate: "2025-09-01",
    endDate: "2025-10-15",
    status: "done",
    linkedKpis: [] as string[],
  },
  {
    id: "tu-2",
    track: "tu",
    title: "Формирование штатного расписания",
    startDate: "2025-10-15",
    endDate: "2025-11-30",
    status: "done",
    linkedKpis: ["turnover", "vacancies_30d"],
  },
  {
    id: "tu-3",
    track: "tu",
    title: "Запуск мониторинга обращений",
    startDate: "2025-12-01",
    endDate: "2026-01-15",
    status: "in_progress",
    linkedKpis: ["delayed_appeals", "response_time"],
  },
  {
    id: "tu-4",
    track: "tu",
    title: "Внедрение фотофиксации",
    startDate: "2026-01-15",
    endDate: "2026-03-01",
    status: "planned",
    linkedKpis: ["photo_fixation"],
  },
  {
    id: "mbu-1",
    track: "mbu",
    title: "Реорганизация МБУ МТХ",
    startDate: "2025-08-01",
    endDate: "2025-10-01",
    status: "done",
    linkedKpis: [] as string[],
  },
  {
    id: "mbu-2",
    track: "mbu",
    title: "Сокращение аутсорса (этап 1)",
    startDate: "2025-10-01",
    endDate: "2026-01-01",
    status: "done",
    linkedKpis: ["outsource_share"],
  },
  {
    id: "mbu-3",
    track: "mbu",
    title: "Набор собственных бригад",
    startDate: "2026-01-01",
    endDate: "2026-04-01",
    status: "in_progress",
    linkedKpis: ["outsource_share", "turnover"],
  },
  {
    id: "mbu-4",
    track: "mbu",
    title: "Сокращение аутсорса (этап 2)",
    startDate: "2026-04-01",
    endDate: "2026-07-01",
    status: "planned",
    linkedKpis: ["outsource_share"],
  },
  {
    id: "mbu-5",
    track: "mbu",
    title: "Выход на целевые показатели",
    startDate: "2026-07-01",
    endDate: "2026-09-30",
    status: "planned",
    linkedKpis: ["outsource_share", "nps", "appeals_per_1k"],
  },
];

// ---------------------------------------------------------------------------
// Write all files
// ---------------------------------------------------------------------------
function writeJson(filename: string, data: unknown): void {
  const filePath = join(DATA_DIR, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`Written ${filePath} (${JSON.stringify(data).length} bytes)`);
}

writeJson("kpi-definitions.json", kpiDefinitions);
writeJson("kpi-values.json", kpiValues);
writeJson("appeals.json", appeals);
writeJson("staff.json", staff);
writeJson("roadmap.json", roadmap);

console.log("\nAll demo data generated successfully.");
