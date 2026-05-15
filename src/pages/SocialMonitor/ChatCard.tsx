import { useState, useMemo } from 'react';
import { Card, Chart } from '../../shared/ui';
import { timeAgo, tgLink } from './social-monitor-helpers';
import styles from './SocialMonitor.module.css';

interface ChatCardProps {
  chat: { id: number; chatId: number; title: string; username: string | null; subscribers: number };
  counts?: { total: number; today: number };
  fetchStats: () => Promise<any>;
  onRemove: () => void;
  onUpdateChatId: (newId: number) => void;
}

export function ChatCard({ chat, counts, fetchStats, onRemove, onUpdateChatId }: ChatCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState(false);
  const [tempId, setTempId] = useState(String(chat.chatId));
  const [stats, setStats] = useState<any>(null);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !stats) {
      const data = await fetchStats();
      setStats(data);
    }
  };

  const chartData = useMemo(() =>
    (stats?.perDay ?? []).map((d: any) => ({
      date: d.date.slice(5),
      'Сообщений': d.count,
      'Авторов': d.senders,
    })),
    [stats],
  );

  return (
    <Card>
      <div className={styles.chatCardHeader} onClick={handleExpand}>
        <div className={styles.chatCardInfo}>
          <span className={styles.chatTitle}>{chat.title}</span>
          {chat.username && <span className={styles.chatUsername}>@{chat.username}</span>}
        </div>
        <div className={styles.chatCardStats}>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{chat.subscribers > 0 ? chat.subscribers.toLocaleString() : '\u2014'}</span>
            <span className={styles.chatStatLabel}>участников</span>
          </div>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{counts?.total ?? 0}</span>
            <span className={styles.chatStatLabel}>сообщений</span>
          </div>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{counts?.today ?? 0}</span>
            <span className={styles.chatStatLabel}>сегодня</span>
          </div>
        </div>
        <span className={styles.chatExpand}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {expanded && stats && (
        <div className={styles.chatCardBody}>
          {chartData.length > 0 && (
            <div className={styles.chatSection}>
              <Chart type="line" data={chartData} xKey="date" yKey={['Сообщений', 'Авторов']} color={['var(--color-teal)', 'var(--color-orange)']} title="Активность по дням" height={220} />
            </div>
          )}
          {/* Two columns: senders + recent messages */}
          <div className={styles.chatColumns}>
            {/* Top senders */}
            {stats.topSenders.length > 0 && (
              <div className={styles.chatSection}>
                <span className={styles.chatSectionTitle}>Активные участники</span>
                <div className={styles.chatSenderList}>
                  {stats.topSenders.map((s: any, i: number) => (
                    <div key={i} className={styles.chatSenderItem}>
                      <span className={styles.chatSenderName}>{s.name}</span>
                      <span className={styles.chatSenderCount}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent messages */}
            {stats.recentMessages?.length > 0 && (
              <div className={styles.chatSection}>
                <span className={styles.chatSectionTitle}>Последние сообщения</span>
                <div className={styles.chatRecentList}>
                  {stats.recentMessages.map((m: any) => (
                    <a key={m.id} href={tgLink(m.chatId, m.messageId)} target="_blank" rel="noopener noreferrer" className={styles.chatRecentItem}>
                      <div className={styles.chatRecentMeta}>
                        <span className={styles.chatRecentSender}>{m.senderName ?? '?'}</span>
                        <span className={styles.chatRecentTime}>{timeAgo(m.date)}</span>
                      </div>
                      <p className={styles.chatRecentText}>{m.text.slice(0, 120)}{m.text.length > 120 ? '…' : ''}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.chatCardFooter}>
            {editingId ? (
              <div className={styles.editIdRow}>
                <input className={styles.editIdInput} value={tempId} onChange={e => setTempId(e.target.value)} type="text" placeholder="-100..." />
                <button className={styles.editIdSave} onClick={(e) => { e.stopPropagation(); onUpdateChatId(Number(tempId)); setEditingId(false); }}>OK</button>
                <button className={styles.editIdCancel} onClick={(e) => { e.stopPropagation(); setEditingId(false); setTempId(String(chat.chatId)); }}>x</button>
              </div>
            ) : (
              <span className={styles.chatId} onClick={(e) => { e.stopPropagation(); setEditingId(true); }} title="Нажмите для редактирования">ID: {chat.chatId}</span>
            )}
            <button className={styles.chatRemoveBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }}>Отключить</button>
          </div>
        </div>
      )}
    </Card>
  );
}
