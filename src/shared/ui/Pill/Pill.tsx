import { type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Pill.module.css';

interface PillProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
  disabled?: boolean;
}

export function Pill({ active, onClick, children, count, disabled }: PillProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(styles.pill, active && styles.active)}
    >
      <span>{children}</span>
      {count !== undefined && (
        <span className={clsx(styles.count, 'tnum')}>{count}</span>
      )}
    </button>
  );
}
