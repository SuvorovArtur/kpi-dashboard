import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Hash, MessageCircle, Radio, Users, Clock, ExternalLink, Activity,
  ChevronDown, ChevronRight, Crown, Bot,
} from 'lucide-react';
import { Card, Header, EmptyState, Badge, Skeleton, Pill, ScoreCircle, Chart } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import styles from './Sources.module.css';

export interface SourceRow {
  id: number;
  chat_id: number;
  title: string;
  username: string | null;
  type: 'chat' | 'channel' | string;
  is_active: boolean;
  subscribers: number | null;
  created_at: string;
  msgs_24h: number;
  msgs_7d: number;
  msgs_total: number;
  last_message_at: string | null;
  news_24h: number;
  news_7d: number;
  news_total: number;
  last_news_at: string | null;
  octo_processed_7d: number;
  octo_incidents_7d: number;
  last_activity_at: string | null;
  userbot_id: number | null;
  userbot_label: string | null;
  userbot_session: string | null;
  userbot_is_active: boolean | null;
  userbot_last_seen_at: string | null;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU');
}

export function telegramUrl(row: SourceRow): string | null {
  if (row.username) return `https://t.me/${row.username}`;
  // Private chat/channel — build c/{id}/ link
  const raw = Math.abs(row.chat_id);
  const stripped = raw > 1_000_000_000_000 ? raw - 1_000_000_000_000 : raw;
  return `https://t.me/c/${stripped}`;
}

