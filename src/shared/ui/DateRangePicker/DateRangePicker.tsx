import { useMemo, useState, useEffect } from 'react';
import clsx from 'clsx';
import styles from './DateRangePicker.module.css';

interface DateRange {
  from: string;
  to: string;
}

type PeriodType = 'week' | 'month' | 'quarter' | 'year' | 'all';

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfIsoWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay() || 7;
  r.setDate(r.getDate() - (day - 1));
  return r;
}

interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

function getPeriodRange(type: PeriodType, offset: number): PeriodRange {
  const now = new Date();
  if (type === 'all') {
    return { from: '2020-01-01', to: fmt(now), label: 'Всё время' };
  }
  if (type === 'week') {
    const start = startOfIsoWeek(now);
    start.setDate(start.getDate() + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const sM = monthNames[start.getMonth()].toLowerCase();
    const eM = monthNames[end.getMonth()].toLowerCase();
    const label =
      start.getMonth() === end.getMonth()
        ? `${start.getDate()}–${end.getDate()} ${sM}`
        : `${start.getDate()} ${sM} – ${end.getDate()} ${eM}`;
    return { from: fmt(start), to: fmt(end), label };
  }
  if (type === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    return {
      from: fmt(start),
      to: fmt(end),
      label: `${monthNames[start.getMonth()]} ${start.getFullYear()}`,
    };
  }
  if (type === 'quarter') {
    const curQ = Math.floor(now.getMonth() / 3);
    const targetMonth = (curQ + offset) * 3;
    const start = new Date(now.getFullYear(), targetMonth, 1);
    const end = new Date(now.getFullYear(), targetMonth + 3, 0);
    const q = Math.floor(start.getMonth() / 3) + 1;
    return { from: fmt(start), to: fmt(end), label: `Q${q} ${start.getFullYear()}` };
  }
  const start = new Date(now.getFullYear() + offset, 0, 1);
  const end = new Date(now.getFullYear() + offset, 11, 31);
  return { from: fmt(start), to: fmt(end), label: `${start.getFullYear()}` };
}

function detectPeriod(value: DateRange): { type: PeriodType; offset: number } | null {
  const types: PeriodType[] = ['week', 'month', 'quarter', 'year', 'all'];
  for (const type of types) {
    const maxBack = type === 'week' ? 52 : type === 'month' ? 24 : type === 'quarter' ? 12 : type === 'year' ? 10 : 0;
    for (let off = 0; off >= -maxBack; off--) {
      const r = getPeriodRange(type, off);
      if (r.from === value.from && r.to === value.to) return { type, offset: off };
    }
  }
  return null;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [type, setType] = useState<PeriodType>(() => detectPeriod(value)?.type ?? 'month');
  const [offset, setOffset] = useState<number>(() => detectPeriod(value)?.offset ?? 0);

  useEffect(() => {
    const detected = detectPeriod(value);
    if (detected && (detected.type !== type || detected.offset !== offset)) {
      setType(detected.type);
      setOffset(detected.offset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.from, value.to]);

  const current = useMemo(() => getPeriodRange(type, offset), [type, offset]);

  const selectType = (t: PeriodType) => {
    setType(t);
    setOffset(0);
    const r = getPeriodRange(t, 0);
    onChange({ from: r.from, to: r.to });
  };

  const navigate = (delta: number) => {
    const newOffset = Math.min(0, offset + delta);
    if (newOffset === offset) return;
    setOffset(newOffset);
    const r = getPeriodRange(type, newOffset);
    onChange({ from: r.from, to: r.to });
  };

  const presets: { key: PeriodType; label: string }[] = [
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'quarter', label: 'Квартал' },
    { key: 'year', label: 'Год' },
    { key: 'all', label: 'Всё' },
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.presets}>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={clsx(styles.presetBtn, type === p.key && styles.presetBtnActive)}
            onClick={() => selectType(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {type !== 'all' && (
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate(-1)}
            aria-label="Предыдущий период"
          >
            ‹
          </button>
          <span className={styles.navLabel}>{current.label}</span>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate(1)}
            aria-label="Следующий период"
            aria-hidden={offset >= 0}
            tabIndex={offset >= 0 ? -1 : 0}
            style={offset >= 0 ? { visibility: 'hidden' } : undefined}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
