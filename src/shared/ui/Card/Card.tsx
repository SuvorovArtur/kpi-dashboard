import { type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Card.module.css';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  accent?: 'teal' | 'orange' | 'red' | 'neutral';
}

const accentMap: Record<string, string> = {
  teal: styles.accentTeal,
  orange: styles.accentOrange,
  red: styles.accentRed,
  neutral: styles.accentNeutral,
};

export function Card({ title, children, className, accent }: CardProps) {
  return (
    <div className={clsx(styles.card, accent && accentMap[accent], className)}>
      {title && (
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
