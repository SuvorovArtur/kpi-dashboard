import clsx from 'clsx';
import styles from './Badge.module.css';

interface BadgeProps {
  status: 'green' | 'yellow' | 'red';
  label?: string;
  size?: 'sm' | 'md';
}

export function Badge({ status, label, size = 'md' }: BadgeProps) {
  return (
    <span className={clsx(styles.badge, styles[status], styles[size])}>
      <span className={styles.dot} />
      {label && <span>{label}</span>}
    </span>
  );
}
