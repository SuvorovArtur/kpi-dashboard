import { useState, useMemo, useCallback } from 'react';
import { Card, KpiCard, Chart, DataTable, Header, DateRangePicker, EmptyState, Skeleton, Toast, XlsxImport, SlideOver } from '../../shared/ui';
import { useAppeals, useDateRange, useAppSettings } from '../../shared/hooks';
import { supabase } from '../../shared/lib/supabase';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import type { Appeal } from '../../shared/types';
import type { Column } from '../../shared/ui/DataTable/DataTable';
import styles from './Appeals.module.css';

const STATUS_GROUPS: Record<string, string[]> = {
  'В работе': ['В работе исполнителя', 'На исполнении', 'На модерации', 'Готова к редактированию', 'Отправлено во внешние системы'],
  'На согласовании': ['На согласовании', 'Готова к согласованию', 'Готова к согласованию (отложенное решение)'],
  'Закрыта': ['Закрыта'],
  'Отложена': ['Закрыта с отложенным'],
  'Возврат': ['Возврат модератору'],
};

function getStatusGroup(status: string): string {
  for (const [group, statuses] of Object.entries(STATUS_GROUPS)) {
    if (statuses.includes(status)) return group;
  }
  return 'Прочее';
}

type AppealRow = Appeal & Record<string, unknown>;

