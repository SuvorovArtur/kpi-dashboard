import { useMemo, useState, useCallback, Fragment } from 'react';
import { Card, KpiCard, Chart, Skeleton, Header, DateRangePicker, SlideOver } from '../../shared/ui';
import { useDateRange, useAppeals, useAppSettings, useKpiData } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import type { Appeal } from '../../shared/types';
import styles from './Overview.module.css';

// Strip trailing house number / building suffix so neighbouring buildings on
// the same street collapse into one location.
function stripHouse(addr: string): string {
  return addr.replace(/,\s*(?:д\.?\s*|дом\s*|стр\.?\s*|корп\.?\s*)?\d+\s*[кК]?\s*\d*\s*$/i, '').trim();
}

// Normalize for grouping: lowercase, strip settlement / street abbrev prefixes,
// collapse separators. So "д. Сухарево" and "Сухарево" produce the same key.
function normalizeAddrKey(addr: string): string {
  let s = addr.toLowerCase().replace(/ё/g, 'е');
  // Strip prefix tokens followed by whitespace: "д.", "пос.", "с.", "г.", "ул.",
  // "мкр.", "пр-т", "пер.", "ш.", "б-р", and full forms (деревня/посёлок/...)
  s = s.replace(
    /(^|[\s,])(?:д|пос|посёлок|поселок|с|г|ул|улица|мкр|микрорайон|пр-т|проспект|пер|переулок|ш|шоссе|б-р|бульвар|деревня|село|город|тер|кв-л|квартал)\.?(?=\s)/g,
    '$1'
  );
  return s.replace(/[\s,]+/g, ' ').trim();
}

