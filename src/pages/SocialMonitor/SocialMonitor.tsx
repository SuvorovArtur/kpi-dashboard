import { useState, useMemo } from 'react';
import { Card, Header, Skeleton, Toast, Chart } from '../../shared/ui';
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

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) {
    const mins = Math.floor(-diff / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `просрочен на ${mins}м`;
    const hrs = Math.floor(mins / 60);
    return `просрочен на ${hrs}ч`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'сейчас';
  if (mins < 60) return `через ${mins}м`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `через ${hrs}ч`;
  const days = Math.floor(hrs / 24);
  return `через ${days}д`;
}

type Tab = 'issues' | 'chats' | 'channels';

export function SocialMonitor() {
  const { chats, issues, isLoading, chatCounts, analysisStatus, updateIssueStatus, addChat, removeChat, updateChatId, fetchChatStats, fetchIssueMessages, fetchChannelNews, fetchChannelStats } = useSocialMonitor();
  const [tab, setTab] = useState<Tab>('issues');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newChatId, setNewChatId] = useState('');
  const [newChatTitle, setNewChatTitle] = useState('');

  // Split chats vs channels
  const chatsList = useMemo(() => chats.filter(c => c.type !== 'channel'), [chats]);
  const channelsList = useMemo(() => chats.filter(c => c.type === 'channel'), [chats]);

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

    // ISS: Индекс социальных сетей (по аналогии с ИСН)
    const scored = active.filter(i => i.severity > 0);
    let issWeighted = 0;
    let issSimple = 0;
    let acutePct = 0;
    if (scored.length > 0) {
      const sumS = scored.reduce((s, i) => s + i.severity, 0);
      const sumSq = scored.reduce((s, i) => s + i.severity * i.severity, 0);
      issWeighted = Math.round((sumSq / sumS) * 10) / 10;
      issSimple = Math.round((sumS / scored.length) * 10) / 10;
      acutePct = Math.round((scored.filter(i => i.severity >= 7).length / scored.length) * 1000) / 10;
    }
    const issStatus = issWeighted > 6 || acutePct > 10 ? 'red' : issWeighted > 4 || acutePct > 5 ? 'yellow' : 'green';
    const issLabel = issStatus === 'red' ? 'Эскалация' : issStatus === 'yellow' ? 'Внимание' : 'Штатный режим';

    return {
      total: issues.length,
      active: active.length,
      critical: critical.length,
      escalated: escalated.length,
      chats: chats.length,
      issWeighted, issSimple, acutePct, issStatus, issLabel, analyzed: scored.length,
    };
  }, [issues, chats]);

  if (isLoading) {
    return <div className={styles.page}><Header title="Мониторинг соцсетей" /><Skeleton variant="card" height={300} /></div>;
  }

  return (
    <div className={styles.page}>
      <Header title="Мониторинг соцсетей" />

      {/* ISS: Индекс социальных сетей */}
      {stats.analyzed > 0 && (
        <div className={`${styles.issBlock} ${styles[`iss_${stats.issStatus}`]}`}>
          <div className={styles.issSignal}>
            {stats.issStatus === 'green' ? '✓' : stats.issStatus === 'yellow' ? '⚠' : '!'}
          </div>
          <div className={styles.issInfo}>
            <div className={styles.issTitle}>{stats.issLabel}</div>
            <div className={styles.issSub}>
              ИСС {stats.issWeighted} · Острых {stats.acutePct}% · {stats.analyzed} проблем · {stats.chats} чатов
            </div>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>ИСС (взвешенный)</span>
          <span className={styles.statValue}>{stats.analyzed > 0 ? stats.issWeighted : '—'}</span>
          <span className={styles.statHint}>{stats.analyzed > 0 ? `Простой: ${stats.issSimple}` : 'Нет данных'}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Острые проблемы</span>
          <span className={styles.statValue}>{stats.analyzed > 0 ? `${stats.acutePct}%` : '—'}</span>
          <span className={styles.statHint}>{stats.critical} из {stats.analyzed}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Активных</span>
          <span className={styles.statValue}>{stats.active}</span>
          <span className={styles.statHint}>{stats.escalated} на эскалации</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Чатов</span>
          <span className={styles.statValue}>{stats.chats}</span>
          <span className={styles.statHint}>мониторинг</span>
        </div>
      </div>

      {/* Analysis status bar */}
      <div className={styles.analysisBar}>
        <span className={`${styles.analysisDot} ${analysisStatus.status === 'running' ? styles.analysisDotRunning : styles.analysisDotIdle}`} />
        <span className={styles.analysisLabel}>
          {analysisStatus.status === 'running' ? 'Анализ...' : 'Анализатор'}
        </span>
        {analysisStatus.lastRun && (
          <span className={styles.analysisItem}>Последний: {timeAgo(analysisStatus.lastRun)}</span>
        )}
        {analysisStatus.nextRun && (
          <span className={styles.analysisItem}>Следующий: {timeUntil(analysisStatus.nextRun)}</span>
        )}
        <span className={styles.analysisItem}>В очереди: {analysisStatus.queueSize}</span>
        {analysisStatus.lastThreads > 0 && (
          <span className={styles.analysisItem}>Найдено: {analysisStatus.lastThreads} проблем</span>
        )}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {([['issues', 'Проблемы'], ['chats', 'Чаты'], ['channels', 'Каналы']] as [Tab, string][]).map(([key, label]) => (
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
              <IssueCard key={issue.id} issue={issue} chats={chats} fetchMessages={() => fetchIssueMessages(issue.id)} onStatusChange={async (status) => {
                await updateIssueStatus(issue.id, status);
                setToast({ message: `Статус изменён: ${STATUS_LABELS[status]}`, type: 'success' });
              }} />
            ))}
          </div>
        )
      )}

      {/* Chats tab */}
      {tab === 'chats' && (
        <div className={styles.stack}>
          {chatsList.map(chat => (
            <ChatCard key={chat.id} chat={chat} counts={chatCounts.get(chat.chatId)} fetchStats={() => fetchChatStats(chat.chatId)}
              onRemove={async () => { await removeChat(chat.chatId); setToast({ message: 'Чат отключён', type: 'success' }); }}
              onUpdateChatId={async (newId) => { await updateChatId(chat.chatId, newId); setToast({ message: 'ID обновлён', type: 'success' }); }} />
          ))}
          {chatsList.length === 0 && (
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

      {/* Channels tab */}
      {tab === 'channels' && (
        <div className={styles.stack}>
          {channelsList.map(ch => (
            <ChannelNewsCard key={ch.id} channel={ch}
              fetchNews={() => fetchChannelNews(ch.chatId)}
              fetchStats={() => fetchChannelStats(ch.chatId)}
              onRemove={async () => { await removeChat(ch.chatId); setToast({ message: 'Канал отключён', type: 'success' }); }}
              onSendAlert={(text) => { setToast({ message: text, type: 'success' }); }} />
          ))}
          {channelsList.length === 0 && (
            <Card><div className={styles.empty}><p className={styles.emptyTitle}>Нет подключённых каналов</p></div></Card>
          )}
          <Card>
            <div className={styles.addChatRow}>
              <input className={styles.addChatInput} placeholder="@username или ID канала" value={newChatId}
                onChange={e => setNewChatId(e.target.value)} type="text" />
              <input className={styles.addChatInput} placeholder="Название канала" value={newChatTitle}
                onChange={e => setNewChatTitle(e.target.value)} />
              <button className={styles.addChatBtn} disabled={!newChatId || !newChatTitle}
                onClick={async () => {
                  try {
                    const val = newChatId.trim().replace(/^@/, '');
                    const isNumeric = /^-?\d+$/.test(val);
                    await addChat(
                      isNumeric ? Number(val) : 0,
                      newChatTitle,
                      isNumeric ? undefined : val,
                      'channel',
                    );
                    setNewChatId(''); setNewChatTitle('');
                    setToast({ message: isNumeric ? 'Канал добавлен' : 'Канал добавлен, ID будет определён автоматически', type: 'success' });
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
function tgLink(chatId: number, messageId: number): string {
  // Convert -100XXXXXXXXXX → XXXXXXXXXX for t.me/c/ format
  const raw = Math.abs(chatId);
  const stripped = raw > 1000000000000 ? raw - 1000000000000 : raw;
  return `https://t.me/c/${stripped}/${messageId}`;
}

function IssueCard({ issue, chats, fetchMessages, onStatusChange }: {
  issue: TgIssue;
  chats: { chatId: number; title: string }[];
  fetchMessages: () => Promise<{ id: number; chatId: number; messageId: number; date: string; senderName: string | null; text: string }[]>;
  onStatusChange: (s: TgIssue['status']) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msgs, setMsgs] = useState<{ id: number; chatId: number; messageId: number; date: string; senderName: string | null; text: string }[] | null>(null);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !msgs) {
      const data = await fetchMessages();
      setMsgs(data);
    }
  };

  return (
    <div className={`${styles.issueCard} ${issue.severity >= 8 ? styles.issueCritical : ''}`}>
      <div className={styles.issueHeader} onClick={handleExpand}>
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

          {/* Messages */}
          {msgs && msgs.length > 0 && (
            <div className={styles.issueMsgList}>
              {msgs.slice(0, 5).map(m => {
                const chat = chats.find(c => c.chatId === m.chatId);
                return (
                  <a key={m.id} href={tgLink(m.chatId, m.messageId)} target="_blank" rel="noopener noreferrer" className={styles.issueMsgItem}>
                    <div className={styles.issueMsgMeta}>
                      <span className={styles.issueMsgSender}>{m.senderName ?? '?'}</span>
                      <span className={styles.issueMsgTime}>{timeAgo(m.date)}</span>
                      {chat && <span className={styles.issueMsgChat}>{chat.title}</span>}
                    </div>
                    <p className={styles.issueMsgText}>{m.text.slice(0, 200)}{m.text.length > 200 ? '…' : ''}</p>
                  </a>
                );
              })}
            </div>
          )}

          <div className={styles.issueActions}>
            <button className={styles.issueCopyBtn} onClick={(e) => {
              e.stopPropagation();
              const icon = issue.severity >= 9 ? '🚨' : issue.severity >= 7 ? '⚠️' : 'ℹ️';
              const lines: string[] = [];

              lines.push(`${icon} ${issue.title}`);
              lines.push(`Острота: ${issue.severity}/10`);
              lines.push('');

              if (issue.location && issue.location !== 'не указана') lines.push(`Где: ${issue.location}`);
              if (issue.direction) lines.push(`Тема: ${issue.direction}`);

              if (issue.summary) {
                const clean = issue.summary.split('\n\nЦитаты:')[0];
                lines.push('', clean);
              }

              if (msgs && msgs.length > 0) {
                lines.push('');
                msgs.slice(0, 3).forEach(m => {
                  const link = tgLink(m.chatId, m.messageId);
                  const text = m.text.slice(0, 80).replace(/\n/g, ' ') + (m.text.length > 80 ? '…' : '');
                  lines.push(`— "${text}"  [→]( ${link} )`);
                });
              }

              lines.push('', `${issue.messageCount} сообщ. · SocPulse`);
              const text = lines.join('\n');
              try {
                navigator.clipboard.writeText(text);
              } catch {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? '✓ Скопировано' : 'Копировать для Telegram'}
            </button>
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
function ChatCard({ chat, counts, fetchStats, onRemove, onUpdateChatId }: {
  chat: { id: number; chatId: number; title: string; username: string | null; subscribers: number };
  counts?: { total: number; today: number };
  fetchStats: () => Promise<any>;
  onRemove: () => void;
  onUpdateChatId: (newId: number) => void;
}) {
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

/* ===== Channel News Card ===== */
interface NewsItem {
  id: number;
  chatId: number;
  messageId: number;
  text: string;
  photoUrl: string | null;
  summary: string;
  topic: string;
  location: string;
  severity: number;
  channelName: string;
  postUrl: string | null;
  createdAt: string;
}

function ChannelNewsCard({ channel, fetchNews, fetchStats, onRemove, onSendAlert }: {
  channel: { id: number; chatId: number; title: string; username: string | null; subscribers: number };
  fetchNews: () => Promise<NewsItem[]>;
  fetchStats: () => Promise<{ date: string; subscribers: number; postsFound: number }[]>;
  onRemove: () => void;
  onSendAlert: (msg: string) => void;
}) {
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
                data={stats.slice(-14).map(s => ({ date: s.date.slice(5), '\u041F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u043E\u0432': s.subscribers }))}
                xKey="date"
                yKey={['\u041F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u043E\u0432']}
                color={['var(--color-teal)']}
                title="\u041F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438 \u043F\u043E \u0434\u043D\u044F\u043C"
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

function TgNewsCard({ item, onSendAlert }: { item: NewsItem; onSendAlert: (msg: string) => void }) {
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
    try {
      navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    }
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

export default SocialMonitor;
