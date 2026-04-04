export const TARGET_PCT = 85;
export const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export const QUARTERS = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

export function pct(fact: number, plan: number): number | null {
  if (!plan) return null;
  return Math.round((fact / plan) * 100);
}

export function avg(arr: (number | null)[]): number | null {
  const v = arr.filter((x): x is number => x !== null && x !== undefined);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

export function statusColor(val: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (val === null) return 'gray';
  if (val >= TARGET_PCT) return 'green';
  if (val >= 70) return 'yellow';
  return 'red';
}

// Month average from records map
export function monthAvg(
  monthRecords: Map<number, { fact: number; plan: number }>,
  plan: number,
  year: number,
  month: number,
): number | null {
  const days = daysInMonth(year, month);
  const pcts: (number | null)[] = [];
  for (let d = 1; d <= days; d++) {
    const rec = monthRecords.get(d);
    pcts.push(rec ? pct(rec.fact, plan) : null);
  }
  return avg(pcts);
}

export function formatDateISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
