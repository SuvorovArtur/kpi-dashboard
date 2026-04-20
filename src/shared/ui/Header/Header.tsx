import { type ReactNode } from 'react';
import styles from './Header.module.css';

interface HeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

function formatDateRu(date: Date): string {
  // Drop the archaic "г." suffix that ru-RU locale appends by default.
  return date
    .toLocaleDateString('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    .replace(/\s*г\.?\s*$/u, '');
}

export function Header({ title, subtitle, children }: HeaderProps) {
  const today = formatDateRu(new Date());

  return (
    <div className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        <span className={styles.date}>{today}</span>
      </div>
      {children && <div className={styles.right}>{children}</div>}
    </div>
  );
}
