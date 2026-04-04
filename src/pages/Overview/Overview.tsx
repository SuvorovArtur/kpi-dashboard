import { useMemo, useState, useCallback, useRef } from 'react';
import { Card, KpiCard, Chart, Skeleton, Header, DateRangePicker, SlideOver } from '../../shared/ui';
import { useDateRange, useAppeals, useAppSettings, useKpiData } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import type { Appeal } from '../../shared/types';
import styles from './Overview.module.css';


export function Overview() {
  const { range, setRange } = useDateRange({
    from: (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); })(),
    to: new Date().toISOString().slice(0, 10),
  });
  const { data: appeals } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
  });
  const { getNumber } = useAppSettings();
  const population = getNumber('population') || 88876;
  const { definitions } = useKpiData();

  // Get D360 target from kpi_definitions, with fallback
  const getTarget = useCallback((kpiId: string, fallback: number) => {
    const def = definitions.find(d => d.id === kpiId);
    return def?.d360 ?? fallback;
  }, [definitions]);

  const periodLabel = useMemo(() => {
    const days = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000);
    if (days <= 8) return 'за неделю';
    if (days <= 32) return 'за месяц';
    if (days <= 95) return 'за квартал';
    if (days <= 370) return 'за год';
    return 'всего';
  }, [range]);

  // Auto-calculated KPIs from appeals
  const appealsKpis = useMemo(() => {
    // KPI: count ALL appeals (including spam)
    const total = appeals.length;
    const per1k = total > 0 ? Math.round((total / (population / 1000)) * 10) / 10 : 0;

    const delayed = appeals.filter(a => a.status === 'Закрыта с отложенным').length;
    const delayedPct = total > 0 ? Math.round((delayed / total) * 1000) / 10 : 0;

    const addrKey = new Map<string, number>();
    let repeatedCount = 0;
    const vagueAddresses = ['Россия, Московская область, городской округ Мытищи', 'Россия, Московская область, Мытищи', 'городской округ Мытищи'];
    for (const a of appeals) {
      if (!a.address || vagueAddresses.includes(a.address)) continue;
      const key = `${a.address}__${a.direction}`;
      const count = (addrKey.get(key) ?? 0) + 1;
      addrKey.set(key, count);
      if (count > 1) repeatedCount++;
    }
    const repeatedPct = total > 0 ? Math.round((repeatedCount / total) * 100) : 0;

    // ISN: only non-spam
    const withSentiment = appeals.filter(a => a.sentiment_score != null && !a.is_spam);
    let isn = 0;
    let acutePct = 0;
    if (withSentiment.length > 0) {
      const sumS = withSentiment.reduce((s, a) => s + (a.sentiment_score ?? 0), 0);
      const sumSq = withSentiment.reduce((s, a) => s + (a.sentiment_score ?? 0) ** 2, 0);
      isn = Math.round((sumSq / sumS) * 10) / 10;
      acutePct = Math.round((withSentiment.filter(a => (a.sentiment_score ?? 0) >= 7).length / withSentiment.length) * 1000) / 10;
    }

    // Top repeated addresses
    const repeatedAddresses: { address: string; direction: string; count: number }[] = [];
    for (const [key, count] of addrKey) {
      if (count > 1) {
        const [address, direction] = key.split('__');
        repeatedAddresses.push({ address, direction, count });
      }
    }
    repeatedAddresses.sort((a, b) => b.count - a.count);

    return { total, per1k, delayedPct, repeatedCount, repeatedPct, isn, acutePct, analyzed: withSentiment.length, repeatedAddresses };
  }, [appeals, population]);

  // Expandable card state
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<7 | 30 | 90>(7);
  const repeatedRef = useRef<HTMLDivElement>(null);
  const [repeatedHighlight, setRepeatedHighlight] = useState(false);
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);

  const trendLabels: Record<string, string> = {
    isn: 'ИСН',
    total: 'Обращений',
    per1k: 'На 1000 жит.',
    repeated: 'Горячие адреса %',
    delayed: 'Отложенные %',
  };

  const toggleCard = useCallback((key: string) => {
    setExpandedCard(prev => prev === key ? null : key);
    setTrendPeriod(7);
    if (key === 'repeated') {
      setTimeout(() => {
        repeatedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setRepeatedHighlight(true);
        setTimeout(() => setRepeatedHighlight(false), 1500);
      }, 100);
    }
  }, []);

  // Build daily trend data for a given metric over selected period
  const trendData = useMemo(() => {
    if (!expandedCard || appeals.length === 0) return [];
    const now = new Date();
    const from = new Date();
    from.setDate(now.getDate() - trendPeriod + 1);
    const fromStr = from.toISOString().slice(0, 10);

    // Group by date (all appeals for KPI, filtered for ISN inside)
    const dateMap = new Map<string, Appeal[]>();
    for (const a of appeals) {
      if (a.date < fromStr) continue;
      if (!dateMap.has(a.date)) dateMap.set(a.date, []);
      dateMap.get(a.date)!.push(a);
    }

    // Fill all dates in range
    const result: Record<string, unknown>[] = [];
    const d = new Date(from);
    while (d <= now) {
      const ds = d.toISOString().slice(0, 10);
      const dayAppeals = dateMap.get(ds) ?? [];
      const total = dayAppeals.length;

      let value = 0;
      if (expandedCard === 'total') {
        value = total;
      } else if (expandedCard === 'per1k') {
        value = Math.round((total / (population / 1000)) * 10) / 10;
      } else if (expandedCard === 'repeated') {
        const keys = new Map<string, number>();
        let reps = 0;
        for (const a of dayAppeals) {
          if (!a.address) continue;
          const k = `${a.address}__${a.direction}`;
          const c = (keys.get(k) ?? 0) + 1;
          keys.set(k, c);
          if (c > 1) reps++;
        }
        value = total > 0 ? Math.round((reps / total) * 1000) / 10 : 0;
      } else if (expandedCard === 'delayed') {
        const del = dayAppeals.filter(a => a.status === 'Закрыта с отложенным').length;
        value = total > 0 ? Math.round((del / total) * 1000) / 10 : 0;
      } else if (expandedCard === 'isn') {
        const ws = dayAppeals.filter(a => a.sentiment_score != null && !a.is_spam);
        if (ws.length > 0) {
          const sumS = ws.reduce((s, a) => s + (a.sentiment_score ?? 0), 0);
          const sumSq = ws.reduce((s, a) => s + (a.sentiment_score ?? 0) ** 2, 0);
          value = Math.round((sumSq / sumS) * 10) / 10;
        }
      }

      result.push({ date: formatDate(ds), [trendLabels[expandedCard] ?? 'Значение']: value });
      d.setDate(d.getDate() + 1);
    }
    return result;
  }, [expandedCard, trendPeriod, appeals, population]);

  const isLoading = false;

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

  return (
    <div className={styles.page}>
      <Header title="Дашборд управления по развитию сельскими территориями">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* KPI Cards — clickable with expandable trend chart */}
      {appealsKpis.total > 0 && (
        <>
          <div className={styles.appealsKpiRow}>
            {(() => {
              const isnTarget = getTarget('isn', 4);
              const per1kTarget = getTarget('appeals_per_1k', 20);
              const repeatedTarget = getTarget('repeated_appeals', 15);
              const delayedTarget = getTarget('delayed_appeals', 5);
              return [
              { key: 'isn', label: 'ИСН (соц. напряжение)', value: appealsKpis.analyzed > 0 ? String(appealsKpis.isn) : '—', target: isnTarget, unit: 'балл',
                trend: appealsKpis.isn <= isnTarget ? 'down' : 'up', status: appealsKpis.isn <= isnTarget ? 'green' : appealsKpis.isn <= isnTarget * 1.5 ? 'yellow' : 'red',
                progress: Math.max(0, (10 - appealsKpis.isn) / 10 * 100), targetLabel: appealsKpis.analyzed > 0 ? `Острых: ${appealsKpis.acutePct}%` : 'Ожидает анализа' },
              { key: 'total', label: `Обращений ${periodLabel}`, value: formatNumber(appealsKpis.total), target: 0, unit: 'шт',
                trend: 'flat', status: 'green', progress: 100, targetLabel: `На 1000 жит.: ${appealsKpis.per1k}` },
              { key: 'per1k', label: 'На 1000 жителей', value: String(appealsKpis.per1k), target: per1kTarget, unit: 'шт',
                trend: appealsKpis.per1k <= per1kTarget ? 'down' : 'up', status: appealsKpis.per1k <= per1kTarget ? 'green' : appealsKpis.per1k <= per1kTarget * 1.5 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (per1kTarget * 2 - appealsKpis.per1k) / (per1kTarget * 2) * 100)), targetLabel: `Цель: ≤ ${per1kTarget}` },
              { key: 'repeated', label: 'Горячие адреса', value: `${appealsKpis.repeatedPct}%`, target: repeatedTarget, unit: '%',
                trend: appealsKpis.repeatedPct <= repeatedTarget ? 'down' : 'up', status: appealsKpis.repeatedPct <= repeatedTarget ? 'green' : appealsKpis.repeatedPct <= repeatedTarget * 2 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (repeatedTarget * 3 - appealsKpis.repeatedPct) / (repeatedTarget * 3) * 100)), targetLabel: `${appealsKpis.repeatedCount} повторов · цель ≤ ${repeatedTarget}%` },
              { key: 'delayed', label: 'Отложенные', value: formatPercent(appealsKpis.delayedPct), target: delayedTarget, unit: '%',
                trend: appealsKpis.delayedPct <= delayedTarget ? 'down' : 'up', status: appealsKpis.delayedPct <= delayedTarget ? 'green' : appealsKpis.delayedPct <= delayedTarget * 2 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (delayedTarget * 3 - appealsKpis.delayedPct) / (delayedTarget * 3) * 100)), targetLabel: `Цель: ≤ ${delayedTarget}%` },
            ] as Array<{ key: string; label: string; value: string; target: number; unit: string; trend: 'up' | 'down' | 'flat'; status: 'green' | 'yellow' | 'red'; progress: number; targetLabel: string }>;
            })().map(card => (
              <div key={card.key} className={`${styles.kpiClickable} ${expandedCard === card.key ? styles.kpiClickableActive : ''}`} onClick={() => toggleCard(card.key)}>
                <KpiCard {...card} />
              </div>
            ))}
          </div>

          {/* Expanded trend chart */}
          {expandedCard && trendData.length > 0 && (
            <Card>
              <div className={styles.trendHeader}>
                <h4 className={styles.trendTitle}>{trendLabels[expandedCard]} — динамика</h4>
                <div className={styles.periodTabs}>
                  {([7, 30, 90] as const).map(p => (
                    <button
                      key={p}
                      className={`${styles.periodTab} ${trendPeriod === p ? styles.periodTabActive : ''}`}
                      onClick={(e) => { e.stopPropagation(); setTrendPeriod(p); }}
                    >
                      {p === 7 ? '7 дней' : p === 30 ? '30 дней' : 'Квартал'}
                    </button>
                  ))}
                </div>
              </div>
              <Chart type="area" data={trendData} xKey="date" yKey={trendLabels[expandedCard] ?? 'Значение'} height={220} />
            </Card>
          )}
        </>
      )}

      {/* Charts Row: radar + bar + line */}
      {appealsKpis.total > 0 && (
        <div className={styles.chartsRow3}>
          <Card>
            <Chart
              type="radar"
              data={(() => {
                const isnT = getTarget('isn', 4);
                const per1kT = getTarget('appeals_per_1k', 20);
                const repT = getTarget('repeated_appeals', 15);
                const delT = getTarget('delayed_appeals', 5);
                return [
                  { subject: 'ИСН', value: Math.max(0, Math.round((10 - appealsKpis.isn) / 10 * 100)), displayValue: String(appealsKpis.isn), targetLabel: `цель ≤ ${isnT}` },
                  { subject: 'На 1000 жит.', value: Math.max(0, Math.min(100, Math.round((per1kT * 2 - appealsKpis.per1k) / (per1kT * 2) * 100))), displayValue: String(appealsKpis.per1k), targetLabel: `цель ≤ ${per1kT}` },
                  { subject: 'Горяч. адреса', value: Math.max(0, Math.min(100, Math.round((repT * 3 - appealsKpis.repeatedPct) / (repT * 3) * 100))), displayValue: `${appealsKpis.repeatedPct}%`, targetLabel: `цель ≤ ${repT}%` },
                  { subject: 'Отложенные', value: Math.max(0, Math.min(100, Math.round((delT * 3 - appealsKpis.delayedPct) / (delT * 3) * 100))), displayValue: `${appealsKpis.delayedPct}%`, targetLabel: `цель ≤ ${delT}%` },
                  { subject: 'Острые', value: Math.max(0, Math.min(100, Math.round((100 - appealsKpis.acutePct)))), displayValue: `${appealsKpis.acutePct}%`, targetLabel: 'цель ≤ 10%' },
                ];
              })()}
              xKey="subject"
              yKey="value"
              title="Исполнение KPI"
              height={300}
            />
          </Card>
          <Card>
            <Chart
              type="horizontal-bar"
              data={(() => {
                const nonSpam = appeals.filter(a => !a.is_spam);
                const dirCounts = new Map<string, number>();
                for (const a of nonSpam) dirCounts.set(a.direction, (dirCounts.get(a.direction) ?? 0) + 1);
                return Array.from(dirCounts.entries())
                  .sort((a, b) => a[1] - b[1])
                  .slice(-8)
                  .map(([name, count]) => ({ name, 'Кол-во': count }));
              })()}
              xKey="name"
              yKey="Кол-во"
              title="Обращения по направлениям"
              height={300}
            />
          </Card>
          <Card>
            <Chart
              type="line"
              data={(() => {
                const nonSpam = appeals.filter(a => !a.is_spam);
                const dayMap = new Map<string, number>();
                for (const a of nonSpam) dayMap.set(a.date, (dayMap.get(a.date) ?? 0) + 1);
                return Array.from(dayMap.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .slice(-30)
                  .map(([date, count]) => ({ date: formatDate(date), 'Обращений': count }));
              })()}
              xKey="date"
              yKey="Обращений"
              title="Обращения по дням"
              height={320}
            />
          </Card>
        </div>
      )}

      {/* Repeated addresses — clickable histogram */}
      {appealsKpis.repeatedAddresses.length > 0 && (
        <div ref={repeatedRef} className={repeatedHighlight ? styles.repeatedCardHighlight : undefined}>
        <Card>
          <h4 className={styles.sectionTitle}>Горячие адреса ({appealsKpis.repeatedAddresses.length})</h4>
          <div className={styles.rGrid}>
            {appealsKpis.repeatedAddresses.slice(0, 12).map((item) => {
              const key = `${item.address}__${item.direction}`;
              const short = item.address
                .replace(/Россия, Московская область, /g, '')
                .replace(/городской округ Мытищи, /g, '')
                .replace(/посёлок /g, 'пос. ')
                .replace(/деревня /g, 'д. ')
                .replace(/микрорайон /g, 'мкр. ');
              const isActive = selectedAddr === key;
              const addrAppeals = isActive
                ? appeals.filter(a => a.address === item.address && a.direction === item.direction).sort((a, b) => b.date.localeCompare(a.date))
                : [];
              return (
                <div key={key} className={`${styles.rTile} ${isActive ? styles.rTileActive : ''}`}>
                  <div className={styles.rTileHead} onClick={() => setSelectedAddr(isActive ? null : key)}>
                    <span className={styles.rBadge}>{item.count}</span>
                    <div className={styles.rTileText}>
                      <span className={styles.rAddr}>{short}</span>
                      <span className={styles.rDir}>{item.direction}</span>
                    </div>
                  </div>
                  {isActive && addrAppeals.length > 0 && (
                    <div className={styles.rSublist}>
                      {addrAppeals.map(a => (
                        <div key={a.id} className={styles.rSubItem} onClick={(e) => { e.stopPropagation(); setSelectedAppeal(a); }}>
                          <span className={styles.rSubDate}>{formatDate(a.date)}</span>
                          <span className={styles.rSubEcur}>#{a.ecur_number}</span>
                          <span className={styles.rSubStatus}>{a.status}</span>
                          <span className={styles.rSubArrow}>&rsaquo;</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        </div>
      )}
      {/* Appeal detail slide-over */}
      <SlideOver
        open={!!selectedAppeal}
        onClose={() => setSelectedAppeal(null)}
        title={`Обращение ${selectedAppeal?.ecur_number ?? ''}`}
      >
        {selectedAppeal && (
          <div className={styles.appealDetail}>
            <div className={styles.appealDetailFields}>
              <div className={styles.adf}><span className={styles.adl}>Дата</span><span>{formatDate(selectedAppeal.date)}</span></div>
              <div className={styles.adf}><span className={styles.adl}>Направление</span><span>{selectedAppeal.direction}</span></div>
              {selectedAppeal.subtopic && <div className={styles.adf}><span className={styles.adl}>Подтема</span><span>{selectedAppeal.subtopic}</span></div>}
              <div className={styles.adf}><span className={styles.adl}>Статус</span><span>{selectedAppeal.status}</span></div>
              {selectedAppeal.source && <div className={styles.adf}><span className={styles.adl}>Источник</span><span>{selectedAppeal.source}</span></div>}
              {selectedAppeal.executor && <div className={styles.adf}><span className={styles.adl}>Исполнитель</span><span>{selectedAppeal.executor}</span></div>}
              {selectedAppeal.curator && <div className={styles.adf}><span className={styles.adl}>Куратор</span><span>{selectedAppeal.curator}</span></div>}
              {selectedAppeal.settlement && <div className={styles.adf}><span className={styles.adl}>Нас. пункт</span><span>{selectedAppeal.settlement}</span></div>}
              {selectedAppeal.address && <div className={styles.adf}><span className={styles.adl}>Адрес</span><span>{selectedAppeal.address}</span></div>}
              {selectedAppeal.sentiment_score != null && (
                <div className={styles.adf}><span className={styles.adl}>ИСН балл</span><span>{selectedAppeal.sentiment_score}/10</span></div>
              )}
            </div>
            {selectedAppeal.description && (
              <div className={styles.appealDetailDesc}>
                <span className={styles.adl}>Описание</span>
                <p>{selectedAppeal.description}</p>
              </div>
            )}
            {selectedAppeal.source_number && (
              <a
                href={`https://dobrodel.mosreg.ru/appeal/${selectedAppeal.source_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.appealDetailLink}
              >
                Открыть в Добродел
              </a>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}

export default Overview;
