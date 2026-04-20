import { AlertTriangle } from 'lucide-react';
import { type ReactNode } from 'react';
import styles from './EscalationBanner.module.css';

interface EscalationBannerProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'danger' | 'warning';
}

export function EscalationBanner({
  title,
  description,
  action,
  tone = 'danger',
}: EscalationBannerProps) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="alert">
      <div className={styles.iconWrap}>
        <AlertTriangle size={18} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {description && <div className={styles.description}>{description}</div>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
