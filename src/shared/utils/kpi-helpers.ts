import type { KpiDataPoint, Status, Trend } from '../types';

export function getKpiStatus(current: number, target: number, direction: 'lower' | 'higher'): Status {
  const ratio = direction === 'lower'
    ? target / current
    : current / target;

  if (ratio >= 0.9) return 'green';
  if (ratio >= 0.7) return 'yellow';
  return 'red';
}

export function getProgressToTarget(current: number, base: number, target: number): number {
  if (base === target) return 100;
  const progress = ((current - base) / (target - base)) * 100;
  return Math.max(0, Math.min(100, progress));
}

export function getTrend(dataPoints: KpiDataPoint[], periods = 2): Trend {
  if (dataPoints.length < 2) return 'flat';
  const recent = dataPoints.slice(-periods);
  const first = recent[0].value;
  const last = recent[recent.length - 1].value;
  const diff = last - first;
  const threshold = Math.abs(first) * 0.01;
  if (Math.abs(diff) < threshold) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

export function getTrendValue(dataPoints: KpiDataPoint[], periods = 2): number {
  if (dataPoints.length < 2) return 0;
  const recent = dataPoints.slice(-periods);
  return recent[recent.length - 1].value - recent[0].value;
}

export function getStatusColor(status: Status): string {
  switch (status) {
    case 'green': return '#16A34A';
    case 'yellow': return '#EAB308';
    case 'red': return '#DC2626';
  }
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}
