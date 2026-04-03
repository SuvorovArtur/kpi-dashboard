import { type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Tooltip.module.css';

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  return (
    <span className={styles.wrapper}>
      {children}
      <span className={clsx(styles.bubble, styles[position])}>
        {content}
        <span className={styles.arrow} />
      </span>
    </span>
  );
}
