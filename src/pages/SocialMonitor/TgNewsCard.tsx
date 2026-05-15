import { useState } from 'react';
import { copyToClipboard } from '../../shared/utils/kpi-helpers';
import { severityColor, type NewsItem } from './social-monitor-helpers';
import styles from './SocialMonitor.module.css';

interface TgNewsCardProps {
  item: NewsItem;
  onSendAlert: (msg: string) => void;
}

export function TgNewsCard({ item, onSendAlert }: TgNewsCardProps) {
  const [copied, setCopied] = useState(false);

  const handleSend = () => {
    const icon = item.severity >= 8 ? '\u{1F6A8}' : item.severity >= 5 ? '\u26A0\uFE0F' : '\u{1F4F0}';
    const lines = [
      `${icon} ${item.summary}`,
      '',
      `\u{1F4CD} ${item.location !== 'не указана' ? item.location : ''}`,
      `\u{1F4E2} ${item.channelName}`,
      '',
      item.text.slice(0, 300) + (item.text.length > 300 ? '...' : ''),
    ];
    if (item.postUrl) lines.push('', `\u{1F517} ${item.postUrl}`);
    lines.push('', `#новости #${item.topic.replace(/\s/g, '_')}`);

    const text = lines.join('\n');
    copyToClipboard(text);
    setCopied(true);
    onSendAlert('Скопировано для Telegram');
    setTimeout(() => setCopied(false), 2000);
  };

  const date = new Date(item.createdAt);
  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;

  return (
    <div className={styles.tgCard}>
      {item.photoUrl && (
        <div className={styles.tgCardPhoto}>
          <img src={item.photoUrl} alt="" loading="lazy" />
        </div>
      )}
      <div className={styles.tgCardContent}>
        <div className={styles.tgCardHeader}>
          <span className={styles.tgCardChannel}>{item.channelName}</span>
          <span className={styles.tgCardTime}>{dateStr} {timeStr}</span>
        </div>
        <p className={styles.tgCardSummary}>{item.summary}</p>
        <p className={styles.tgCardText}>{item.text.slice(0, 200)}{item.text.length > 200 ? '...' : ''}</p>
        <div className={styles.tgCardFooter}>
          <span className={styles.tgCardTopic}>{item.topic}</span>
          {item.severity > 0 && (
            <span className={styles.tgCardSeverity} style={{ color: severityColor(item.severity) }}>
              {item.severity}/10
            </span>
          )}
          {item.postUrl && (
            <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className={styles.tgCardLink}>
              Открыть
            </a>
          )}
        </div>
      </div>
      <button className={styles.tgCardSendBtn} onClick={handleSend}>
        {copied ? '\u2713 Скопировано' : '\u{1F4E8} Отправить в Telegram'}
      </button>
    </div>
  );
}
