import { useState, useMemo } from 'react';
import { Card, Header, Skeleton, Toast } from '../../shared/ui';
import { useSocialMonitor, type TgIssue } from '../../shared/hooks/useSocialMonitor';
import styles from './SocialMonitor.module.css';

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  watching: 'На контроле',
  escalated: 'Эскалация',
  resolved: 'Решена',
  ignored: 'Игнор',
};

const STATUS_COLORS: Record<string, string> = {
  new: '#dc2626',
  watching: '#ca8a04',
  escalated: '#dc2626',
  resolved: '#16a34a',
  ignored: '#9ca3af',
};

function severityColor(s: number): string {
  if (s >= 8) return '#dc2626';
  if (s >= 5) return '#ca8a04';
  return '#16a34a';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}м назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days}д назад`;
}

type Tab = 'issues' | 'feed' | 'chats';

export function SocialMonitor() {
  const { chats, messages, issues, isLoading, updateIssueStatus, addChat, removeChat, getChatStats } = useSocialMonitor();
  const [tab, setTab] = useState<Tab>('issues');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newChatId, setNewChatId] = useState('');
  const [newChatTitle, setNewChatTitle] = useState('');

  // Filter issues
  const filteredIssues = useMemo(() => {
    if (statusFilter === 'active') return issues.filter(i => ['new', 'watching', 'escalated'].includes(i.status));
    if (statusFilter === 'all') return issues;
    return issues.filter(i => i.status === statusFilter);
  }, [issues, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    const active = issues.filter(i => ['new', 'watching', 'escalated'].includes(i.status));
    const critical = active.filter(i => i.severity >= 8);
    const escalated = active.filter(i => i.status === 'escalated');
    return {
      total: issues.length,
      active: active.length,
      critical: critical.length,
      escalated: escalated.length,
      chats: chats.length,
      messages: messages.length,
    };
  }, [issues, chats, messages]);

  if (isLoading) {
    return <div className={styles.page}><Header title="Мониторинг соцсетей" /><Skeleton variant="card" height={300} /></div>;
  }

  return (
    <div className={styles.page}>
      <Header title="Мониторинг соцсетей" />

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.active}</span>
          <span className={styles.statLabel}>Активных проблем</span>
        </div>
        <div className={`${styles.statCard} ${stats.critical > 0 ? styles.statDanger : ''}`}>
          <span className={styles.statValue}>{stats.critical}</span>
          <span className={styles.statLabel}>Критических</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.escalated}</span>
          <span className={styles.statLabel}>На эскалации</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.chats}</span>
          <span className={styles.statLabel}>Чатов</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {([['issues', 'Проблемы'], ['feed', 'Лента'], ['chats', 'Чаты']] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        {tab === 'issues' && (
          <div className={styles.filters}>
            {(['active', 'new', 'escalated', 'resolved', 'all'] as string[]).map(f => (
              <button key={f} className={`${styles.filterBtn} ${statusFilter === f ? styles.filterActive : ''}`}
                onClick={() => setStatusFilter(f)}>
                {f === 'active' ? 'Активные' : f === 'all' ? 'Все' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Issues tab */}
      {tab === 'issues' && (
        filteredIssues.length === 0 ? (
          <Card>
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Проблем не обнаружено</p>
              <p className={styles.emptyHint}>Подключите Telegram-чаты и запустите бот для мониторинга</p>
            </div>
          </Card>
        ) : (
          <div className={styles.issueList}>
            {filteredIssues.map(issue => (
              <IssueCard key={issue.id} issue={issue} onStatusChange={async (status) => {
                await updateIssueStatus(issue.id, status);
                setToast({ message: `Статус изменён: ${STATUS_LABELS[status]}`, type: 'success' });
              }} />
            ))}
          </div>
        )
      )}

      {/* Feed tab */}
      {tab === 'feed' && (
        messages.length === 0 ? (
          <Card>
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Сообщений пока нет</p>
              <p className={styles.emptyHint}>Бот начнёт собирать сообщения после запуска</p>
            </div>
          </Card>
        ) : (
          <Card>
            <div className={styles.feedList}>
              {messages.slice(0, 50).map(msg => {
                const chat = chats.find(c => c.chatId === msg.chatId);
                return (
                  <div key={msg.id} className={styles.feedItem}>
                    <div className={styles.feedMeta}>
                      <span className={styles.feedChat}>{chat?.title ?? '?'}</span>
                      <span className={styles.feedTime}>{timeAgo(msg.date)}</span>
                    </div>
                    {msg.senderName && <span className={styles.feedSender}>{msg.senderName}</span>}
                    <p className={styles.feedText}>{msg.text.slice(0, 300)}{msg.text.length > 300 ? '…' : ''}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        )
      )}

      {/* Chats tab */}
      {tab === 'chats' && (
        <div className={styles.stack}>
          {chats.map(chat => (
            <ChatCard key={chat.id} chat={chat} stats={getChatStats(chat.chatId)}
              onRemove={async () => { await removeChat(chat.chatId); setToast({ message: 'Чат отключён', type: 'success' }); }} />
          ))}
          {chats.length === 0 && (
            <Card><div className={styles.empty}><p className={styles.emptyTitle}>Нет подключённых чатов</p></div></Card>
          )}
          <Card>
            <div className={styles.addChatRow}>
              <input className={styles.addChatInput} placeholder="Chat ID" value={newChatId}
                onChange={e => setNewChatId(e.target.value)} type="number" />
              <input className={styles.addChatInput} placeholder="Название чата" value={newChatTitle}
                onChange={e => setNewChatTitle(e.target.value)} />
              <button className={styles.addChatBtn} disabled={!newChatId || !newChatTitle}
                onClick={async () => {
                  try {
                    await addChat(Number(newChatId), newChatTitle);
                    setNewChatId(''); setNewChatTitle('');
                    setToast({ message: 'Чат добавлен', type: 'success' });
                  } catch { setToast({ message: 'Ошибка', type: 'error' }); }
                }}>Добавить</button>
            </div>
          </Card>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ===== Issue Card ===== */
function IssueCard({ issue, onStatusChange }: { issue: TgIssue; onStatusChange: (s: TgIssue['status']) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${styles.issueCard} ${issue.severity >= 8 ? styles.issueCritical : ''}`}>
      <div className={styles.issueHeader} onClick={() => setExpanded(!expanded)}>
        <div className={styles.issueSeverity} style={{ background: severityColor(issue.severity) }}>
          {issue.severity}
        </div>
        <div className={styles.issueInfo}>
          <span className={styles.issueTitle}>{issue.title}</span>
          <div className={styles.issueMeta}>
            {issue.location && <span className={styles.issueLocation}>{issue.location}</span>}
            {issue.direction && <span className={styles.issueDirection}>{issue.direction}</span>}
            <span className={styles.issueTime}>{timeAgo(issue.lastSeen)}</span>
            <span className={styles.issueMsgCount}>{issue.messageCount} сообщ.</span>
          </div>
        </div>
        <div className={styles.issueStatus} style={{ color: STATUS_COLORS[issue.status] }}>
          {STATUS_LABELS[issue.status]}
        </div>
      </div>

      {expanded && (
        <div className={styles.issueExpanded}>
          {issue.summary && <p className={styles.issueSummary}>{issue.summary}</p>}
          <div className={styles.issueActions}>
            {(['watching', 'escalated', 'resolved', 'ignored'] as TgIssue['status'][])
              .filter(s => s !== issue.status)
              .map(s => (
                <button key={s} className={styles.issueActionBtn} style={{ color: STATUS_COLORS[s] }}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(s); }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Chat Card with expandable stats ===== */
function ChatCard({ chat, stats, onRemove }: {
  chat: { id: number; chatId: number; title: string; username: string | null };
  stats: { total: number; todayCount: number; perDay: { date: string; count: number }[]; topSenders: { name: string; count: number }[] };
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxPerDay = Math.max(1, ...stats.perDay.map(d => d.count));

  return (
    <Card>
      <div className={styles.chatCardHeader} onClick={() => setExpanded(!expanded)}>
        <div className={styles.chatCardInfo}>
          <span className={styles.chatTitle}>{chat.title}</span>
          {chat.username && <span className={styles.chatUsername}>@{chat.username}</span>}
        </div>
        <div className={styles.chatCardStats}>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{stats.total}</span>
            <span className={styles.chatStatLabel}>всего</span>
          </div>
          <div className={styles.chatStat}>
            <span className={styles.chatStatValue}>{stats.todayCount}</span>
            <span className={styles.chatStatLabel}>сегодня</span>
          </div>
        </div>
        <span className={styles.chatExpand}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className={styles.chatCardBody}>
          {/* Messages per day mini chart */}
          {stats.perDay.length > 0 && (
            <div className={styles.chatSection}>
              <span className={styles.chatSectionTitle}>Сообщений по дням</span>
              <div className={styles.chatBarChart}>
                {stats.perDay.map(d => (
                  <div key={d.date} className={styles.chatBarCol}>
                    <span className={styles.chatBarCount}>{d.count}</span>
                    <div className={styles.chatBarTrack}>
                      <div className={styles.chatBarFill} style={{ height: `${(d.count / maxPerDay) * 100}%` }} />
                    </div>
                    <span className={styles.chatBarDate}>{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top senders */}
          {stats.topSenders.length > 0 && (
            <div className={styles.chatSection}>
              <span className={styles.chatSectionTitle}>Активные участники</span>
              <div className={styles.chatSenderList}>
                {stats.topSenders.map((s, i) => (
                  <div key={i} className={styles.chatSenderItem}>
                    <span className={styles.chatSenderName}>{s.name}</span>
                    <span className={styles.chatSenderCount}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.chatCardFooter}>
            <span className={styles.chatId}>ID: {chat.chatId}</span>
            <button className={styles.chatRemoveBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }}>Отключить</button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default SocialMonitor;
