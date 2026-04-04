import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
import { Card, KpiCard, DataTable, Badge, Skeleton, Header, DateRangePicker, Toast } from '../../shared/ui';
import type { Column } from '../../shared/ui';
import { useKpiData, useDateRange, useAppeals, useAppSettings } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import { getKpiStatus, getTrend, getTrendValue, getProgressToTarget } from '../../shared/utils/kpi-helpers';
import { supabase } from '../../shared/lib/supabase';
import type { KpiDefinition } from '../../shared/types';
import styles from './KpiDetail.module.css';

const AUTO_KPI_IDS = ['isn', 'appeals_per_1k', 'repeated_appeals', 'delayed_appeals'];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  quarterly: 'Ежеквартально',
};

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

const TERRITORY_OPTIONS = [
  { id: 'total', name: 'Общая территория' },
  { id: 'pirogovsky', name: 'Пироговский' },
  { id: 'fedoskino', name: 'Федоскино' },
];

export function KpiDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { range, setRange } = useDateRange({
    from: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })(),
    to: new Date().toISOString().slice(0, 10),
  });
  const { data, definitions, isLoading, refetch } = useKpiData({
    dateFrom: range.from,
    dateTo: range.to,
  });

  // Load appeals for auto-KPI calculation
  const { data: appeals } = useAppeals({ dateFrom: range.from, dateTo: range.to });
  const { getNumber } = useAppSettings();
  const population = getNumber('population') || 88876;
  const syncedRef = useRef(false);

  // Auto-sync: calculate KPI values from appeals as period aggregate (same as Overview)
  useEffect(() => {
    if (appeals.length === 0 || syncedRef.current) return;
    syncedRef.current = true;

    const total = appeals.length;
    const date = range.to; // use end of period as date

    // ISN — aggregate over entire period
    const withScore = appeals.filter(a => a.sentiment_score != null && !a.is_spam);
    let isnValue = 0;
    if (withScore.length > 0) {
      const sumS = withScore.reduce((s, a) => s + (a.sentiment_score ?? 0), 0);
      const sumSq = withScore.reduce((s, a) => s + (a.sentiment_score ?? 0) ** 2, 0);
      isnValue = Math.round((sumSq / sumS) * 10) / 10;
    }

    // Appeals per 1k — total for period
    const per1k = Math.round((total / (population / 1000)) * 10) / 10;

    // Repeated (hot addresses) — aggregate
    const vagueAddresses = ['Россия, Московская область, городской округ Мытищи', 'Россия, Московская область, Мытищи', 'городской округ Мытищи'];
    const addrKey = new Map<string, number>();
    let reps = 0;
    for (const a of appeals) {
      if (!a.address || vagueAddresses.includes(a.address)) continue;
      const k = `${a.address}__${a.direction}`;
      const c = (addrKey.get(k) ?? 0) + 1;
      addrKey.set(k, c);
      if (c > 1) reps++;
    }
    const repeatedPct = total > 0 ? Math.round((reps / total) * 100) : 0;

    // Delayed — aggregate
    const delayed = appeals.filter(a => a.status === 'Закрыта с отложенным').length;
    const delayedPct = total > 0 ? Math.round((delayed / total) * 1000) / 10 : 0;

    const rows = [
      { date, kpi_id: 'isn', value: isnValue, territory: 'total' },
      { date, kpi_id: 'appeals_per_1k', value: per1k, territory: 'total' },
      { date, kpi_id: 'repeated_appeals', value: repeatedPct, territory: 'total' },
      { date, kpi_id: 'delayed_appeals', value: delayedPct, territory: 'total' },
    ];

    supabase.from('kpi_values').upsert(rows, { onConflict: 'date,kpi_id,territory' }).then(() => refetch());
  }, [appeals, population, refetch]);

  // Reset sync flag when range changes
  useEffect(() => { syncedRef.current = false; }, [range.from, range.to]);

  // Add value form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addTerritory, setAddTerritory] = useState('total');
  const [addValue, setAddValue] = useState('');
  const [addNote, setAddNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const selectedId = searchParams.get('id') ?? (definitions.find(d => d.id === 'isn')?.id || definitions[0]?.id) ?? '';

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

  const kpiPoints = useMemo(() => {
    return data
      .filter((d) => d.kpiId === selectedId && d.territory === 'total')
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedId]);

  const allKpiPoints = useMemo(() => {
    return data
      .filter((d) => d.kpiId === selectedId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data, selectedId]);

  const chartData = useMemo(() => {
    return kpiPoints.map((p) => ({
      date: formatDate(p.date),
      value: p.value,
    }));
  }, [kpiPoints]);

  const latestValue = useMemo(() => {
    if (kpiPoints.length === 0) return 0;
    return kpiPoints[kpiPoints.length - 1].value;
  }, [kpiPoints]);

  // Save new value
  const handleAddValue = useCallback(async () => {
    if (!selectedId || !addValue) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('kpi_values').upsert(
        {
          date: addDate,
          kpi_id: selectedId,
          value: parseFloat(addValue),
          territory: addTerritory,
          note: addNote || null,
        },
        { onConflict: 'date,kpi_id,territory' },
      );
      if (error) throw error;
      setToast({ message: 'Значение сохранено', type: 'success' });
      setAddValue('');
      setAddNote('');
      setShowAddForm(false);
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [selectedId, addDate, addTerritory, addValue, addNote, refetch]);

  // Delete value
  const handleDeleteValue = useCallback(async (date: string, territory: string) => {
    try {
      const { error } = await supabase
        .from('kpi_values')
        .delete()
        .eq('date', date)
        .eq('kpi_id', selectedId)
        .eq('territory', territory);
      if (error) throw error;
      setToast({ message: 'Запись удалена', type: 'success' });
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка удаления: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [selectedId, refetch]);

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
      {
        key: '_actions',
        title: '',
        render: (_val: unknown, row: Record<string, unknown>) => (
          <button
            className={styles.deleteBtn}
            onClick={() => handleDeleteValue(String(row.date), String(row.territory))}
            title="Удалить"
          >
            &times;
          </button>
        ),
      },
    ];
  }, [selectedDef, handleDeleteValue]);

  const tableData = useMemo(() => {
    if (!selectedDef) return [];
    const targets = getTargets(selectedDef);
    return allKpiPoints.map((p) => ({
      date: p.date,
      value: p.value,
      territory: p.territory ?? 'total',
      status: getKpiStatus(p.value, targets.d90, selectedDef.direction),
      note: p.note ?? '',
      _actions: '',
    }));
  }, [allKpiPoints, selectedDef]);

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
        {[...definitions]
          .filter(d => AUTO_KPI_IDS.includes(d.id))
          .sort((a, b) => AUTO_KPI_IDS.indexOf(a.id) - AUTO_KPI_IDS.indexOf(b.id))
          .map((def) => (
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
                      formatter={(value: unknown) => [Number(value).toLocaleString('ru-RU'), 'Значение']}
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

          {/* Data Entry + Table */}
          <Card>
            <div className={styles.tableHeader}>
              <h3 className={styles.sectionTitle}>Данные по периодам</h3>
              <button
                className={styles.addBtn}
                onClick={() => setShowAddForm(!showAddForm)}
              >
                {showAddForm ? 'Отмена' : '+ Добавить значение'}
              </button>
            </div>

            {showAddForm && (
              <div className={styles.addForm}>
                <div className={styles.addFormRow}>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Дата</label>
                    <input
                      type="date"
                      className={styles.formInput}
                      value={addDate}
                      onChange={(e) => setAddDate(e.target.value)}
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Территория</label>
                    <select
                      className={styles.formInput}
                      value={addTerritory}
                      onChange={(e) => setAddTerritory(e.target.value)}
                    >
                      {TERRITORY_OPTIONS.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Значение ({selectedDef.unit})</label>
                    <input
                      type="number"
                      step="0.1"
                      className={styles.formInput}
                      value={addValue}
                      onChange={(e) => setAddValue(e.target.value)}
                      placeholder="0.0"
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>Примечание</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      value={addNote}
                      onChange={(e) => setAddNote(e.target.value)}
                      placeholder="Необязательно"
                    />
                  </div>
                </div>
                <button
                  className={styles.saveBtn}
                  onClick={handleAddValue}
                  disabled={saving || !addValue}
                >
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            )}

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
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default KpiDetail;
