import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from 'recharts';
import { Card, KpiCard, DataTable, Badge, Skeleton, Header, DateRangePicker } from '../../shared/ui';
import type { Column } from '../../shared/ui';
import { useKpiData, useDateRange } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import { getKpiStatus, getTrend, getTrendValue, getProgressToTarget } from '../../shared/utils/kpi-helpers';
import type { KpiDefinition } from '../../shared/types';
import styles from './KpiDetail.module.css';

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  quarterly: 'Ежеквартально',
};

/** Helper to read targets from definitions -- handles both flat and nested shapes */
function getTargets(def: KpiDefinition) {
  return {
    d90: def.d90 ?? 0,
    d180: def.d180 ?? 0,
    d360: def.d360 ?? 0,
    base: def.base ?? 0,
  };
}

const TERRITORY_LABELS: Record<string, string> = {
  total: 'Общая',
  pirogovsky: 'Пироговский',
  fedoskino: 'Федоскино',
};

export function KpiDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange } = useDateRange();
  const { data, definitions, isLoading } = useKpiData({
    dateFrom: range.from,
    dateTo: range.to,
  });
  const [comment, setComment] = useState('');

  const selectedId = searchParams.get('id') ?? definitions[0]?.id ?? '';

  const selectKpi = useCallback(
    (id: string) => {
      setSearchParams({ id });
    },
    [setSearchParams],
  );

  const selectedDef = useMemo(
    () => definitions.find((d) => d.id === selectedId),
    [definitions, selectedId],
  );

  // All data points for selected KPI (territory=total)
  const kpiPoints = useMemo(() => {
    return data
      .filter((d) => d.kpiId === selectedId && d.territory === 'total')
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedId]);

  // All data points for selected KPI (all territories, for table)
  const allKpiPoints = useMemo(() => {
    return data
      .filter((d) => d.kpiId === selectedId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data, selectedId]);

  // Chart data
  const chartData = useMemo(() => {
    return kpiPoints.map((p) => ({
      date: formatDate(p.date),
      value: p.value,
    }));
  }, [kpiPoints]);

  // Latest value
  const latestValue = useMemo(() => {
    if (kpiPoints.length === 0) return 0;
    return kpiPoints[kpiPoints.length - 1].value;
  }, [kpiPoints]);

  // Table columns
  const tableColumns: Column<Record<string, unknown>>[] = useMemo(() => {
    return [
      {
        key: 'date',
        title: 'Дата',
        sortable: true,
        render: (val: unknown) => formatDate(String(val)),
      },
      {
        key: 'value',
        title: 'Значение',
        sortable: true,
        render: (val: unknown) => {
          if (!selectedDef) return String(val);
          const num = Number(val);
          return selectedDef.unit === '%' || selectedDef.unit === '%/кв'
            ? formatPercent(num)
            : formatNumber(num, 1);
        },
      },
      {
        key: 'territory',
        title: 'Территория',
        sortable: true,
        render: (val: unknown) => TERRITORY_LABELS[String(val)] ?? String(val),
      },
      {
        key: 'status',
        title: 'Статус',
        render: (val: unknown) => {
          const status = String(val) as 'green' | 'yellow' | 'red';
          const label = status === 'green' ? 'Норма' : status === 'yellow' ? 'Внимание' : 'Критично';
          return <Badge status={status} label={label} size="sm" />;
        },
      },
      {
        key: 'note',
        title: 'Примечание',
        render: (val: unknown) => String(val ?? '—'),
      },
    ];
  }, [selectedDef]);

  // Table data with computed status
  const tableData = useMemo(() => {
    if (!selectedDef) return [];
    const targets = getTargets(selectedDef);
    return allKpiPoints.map((p) => ({
      date: p.date,
      value: p.value,
      territory: p.territory ?? 'total',
      status: getKpiStatus(p.value, targets.d90, selectedDef.direction),
      note: p.note ?? '',
    }));
  }, [allKpiPoints, selectedDef]);

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Детализация KPI" subtitle="Подробный анализ показателя" />
        <div className={styles.skeletonStack}>
          <Skeleton variant="text" width="100%" height={48} />
          <Skeleton variant="card" height={180} />
          <Skeleton variant="chart" height={300} />
        </div>
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className={styles.page}>
        <Header title="Детализация KPI" subtitle="Подробный анализ показателя" />
        <div className={styles.emptyMessage}>Нет доступных KPI</div>
      </div>
    );
  }

  const targets = selectedDef ? getTargets(selectedDef) : { d90: 0, d180: 0, d360: 0, base: 0 };
  const status = selectedDef ? getKpiStatus(latestValue, targets.d90, selectedDef.direction) : 'green' as const;
  const trend = getTrend(kpiPoints);
  const trendValue = getTrendValue(kpiPoints);
  const progress = getProgressToTarget(latestValue, targets.base, targets.d90);

  const formattedValue = selectedDef
    ? selectedDef.unit === '%' || selectedDef.unit === '%/кв'
      ? formatPercent(latestValue)
      : formatNumber(latestValue, 1)
    : '0';

  return (
    <div className={styles.page}>
      <Header title="Детализация KPI" subtitle="Подробный анализ показателя">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* KPI Selector Tabs */}
      <div className={styles.kpiSelector}>
        {definitions.map((def) => (
          <button
            key={def.id}
            className={`${styles.kpiTab} ${def.id === selectedId ? styles.kpiTabActive : ''}`}
            onClick={() => selectKpi(def.id)}
            type="button"
          >
            {def.name}
          </button>
        ))}
      </div>

      {selectedDef && (
        <>
          {/* Top: KpiCard + Chart */}
          <div className={styles.detailGrid}>
            <KpiCard
              label={selectedDef.name}
              value={formattedValue}
              target={targets.d90}
              unit={selectedDef.unit}
              trend={trend}
              trendValue={Math.round(trendValue * 10) / 10}
              status={status}
              progress={progress}
            />

            <Card>
              <h3 className={styles.sectionTitle}>Динамика показателя</h3>
              {chartData.length === 0 ? (
                <div className={styles.emptyMessage}>Нет данных за выбранный период</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: 'var(--color-text-secondary, #6b7280)' }}
                      axisLine={{ stroke: 'var(--color-border, #e5e7eb)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: 'var(--color-text-secondary, #6b7280)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => v.toLocaleString('ru-RU')}
                    />
                    <RechartsTooltip
                      formatter={(value: any) => [Number(value).toLocaleString('ru-RU'), 'Значение']}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <ReferenceLine
                      y={targets.d90}
                      stroke="#DC2626"
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      label={{
                        value: `D90: ${targets.d90}`,
                        position: 'right',
                        fill: '#DC2626',
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-teal, #0d9488)"
                      fill="var(--color-teal, #0d9488)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Horizon Badges */}
          <Card>
            <h3 className={styles.sectionTitle}>Горизонты планирования</h3>
            <div className={styles.horizonBadges}>
              <span className={styles.horizonBadge}>
                <span className={styles.horizonLabel}>D90:</span>
                <span className={styles.horizonValue}>
                  {formatNumber(targets.d90, 1)} {selectedDef.unit}
                </span>
                <Badge status={getKpiStatus(latestValue, targets.d90, selectedDef.direction)} size="sm" />
              </span>
              <span className={styles.horizonBadge}>
                <span className={styles.horizonLabel}>D180:</span>
                <span className={styles.horizonValue}>
                  {formatNumber(targets.d180, 1)} {selectedDef.unit}
                </span>
                <Badge status={getKpiStatus(latestValue, targets.d180, selectedDef.direction)} size="sm" />
              </span>
              <span className={styles.horizonBadge}>
                <span className={styles.horizonLabel}>D360:</span>
                <span className={styles.horizonValue}>
                  {formatNumber(targets.d360, 1)} {selectedDef.unit}
                </span>
                <Badge status={getKpiStatus(latestValue, targets.d360, selectedDef.direction)} size="sm" />
              </span>
            </div>
          </Card>

          {/* Data Table */}
          <Card>
            <h3 className={styles.sectionTitle}>Данные по периодам</h3>
            {tableData.length === 0 ? (
              <div className={styles.emptyMessage}>Нет данных за выбранный период</div>
            ) : (
              <DataTable
                columns={tableColumns}
                data={tableData as unknown as Record<string, unknown>[]}
                pageSize={10}
                exportFilename={`kpi-${selectedId}`}
              />
            )}
          </Card>

          {/* Info Section */}
          <Card>
            <h3 className={styles.sectionTitle}>Информация о показателе</h3>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Формула</span>
                <span className={styles.infoValue}>{selectedDef.formula}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Источник данных</span>
                <span className={styles.infoValue}>{selectedDef.source}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Ответственный</span>
                <span className={styles.infoValue}>{selectedDef.responsible}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Частота обновления</span>
                <span className={styles.infoValue}>
                  {FREQUENCY_LABELS[selectedDef.frequency] ?? selectedDef.frequency}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Направление</span>
                <span className={styles.infoValue}>
                  {selectedDef.direction === 'lower' ? 'Чем ниже, тем лучше' : 'Чем выше, тем лучше'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Единица измерения</span>
                <span className={styles.infoValue}>{selectedDef.unit}</span>
              </div>
            </div>
          </Card>

          {/* Comments */}
          <Card>
            <div className={styles.commentSection}>
              <label className={styles.commentLabel} htmlFor="kpi-comment">
                Комментарии и заметки
              </label>
              <textarea
                id="kpi-comment"
                className={styles.commentArea}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Введите комментарий к показателю..."
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default KpiDetail;
