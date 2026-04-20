import { useEffect, useMemo, useState } from 'react';
import { Bot, Clock } from 'lucide-react';
import { Card, Header, EmptyState, Pill, ScoreCircle, Skeleton, KpiCard, Badge } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import styles from './Octobot.module.css';

type IncidentStatus = 'open' | 'resolved' | 'stale' | 'dismissed';
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
}

type StatusFilter = 'open' | 'resolved' | 'stale' | 'all';

const STATUS_LABELS: Record<StatusFilter, string> = {
  open: 'Открытые',
  resolved: 'Закрытые',
  stale: 'Устаревшие',
  all: 'Все',
};

const ESCALATE_LABELS: Record<EscalateTo, string> = {
  emergency: 'ЧС',
  head: 'Руководителю',
  department: 'Отделу',
  log_only: 'Лог',
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('octobot_incidents_feed')
        .select('*')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) setError(error.message);
      else setIncidents((data || []) as Incident[]);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const open = incidents.filter(i => i.status === 'open');
    const escalated = open.filter(i => i.escalate_to === 'head' || i.escalate_to === 'emergency');
    const resolved = incidents.filter(i => i.status === 'resolved');
    const totalConfirmations = incidents.reduce((s, i) => s + (i.confirmations_count || 0), 0);
    return {
      total: incidents.length,
      open: open.length,
      escalated: escalated.length,
      resolved: resolved.length,
      totalConfirmations,
    };
  }, [incidents]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return incidents;
    return incidents.filter(i => i.status === statusFilter);
  }, [incidents, statusFilter]);

  const counts = useMemo(() => ({
    open: incidents.filter(i => i.status === 'open').length,
    resolved: incidents.filter(i => i.status === 'resolved').length,
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
          label="Открытых"
          value={String(stats.open)}
          target={0}
          unit=""
          trend="flat"
          status={stats.open === 0 ? 'green' : stats.open < 5 ? 'yellow' : 'red'}
          progress={Math.min(100, stats.open * 10)}
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
          {(['open', 'resolved', 'stale', 'all'] as StatusFilter[]).map(s => (
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
              statusFilter === 'open'
                ? 'Pipeline бота ещё не запущен, либо в чатах не было проблемных сообщений за последние 7 дней.'
                : 'Нет записей в этой категории.'
            }
          />
        ) : (
          <div className={styles.list}>
            {filtered.map(i => <IncidentRow key={i.id} incident={i} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function IncidentRow({ incident: i }: { incident: Incident }) {
  return (
    <div className={styles.incidentRow}>
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
        </div>
      </div>
    </div>
  );
}

export default Octobot;
