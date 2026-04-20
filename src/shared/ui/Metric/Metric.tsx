import { type ReactNode } from 'react';
import styles from './Metric.module.css';

interface MetricProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}

export function Metric({ label, value, unit, sub, tone = 'neutral' }: MetricProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.label}>{label}</div>
      <div className={styles.valueRow}>
        <div className={`${styles.value} ${styles[tone]} tnum`}>{value}</div>
        {unit && <div className={styles.unit}>{unit}</div>}
      </div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  );
}