export function Appeals() {
  const { range, setRange } = useDateRange();
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const { getNumber } = useAppSettings();
  const population = getNumber('population') || 88876;

  const { data, isLoading, error, refetch } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
    direction: directionFilter === 'all' ? undefined : directionFilter,
  });

  const { data: allData } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
  });

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState('');

  // ISN analysis
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeProgress('Запуск анализа...');
    let totalProcessed = 0;

    try {
      while (true) {
        const res = await supabase.functions.invoke('analyze-sentiment', {
          body: { batch_size: 20 },
        });
        if (res.error) throw new Error(res.error.message);
        const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        const { processed, remaining } = result;
        totalProcessed += processed;
        setAnalyzeProgress(`Обработано ${totalProcessed}, осталось ${remaining}`);
        if (remaining <= 0 || processed === 0) break;
      }
      setToast({ message: `Анализ завершён: ${totalProcessed} обращений`, type: 'success' });
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка анализа: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress('');
    }
  }, [refetch]);

  // Data range info
  const dataRange = useMemo(() => {
    if (allData.length === 0) return null;
    const dates = allData.map(a => a.date).sort();
    return { first: dates[0], last: dates[dates.length - 1], total: allData.length };
  }, [allData]);

  // Unique directions for filter
  const directions = useMemo(() => {
    const set = new Set(allData.map(a => a.direction));
    return Array.from(set).sort();
  }, [allData]);

  // Auto-calculated KPIs
  const kpis = useMemo(() => {
    if (allData.length === 0) return null;
    const total = allData.length;
    const delayed = allData.filter(a => getStatusGroup(a.status) === 'Отложена').length;
    const delayedPercent = (delayed / total) * 100;
    const repeated = allData.filter(a => a.is_repeated).length;
    const repeatedPercent = (repeated / total) * 100;
    const per1k = total / (population / 1000);
    const withSentiment = allData.filter(a => a.sentiment_score != null);
    let isnWeighted = 0;
    let analyzedCount = withSentiment.length;
    if (analyzedCount > 0) {
      const sumS = withSentiment.reduce((s, a) => s + (a.sentiment_score ?? 0), 0);
      const sumSq = withSentiment.reduce((s, a) => s + (a.sentiment_score ?? 0) ** 2, 0);
      isnWeighted = sumS > 0 ? sumSq / sumS : 0;
    }
    const acuteCount = withSentiment.filter(a => (a.sentiment_score ?? 0) >= 7).length;
    const acutePct = analyzedCount > 0 ? (acuteCount / analyzedCount) * 100 : 0;

    return { total, delayedPercent, repeatedPercent, per1k, isnWeighted, analyzedCount, acutePct };
  }, [allData, population]);

  // Bar chart: by direction (top categories, rest grouped as "Прочее")
  const directionChartData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data) {
      counts.set(a.direction, (counts.get(a.direction) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const TOP = 7;
    const top = sorted.slice(0, TOP).map(([name, value]) => ({ name, 'Обращений': value }));
    const restSum = sorted.slice(TOP).reduce((s, [, v]) => s + v, 0);
    if (restSum > 0) top.push({ name: 'Прочее', 'Обращений': restSum });
    return top.sort((a, b) => a['Обращений'] - b['Обращений']);
  }, [data]);

  // Bar chart: by week
  const weeklyChartData = useMemo(() => {
    const weekMap = new Map<string, Record<string, unknown>>();
    for (const a of data) {
      const d = new Date(a.date);
      const day = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - day + 1);
      const weekKey = monday.toISOString().slice(0, 10);
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, { week: formatDate(weekKey), 'Обращений': 0 });
      }
      (weekMap.get(weekKey)!['Обращений'] as number)++;
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [data]);

  // Table columns
  const columns: Column<AppealRow>[] = useMemo(() => [
    { key: 'date', title: 'Дата', sortable: true, render: (v) => formatDate(String(v)) },
    { key: 'ecur_number', title: '# ЕЦУР', sortable: true },
    { key: 'direction', title: 'Направление', sortable: true },
    { key: 'subtopic', title: 'Подтема', sortable: true, render: (v) => String(v ?? '—') },
    { key: 'status', title: 'Статус', sortable: true },
    { key: 'settlement', title: 'Нас. пункт', sortable: true, render: (v) => String(v ?? '—') },
    { key: 'source', title: 'Источник', sortable: true, render: (v) => String(v ?? '—') },
  ], []);

  const handleImportComplete = useCallback(async (result: { total: number; inserted: number; skipped: number }) => {
    setToast({
      message: `Загружено ${result.inserted} новых обращений (дублей: ${result.skipped}). Запускаю анализ ИСН...`,
      type: 'success',
    });
    refetch();
    // Auto-trigger sentiment analysis for new appeals
    if (result.inserted > 0) {
      setTimeout(() => handleAnalyze(), 1000);
    }
  }, [refetch, handleAnalyze]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Обращения" />
        <div className={styles.kpiRow}>
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} variant="card" height={160} />)}
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
        {dataRange && (
          <span className={styles.dataRangeBadge}>
            Последняя загрузка: до {formatDate(dataRange.last)}
          </span>
        )}
        <button
          className={styles.analyzeBtn}
          onClick={handleAnalyze}
          disabled={analyzing}
        >
          {analyzing ? analyzeProgress : 'Анализ ИСН'}
        </button>
        <XlsxImport
          onComplete={handleImportComplete}
          onError={(msg) => setToast({ message: msg, type: 'error' })}
        />
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* Auto-calculated KPIs */}
      {kpis && (
        <div className={styles.kpiRow}>
          <KpiCard
            label="Всего обращений"
            value={formatNumber(kpis.total)}
            target={0}
            unit="шт"
            trend="flat"
            status="green"
            progress={100}
            targetLabel="За выбранный период"
          />
          <KpiCard
            label="На 1000 жителей"
            value={formatNumber(kpis.per1k, 1)}
            target={20}
            unit="шт"
            trend={kpis.per1k <= 20 ? 'down' : 'up'}
            status={kpis.per1k <= 20 ? 'green' : kpis.per1k <= 30 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((40 - kpis.per1k) / 40) * 100))}
            targetLabel="Цель: ≤ 20"
          />
          <KpiCard
            label="Отложенные"
            value={formatPercent(kpis.delayedPercent)}
            target={10}
            unit="%"
            trend={kpis.delayedPercent <= 10 ? 'down' : 'up'}
            status={kpis.delayedPercent <= 10 ? 'green' : kpis.delayedPercent <= 20 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((30 - kpis.delayedPercent) / 30) * 100))}
            targetLabel="Цель: ≤ 10%"
          />
          <KpiCard
            label="ИСН (напряжение)"
            value={kpis.analyzedCount > 0 ? kpis.isnWeighted.toFixed(1) : '—'}
            target={4}
            unit="балл"
            trend={kpis.isnWeighted <= 4 ? 'down' : 'up'}
            status={kpis.isnWeighted <= 4 ? 'green' : kpis.isnWeighted <= 6 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((10 - kpis.isnWeighted) / 10) * 100))}
            targetLabel={kpis.analyzedCount > 0 ? `Острых: ${kpis.acutePct.toFixed(0)}%` : 'Не проанализировано'}
          />
          <KpiCard
            label="Повторные"
            value={formatPercent(kpis.repeatedPercent)}
            target={5}
            unit="%"
            trend={kpis.repeatedPercent <= 5 ? 'down' : 'up'}
            status={kpis.repeatedPercent <= 5 ? 'green' : kpis.repeatedPercent <= 10 ? 'yellow' : 'red'}
            progress={Math.max(0, Math.min(100, ((15 - kpis.repeatedPercent) / 15) * 100))}
            targetLabel="Цель: ≤ 5%"
          />
        </div>
      )}

      {/* Charts */}
      <div className={styles.chartsRow}>
        <Card>
          <Chart type="bar" data={directionChartData} xKey="name" yKey="Обращений" title="По направлениям" height={320} />
        </Card>
        <Card>
          <Chart type="bar" data={weeklyChartData} xKey="week" yKey="Обращений" title="По неделям" height={320} />
        </Card>
      </div>

      {/* Filter + Table */}
      <Card>
        <div className={styles.tableHeader}>
          <h3 className={styles.sectionTitle}>Все обращения</h3>
          <span className={styles.totalCount}>{data.length} записей</span>
        </div>

        <div className={styles.filters}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Направление:</span>
            <div className={styles.filterButtons}>
              <button
                className={`${styles.filterBtn} ${directionFilter === 'all' ? styles.filterBtnActive : ''}`}
                onClick={() => setDirectionFilter('all')}
              >
                Все
              </button>
              {directions.map(d => (
                <button
                  key={d}
                  className={`${styles.filterBtn} ${directionFilter === d ? styles.filterBtnActive : ''}`}
                  onClick={() => setDirectionFilter(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <EmptyState title="Нет обращений" description="Загрузите выгрузку XLSX из ЕЦУР" />
        ) : (
          <DataTable<AppealRow>
            columns={columns}
            data={data as AppealRow[]}
            pageSize={20}
            exportFilename="appeals"
            onRowClick={(row) => setSelectedAppeal(row as unknown as Appeal)}
          />
        )}
      </Card>

      {/* Appeal detail slide-over */}
      <SlideOver
        open={!!selectedAppeal}
        onClose={() => setSelectedAppeal(null)}
        title={`Обращение ${selectedAppeal?.ecur_number ?? ''}`}
      >
        {selectedAppeal && (
          <div className={styles.appealCard}>
            <div className={styles.cardField}>
              <span className={styles.cardLabel}>Дата</span>
              <span className={styles.cardValue}>{formatDate(selectedAppeal.date)}</span>
            </div>
            <div className={styles.cardField}>
              <span className={styles.cardLabel}>Номер ЕЦУР</span>
              <span className={styles.cardValue}>{selectedAppeal.ecur_number}</span>
            </div>
            {selectedAppeal.source_number && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Номер в источнике</span>
                <span className={styles.cardValue}>{selectedAppeal.source_number}</span>
              </div>
            )}
            <div className={styles.cardField}>
              <span className={styles.cardLabel}>Направление</span>
              <span className={styles.cardValue}>{selectedAppeal.direction}</span>
            </div>
            {selectedAppeal.subtopic && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Подтема</span>
                <span className={styles.cardValue}>{selectedAppeal.subtopic}</span>
              </div>
            )}
            <div className={styles.cardField}>
              <span className={styles.cardLabel}>Статус</span>
              <span className={styles.cardValue}>{selectedAppeal.status}</span>
            </div>
            {selectedAppeal.source && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Источник</span>
                <span className={styles.cardValue}>{selectedAppeal.source}</span>
              </div>
            )}
            {selectedAppeal.executor && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Исполнитель</span>
                <span className={styles.cardValue}>{selectedAppeal.executor}</span>
              </div>
            )}
            {selectedAppeal.curator && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Куратор</span>
                <span className={styles.cardValue}>{selectedAppeal.curator}</span>
              </div>
            )}
            {selectedAppeal.settlement && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Населённый пункт</span>
                <span className={styles.cardValue}>{selectedAppeal.settlement}</span>
              </div>
            )}
            {selectedAppeal.address && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Адрес</span>
                <span className={styles.cardValue}>{selectedAppeal.address}</span>
              </div>
            )}
            {selectedAppeal.fact && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Факт</span>
                <span className={styles.cardValue}>{selectedAppeal.fact}</span>
              </div>
            )}
            {selectedAppeal.description && (
              <div className={styles.cardFieldFull}>
                <span className={styles.cardLabel}>Описание</span>
                <p className={styles.cardDescription}>{selectedAppeal.description}</p>
              </div>
            )}
            <div className={styles.cardField}>
              <span className={styles.cardLabel}>Тип сообщения</span>
              <span className={styles.cardValue}>{selectedAppeal.message_type ?? '—'}</span>
            </div>
            {selectedAppeal.sector && (
              <div className={styles.cardField}>
                <span className={styles.cardLabel}>Сектор</span>
                <span className={styles.cardValue}>{selectedAppeal.sector}</span>
              </div>
            )}
          </div>
        )}
      </SlideOver>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Appeals;
