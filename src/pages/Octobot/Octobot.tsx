import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Clock, Check, EyeOff, Play } from 'lucide-react';
import { Card, Header, EmptyState, Pill, ScoreCircle, Skeleton, KpiCard, Badge } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import styles from './Octobot.module.css';

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
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

interface RowProps {
  incident: Incident;
  busy: boolean;
  onTransition: (next: IncidentStatus) => void;
}

function IncidentRow({ incident: i, busy, onTransition }: RowProps) {
  const dimmed = i.status === 'dismissed' || i.status === 'stale';
  const badge = STATUS_BADGE[i.status];

  return (
    <div className={`${styles.incidentRow} ${dimmed ? styles.incidentDimmed : ''}`}>
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

      {/* Actions — only when actionable */}
      {ACTIVE_STATUSES.includes(i.status) && (
        <div className={styles.incidentActions}>
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

export default Octobot;
