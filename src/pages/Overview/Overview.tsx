import { useMemo } from 'react';
import { Card, KpiCard, Chart, Badge, Skeleton, Header, DateRangePicker } from '../../shared/ui';
import { useKpiData, useDateRange } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import { getKpiStatus, getTrend, getTrendValue, getProgressToTarget } from '../../shared/utils/kpi-helpers';
import type { KpiDefinition, KpiDataPoint } from '../../shared/types';
import styles from './Overview.module.css';

/** Helper to read targets from definitions (flat fields) */
function getTargets(def: KpiDefinition) {
  return {
    d90: def.d90 ?? 0,
    d180: def.d180 ?? 0,
    d360: def.d360 ?? 0,
    base: def.base ?? 0,
  };
}

const TREND_KPIS = ['outsource_share', 'delayed_appeals', 'photo_fixation'];
const TREND_LABELS: Record<string, string> = {
  outsource_share: 'Аутсорс',
  delayed_appeals: 'Отложенные',
  photo_fixation: 'Фотофикс.',
};

export function Overview() {
  const { range, setRange } = useDateRange();
  const { data, definitions, isLoading } = useKpiData({
    dateFrom: range.from,
    dateTo: range.to,
  });

  // Latest data point per KPI (territory = 'total')
  const latestByKpi = useMemo(() => {
    const map = new Map<string, KpiDataPoint>();
    const totalData = data.filter((d) => d.territory === 'total');
    for (const point of totalData) {
      const existing = map.get(point.kpiId);
      if (!existing || point.date > existing.date) {
        map.set(point.kpiId, point);
      }
    }
    return map;
  }, [data]);

  // Data points per KPI for trend calculation
  const dataByKpi = useMemo(() => {
    const map = new Map<string, KpiDataPoint[]>();
    const totalData = data.filter((d) => d.territory === 'total');
    for (const point of totalData) {
      if (!map.has(point.kpiId)) map.set(point.kpiId, []);
      map.get(point.kpiId)!.push(point);
    }
    // Sort each by date
    for (const [, arr] of map) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [data]);

  // Line chart data: trends of key KPIs over time
  const trendChartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const kpiId of TREND_KPIS) {
      const points = dataByKpi.get(kpiId) ?? [];
      for (const p of points) {
        if (!dateMap.has(p.date)) dateMap.set(p.date, { date: formatDate(p.date) });
        dateMap.get(p.date)![TREND_LABELS[kpiId]] = p.value;
      }
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [dataByKpi]);

  // Radar chart data: current values vs d90 targets (normalized 0-100)
  const radarData = useMemo(() => {
    return definitions.map((def) => {
      const targets = getTargets(def);
      const latest = latestByKpi.get(def.id);
      const value = latest?.value ?? def.current ?? 0;
      const target = targets.d90;
      let normalized: number;
      if (target === 0) {
        normalized = value === 0 ? 100 : 50;
      } else if (def.direction === 'lower') {
        // Lower is better: if value <= target, 100; scale down as value exceeds target
        normalized = Math.max(0, Math.min(100, (target / Math.max(value, 0.01)) * 100));
      } else {
        normalized = Math.max(0, Math.min(100, (value / target) * 100));
      }
      return {
        subject: def.name.length > 18 ? def.name.slice(0, 16) + '...' : def.name,
        value: Math.round(normalized),
      };
    });
  }, [definitions, latestByKpi]);

  // Escalation: KPIs in yellow/red status
  const escalations = useMemo(() => {
    return definitions
      .map((def) => {
        const targets = getTargets(def);
        const latest = latestByKpi.get(def.id);
        const value = latest?.value ?? def.current ?? 0;
        const status = getKpiStatus(value, targets.d90, def.direction);
        return { def, value, target: targets.d90, status };
      })
      .filter((e) => e.status === 'yellow' || e.status === 'red')
      .sort((a, b) => (a.status === 'red' ? -1 : 1) - (b.status === 'red' ? -1 : 1));
  }, [definitions, latestByKpi]);

  // Recent events: last 10 data point changes sorted by date desc
  const recentEvents = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 10);
  }, [data]);

  // KPI name lookup
  const kpiNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const def of definitions) map.set(def.id, def.name);
    return map;
  }, [definitions]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="KPI Dashboard МБУ МТХ" subtitle="Развитие сельских территорий г.о. Мытищи" />
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} variant="card" height={180} />
          ))}
        </div>
        <div className={styles.chartsRow}>
          <Skeleton variant="chart" height={300} />
          <Skeleton variant="chart" height={300} />
        </div>
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className={styles.page}>
        <Header title="KPI Dashboard МБУ МТХ" subtitle="Развитие сельских территорий г.о. Мытищи" />
        <div className={styles.emptyMessage}>Нет данных для отображения</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="KPI Dashboard МБУ МТХ" subtitle="Развитие сельских территорий г.о. Мытищи">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* KPI Cards Grid */}
      <div className={styles.kpiGrid}>
        {definitions.map((def) => {
          const targets = getTargets(def);
          const kpiPoints = dataByKpi.get(def.id) ?? [];
          const latest = latestByKpi.get(def.id);
          const value = latest?.value ?? def.current ?? 0;
          const status = getKpiStatus(value, targets.d90, def.direction);
          const trend = getTrend(kpiPoints);
          const trendValue = getTrendValue(kpiPoints);
          const progress = getProgressToTarget(value, targets.base, targets.d90);

          const formattedValue = def.unit === '%' || def.unit === '%/кв'
            ? formatPercent(value)
            : formatNumber(value);

          return (
            <KpiCard
              key={def.id}
              label={def.name}
              value={formattedValue}
              target={targets.d90}
              unit={def.unit}
              trend={trend}
              trendValue={Math.round(trendValue * 10) / 10}
              status={status}
              progress={progress}
            />
          );
        })}
      </div>

      {/* Charts Row */}
      <div className={styles.chartsRow}>
        <Card>
          <Chart
            type="line"
            data={trendChartData}
            xKey="date"
            yKey={TREND_KPIS.map((id) => TREND_LABELS[id])}
            title="Динамика ключевых KPI"
            height={320}
          />
        </Card>
        <Card>
          <Chart
            type="radar"
            data={radarData}
            xKey="subject"
            yKey="value"
            title="Достижение целей (D90), %"
            height={320}
          />
        </Card>
      </div>

      {/* Escalation + Events Row */}
      <div className={styles.sectionsRow}>
        <Card>
          <h3 className={styles.sectionTitle}>Эскалация</h3>
          {escalations.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              Все показатели в норме
            </p>
          ) : (
            <div className={styles.escalationList}>
              {escalations.map((esc) => (
                <div
                  key={esc.def.id}
                  className={`${styles.escalationItem} ${styles[esc.status]}`}
                >
                  <span className={styles.escalationName}>{esc.def.name}</span>
                  <div className={styles.escalationValues}>
                    <span>
                      Факт: <strong>{formatNumber(esc.value, 1)}</strong> {esc.def.unit}
                    </span>
                    <span>
                      Цель: <strong>{formatNumber(esc.target, 1)}</strong> {esc.def.unit}
                    </span>
                    <Badge status={esc.status} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className={styles.sectionTitle}>Последние изменения</h3>
          {recentEvents.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              Нет записей
            </p>
          ) : (
            <div className={styles.eventsList}>
              {recentEvents.map((evt, i) => (
                <div key={`${evt.kpiId}-${evt.date}-${i}`} className={styles.eventItem}>
                  <span className={styles.eventDate}>{formatDate(evt.date)}</span>
                  <span className={styles.eventKpi}>
                    {kpiNameMap.get(evt.kpiId) ?? evt.kpiId}
                  </span>
                  <span className={styles.eventValue}>{formatNumber(evt.value, 1)}</span>
                  {evt.note && <span className={styles.eventNote}>{evt.note}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default Overview;