export function Overview() {
  const { range, setRange } = useDateRange((() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: fmt(start), to: fmt(end) };
  })());
  const { data: appeals } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
  });

  // Prior period of equal length, ending the day before range.from
  const priorRange = useMemo(() => {
    const fromD = new Date(range.from);
    const toD = new Date(range.to);
    const lenMs = toD.getTime() - fromD.getTime();
    const priorTo = new Date(fromD.getTime() - 86400000);
    const priorFrom = new Date(priorTo.getTime() - lenMs);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: fmt(priorFrom), to: fmt(priorTo) };
  }, [range]);
  const { data: priorAppeals } = useAppeals({
    dateFrom: priorRange.from,
    dateTo: priorRange.to,
  });
  const { getNumber } = useAppSettings();
  const population = getNumber('population') || 88876;
  const { definitions } = useKpiData();

  // Get D360 target from kpi_definitions, with fallback
  const getTarget = useCallback((kpiId: string, fallback: number) => {
    const def = definitions.find(d => d.id === kpiId);
    return def?.d360 ?? fallback;
  }, [definitions]);

  const periodDays = useMemo(() => {
    return Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1);
  }, [range]);

  const periodLabel = useMemo(() => {
    if (periodDays <= 8) return 'за неделю';
    if (periodDays <= 32) return 'за месяц';
    if (periodDays <= 95) return 'за квартал';
    if (periodDays <= 370) return 'за год';
    return 'всего';
  }, [periodDays]);

  // Round target nicely: 1 decimal if < 10, integer otherwise
  const fmtTarget = (v: number) => v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v));

  // Auto-calculated KPIs from appeals
  const appealsKpis = useMemo(() => {
    // KPI: count ALL appeals (including spam)
    const total = appeals.length;
    const per1k = total > 0 ? Math.round((total / (population / 1000)) * 10) / 10 : 0;

    const delayed = appeals.filter(a => a.status === 'Закрыта с отложенным').length;
    const delayedPct = total > 0 ? Math.round((delayed / total) * 1000) / 10 : 0;

    const addrKey = new Map<string, number>();
    const groupHouses = new Map<string, Set<string>>();
    const groupDisplay = new Map<string, string>();
    let repeatedCount = 0;
    const vagueAddresses = ['Россия, Московская область, городской округ Мытищи', 'Россия, Московская область, Мытищи', 'городской округ Мытищи'];
    for (const a of appeals) {
      if (!a.address || vagueAddresses.includes(a.address)) continue;
      const street = stripHouse(a.address);
      const key = `${normalizeAddrKey(street)}__${a.direction}`;
      const count = (addrKey.get(key) ?? 0) + 1;
      addrKey.set(key, count);
      if (count > 1) repeatedCount++;
      // Pick the longest stripped form as the display label (most descriptive).
      const prevDisplay = groupDisplay.get(key);
      if (!prevDisplay || street.length > prevDisplay.length) {
        groupDisplay.set(key, street);
      }
      const houseSuffix = a.address.slice(street.length).replace(/^,\s*/, '').trim();
      if (houseSuffix) {
        if (!groupHouses.has(key)) groupHouses.set(key, new Set());
        groupHouses.get(key)!.add(houseSuffix);
      }
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

    // Prior-period counts grouped by normalized street (same key strategy)
    const priorAddrKey = new Map<string, number>();
    for (const a of priorAppeals) {
      if (!a.address || vagueAddresses.includes(a.address)) continue;
      const street = stripHouse(a.address);
      const key = `${normalizeAddrKey(street)}__${a.direction}`;
      priorAddrKey.set(key, (priorAddrKey.get(key) ?? 0) + 1);
    }

    const addrSentiment = new Map<string, { sum: number; n: number }>();
    for (const a of appeals) {
      if (!a.address || vagueAddresses.includes(a.address) || a.is_spam || a.sentiment_score == null) continue;
      const street = stripHouse(a.address);
      const key = `${normalizeAddrKey(street)}__${a.direction}`;
      const cur = addrSentiment.get(key) ?? { sum: 0, n: 0 };
      cur.sum += a.sentiment_score;
      cur.n += 1;
      addrSentiment.set(key, cur);
    }

    // Top problem locations with delta vs prior period (grouped by normalized street)
    const topLocations: { address: string; direction: string; key: string; count: number; prior: number; delta: number; isn: number | null; houses: string[] }[] = [];
    for (const [key, count] of addrKey) {
      if (count < 2) continue;
      const [, direction] = key.split('__');
      const address = groupDisplay.get(key) ?? key.split('__')[0];
      const prior = priorAddrKey.get(key) ?? 0;
      const sent = addrSentiment.get(key);
      const houses = Array.from(groupHouses.get(key) ?? []).sort((a, b) => {
        const na = parseInt(a, 10); const nb = parseInt(b, 10);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      });
      topLocations.push({
        address,
        direction,
        key,
        count,
        prior,
        delta: count - prior,
        isn: sent && sent.n > 0 ? Math.round((sent.sum / sent.n) * 10) / 10 : null,
        houses,
      });
    }
    topLocations.sort((a, b) => (b.delta - a.delta) || (b.count - a.count));

    // Prior period totals for summary deltas
    const priorTotal = priorAppeals.length;
    const totalDeltaPct = priorTotal > 0 ? Math.round(((total - priorTotal) / priorTotal) * 100) : null;
    const priorWithSent = priorAppeals.filter(a => a.sentiment_score != null && !a.is_spam);
    let priorIsn = 0;
    if (priorWithSent.length > 0) {
      const ps = priorWithSent.reduce((s, a) => s + (a.sentiment_score ?? 0), 0);
      const pq = priorWithSent.reduce((s, a) => s + (a.sentiment_score ?? 0) ** 2, 0);
      priorIsn = Math.round((pq / ps) * 10) / 10;
    }
    const isnDelta = priorWithSent.length > 0 && withSentiment.length > 0
      ? Math.round((isn - priorIsn) * 10) / 10
      : null;

    return {
      total, per1k, delayedPct, repeatedCount, repeatedPct, isn, acutePct,
      analyzed: withSentiment.length,
      repeatedAddresses: topLocations.map(l => ({ address: l.address, direction: l.direction, count: l.count })),
      topLocations,
      priorTotal,
      totalDeltaPct,
      priorIsn,
      isnDelta,
    };
  }, [appeals, priorAppeals, population]);

  // Expandable card state
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<7 | 30 | 90>(7);
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

      const shortDate = new Date(ds).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
      result.push({ date: shortDate, [trendLabels[expandedCard] ?? 'Значение']: value });
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
      <Header title="Обзор" subtitle="Дашборд развития сельских территорий г.о. Мытищи">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {appealsKpis.total === 0 && (
        <>
          <div className={styles.emptyBanner}>
            <div>
              <strong>Нет обращений за выбранный период.</strong>
              <span> Переключи период вверху справа или листай стрелками.</span>
            </div>
          </div>
          <div className={styles.appealsKpiRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="card" height={180} />
            ))}
          </div>
          <div className={styles.chartsRow3}>
            <Skeleton variant="chart" height={300} />
            <Skeleton variant="chart" height={300} />
            <Skeleton variant="chart" height={300} />
          </div>
        </>
      )}

      {/* Summary banner + top problem locations — primary content */}
      {appealsKpis.total > 0 && (
        <div className={styles.summaryBanner}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{periodLabel.replace('за ', '')}</span>
            <span className={styles.summaryValue}>{formatNumber(appealsKpis.total)} <span className={styles.summaryUnit}>обращений</span></span>
            {appealsKpis.totalDeltaPct != null && (
              <span className={`${styles.summaryDelta} ${appealsKpis.totalDeltaPct > 0 ? styles.deltaUp : styles.deltaDown}`}>
                {appealsKpis.totalDeltaPct > 0 ? '▲' : '▼'} {Math.abs(appealsKpis.totalDeltaPct)}% к прошлому периоду
              </span>
            )}
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>ИСН</span>
            <span className={styles.summaryValue}>{appealsKpis.analyzed > 0 ? appealsKpis.isn : '—'}</span>
            {appealsKpis.isnDelta != null && Math.abs(appealsKpis.isnDelta) >= 0.1 && (
              <span className={`${styles.summaryDelta} ${appealsKpis.isnDelta > 0 ? styles.deltaUp : styles.deltaDown}`}>
                {appealsKpis.isnDelta > 0 ? '▲' : '▼'} {Math.abs(appealsKpis.isnDelta).toFixed(1)}
              </span>
            )}
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>повторов</span>
            <span className={styles.summaryValue}>{appealsKpis.repeatedCount}</span>
            <span className={styles.summaryDeltaMuted}>{appealsKpis.repeatedPct}% от всех</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>острых</span>
            <span className={styles.summaryValue}>{appealsKpis.acutePct}%</span>
            <span className={styles.summaryDeltaMuted}>≥ 7 баллов ИСН</span>
          </div>
        </div>
      )}

      {/* Top problem locations — primary triage table */}
      {appealsKpis.total > 0 && appealsKpis.topLocations.length > 0 && (
        <Card>
          <div className={styles.tlHeader}>
            <h4 className={styles.sectionTitle}>Где сейчас проблемы — топ {Math.min(10, appealsKpis.topLocations.length)} локаций</h4>
            <span className={styles.tlHint}>сортировка по росту к прошлому периоду</span>
          </div>
          <table className={styles.tlTable}>
            <thead>
              <tr>
                <th>Адрес</th>
                <th>Направление</th>
                <th className={styles.tlNumCol}>Сейчас</th>
                <th className={styles.tlNumCol}>Прошлый период</th>
                <th className={styles.tlNumCol}>Δ</th>
                <th className={styles.tlNumCol}>ИСН</th>
              </tr>
            </thead>
            <tbody>
              {appealsKpis.topLocations.slice(0, 10).map((loc) => {
                const short = loc.address
                  .replace(/Россия, Московская область, /g, '')
                  .replace(/городской округ Мытищи, /g, '')
                  .replace(/посёлок /g, 'пос. ')
                  .replace(/деревня /g, 'д. ')
                  .replace(/микрорайон /g, 'мкр. ');
                const isActive = selectedAddr === loc.key;
                const addrAppeals = isActive
                  ? appeals.filter(a => a.address && `${normalizeAddrKey(stripHouse(a.address))}__${a.direction}` === loc.key).sort((a, b) => b.date.localeCompare(a.date))
                  : [];
                const isnTone = loc.isn == null ? '' : loc.isn >= 7 ? styles.isnRed : loc.isn >= 5 ? styles.isnYellow : styles.isnGreen;
                return (
                  <Fragment key={loc.key}>
                    <tr
                      className={`${styles.tlRow} ${isActive ? styles.tlRowActive : ''}`}
                      onClick={() => setSelectedAddr(isActive ? null : loc.key)}
                    >
                      <td className={styles.tlAddr}>
                        <span>{short}</span>
                        {loc.houses.length > 0 && (
                          <span className={styles.tlHouses}>
                            {loc.houses.length === 1
                              ? `д. ${loc.houses[0]}`
                              : `${loc.houses.length} дом${loc.houses.length < 5 ? 'а' : 'ов'}: ${loc.houses.slice(0, 5).join(', ')}${loc.houses.length > 5 ? '…' : ''}`}
                          </span>
                        )}
                      </td>
                      <td className={styles.tlDir}>{loc.direction}</td>
                      <td className={styles.tlNum}>{loc.count}</td>
                      <td className={`${styles.tlNum} ${styles.tlMuted}`}>{loc.prior}</td>
                      <td className={styles.tlNum}>
                        <span className={loc.delta > 0 ? styles.deltaUp : loc.delta < 0 ? styles.deltaDown : styles.tlMuted}>
                          {loc.delta > 0 ? '+' : ''}{loc.delta}
                        </span>
                      </td>
                      <td className={`${styles.tlNum} ${isnTone}`}>{loc.isn ?? '—'}</td>
                    </tr>
                    {isActive && addrAppeals.length > 0 && (
                      <tr className={styles.tlDetailRow}>
                        <td colSpan={6}>
                          <div className={styles.tlDetailList}>
                            {addrAppeals.slice(0, 12).map(a => (
                              <div
                                key={a.id}
                                className={styles.tlDetailItem}
                                onClick={(e) => { e.stopPropagation(); setSelectedAppeal(a); }}
                              >
                                <span className={styles.tlDetailDate}>{formatDate(a.date)}</span>
                                <span className={styles.tlDetailEcur}>#{a.ecur_number}</span>
                                <span className={styles.tlDetailStatus}>{a.status}</span>
                                <span className={styles.tlDetailArrow}>›</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* KPI Cards — clickable with expandable trend chart */}
      {appealsKpis.total > 0 && (
        <>
          <div className={styles.appealsKpiRow}>
            {(() => {
              const isnTarget = getTarget('isn', 4);
              const per1kBase = getTarget('appeals_per_1k', 20);
              const per1kTarget = per1kBase * periodDays / 30;
              const repeatedTarget = getTarget('repeated_appeals', 15);
              const delayedTarget = getTarget('delayed_appeals', 5);
              return [
              { key: 'isn', label: 'ИСН (соц. напряжение)', value: appealsKpis.analyzed > 0 ? String(appealsKpis.isn) : '—', target: isnTarget, unit: 'балл',
                trend: appealsKpis.isn <= isnTarget ? 'down' : 'up', status: appealsKpis.isn <= isnTarget ? 'green' : appealsKpis.isn <= isnTarget * 1.5 ? 'yellow' : 'red',
                progress: Math.max(0, (10 - appealsKpis.isn) / 10 * 100), targetLabel: appealsKpis.analyzed > 0 ? `Острых: ${appealsKpis.acutePct}%` : 'Ожидает анализа' },
              { key: 'total', label: `Обращений ${periodLabel}`, value: formatNumber(appealsKpis.total), target: 0, unit: 'шт',
                trend: 'flat', status: 'green', progress: 100, targetLabel: `На 1000 жит.: ${appealsKpis.per1k}` },
              { key: 'per1k', label: `На 1000 жителей ${periodLabel}`, value: String(appealsKpis.per1k), target: per1kTarget, unit: 'шт',
                trend: appealsKpis.per1k <= per1kTarget ? 'down' : 'up', status: appealsKpis.per1k <= per1kTarget ? 'green' : appealsKpis.per1k <= per1kTarget * 1.5 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (per1kTarget * 2 - appealsKpis.per1k) / (per1kTarget * 2) * 100)), targetLabel: `Цель: ≤ ${fmtTarget(per1kTarget)}`, targetSubLabel: `норма ${per1kBase} в месяц` },
              { key: 'repeated', label: 'Горячие адреса', value: `${appealsKpis.repeatedPct}%`, target: repeatedTarget, unit: '%',
                trend: appealsKpis.repeatedPct <= repeatedTarget ? 'down' : 'up', status: appealsKpis.repeatedPct <= repeatedTarget ? 'green' : appealsKpis.repeatedPct <= repeatedTarget * 2 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (repeatedTarget * 3 - appealsKpis.repeatedPct) / (repeatedTarget * 3) * 100)), targetLabel: `${appealsKpis.repeatedCount} повторов · цель ≤ ${repeatedTarget}%` },
              { key: 'delayed', label: 'Отложенные', value: formatPercent(appealsKpis.delayedPct), target: delayedTarget, unit: '%',
                trend: appealsKpis.delayedPct <= delayedTarget ? 'down' : 'up', status: appealsKpis.delayedPct <= delayedTarget ? 'green' : appealsKpis.delayedPct <= delayedTarget * 2 ? 'yellow' : 'red',
                progress: Math.max(0, Math.min(100, (delayedTarget * 3 - appealsKpis.delayedPct) / (delayedTarget * 3) * 100)), targetLabel: `Цель: ≤ ${delayedTarget}%` },
            ] as Array<{ key: string; label: string; value: string; target: number; unit: string; trend: 'up' | 'down' | 'flat'; status: 'green' | 'yellow' | 'red'; progress: number; targetLabel: string; targetSubLabel?: string }>;
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
                const per1kBaseT = getTarget('appeals_per_1k', 20);
                const per1kT = per1kBaseT * periodDays / 30;
                const repT = getTarget('repeated_appeals', 15);
                const delT = getTarget('delayed_appeals', 5);
                return [
                  { subject: 'ИСН', value: Math.max(0, Math.round((10 - appealsKpis.isn) / 10 * 100)), displayValue: String(appealsKpis.isn), targetLabel: `цель ≤ ${isnT}` },
                  { subject: 'На 1000 жит.', value: Math.max(0, Math.min(100, Math.round((per1kT * 2 - appealsKpis.per1k) / (per1kT * 2) * 100))), displayValue: String(appealsKpis.per1k), targetLabel: `цель ≤ ${fmtTarget(per1kT)}` },
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
                  .map(([date, count]) => ({
                    date: new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', ''),
                    'Обращений': count,
                  }));
              })()}
              xKey="date"
              yKey="Обращений"
              title="Обращения по дням"
              height={320}
            />
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
