import clsx from 'clsx';
import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  value: number;
  max: number;
  thresholds?: { yellow: number; red: number };
  showLabel?: boolean;
}

export function ProgressBar({
  value,
  max,
  thresholds = { yellow: 0.7, red: 0.4 },
  showLabel = false,
}: ProgressBarProps) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const percent = Math.round(ratio * 100);

  let colorClass = styles.fillGreen;
  if (ratio < thresholds.red) {
    colorClass = styles.fillRed;
  } else if (ratio < thresholds.yellow) {
    colorClass = styles.fillYellow;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.track}>
        <div
          className={clsx(styles.fill, colorClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && <span className={styles.label}>{percent}%</span>}
    </div>
  );
}
