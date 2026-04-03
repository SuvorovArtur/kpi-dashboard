import { useState, useMemo, useCallback } from 'react';
import { Card, KpiCard, Chart, DataTable, Badge, Header, DateRangePicker, EmptyState, Skeleton } from '../../shared/ui';
import { useAppeals, useDateRange } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate, formatHours } from '../../shared/utils/formatters';
import type { Appeal } from '../../shared/types';
import type { Column } from '../../shared/ui/DataTable/DataTable';
import { territories, appealCategories } from '../../shared/config/kpi-config';
import styles from './Appeals.module.css';

const STATUS_LABELS: Record<Appeal['status'], string> = {
  new: 'Новое',
  in_progress: 'В работе',
  delayed: 'Отложено',
  resolved: 'Решено',
  repeated: 'Повторное',
};

const STATUS_COLORS: Record<Appeal['status'], 'green' | 'yellow' | 'red'> = {
  new: 'yellow',
  in_progress: 'yellow',
  delayed: 'red',
  resolved: 'green',
  repeated: 'red',
};

const ALL_STATUSES: Array<Appeal['status'] | 'all'> = ['all', 'new', 'in_progress', 'delayed', 'resolved', 'repeated'];

const STATUS_FILTER_LABELS: Record<string, string> = {
  all: 'Все',
  ...STATUS_LABELS,
};

const territoryNameMap = new Map<string, string>(territories.map((t) => [t.id, t.name]));

type AppealRow = Appeal & Record<string, unknown>;

