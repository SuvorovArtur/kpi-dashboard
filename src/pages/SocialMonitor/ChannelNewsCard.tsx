import { useState } from 'react';
import { Card, Chart } from '../../shared/ui';
import { type NewsItem } from './social-monitor-helpers';
import { TgNewsCard } from './TgNewsCard';
import styles from './SocialMonitor.module.css';

interface ChannelNewsCardProps {
  channel: { id: number; chatId: number; title: string; username: string | null; subscribers: number };
  fetchNews: () => Promise<NewsItem[]>;
  fetchStats: () => Promise<{ date: string; subscribers: number; postsFound: number }[]>;
  onRemove: () => void;
  onSendAlert: (msg: string) => void;
}

export function ChannelNewsCard({ channel, fetchNews, fetchStats, onRemove, onSendAlert }: ChannelNewsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [stats, setStats] = useState<{ date: string; subscribers: number; postsFound: number }[] | null>(null);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !news) {
      const [newsData, statsData] = await Promise.all([fetchNews(), fetchStats()]);
      setNews(newsData);
      setStats(statsData);
    }
  };

  const newsCount = news?.length ?? 0;

  return (
    <Card>
      <div className={styles.chatCardHeader} onClick={handleExpand}>
        <div className={styles.chatCardInfo}>
          <span className={styles.chatTitle}>{channel.title}</span>
          {channel.username && <span className={styles.chatUsername}>@{channel.username}</span>}
        </div>
        <div className={styles.chatCardStats}>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{channel.subscribers > 0 ? channel.subscribers.toLocaleString() : '\u2014'}</span>
            <span className={styles.chatStatLabel}>подписчиков</span>
          </div>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{newsCount}</span>
            <span className={styles.chatStatLabel}>отобрано</span>
          </div>
        </div>
        <span className={styles.chatExpand}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {expanded && (
        <div className={styles.channelBody}>
          {/* Subscribers chart */}
          {stats && stats.length > 1 && (
            <div className={styles.channelChart}>
              <Chart
                type="line"
                data={stats.slice(-14).map(s => ({ date: s.date.slice(5), 'Подписчиков': s.subscribers }))}
                xKey="date"
                yKey={['Подписчиков']}
                color={['var(--color-teal)']}
                title="Подписчики по дням"
                height={200}
              />
            </div>
          )}

          {/* News cards */}
          {news && news.length > 0 ? (
            <div className={styles.newsRow}>
              {news.slice(0, 3).map(item => (
                <TgNewsCard key={item.id} item={item} onSendAlert={onSendAlert} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Нет отобранных новостей</p>
              <p className={styles.emptyHint}>Релевантные посты появятся автоматически</p>
            </div>
          )}
          <div className={styles.chatCardFooter}>
            <span className={styles.chatId}>ID: {channel.chatId}</span>
            <button className={styles.chatRemoveBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }}>Отключить</button>
          </div>
        </div>
      )}
    </Card>
  );
}
