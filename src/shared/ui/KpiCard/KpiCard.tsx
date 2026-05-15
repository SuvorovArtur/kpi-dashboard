import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card } from '../Card/Card';
import { Badge } from '../Badge/Badge';
import { ProgressBar } from '../ProgressBar/ProgressBar';
import styles from './KpiCard.module.css';

interface KpiCardProps {
  label: string;
  value: number | string;
  target: number;
  unit: string;
  trend: 'up' | 'down' | 'flat';
  trendValue?: number;
  status: 'green' | 'yellow' | 'red';
  progress: number;
  targetLabel?: string;
  targetSubLabel?: string;
}

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

const trendStyles = {
  up: styles.trendUp,
  down: styles.trendDown,
  flat: styles.trendFlat,
};

export function KpiCard({
  label,
  value,
  target,
  unit,
  trend,
  trendValue,
  status,
  progress,
  targetLabel,
  targetSubLabel,
}: KpiCardProps) {
  const TrendIcon = trendIcons[trend];

  // Strip trailing unit from pre-formatted string values (e.g. "27%" with unit="%")
  // so we don't render "27% %". Numeric values pass through unchanged.
  const displayValue =
    typeof value === 'string' && unit && value.endsWith(unit)
      ? value.slice(0, -unit.length).trimEnd()
      : value;

  return (
    <Card>
      <div className={styles.wrapper}>
        <div className={styles.topRow}>
          <span className={styles.label}>{label}</span>
          <Badge status={status} size="sm" />
        </div>

        <div className={styles.valueRow}>
          <span className={styles.value}>{displayValue}</span>
          <span className={styles.unit}>{unit}</span>
        </div>

        <div className={`${styles.trendRow} ${trendStyles[trend]}`}>
          <TrendIcon size={14} />
          {trendValue !== undefined && (
            <span>
              {trend === 'up' ? '+' : trend === 'down' ? '' : ''}
              {trendValue}%
            </span>
          )}
        </div>

        <div className={styles.targetRow}>
          <div className={styles.targetStack}>
            <span className={styles.targetLabel}>
              {targetLabel ?? `Цель: ${target} ${unit}`}
            </span>
            {targetSubLabel && (
              <span className={styles.targetSubLabel}>{targetSubLabel}</span>
            )}
          </div>
        </div>

        <div className={styles.progressWrapper}>
          <ProgressBar value={progress} max={100} showLabel />
        </div>
      </div>
    </Card>
  );
}
