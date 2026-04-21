import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Clock, Check, EyeOff, Play, CheckCircle2, Copy, ExternalLink, MapPin } from 'lucide-react';
import { Card, Header, EmptyState, Pill, ScoreCircle, Skeleton, KpiCard, Badge, SlideOver } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import { copyToClipboard } from '../../shared/utils/kpi-helpers';
import styles from './Octobot.module.css';

/** Convert a Telegram chat_id (-100XXXXXXXXXX) to t.me/c/{stripped}/{msg_id} link. */
function tgMessageLink(chatId: number, messageId: number): string {
  const raw = Math.abs(chatId);
  const stripped = raw > 1_000_000_000_000 ? raw - 1_000_000_000_000 : raw;
  return `https://t.me/c/${stripped}/${messageId}`;
}

/** Format an incident as a copyable Telegram card. */
function formatTelegramCard(i: Incident, confirmations: Confirmation[]): string {
  const emoji = i.priority >= 9 ? '🆘🆘' : i.priority >= 7 ? '🆘' : i.priority >= 5 ? '🟡' : '🟢';
  const lines = [
    `${emoji} Инцидент INC-${String(i.id).padStart(5, '0')} · приоритет ${i.priority}/10`,
    '',
    `📋 ${i.topic.toUpperCase()}`,
  ];
  if (i.address) lines.push(`📍 ${i.address}`);
  lines.push('', i.summary, '');
  lines.push(`⚠️ Эскалация: ${ESCALATE_LABELS[i.escalate_to]}`);
  if (i.first_author) lines.push(`👤 Первое сообщение от: ${i.first_author}`);
  if (confirmations.length > 0) {
    lines.push(`✅ Подтверждений: ${confirmations.length} (${confirmations.map(c => c.author || 'аноним').slice(0, 5).join(', ')}${confirmations.length > 5 ? '…' : ''})`);
  }
  lines.push(`🕒 Создан: ${new Date(i.created_at).toLocaleString('ru-RU')}`);
  return lines.join('\n');
}

type IncidentStatus = 'open' | 'in_progress' | 'watching' | 'resolved' | 'stale' | 'dismissed';
type EscalateTo = 'emergency' | 'head' | 'department' | 'log_only';

interface Incident {
  id: number;
  topic: string;
  address: string | null;
  summary: string;
  priority: number;
  escalate_to: EscalateTo;
  status: IncidentStatus;
  first_author: string | null;
  created_at: string;
  updated_at: string;
  confirmations_count: number;
  last_confirmation_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

type StatusFilter = 'active' | 'resolved' | 'dismissed' | 'stale' | 'all';

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'Активные',
  resolved: 'Закрытые',
  dismissed: 'Пропущенные',
  stale: 'Устаревшие',
  all: 'Все',
};

const ACTIVE_STATUSES: IncidentStatus[] = ['open', 'in_progress', 'watching'];

const ESCALATE_LABELS: Record<EscalateTo, string> = {
  emergency: 'ЧС',
  head: 'Руководителю',
  department: 'Отделу',
  log_only: 'Лог',
};