export function Appeals() {
  const { range, setRange } = useDateRange();
  const [statusFilter, setStatusFilter] = useState<Appeal['status'] | 'all'>('all');
  const [territoryFilter, setTerritoryFilter] = useState<string | 'all'>('all');

  const { data, isLoading, error } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
    status: statusFilter === 'all' ? undefined : statusFilter,
    territory: territoryFilter === 'all' ? undefined : territoryFilter,
  });

  // All appeals (unfiltered by status/territory) for summary KPIs
  const { data: allData } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
  });

  // KPI calculations
  const kpis = useMemo(() => {
    if (allData.length === 0) return null;

    const totalCount = allData.length;

    const withResponseTime = allData.filter((a) => a.responseHours != null);
    const avgResponseHours =
      withResponseTime.length > 0
        ? withResponseTime.reduce((sum, a) => sum + (a.responseHours ?? 0), 0) / withResponseTime.length
        : 0;

    const delayedCount = allData.filter((a) => a.status === 'delayed').length;
    const delayedPercent = totalCount > 0 ? (delayedCount / totalCount) * 100 : 0;

    const withBothPhotos = allData.filter((a) => a.hasPhotoBefore && a.hasPhotoAfter).length;
    const photoPercent = totalCount > 0 ? (withBothPhotos / totalCount) * 100 : 0;

    return { totalCount, avgResponseHours, delayedPercent, photoPercent };
  }, [allData]);

  // Pie chart data: structure by category
  const categoryChartData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of appealCategories) {
      counts.set(cat, 0);
    }
    for (const appeal of data) {
      counts.set(appeal.category, (counts.get(appeal.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .map(([name, value]) => ({ name, value }));
  }, [data]);

  // Bar chart data: appeals by week, stacked by status
  const weeklyChartData = useMemo(() => {
    const weekMap = new Map<string, Record<string, unknown>>();
    for (const appeal of data) {
      const d = new Date(appeal.date);
      const dayOfWeek = d.getDay() || 7; // Monday = 1
      const monday = new Date(d);
      monday.setDate(d.getDate() - dayOfWeek + 1);
      const weekKey = monday.toISOString().slice(0, 10);

      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, {
          week: formatDate(weekKey),
          [STATUS_LABELS.new]: 0,
          [STATUS_LABELS.in_progress]: 0,
          [STATUS_LABELS.delayed]: 0,
          [STATUS_LABELS.resolved]: 0,
          [STATUS_LABELS.repeated]: 0,
        });
      }
      const entry = weekMap.get(weekKey)!;
      const label = STATUS_LABELS[appeal.status];
      entry[label] = (entry[label] as number) + 1;
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data]);

  // Table columns
  const columns: Column<AppealRow>[] = useMemo(
    () => [
      { key: 'id', title: 'ID', sortable: true },
      {
        key: 'date',
        title: 'Дата',
        sortable: true,
        render: (val) => formatDate(String(val)),
      },
      { key: 'category', title: 'Категория', sortable: true },
      {
        key: 'territory',
        title: 'Территория',
        sortable: true,
        render: (val) => territoryNameMap.get(String(val)) ?? String(val),
      },
      {
        key: 'status',
        title: 'Статус',
        sortable: true,
        render: (val) => {
          const status = val as Appeal['status'];
          return <Badge status={STATUS_COLORS[status]} label={STATUS_LABELS[status]} />;
        },
      },
      {
        key: 'responseHours',
        title: 'Время ответа',
        sortable: true,
        render: (val) => (val != null ? formatHours(val as number) : '\u2014'),
      },
      {
        key: 'hasPhotoBefore',
        title: 'Фото до',
        render: (val) => (val ? 'Да' : 'Нет'),
      },
      {
        key: 'hasPhotoAfter',
        title: 'Фото после',
        render: (val) => (val ? 'Да' : 'Нет'),
      },
      { key: 'source', title: 'Источник', sortable: true },
    ],
    [],
  );

  const handleStatusFilter = useCallback((status: Appeal['status'] | 'all') => {
    setStatusFilter(status);
  }, []);

  const handleTerritoryFilter = useCallback((territory: string) => {
    setTerritoryFilter(territory);
  }, []);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Обращения" />
        <div className={styles.kpiRow}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="card" height={160} />
          ))}
        </div>
        <div className={styles.chartsRow}>
          <Skeleton variant="chart" height={300} />
          <Skeleton variant="chart" height={300} />
        </div>
        <Skeleton variant="card" height={400} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Header title="Обращения" />
        <EmptyState title="Ошибка загрузки" description={error.message} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="Обращения">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* KPI Cards */}
      {kpis && (
        <div className={styles.kpiRow}>
          <KpiCard
            label="Всего обращений"
            value={formatNumber(kpis.totalCount)}
            target={0}
            unit="шт"
            trend="flat"
            status="green"
            progress={100}
            targetLabel={`За выбранный период`}
          />
          <KpiCard
            label="Среднее время ответа"
            value={formatHours(kpis.avgResponseHours)}
            target={24}
            unit="час"
            trend={kpis.avgResponseHours <= 24 ? 'down' : 'up'}
            status={kpis.avgResponseHours <= 24 ? 'green' : kpis.avgResponseHours <= 48 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((48 - kpis.avgResponseHours) / 48) * 100))}
            targetLabel={`Цель: 24 час`}
          />
          <KpiCard
            label="Отложенные обращения"
            value={formatPercent(kpis.delayedPercent)}
            target={10}
            unit="%"
            trend={kpis.delayedPercent <= 10 ? 'down' : 'up'}
            status={kpis.delayedPercent <= 10 ? 'green' : kpis.delayedPercent <= 20 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((30 - kpis.delayedPercent) / 30) * 100))}
            targetLabel={`Цель: <= 10%`}
          />
          <KpiCard
            label="Фотофиксация"
            value={formatPercent(kpis.photoPercent)}
            target={90}
            unit="%"
            trend={kpis.photoPercent >= 90 ? 'up' : 'down'}
            status={kpis.photoPercent >= 90 ? 'green' : kpis.photoPercent >= 70 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, (kpis.photoPercent / 100) * 100))}
            targetLabel={`Цель: >= 90%`}
          />
        </div>
      )}

      {/* Charts */}
      <div className={styles.chartsRow}>
        <Card>
          <Chart
            type="pie"
            data={categoryChartData}
            xKey="name"
            yKey="value"
            title="Структура по категориям"
            height={320}
          />
        </Card>
        <Card>
          <Chart
            type="bar"
            data={weeklyChartData}
            xKey="week"
            yKey={Object.values(STATUS_LABELS)}
            title="Обращения по неделям"
            height={320}
          />
        </Card>
      </div>

      {/* Filters and Table */}
      <Card>
        <h3 className={styles.sectionTitle}>Все обращения</h3>

        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Статус:</span>
            <div className={styles.filterButtons}>
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.filterBtn} ${statusFilter === s ? styles.filterBtnActive : ''}`}
                  onClick={() => handleStatusFilter(s)}
                >
                  {STATUS_FILTER_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Территория:</span>
            <div className={styles.filterButtons}>
              <button
                type="button"
                className={`${styles.filterBtn} ${territoryFilter === 'all' ? styles.filterBtnActive : ''}`}
                onClick={() => handleTerritoryFilter('all')}
              >
                Все
              </button>
              {territories.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.filterBtn} ${territoryFilter === t.id ? styles.filterBtnActive : ''}`}
                  onClick={() => handleTerritoryFilter(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <EmptyState
            title="Нет обращений"
            description="Для выбранных фильтров обращения не найдены"
          />
        ) : (
          <DataTable<AppealRow>
            columns={columns}
            data={data as AppealRow[]}
            pageSize={15}
            exportFilename="appeals"
          />
        )}
      </Card>
    </div>
  );
}

export default Appeals;
