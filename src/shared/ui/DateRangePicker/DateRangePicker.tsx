import { useMemo } from 'react';
import clsx from 'clsx';
import styles from './DateRangePicker.module.css';

interface DateRange {
  from: string;
  to: string;
}

interface Preset {
  label: string;
  from: string;
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: Preset[];
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultPresets(): Preset[] {
  const today = new Date();
  const to = formatDate(today);

  const week = new Date(today);
  week.setDate(week.getDate() - 7);

  const month = new Date(today);
  month.setMonth(month.getMonth() - 1);

  const quarter = new Date(today);
  quarter.setMonth(quarter.getMonth() - 3);

  const year = new Date(today);
  year.setFullYear(year.getFullYear() - 1);

  return [
    { label: 'Неделя', from: formatDate(week), to },
    { label: 'Месяц', from: formatDate(month), to },
    { label: 'Квартал', from: formatDate(quarter), to },
    { label: 'Год', from: formatDate(year), to },
    { label: 'Всё', from: '2020-01-01', to },
  ];
}

export function DateRangePicker({ value, onChange, presets }: DateRangePickerProps) {
  const items = useMemo(() => presets ?? getDefaultPresets(), [presets]);

  const activeLabel = items.find(
    (p) => p.from === value.from && p.to === value.to,
  )?.label;

  return (
    <div className={styles.wrapper}>
      {items.map((preset) => (
        <button
          key={preset.label}
          className={clsx(
            styles.presetBtn,
            activeLabel === preset.label && styles.presetBtnActive,
          )}
          onClick={() => onChange({ from: preset.from, to: preset.to })}
          type="button"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