function SourceCard({ row, onClick }: { row: SourceRow; onClick: () => void }) {
  const isChannel = row.type === 'channel';
  const recent = isChannel ? row.news_24h : row.msgs_24h;
  const week = isChannel ? row.news_7d : row.msgs_7d;
  const total = isChannel ? row.news_total : row.msgs_total;
  const last = isChannel ? row.last_news_at : row.last_message_at;
  const link = telegramUrl(row);

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon} data-type={row.type}>
          {isChannel ? <Radio size={18} /> : <MessageCircle size={18} />}
        </div>
        <div className={styles.cardHeaderBody}>
          <div className={styles.cardTitleRow}>
            <div className={styles.cardTitle}>{row.title}</div>
            <Badge
              status={row.is_active ? 'green' : 'yellow'}
              label={row.is_active ? 'активен' : 'выключен'}
              size="sm"
            />
          </div>
          <div className={styles.cardMeta}>
            <span className={styles.cardType}>{isChannel ? 'Канал' : 'Чат'}</span>
            {row.username && (
              <span className={styles.cardUsername}>
                <Hash size={11} />@{row.username}
              </span>
            )}
            {row.userbot_label ? (
              <span className={styles.cardUserbot} title={`Сессия: ${row.userbot_session ?? '—'}`}>
                <Bot size={11} />{row.userbot_label}
              </span>
            ) : (
              <span className={`${styles.cardUserbot} ${styles.cardUserbotNone}`}>
                <Bot size={11} />не привязан
              </span>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.cardLink}
                onClick={(e) => e.stopPropagation()}
              >
                Открыть <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}><Users size={12} /> Подписчики</span>
          <span className={styles.statValue}>{formatNumber(row.subscribers)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{isChannel ? 'Постов за 24ч' : 'Сообщений за 24ч'}</span>
          <span className={styles.statValue}>{formatNumber(recent)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>За 7 дней</span>
          <span className={styles.statValue}>{formatNumber(week)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Всего</span>
          <span className={styles.statValue}>{formatNumber(total)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}><Clock size={12} /> Активность</span>
          <span className={styles.statValue}>{relativeTime(last)}</span>
        </div>
      </div>

      {!isChannel && (row.octo_incidents_7d > 0 || row.octo_processed_7d > 0) && (
        <div className={styles.octoRow}>
          <Activity size={13} />
          <span>
            Octobot: <strong>{row.octo_incidents_7d}</strong> инцидент
            {row.octo_incidents_7d === 1 ? '' : row.octo_incidents_7d < 5 ? 'а' : 'ов'} из{' '}
            <strong>{row.octo_processed_7d}</strong> обработанных за 7 дней
          </span>
        </div>
      )}
    </div>
  );
}

interface DailyActivity { day: string; messages: number; news: number }
interface TopicBreakdown { topic: string; incidents: number; max_priority: number }
interface RecentIncident {
  id: number;
  topic: string;
  address: string | null;
  summary: string;
  priority: number;
  status: string;
  created_at: string;
  confirmations_count: number | null;
}
interface RecentMessage {
  id: number;
  text: string | null;
  sender_name: string | null;
  date: string;
  message_id: number;
}
interface TopAuthor {
  author: string;
  messages: number;
  last_message_at: string;
}
interface RecentNews {
  id: number;
  text: string | null;
  summary: string | null;
  topic: string | null;
  created_at: string;
  post_url: string | null;
}

export function SourceDetail({ source }: { source: SourceRow }) {
  const navigate = useNavigate();
  const isChannel = source.type === 'channel';
  const link = telegramUrl(source);

  const [daily, setDaily] = useState<DailyActivity[]>([]);
  const [topics, setTopics] = useState<TopicBreakdown[]>([]);
  const [incidents, setIncidents] = useState<RecentIncident[]>([]);
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [news, setNews] = useState<RecentNews[]>([]);
  const [authors, setAuthors] = useState<TopAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [authorsOpen, setAuthorsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [dailyRes, topicsRes, incRes, msgRes, newsRes, authorsRes] = await Promise.all([
        supabase.rpc('tg_source_daily_activity', { p_chat_id: source.chat_id, p_days: 14 }),
        supabase.rpc('tg_source_topic_breakdown', { p_chat_id: source.chat_id, p_days: 30 }),
        supabase
          .from('octobot_incidents')
          .select('id, topic, address, summary, priority, status, created_at, confirmations_count:octobot_confirmations(count)')
          .eq('source_chat_id', source.chat_id)
          .in('status', ['open', 'in_progress', 'watching'])
          .order('created_at', { ascending: false })
          .limit(10),
        isChannel
          ? Promise.resolve({ data: [], error: null } as { data: RecentMessage[]; error: null })
          : supabase
              .from('tg_messages')
              .select('id, text, sender_name, date, message_id')
              .eq('chat_id', source.chat_id)
              .order('date', { ascending: false })
              .limit(50),
        isChannel
          ? supabase
              .from('tg_news')
              .select('id, text, summary, topic, created_at, post_url')
              .eq('chat_id', source.chat_id)
              .order('created_at', { ascending: false })
              .limit(15)
          : Promise.resolve({ data: [], error: null } as { data: RecentNews[]; error: null }),
        isChannel
          ? Promise.resolve({ data: [], error: null } as { data: TopAuthor[]; error: null })
          : supabase.rpc('tg_source_top_authors', {
              p_chat_id: source.chat_id, p_days: 30, p_limit: 15,
            }),
      ]);
      if (cancelled) return;
      setDaily((dailyRes.data || []) as DailyActivity[]);
      setTopics((topicsRes.data || []) as TopicBreakdown[]);
      const incList = ((incRes.data || []) as Array<RecentIncident & { confirmations_count: { count: number }[] | number | null }>).map(r => ({
        ...r,
        confirmations_count: Array.isArray(r.confirmations_count)
          ? (r.confirmations_count[0]?.count ?? 0)
          : (r.confirmations_count ?? 0),
      }));
      setIncidents(incList as RecentIncident[]);
      setMessages((msgRes.data || []) as RecentMessage[]);
      setNews((newsRes.data || []) as RecentNews[]);
      setAuthors((authorsRes.data || []) as TopAuthor[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [source.chat_id, isChannel]);

  const chartData = useMemo(
    () => daily.map(d => ({
      day: new Date(d.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      value: d.messages + d.news,
    })),
    [daily],
  );
  const totalLast14d = chartData.reduce((s, d) => s + d.value, 0);
  const maxAuthorCount = authors[0]?.messages ?? 0;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <div className={styles.detailIcon} data-type={source.type}>
          {isChannel ? <Radio size={20} /> : <MessageCircle size={20} />}
        </div>
        <div className={styles.detailHeadBody}>
          <div className={styles.detailTitle}>{source.title}</div>
          <div className={styles.detailMeta}>
            <span>{isChannel ? 'Канал' : 'Чат'}</span>
            {source.username && <span>·&nbsp;@{source.username}</span>}
            <Badge
              status={source.is_active ? 'green' : 'yellow'}
              label={source.is_active ? 'активен' : 'выключен'}
              size="sm"
            />
          </div>
        </div>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className={styles.detailOpenBtn}>
            <ExternalLink size={14} /> Telegram
          </a>
        )}
      </div>

      <div className={styles.detailKpiGrid}>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}><Users size={12} /> Подписчики</span>
          <span className={styles.detailKpiValue}>{formatNumber(source.subscribers)}</span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>За 24 часа</span>
          <span className={styles.detailKpiValue}>
            {formatNumber(isChannel ? source.news_24h : source.msgs_24h)}
          </span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>За 7 дней</span>
          <span className={styles.detailKpiValue}>
            {formatNumber(isChannel ? source.news_7d : source.msgs_7d)}
          </span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>Всего</span>
          <span className={styles.detailKpiValue}>
            {formatNumber(isChannel ? source.news_total : source.msgs_total)}
          </span>
        </div>
      </div>

      <section className={styles.detailSection}>
        <div className={styles.detailSectionHead}>
          <span>Активность за 14 дней</span>
          <span className={styles.detailSectionHint}>{totalLast14d} {isChannel ? 'постов' : 'сообщений'}</span>
        </div>
        {loading ? (
          <Skeleton variant="chart" />
        ) : totalLast14d > 0 ? (
          <div className={styles.chartWrap}>
            <Chart
              type="bar"
              data={chartData}
              xKey="day"
              yKey="value"
              color="var(--accent-primary)"
              height={220}
            />
          </div>
        ) : (
          <div className={styles.detailEmpty}>Нет данных за период</div>
        )}
      </section>

      {!isChannel && (
        <section className={styles.detailSection}>
          <div className={styles.detailSectionHead}>
            <span>Октобот за 30 дней</span>
            <span className={styles.detailSectionHint}>
              {topics.reduce((s, t) => s + t.incidents, 0)} инцидентов
            </span>
          </div>
          {loading ? (
            <Skeleton variant="card" />
          ) : topics.length === 0 ? (
            <div className={styles.detailEmpty}>Нет инцидентов от этого источника</div>
          ) : (
            <div className={styles.topicList}>
              {topics.slice(0, 8).map(t => (
                <div key={t.topic} className={styles.topicRow}>
                  <ScoreCircle score={t.max_priority} size={28} />
                  <span className={styles.topicName}>{t.topic}</span>
                  <Pill>{t.incidents}</Pill>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!isChannel && (
        <section className={styles.detailSection}>
          <div className={styles.detailSectionHead}>
            <span>Открытые инциденты</span>
            <span className={styles.detailSectionHint}>{incidents.length}</span>
          </div>
          {loading ? (
            <Skeleton variant="card" />
          ) : incidents.length === 0 ? (
            <div className={styles.detailEmpty}>Нет открытых инцидентов</div>
          ) : (
            <ul className={styles.incidentList}>
              {incidents.map(inc => (
                <li key={inc.id} className={styles.incidentRow}>
                  <ScoreCircle score={inc.priority} size={32} />
                  <div className={styles.incidentBody}>
                    <div className={styles.incidentTitleRow}>
                      <span className={styles.incidentTopic}>{inc.topic}</span>
                      {inc.address && <span className={styles.incidentAddress}>· {inc.address}</span>}
                      {(inc.confirmations_count ?? 0) > 0 && (
                        <Pill>×{inc.confirmations_count}</Pill>
                      )}
                    </div>
                    <div className={styles.incidentSummary}>{inc.summary}</div>
                    <div className={styles.incidentFooter}>{relativeTime(inc.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!isChannel && (
        <section className={styles.detailSection}>
          <button
            type="button"
            className={styles.collapseHeader}
            onClick={() => setAuthorsOpen(o => !o)}
            aria-expanded={authorsOpen}
          >
            {authorsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Топ-15 участников · 30 дней</span>
            <span className={styles.detailSectionHint}>{authors.length} активных</span>
          </button>
          {authorsOpen && (
            loading ? (
              <Skeleton variant="card" />
            ) : authors.length === 0 ? (
              <div className={styles.detailEmpty}>Нет данных об участниках</div>
            ) : (
              <ol className={styles.authorList}>
                {authors.map((a, idx) => {
                  const pct = maxAuthorCount > 0 ? (a.messages / maxAuthorCount) * 100 : 0;
                  const href = `/authors/${source.chat_id}/${encodeURIComponent(a.author)}`;
                  return (
                    <li
                      key={`${a.author}-${idx}`}
                      className={styles.authorRow}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(href)}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(href);
                        }
                      }}
                    >
                      <span className={styles.authorRank} data-top={idx < 3}>
                        {idx === 0 ? <Crown size={12} /> : idx + 1}
                      </span>
                      <span className={styles.authorName} title={a.author}>{a.author}</span>
                      <div className={styles.authorBarWrap}>
                        <div className={styles.authorBar} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={styles.authorCount}>{formatNumber(a.messages)}</span>
                      <span className={styles.authorTime}>{relativeTime(a.last_message_at)}</span>
                    </li>
                  );
                })}
              </ol>
            )
          )}
        </section>
      )}

      <section className={styles.detailSection}>
        <button
          type="button"
          className={styles.collapseHeader}
          onClick={() => setMessagesOpen(o => !o)}
          aria-expanded={messagesOpen}
        >
          {messagesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{isChannel ? 'Последние посты' : 'Последние сообщения'}</span>
          <span className={styles.detailSectionHint}>{isChannel ? news.length : messages.length}</span>
        </button>
        {messagesOpen && (
          loading ? (
            <Skeleton variant="card" />
          ) : isChannel ? (
            news.length === 0 ? (
              <div className={styles.detailEmpty}>Нет собранных постов</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.msgTable}>
                  <thead>
                    <tr>
                      <th>Тема</th>
                      <th>Текст</th>
                      <th>Когда</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {news.map(n => (
                      <tr key={n.id}>
                        <td className={styles.cellNarrow}>{n.topic || '—'}</td>
                        <td className={styles.cellText}>{n.summary || n.text || '—'}</td>
                        <td className={styles.cellNarrow}>{relativeTime(n.created_at)}</td>
                        <td className={styles.cellNarrow}>
                          {n.post_url && (
                            <a href={n.post_url} target="_blank" rel="noopener noreferrer" className={styles.messageLink}>
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : messages.length === 0 ? (
            <div className={styles.detailEmpty}>Нет сообщений в буфере</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.msgTable}>
                <thead>
                  <tr>
                    <th>Автор</th>
                    <th>Текст</th>
                    <th>Когда</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id}>
                      <td className={styles.cellNarrow}>{m.sender_name || 'аноним'}</td>
                      <td className={styles.cellText}>{m.text || '—'}</td>
                      <td className={styles.cellNarrow}>{relativeTime(m.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </div>
  );
}

export function Sources() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('tg_sources_overview')
        .select('*')
        .order('is_active', { ascending: false })
        .order('last_activity_at', { ascending: false, nullsFirst: false });
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else {
        setRows((data || []) as SourceRow[]);
      }
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const chats = useMemo(() => rows.filter(r => r.type === 'chat'), [rows]);
  const channels = useMemo(() => rows.filter(r => r.type === 'channel'), [rows]);

  const kpis = useMemo(() => {
    const active = rows.filter(r => r.is_active).length;
    const msgs24 = rows.reduce((s, r) => s + (r.msgs_24h || 0) + (r.news_24h || 0), 0);
    const msgs7 = rows.reduce((s, r) => s + (r.msgs_7d || 0) + (r.news_7d || 0), 0);
    const octoIncidents = rows.reduce((s, r) => s + (r.octo_incidents_7d || 0), 0);
    const subscribers = rows.reduce((s, r) => s + (r.subscribers || 0), 0);
    return { active, total: rows.length, msgs24, msgs7, octoIncidents, subscribers };
  }, [rows]);

  return (
    <div className={styles.page}>
      <Header
        title="Источники"
        subtitle="Telegram-чаты и каналы, которые мониторит Octobot"
      />

      {isLoading ? (
        <div className={styles.skelGrid}>
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить источники" description={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Источников пока нет"
          description="Добавьте чаты в tg_chats, чтобы начать мониторинг"
        />
      ) : (
        <>
          <div className={styles.kpiRow}>
            <Card className={styles.kpiTile}>
              <div className={styles.kpiLabel}>Активных источников</div>
              <div className={styles.kpiValue}>{kpis.active}</div>
              <div className={styles.kpiSub}>из {kpis.total}</div>
            </Card>
            <Card className={styles.kpiTile}>
              <div className={styles.kpiLabel}>Аудитория</div>
              <div className={styles.kpiValue}>{formatNumber(kpis.subscribers)}</div>
              <div className={styles.kpiSub}>подписчиков суммарно</div>
            </Card>
            <Card className={styles.kpiTile}>
              <div className={styles.kpiLabel}>Сообщений за 24ч</div>
              <div className={styles.kpiValue}>{formatNumber(kpis.msgs24)}</div>
              <div className={styles.kpiSub}>{formatNumber(kpis.msgs7)} за неделю</div>
            </Card>
            <Card className={styles.kpiTile}>
              <div className={styles.kpiLabel}>Инцидентов Octobot</div>
              <div className={styles.kpiValue}>{kpis.octoIncidents}</div>
              <div className={styles.kpiSub}>за 7 дней</div>
            </Card>
          </div>

          {chats.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <MessageCircle size={16} />
                <span>Чаты</span>
                <Pill>{chats.length}</Pill>
              </div>
              <div className={styles.cardGrid}>
                {chats.map(row => <SourceCard key={row.id} row={row} onClick={() => navigate(`/sources/${row.id}`)} />)}
              </div>
            </section>
          )}

          {channels.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <Radio size={16} />
                <span>Каналы</span>
                <Pill>{channels.length}</Pill>
              </div>
              <div className={styles.cardGrid}>
                {channels.map(row => <SourceCard key={row.id} row={row} onClick={() => navigate(`/sources/${row.id}`)} />)}
              </div>
            </section>
          )}
        </>
      )}

    </div>
  );
}

export default Sources;