const STATUS_BADGE: Record<IncidentStatus, { label: string; tone: 'green' | 'yellow' | 'red' } | null> = {
  open: null,
  in_progress: { label: 'В работе', tone: 'yellow' },
  watching: { label: 'На контроле', tone: 'yellow' },
  resolved: { label: 'Закрыт', tone: 'green' },
  dismissed: { label: 'Пропущено', tone: 'green' },
  stale: { label: 'Устарел', tone: 'green' },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'сейчас';
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн назад`;
}

export function Octobot() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('octobot_incidents_feed')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setError(error.message);
    else {
      setIncidents((data || []) as Incident[]);
      setError(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await reload();
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reload]);

  // Optimistic status transition
  const updateStatus = useCallback(async (id: number, nextStatus: IncidentStatus, actor: string | null) => {
    setBusyId(id);
    // Optimistic local update
    setIncidents(prev => prev.map(i => i.id === id ? { ...i, status: nextStatus } : i));

    const patch: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'in_progress' || nextStatus === 'watching') {
      patch.assigned_to = actor ?? null;
      patch.assigned_at = new Date().toISOString();
    }
    if (nextStatus === 'dismissed') {
      patch.dismissed_by = actor ?? null;
      patch.dismissed_at = new Date().toISOString();
    }
    if (nextStatus === 'resolved') {
      patch.resolved_by = actor ?? null;
      patch.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('octobot_incidents')
      .update(patch)
      .eq('id', id);

    if (error) {
      // rollback
      setError(error.message);
      await reload();
    }
    setBusyId(null);
  }, [reload]);

  const stats = useMemo(() => {
    const active = incidents.filter(i => ACTIVE_STATUSES.includes(i.status));
    const escalated = active.filter(i => i.escalate_to === 'head' || i.escalate_to === 'emergency');
    const resolved = incidents.filter(i => i.status === 'resolved');
    const totalConfirmations = incidents.reduce((s, i) => s + (i.confirmations_count || 0), 0);
    return {
      total: incidents.length,
      active: active.length,
      escalated: escalated.length,
      resolved: resolved.length,
      totalConfirmations,
    };
  }, [incidents]);

  const filtered = useMemo(() => {
    switch (statusFilter) {
      case 'active':    return incidents.filter(i => ACTIVE_STATUSES.includes(i.status));
      case 'resolved':  return incidents.filter(i => i.status === 'resolved');
      case 'dismissed': return incidents.filter(i => i.status === 'dismissed');
      case 'stale':     return incidents.filter(i => i.status === 'stale');
      case 'all':       return incidents;
    }
  }, [incidents, statusFilter]);

  const counts = useMemo(() => ({
    active: incidents.filter(i => ACTIVE_STATUSES.includes(i.status)).length,
    resolved: incidents.filter(i => i.status === 'resolved').length,
    dismissed: incidents.filter(i => i.status === 'dismissed').length,
    stale: incidents.filter(i => i.status === 'stale').length,
    all: incidents.length,
  }), [incidents]);

  return (
    <div className={styles.page}>
      <Header
        title="Octobot"
        subtitle="Авто-модератор городских чатов: дедупликация, классификация, эскалация"
      />

      <div className={styles.kpiRow}>
        <KpiCard
          label="Активных"
          value={String(stats.active)}
          target={0}
          unit=""
          trend="flat"
          status={stats.active === 0 ? 'green' : stats.active < 5 ? 'yellow' : 'red'}
          progress={Math.min(100, stats.active * 10)}
          targetLabel={`${stats.escalated} у руководства`}
        />
        <KpiCard
          label="Подтверждений"
          value={String(stats.totalConfirmations)}
          target={0}
          unit=""
          trend="flat"
          status="green"
          progress={100}
          targetLabel="жителей подписалось под инцидентами"
        />
        <KpiCard
          label="Закрыто"
          value={String(stats.resolved)}
          target={0}
          unit=""
          trend="flat"
          status="green"
          progress={stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0}
          targetLabel="всего за период"
        />
      </div>

      <Card>
        <div className={styles.filterRow}>
          {(['active', 'resolved', 'dismissed', 'stale', 'all'] as StatusFilter[]).map(s => (
            <Pill
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              count={counts[s]}
            >
              {STATUS_LABELS[s]}
            </Pill>
          ))}
        </div>

        {isLoading ? (
          <div className={styles.skelList}>
            {[1, 2, 3].map(i => <Skeleton key={i} variant="card" height={72} />)}
          </div>
        ) : error ? (
          <EmptyState
            icon={<Bot size={24} />}
            title="Не удалось загрузить инциденты"
            description={error}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Bot size={24} />}
            title="Инцидентов пока нет"
            description={
              statusFilter === 'active'
                ? 'Активных инцидентов нет. Либо все разобраны, либо в чатах пока тихо.'
                : 'Нет записей в этой категории.'
            }
          />
        ) : (
          <div className={styles.list}>
            {filtered.map(i => (
              <IncidentRow
                key={i.id}
                incident={i}
                busy={busyId === i.id}
                onTransition={(s) => updateStatus(i.id, s, null)}
                onOpen={() => setSelectedId(i.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <SlideOver
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={selectedId !== null ? `INC-${String(selectedId).padStart(5, '0')}` : ''}
      >
        {selectedId !== null && (
          <IncidentDetail
            incident={incidents.find(i => i.id === selectedId) || null}
            onTransition={(s) => {
              updateStatus(selectedId, s, null);
              // Leave panel open so the new status/badge is visible
            }}
            busy={busyId === selectedId}
          />
        )}
      </SlideOver>
    </div>
  );
}

interface RowProps {
  incident: Incident;
  busy: boolean;
  onTransition: (next: IncidentStatus) => void;
  onOpen: () => void;
}

function IncidentRow({ incident: i, busy, onTransition, onOpen }: RowProps) {
  const dimmed = i.status === 'dismissed' || i.status === 'stale';
  const badge = STATUS_BADGE[i.status];

  return (
    <div
      className={`${styles.incidentRow} ${dimmed ? styles.incidentDimmed : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <ScoreCircle score={i.priority} />
      <div className={styles.incidentBody}>
        <div className={styles.incidentTitle}>
          <span className={styles.incidentTopic}>{i.topic}</span>
          {i.address && (
            <>
              <span className={styles.incidentDot}>·</span>
              <span className={styles.incidentAddress}>{i.address}</span>
            </>
          )}
          <Badge
            status={i.escalate_to === 'emergency' || i.escalate_to === 'head' ? 'red' : i.escalate_to === 'department' ? 'yellow' : 'green'}
            label={ESCALATE_LABELS[i.escalate_to]}
            size="sm"
          />
          {badge && <Badge status={badge.tone} label={badge.label} size="sm" />}
        </div>
        <div className={styles.incidentSummary}>{i.summary}</div>
        <div className={styles.incidentMeta}>
          <span className={styles.incidentTime}>
            <Clock size={12} />
            {relativeTime(i.created_at)}
          </span>
          {i.confirmations_count > 0 && (
            <span className={styles.incidentConfirmations}>
              {i.confirmations_count} подтв.
            </span>
          )}
          {i.first_author && (
            <span className={styles.incidentAuthor}>от {i.first_author}</span>
          )}
          {i.assigned_to && (
            <span className={styles.incidentAuthor}>взял: {i.assigned_to}</span>
          )}
        </div>
      </div>

      {/* Actions — only when actionable. stopPropagation so click doesn't open panel. */}
      {ACTIVE_STATUSES.includes(i.status) && (
        <div className={styles.incidentActions} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy || i.status === 'in_progress'}
            onClick={() => onTransition('in_progress')}
            title="Взять в работу"
          >
            <Play size={13} />
            <span>В работе</span>
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy || i.status === 'watching'}
            onClick={() => onTransition('watching')}
            title="Поставить на контроль"
          >
            <Check size={13} />
            <span>На контроле</span>
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionDismiss}`}
            disabled={busy}
            onClick={() => onTransition('dismissed')}
            title="Пропустить — больше не подсвечивать"
          >
            <EyeOff size={13} />
            <span>Пропустить</span>
          </button>
        </div>
      )}
    </div>
  );
}


/* ============================ Detail slide-over ============================ */

interface Confirmation {
  id: number;
  author: string | null;
  message_text: string | null;
  similarity: number | null;
  matched_by: string;
  created_at: string;
}

interface RawMessageRef {
  id: number;
  chat_id: number;
  message_id: number;
  author: string | null;
  text: string | null;
  verdict: string | null;
  processed_at: string;
}

function IncidentDetail({
  incident: i,
  busy,
  onTransition,
}: {
  incident: Incident | null;
  busy: boolean;
  onTransition: (next: IncidentStatus) => void;
}) {
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [messages, setMessages] = useState<RawMessageRef[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!i) return;
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      const [confRes, msgRes] = await Promise.all([
        supabase
          .from('octobot_confirmations')
          .select('id, author, message_text, similarity, matched_by, created_at')
          .eq('incident_id', i.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('octobot_messages')
          .select('id, chat_id, message_id, author, text, verdict, processed_at')
          .eq('incident_id', i.id)
          .order('processed_at', { ascending: true })
          .limit(50),
      ]);
      if (!cancelled) {
        setConfirmations((confRes.data || []) as Confirmation[]);
        setMessages((msgRes.data || []) as RawMessageRef[]);
        setLoadingDetail(false);
      }
    })();
    return () => { cancelled = true; };
  }, [i]);

  if (!i) return null;
  const badge = STATUS_BADGE[i.status];

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <ScoreCircle score={i.priority} size={48} />
        <div className={styles.detailHeaderBody}>
          <div className={styles.detailTopic}>{i.topic}</div>
          {i.address && (
            <div className={styles.detailAddress}>
              <MapPin size={13} /> {i.address}
            </div>
          )}
          <div className={styles.detailBadges}>
            <Badge
              status={i.escalate_to === 'emergency' || i.escalate_to === 'head' ? 'red' : i.escalate_to === 'department' ? 'yellow' : 'green'}
              label={ESCALATE_LABELS[i.escalate_to]}
              size="sm"
            />
            {badge && <Badge status={badge.tone} label={badge.label} size="sm" />}
          </div>
        </div>
        <button
          type="button"
          className={styles.detailCopyBtn}
          onClick={() => {
            copyToClipboard(formatTelegramCard(i, confirmations));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          title="Скопировать как карточку для Telegram"
        >
          <Copy size={14} /> {copied ? 'Скопировано' : 'В Telegram'}
        </button>
      </div>

      <section className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Описание</h4>
        <p className={styles.detailSummary}>{i.summary}</p>
      </section>

      <section className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>История</h4>
        <dl className={styles.detailMeta}>
          <dt>Создан</dt>
          <dd>{new Date(i.created_at).toLocaleString('ru-RU')}</dd>
          {i.first_author && (<><dt>Автор</dt><dd>{i.first_author}</dd></>)}
          {i.assigned_to && (
            <>
              <dt>Взят в работу</dt>
              <dd>{i.assigned_to}{i.assigned_at ? ` · ${new Date(i.assigned_at).toLocaleString('ru-RU')}` : ''}</dd>
            </>
          )}
          {i.resolved_at && (
            <>
              <dt>Закрыт</dt>
              <dd>{new Date(i.resolved_at).toLocaleString('ru-RU')}</dd>
            </>
          )}
          {i.dismissed_at && (
            <>
              <dt>Пропущен</dt>
              <dd>{new Date(i.dismissed_at).toLocaleString('ru-RU')}</dd>
            </>
          )}
          <dt>Приоритет</dt>
          <dd>{i.priority}/10 → {ESCALATE_LABELS[i.escalate_to]}</dd>
        </dl>
      </section>

      <section className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>
          Подтверждения <span className={styles.countBadge}>{confirmations.length}</span>
        </h4>
        {loadingDetail ? (
          <Skeleton variant="card" height={60} />
        ) : confirmations.length === 0 ? (
          <div className={styles.detailEmpty}>Пока никто не подтверждал эту проблему.</div>
        ) : (
          <ul className={styles.confirmationList}>
            {confirmations.map(c => (
              <li key={c.id} className={styles.confirmationItem}>
                <div className={styles.confirmationHead}>
                  <strong>{c.author || 'аноним'}</strong>
                  <span className={styles.confirmationMeta}>
                    {new Date(c.created_at).toLocaleString('ru-RU')}
                    {c.similarity != null && <> · sim {c.similarity.toFixed(2)}</>}
                    <> · {c.matched_by}</>
                  </span>
                </div>
                {c.message_text && <div className={styles.confirmationText}>{c.message_text}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {messages.length > 0 && (
        <section className={styles.detailSection}>
          <h4 className={styles.detailSectionTitle}>
            Исходные сообщения <span className={styles.countBadge}>{messages.length}</span>
          </h4>
          <ul className={styles.messageList}>
            {messages.map(m => (
              <li key={m.id} className={styles.messageItem}>
                <div className={styles.messageHead}>
                  <strong>{m.author || 'аноним'}</strong>
                  <span className={styles.messageMeta}>
                    {new Date(m.processed_at).toLocaleString('ru-RU')}
                    {m.verdict && <> · {m.verdict}</>}
                  </span>
                  <a
                    className={styles.messageLink}
                    href={tgMessageLink(m.chat_id, m.message_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Открыть в Telegram"
                  >
                    <ExternalLink size={12} /> Telegram
                  </a>
                </div>
                {m.text && <div className={styles.messageText}>{m.text}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions at footer */}
      <div className={styles.detailFooter}>
        {ACTIVE_STATUSES.includes(i.status) ? (
          <>
            <button
              type="button"
              className={styles.detailActionBtn}
              disabled={busy || i.status === 'in_progress'}
              onClick={() => onTransition('in_progress')}
            >
              <Play size={14} /> В работе
            </button>
            <button
              type="button"
              className={styles.detailActionBtn}
              disabled={busy || i.status === 'watching'}
              onClick={() => onTransition('watching')}
            >
              <Check size={14} /> На контроле
            </button>
            <button
              type="button"
              className={`${styles.detailActionBtn} ${styles.detailActionResolve}`}
              disabled={busy}
              onClick={() => onTransition('resolved')}
            >
              <CheckCircle2 size={14} /> Закрыть
            </button>
            <button
              type="button"
              className={`${styles.detailActionBtn} ${styles.detailActionDismiss}`}
              disabled={busy}
              onClick={() => onTransition('dismissed')}
            >
              <EyeOff size={14} /> Пропустить
            </button>
          </>
        ) : (
          <div className={styles.detailFooterInfo}>
            Инцидент в статусе «{badge?.label ?? i.status}». Действия недоступны.
          </div>
        )}
      </div>
    </div>
  );
}

export default Octobot;
