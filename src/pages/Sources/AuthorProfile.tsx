import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, MessageSquare, Sparkles, MapPin, Tag,
} from 'lucide-react';
import { EmptyState, Skeleton, Badge, Pill, Header, Chart } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import { relativeTime, formatNumber } from './Sources';
import styles from './Sources.module.css';

interface AuthorStats {
  chat_id: number;
  author: string;
  message_count: number;
  first_seen_at: string;
  last_seen_at: string;
  messages_7d: number;
  messages_30d: number;
}

interface AuthorProfile {
  id: number;
  chat_id: number;
  author: string;
  generated_at: string | null;
  generated_from_count: number | null;
  overall_sentiment: string | null;
  sentiment_score: number | null;
  loyalty_score: number | null;
  satisfaction_score: number | null;
  constructiveness_score: number | null;
  influence_score: number | null;
  escalation_score: number | null;
  bio: string | null;
  topics_of_interest: string[] | null;
  frequent_locations: string[] | null;
  notable_traits: string[] | null;
  profile_snapshot: string | null;
  last_processed_message_date: string | null;
  total_processed_count: number | null;
  updated_at: string;
}

interface AuthorMessage {
  id: number;
  text: string | null;
  date: string;
  message_id: number;
  reply_to_id: number | null;
}

interface ChatRow {
  chat_id: number;
  title: string;
  type: string;
  username: string | null;
}

const SENTIMENT_LABEL: Record<string, string> = {
  positive: 'Позитивный',
  neutral:  'Нейтральный',
  negative: 'Негативный',
  mixed:    'Смешанный',
};

const SENTIMENT_TONE: Record<string, 'green' | 'yellow' | 'red'> = {
  positive: 'green',
  neutral:  'yellow',
  negative: 'red',
  mixed:    'yellow',
};

type AxisKey = 'loyalty' | 'satisfaction' | 'constructiveness' | 'influence' | 'escalation';

interface AxisDef {
  key: AxisKey;
  field: keyof AuthorProfile;
  short: string;       // для радара
  label: string;       // полная подпись
  hint: string;
}

const AXES: AxisDef[] = [
  { key: 'loyalty',         field: 'loyalty_score',         short: 'Лояльность',      label: 'Лояльность к власти',   hint: '0 = оппозиция, 100 = поддержка' },
  { key: 'satisfaction',    field: 'satisfaction_score',    short: 'Удовлетворённость', label: 'Удовлетворённость средой', hint: '0 = всё плохо, 100 = доволен' },
  { key: 'constructiveness', field: 'constructiveness_score', short: 'Конструктивность', label: 'Конструктивность',      hint: '0 = токсичен, 100 = предлагает решения' },
  { key: 'influence',       field: 'influence_score',       short: 'Влиятельность',   label: 'Влиятельность',         hint: '0 = незаметен, 100 = лидер мнений' },
  { key: 'escalation',      field: 'escalation_score',      short: 'Эскалационность', label: 'Эскалационность',       hint: '0 = спокоен, 100 = призывает к действию' },
];

function axisColor(v: number): string {
  if (v >= 60) return '#16a34a';
  if (v >= 40) return '#d97706';
  return '#dc2626';
}

