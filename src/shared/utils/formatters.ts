export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)}%`;
}

export function formatDate(date: string | Date, format: 'short' | 'long' | 'month' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (format === 'month') {
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }
  if (format === 'long') {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 24) return `${formatNumber(hours, 1)} ч`;
  const days = Math.floor(hours / 24);
  const remainHours = Math.round(hours % 24);
  return `${days} д ${remainHours} ч`;
}