export function AuthorProfile() {
  const { chatId: chatIdStr, author: authorEncoded } = useParams<{ chatId: string; author: string }>();
  const navigate = useNavigate();
  const chatId = Number(chatIdStr);
  const author = useMemo(() => decodeURIComponent(authorEncoded || ''), [authorEncoded]);

  const [chat, setChat] = useState<ChatRow | null>(null);
  const [stats, setStats] = useState<AuthorStats | null>(null);
  const [profile, setProfile] = useState<AuthorProfile | null>(null);
  const [messages, setMessages] = useState<AuthorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    const [chatRes, statsRes, profileRes, msgsRes] = await Promise.all([
      supabase.from('tg_chats').select('chat_id, title, type, username').eq('chat_id', chatId).maybeSingle(),
      supabase.from('tg_author_stats').select('*').eq('chat_id', chatId).eq('author', author).maybeSingle(),
      supabase.from('tg_author_profiles').select('*').eq('chat_id', chatId).eq('author', author).maybeSingle(),
      supabase
        .from('tg_messages')
        .select('id, text, date, message_id, reply_to_id')
        .eq('chat_id', chatId)
        .eq('sender_name', author)
        .order('date', { ascending: false })
        .limit(100),
    ]);
    if (chatRes.error) setError(chatRes.error.message);
    setChat(chatRes.data as ChatRow | null);
    setStats(statsRes.data as AuthorStats | null);
    setProfile(profileRes.data as AuthorProfile | null);
    setMessages((msgsRes.data || []) as AuthorMessage[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!chatId || !author) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, author]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('analyze-author', {
        body: { chat_id: chatId, author, batch_size: 100 },
      });
      if (fnErr) {
        // supabase-js wraps non-2xx into a generic "Edge Function returned a
        // non-2xx status code" — pull the real body out of fnErr.context.
        let detail = fnErr.message;
        const ctx = (fnErr as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) detail = body.error;
          } catch { /* not JSON, keep original */ }
        }
        throw new Error(detail);
      }
      await loadAll();
      const resp = data as {
        reused?: boolean;
        incremental?: boolean;
        batch_processed?: number;
        total_processed_count?: number;
      } | null;
      if (resp?.reused) {
        alert('Новых сообщений с прошлого анализа не было — профиль не изменился.');
      } else if (resp?.incremental) {
        alert(`Профиль обновлён. Учтено новых сообщений: ${resp.batch_processed}. Всего в профиле: ${resp.total_processed_count}.`);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Translate the most common backend message into something operator-friendly.
      const friendly = /Not enough messages.*>=\s*(\d+)/i.exec(raw);
      const text = friendly
        ? `Слишком мало сообщений автора в этом чате (нужно минимум ${friendly[1]}). Подождите, пока он напишет ещё, или выберите чат, где он активнее.`
        : raw;
      alert(`Анализ не удался: ${text}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const axisValues = useMemo(() => {
    if (!profile) return null;
    return AXES.map(a => ({
      ...a,
      value: (profile[a.field] as number | null) ?? null,
    }));
  }, [profile]);

  const radarData = useMemo(() => {
    if (!axisValues) return [];
    return axisValues.map(a => ({
      subject: a.short,
      value: a.value ?? 0,
      displayValue: a.value == null ? '—' : String(a.value),
    }));
  }, [axisValues]);

  const hasAxes = axisValues ? axisValues.some(a => a.value != null) : false;

  if (loading) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Назад
        </button>
        <Skeleton variant="card" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <EmptyState title="Ошибка загрузки" description={error} />
      </div>
    );
  }

  if (!stats && messages.length === 0) {
    return (
      <div className={styles.page}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Назад
        </button>
        <EmptyState
          title="Автор не найден"
          description={`У ${author} нет сохранённых сообщений в этом чате`}
        />
      </div>
    );
  }

  const hasProfile = profile && profile.generated_at;
  const sentimentKey = profile?.overall_sentiment || '';
  const sentimentLabel = SENTIMENT_LABEL[sentimentKey];
  const sentimentTone = SENTIMENT_TONE[sentimentKey];

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => chat ? navigate(`/sources/${chat.chat_id ? '' : ''}`) : navigate(-1)}
      >
        <ArrowLeft size={14} /> {chat?.title ? `К ${chat.title}` : 'Назад'}
      </button>

      <Header
        title={author}
        subtitle={chat ? `в чате ${chat.title}` : 'Автор'}
      >
        {sentimentLabel && (
          <Badge status={sentimentTone || 'yellow'} label={sentimentLabel} size="md" />
        )}
        <button
          type="button"
          className={styles.analyzeBtn}
          onClick={runAnalysis}
          disabled={analyzing}
        >
          <Sparkles size={12} />
          {analyzing ? 'Анализируем…' : hasProfile ? 'Обновить анализ' : 'Проанализировать'}
        </button>
      </Header>

      {/* Base stats */}
      <div className={styles.detailKpiGrid}>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}><MessageSquare size={12} /> Всего сообщений</span>
          <span className={styles.detailKpiValue}>{formatNumber(stats?.message_count)}</span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>За 7 дней</span>
          <span className={styles.detailKpiValue}>{formatNumber(stats?.messages_7d)}</span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>За 30 дней</span>
          <span className={styles.detailKpiValue}>{formatNumber(stats?.messages_30d)}</span>
        </div>
        <div className={styles.detailKpi}>
          <span className={styles.detailKpiLabel}>Последнее</span>
          <span className={styles.detailKpiValue} style={{ fontSize: 14 }}>
            {relativeTime(stats?.last_seen_at || null)}
          </span>
        </div>
      </div>

      {/* Profile section */}
      {!hasProfile ? (
        <section className={styles.detailSection}>
          <div className={styles.detailSectionHead}>
            <span>Профиль и настрой</span>
          </div>
          <div className={styles.profileEmpty}>
            <User size={28} />
            <div>
              <div className={styles.profileEmptyTitle}>Профиль ещё не создан</div>
              <div className={styles.profileEmptyHint}>
                Нажмите «Проанализировать» — мы соберём последние 100 сообщений автора и прогоним
                через LLM для оценки по 5 осям, краткой биографии и ключевых тем.
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Hero card: bio + topics + meta */}
          <section className={styles.heroCard}>
            {profile!.bio && <div className={styles.heroBio}>{profile!.bio}</div>}
            {profile!.topics_of_interest && profile!.topics_of_interest.length > 0 && (
              <div className={styles.pillWrap}>
                {profile!.topics_of_interest.map(t => <Pill key={t}>{t}</Pill>)}
              </div>
            )}
            <div className={styles.heroMeta}>
              Оценка от {profile!.generated_at ? new Date(profile!.generated_at).toLocaleDateString('ru-RU') : '—'}
              {profile!.total_processed_count ? ` · ${profile!.total_processed_count} сообщений проанализировано` : ''}
              {profile!.generated_from_count ? ` (в последнем прогоне: ${profile!.generated_from_count})` : ''}
            </div>
          </section>

          {/* Two-column: radar + bars */}
          {hasAxes && (
            <div className={styles.axesGrid}>
              <div className={styles.axesCard}>
                <div className={styles.axesCardTitle}>Профиль пользователя</div>
                <Chart type="radar" data={radarData} xKey="subject" yKey="value" height={320} />
              </div>

              <div className={styles.axesCard}>
                <div className={styles.axesCardTitle}>Оценки по осям</div>
                <div className={styles.axisBars}>
                  {axisValues!.map(a => {
                    const v = a.value;
                    const color = v == null ? 'var(--text-tertiary)' : axisColor(v);
                    const fillPct = v == null ? 0 : v;
                    return (
                      <div key={a.key} className={styles.axisBar}>
                        <div className={styles.axisBarLabel}>{a.label}</div>
                        <div className={styles.axisBarValue} style={{ color }}>
                          {v == null ? '—' : v}
                        </div>
                        <div className={styles.axisBarTrack}>
                          <div
                            className={styles.axisBarFill}
                            style={{ width: `${fillPct}%`, background: color }}
                          />
                        </div>
                        <div className={styles.axisBarHint}>{a.hint}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Secondary details */}
          {((profile!.frequent_locations && profile!.frequent_locations.length > 0) ||
            (profile!.notable_traits && profile!.notable_traits.length > 0)) && (
            <div className={styles.profileGrid}>
              {profile!.frequent_locations && profile!.frequent_locations.length > 0 && (
                <div className={`${styles.profileCard} ${styles.profileCardWide}`}>
                  <span className={styles.profileCardLabel}><MapPin size={12} /> Локации</span>
                  <div className={styles.pillWrap}>
                    {profile!.frequent_locations.map(l => <Pill key={l}>{l}</Pill>)}
                  </div>
                </div>
              )}
              {profile!.notable_traits && profile!.notable_traits.length > 0 && (
                <div className={`${styles.profileCard} ${styles.profileCardWide}`}>
                  <span className={styles.profileCardLabel}><Tag size={12} /> Характерные черты</span>
                  <div className={styles.pillWrap}>
                    {profile!.notable_traits.map(t => <Pill key={t}>{t}</Pill>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Last 100 messages */}
      <section className={styles.detailSection}>
        <div className={styles.detailSectionHead}>
          <span>Последние 100 сообщений</span>
          <span className={styles.detailSectionHint}>{messages.length}</span>
        </div>
        {messages.length === 0 ? (
          <div className={styles.detailEmpty}>Нет сохранённых сообщений</div>
        ) : (
          <ul className={styles.messageList}>
            {messages.map(m => (
              <li key={m.id} className={styles.messageRow}>
                <div className={styles.messageMeta}>
                  <span className={styles.messageTime}>{relativeTime(m.date)}</span>
                  <span className={styles.messageTime}>· {new Date(m.date).toLocaleString('ru-RU')}</span>
                </div>
                <div className={styles.messageText}>{m.text || '—'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default AuthorProfile;
