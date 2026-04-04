import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Card, KpiCard, Chart, Header, DateRangePicker, Skeleton, Toast, SlideOver } from '../../shared/ui';
import { useAppeals, useDateRange } from '../../shared/hooks';
import type { Appeal } from '../../shared/types';
import { formatNumber, formatDate } from '../../shared/utils/formatters';
import { supabase } from '../../shared/lib/supabase';
import styles from './ISN.module.css';

function formatTelegramMessage(a: Appeal): string {
  const score = a.sentiment_score ?? 0;
  const emoji = score >= 9 ? '\u{1F534}\u{1F534}' : score >= 7 ? '\u{1F534}' : score >= 5 ? '\u{1F7E1}' : '\u{1F7E2}';
  const lines = [
    `${emoji} Острое обращение \u2014 ИСН ${score}/10`,
    '',
    `\u{1F4CB} #${a.ecur_number}`,
    `\u{1F4C5} ${a.date}`,
    `\u{1F4CC} ${a.direction}${a.subtopic ? ' \u2192 ' + a.subtopic : ''}`,
    `\u{1F4CD} ${a.settlement || '\u2014'}${a.street ? ', ' + a.street : ''}${a.house ? ', \u0434. ' + a.house : ''}`,
    `\u{1F4CA} \u0421\u0442\u0430\u0442\u0443\u0441: ${a.status}`,
    `\u{1F4E1} \u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ${a.source || '\u2014'}`,
  ];
  if (a.executor) lines.push(`\u{1F464} \u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: ${a.executor}`);
  if (a.description) {
    lines.push('', '\u{1F4AC} \u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435:', a.description.slice(0, 500) + (a.description.length > 500 ? '...' : ''));
  }
  if (a.source_number) {
    lines.push('', `\u{1F517} \u0414\u043E\u0431\u0440\u043E\u0434\u0435\u043B: https://dobrodel.mosreg.ru/appeal/${a.source_number}`);
  }
  return lines.join('\n');
}

function scoreColor(s: number): string {
  if (s <= 3) return 'var(--color-status-green)';
  if (s <= 6) return 'var(--color-orange)';
  return 'var(--color-red)';
}

function trafficLabel(isn: number, acutePct: number): { label: string; status: 'green' | 'yellow' | 'red' } {
  if (isn > 6 || acutePct > 10) return { label: 'Эскалация', status: 'red' };
  if (isn > 4 || acutePct > 5) return { label: 'Внимание', status: 'yellow' };
  return { label: 'Штатный режим', status: 'green' };
}

export function ISN() {
  const { range, setRange } = useDateRange();
  const { data: appeals, isLoading, refetch } = useAppeals({
    dateFrom: range.from,
    dateTo: range.to,
  });

  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleOverrideScore = useCallback(async (id: number, newScore: number | null) => {
    try {
      // null = exclude (spam): keep score but mark as spam so AI won't re-analyze
      const update: Record<string, unknown> = newScore === null
        ? { is_spam: true }
        : { sentiment_score: newScore, is_spam: false, is_moderated: true };
      const { error } = await supabase.from('appeals').update(update).eq('id', id);
      if (error) throw error;
      setToast({ message: newScore === null ? 'Исключено из расчёта ИСН' : `Балл изменён на ${newScore}`, type: 'success' });
      if (selectedAppeal?.id === id) {
        if (newScore === null) {
          setSelectedAppeal({ ...selectedAppeal, is_spam: true });
        } else {
          setSelectedAppeal({ ...selectedAppeal, sentiment_score: newScore, is_spam: false });
        }
      }
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [refetch, selectedAppeal]);

  const analyzeRef = useRef(false);

  const handleAnalyze = useCallback(async (resetFirst = false) => {
    if (analyzeRef.current) return;
    analyzeRef.current = true;
    setAnalyzing(true);
    let totalProcessed = 0;
    try {
      if (resetFirst) {
        setAnalyzeProgress('Сброс оценок...');
        await supabase.from('appeals').update({ sentiment_score: null }).eq('is_spam', false);
      }
      while (analyzeRef.current) {
        const res = await supabase.functions.invoke('analyze-sentiment', {
          body: { batch_size: 10 },
        });
        if (res.error) throw new Error(res.error.message);
        const result = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        totalProcessed += result.processed;
        setAnalyzeProgress(`${totalProcessed} из ${totalProcessed + result.remaining}`);
        refetch(); // update UI after each batch
        if (result.remaining <= 0 || result.processed === 0) break;
      }
      setToast({ message: `Проанализировано ${totalProcessed} обращений`, type: 'success' });
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setAnalyzing(false);
      analyzeRef.current = false;
      setAnalyzeProgress('');
    }
  }, [refetch]);

  const analyzed = useMemo(() => appeals.filter(a => a.sentiment_score != null && !a.is_spam), [appeals]);
  const unanalyzed = appeals.filter(a => a.sentiment_score == null && !a.is_spam).length;

  // Auto-start analysis if there are unanalyzed appeals
  useEffect(() => {
    if (unanalyzed > 0 && !analyzing && !analyzeRef.current) {
      handleAnalyze(false);
    }
  }, [unanalyzed]); // intentionally minimal deps — run once when unanalyzed detected

  // Core metrics
  const metrics = useMemo(() => {
    if (analyzed.length === 0) return null;
    const scores = analyzed.map(a => a.sentiment_score!);
    const sumS = scores.reduce((s, v) => s + v, 0);
    const sumSq = scores.reduce((s, v) => s + v * v, 0);
    const isnWeighted = Math.round((sumSq / sumS) * 10) / 10;
    const isnSimple = Math.round((sumS / scores.length) * 10) / 10;
    const acuteCount = scores.filter(s => s >= 7).length;
    const acutePct = Math.round((acuteCount / scores.length) * 1000) / 10;
    const traffic = trafficLabel(isnWeighted, acutePct);
    return { isnWeighted, isnSimple, acuteCount, acutePct, total: analyzed.length, traffic };
  }, [analyzed]);

  // Score distribution (1-10)
  const distribution = useMemo(() => {
    const dist: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) dist[i] = 0;
    for (const a of analyzed) dist[a.sentiment_score!]++;
    const maxCount = Math.max(...Object.values(dist), 1);
    return Array.from({ length: 10 }, (_, i) => ({
      score: String(i + 1),
      count: dist[i + 1],
      pct: Math.round((dist[i + 1] / maxCount) * 100),
    }));
  }, [analyzed]);

  // By direction (top topics by avg score)
  const topicBreakdown = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const a of analyzed) {
      if (!map.has(a.direction)) map.set(a.direction, []);
      map.get(a.direction)!.push(a.sentiment_score!);
    }
    return Array.from(map.entries())
      .map(([name, scores]) => ({
        name,
        count: scores.length,
        avg: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [analyzed]);

  // Weekly ISN trend
  const weeklyTrend = useMemo(() => {
    const weekMap = new Map<string, number[]>();
    for (const a of analyzed) {
      const d = new Date(a.date);
      const day = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - day + 1);
      const weekKey = monday.toISOString().slice(0, 10);
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
      weekMap.get(weekKey)!.push(a.sentiment_score!);
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, scores]) => {
        const sumS = scores.reduce((s, v) => s + v, 0);
        const sumSq = scores.reduce((s, v) => s + v * v, 0);
        const isn = Math.round((sumSq / sumS) * 10) / 10;
        const acute = Math.round((scores.filter(s => s >= 7).length / scores.length) * 1000) / 10;
        return { week: formatDate(week), 'ИСН': isn, 'Острых %': acute };
      });
  }, [analyzed]);

  // Critical appeals (score >= 9)
  const criticalAppeals = useMemo(() => {
    return analyzed
      .filter(a => a.sentiment_score! >= 9)
      .sort((a, b) => (b.sentiment_score ?? 0) - (a.sentiment_score ?? 0));
  }, [analyzed]);

  // Acute appeals list (score 7-8)
  const acuteAppeals = useMemo(() => {
    return analyzed
      .filter(a => a.sentiment_score! >= 7 && a.sentiment_score! < 9)
      .sort((a, b) => (b.sentiment_score ?? 0) - (a.sentiment_score ?? 0))
      .slice(0, 15);
  }, [analyzed]);

  // Appeals filtered by selected score
  const scoreAppeals = useMemo(() => {
    if (selectedScore === null) return [];
    return analyzed
      .filter(a => a.sentiment_score === selectedScore)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);
  }, [analyzed, selectedScore]);

  // Topic chart data (horizontal bar by avg score)
  const topicChartData = useMemo(() => {
    return topicBreakdown
      .slice(0, 8)
      .reverse()
      .map(t => ({ name: t.name.length > 20 ? t.name.slice(0, 18) + '...' : t.name, 'Ср. балл': t.avg }));
  }, [topicBreakdown]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Индекс социального напряжения" />
        <div className={styles.kpiRow}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="card" height={160} />)}
        </div>
        <Skeleton variant="chart" height={300} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="Индекс социального напряжения" subtitle="Анализ эмоционального окраса обращений граждан">
        {unanalyzed > 0 ? (
          <button className={styles.analyzeBtn} onClick={() => handleAnalyze(false)} disabled={analyzing}>
            {analyzing ? analyzeProgress : `Анализировать (${unanalyzed})`}
          </button>
        ) : (
          <button className={styles.analyzeBtn} onClick={() => handleAnalyze(true)} disabled={analyzing}>
            {analyzing ? analyzeProgress : 'Переанализировать все'}
          </button>
        )}
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* Traffic light + KPIs */}
      {metrics ? (
        <>
          <div className={`${styles.trafficCard} ${styles[metrics.traffic.status]}`}>
            <div className={styles.trafficSignal}>
              {metrics.traffic.status === 'green' ? '✓' : metrics.traffic.status === 'yellow' ? '⚠' : '!'}
            </div>
            <div className={styles.trafficInfo}>
              <div className={styles.trafficLabel}>{metrics.traffic.label}</div>
              <div className={styles.trafficSub}>
                ИСН {metrics.isnWeighted} · Острых {metrics.acutePct}% · {metrics.total} обращений проанализировано
              </div>
            </div>
          </div>

          <div className={styles.kpiRow}>
            <KpiCard
              label="ИСН (взвешенный)"
              value={String(metrics.isnWeighted)}
              target={4}
              unit="балл"
              trend={metrics.isnWeighted <= 4 ? 'down' : 'up'}
              status={metrics.traffic.status}
              progress={Math.max(0, (10 - metrics.isnWeighted) / 10 * 100)}
              targetLabel={`Простой: ${metrics.isnSimple}`}
            />
            <KpiCard
              label="Острые обращения"
              value={`${metrics.acutePct}%`}
              target={5}
              unit="%"
              trend={metrics.acutePct <= 5 ? 'down' : 'up'}
              status={metrics.acutePct <= 5 ? 'green' : metrics.acutePct <= 10 ? 'yellow' : 'red'}
              progress={Math.max(0, (20 - metrics.acutePct) / 20 * 100)}
              targetLabel={`${metrics.acuteCount} из ${metrics.total}`}
            />
            <KpiCard
              label="Проанализировано"
              value={formatNumber(metrics.total)}
              target={0}
              unit="шт"
              trend="flat"
              status={unanalyzed === 0 ? 'green' : 'yellow'}
              progress={appeals.length > 0 ? (metrics.total / appeals.length) * 100 : 0}
              targetLabel={unanalyzed > 0 ? `Ожидает: ${unanalyzed}` : 'Все обработаны'}
            />
          </div>
        </>
      ) : (
        <div className={styles.emptyCard}>
          <p>Обращения ещё не проанализированы</p>
          <button className={styles.analyzeBtn} onClick={() => handleAnalyze(false)} disabled={analyzing}>
            {analyzing ? analyzeProgress : 'Запустить анализ'}
          </button>
        </div>
      )}

      {/* Charts */}
      {metrics && (
        <>
          <div className={styles.chartsRow}>
            <Card>
              <h4 className={styles.chartTitle}>Распределение по баллам (1–10)</h4>
              <div className={styles.distChart}>
                {distribution.map(d => (
                  <div
                    key={d.score}
                    className={`${styles.distCol} ${selectedScore === parseInt(d.score) ? styles.distColActive : ''}`}
                    onClick={() => setSelectedScore(selectedScore === parseInt(d.score) ? null : parseInt(d.score))}
                  >
                    <span className={styles.distCount}>{d.count}</span>
                    <div
                      className={styles.distBar}
                      style={{
                        height: `${d.pct}%`,
                        background: scoreColor(parseInt(d.score)),
                      }}
                    />
                    <span className={styles.distLabel}>{d.score}</span>
                  </div>
                ))}
              </div>
              {selectedScore !== null && (
                <div className={styles.scoreAppealsList}>
                  <div className={styles.scoreAppealsHeader}>
                    <span>Обращения с баллом {selectedScore} ({scoreAppeals.length})</span>
                    <button className={styles.scoreClose} onClick={() => setSelectedScore(null)}>&times;</button>
                  </div>
                  {scoreAppeals.map(a => (
                    <div key={a.id} className={styles.scoreAppealItem} onClick={() => setSelectedAppeal(a)}>
                      <span className={styles.scoreAppealDate}>{formatDate(a.date)}</span>
                      <span className={styles.scoreAppealDir}>{a.direction}</span>
                      <span className={styles.scoreAppealText}>
                        {(a.description || a.fact || '').slice(0, 120)}
                        {(a.description || '').length > 120 ? '...' : ''}
                      </span>
                    </div>
                  ))}
                  {scoreAppeals.length === 0 && (
                    <div className={styles.scoreEmpty}>Нет обращений с этим баллом</div>
                  )}
                </div>
              )}
            </Card>
            <Card>
              <Chart type="horizontal-bar" data={topicChartData} xKey="name" yKey="Ср. балл" title="Средний балл по направлениям" height={300} />
            </Card>
          </div>

          {/* Weekly trend */}
          {weeklyTrend.length > 1 && (
            <Card>
              <Chart type="line" data={weeklyTrend} xKey="week" yKey={['ИСН', 'Острых %']} title="Динамика ИСН по неделям" height={280} />
            </Card>
          )}

          {/* Critical appeals (9-10) */}
          {criticalAppeals.length > 0 && (
            <div className={styles.criticalBlock}>
              <h3 className={styles.criticalTitle}>
                <span className={styles.criticalIcon}>!</span>
                Критические обращения ({criticalAppeals.length})
              </h3>
              <div className={styles.criticalList}>
                {criticalAppeals.map(a => (
                  <div key={a.id} className={styles.criticalItem} onClick={() => setSelectedAppeal(a)}>
                    <div className={styles.criticalItemHeader}>
                      <span className={styles.criticalScore}>{a.sentiment_score}/10</span>
                      <span className={styles.criticalDirection}>{a.direction}</span>
                      <span className={styles.criticalDate}>{formatDate(a.date)}</span>
                      {a.source_number && (
                        <a
                          href={`https://dobrodel.mosreg.ru/appeal/${a.source_number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.criticalLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Добродел
                        </a>
                      )}
                      <button
                        className={styles.criticalCopy}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(formatTelegramMessage(a));
                          setToast({ message: 'Скопировано для Telegram', type: 'success' });
                        }}
                      >
                        Копировать
                      </button>
                    </div>
                    <p className={styles.criticalText}>
                      {(a.description || a.fact || '').slice(0, 300)}
                      {(a.description || '').length > 300 ? '...' : ''}
                    </p>
                    {a.settlement && (
                      <span className={styles.criticalLocation}>{a.settlement}{a.street ? ', ' + a.street : ''}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acute appeals (7-8) */}
          {acuteAppeals.length > 0 && (
            <Card>
              <h3 className={styles.sectionTitle}>Острые обращения (7–8 баллов)</h3>
              <div className={styles.acuteList}>
                {acuteAppeals.map(a => (
                  <div key={a.id} className={styles.acuteItem} onClick={() => setSelectedAppeal(a)}>
                    <div className={styles.acuteHeader}>
                      <span className={styles.acuteScore} style={{ background: scoreColor(a.sentiment_score!) }}>
                        {a.sentiment_score}
                      </span>
                      <span className={styles.acuteDirection}>{a.direction}</span>
                      <span className={styles.acuteDate}>{formatDate(a.date)}</span>
                      <span className={styles.acuteEcur}>#{a.ecur_number}</span>
                    </div>
                    <p className={styles.acuteText}>
                      {(a.description || a.fact || '').slice(0, 200)}
                      {(a.description || '').length > 200 ? '...' : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Topic breakdown table */}
          <Card>
            <h3 className={styles.sectionTitle}>Разбивка по направлениям</h3>
            <table className={styles.topicTable}>
              <thead>
                <tr>
                  <th>Направление</th>
                  <th>Обращений</th>
                  <th>Ср. балл</th>
                </tr>
              </thead>
              <tbody>
                {topicBreakdown.map(t => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td>{t.count}</td>
                    <td>
                      <span className={styles.avgBadge} style={{ background: scoreColor(t.avg), color: '#fff' }}>
                        {t.avg}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Detail slide-over */}
      <SlideOver
        open={!!selectedAppeal}
        onClose={() => { setSelectedAppeal(null); setCopied(false); }}
        title={`Обращение ${selectedAppeal?.ecur_number ?? ''}`}
      >
        {selectedAppeal && (
          <div className={styles.detail}>
            <div className={styles.detailScoreBig} style={{ background: scoreColor(selectedAppeal.sentiment_score!) }}>
              {selectedAppeal.sentiment_score}/10
            </div>

            <div className={styles.detailFields}>
              <div className={styles.df}><span className={styles.dl}>Дата</span><span>{formatDate(selectedAppeal.date)}</span></div>
              <div className={styles.df}><span className={styles.dl}>Направление</span><span>{selectedAppeal.direction}</span></div>
              {selectedAppeal.subtopic && <div className={styles.df}><span className={styles.dl}>Подтема</span><span>{selectedAppeal.subtopic}</span></div>}
              <div className={styles.df}><span className={styles.dl}>Статус</span><span>{selectedAppeal.status}</span></div>
              {selectedAppeal.source && <div className={styles.df}><span className={styles.dl}>Источник</span><span>{selectedAppeal.source}</span></div>}
              {selectedAppeal.executor && <div className={styles.df}><span className={styles.dl}>Исполнитель</span><span>{selectedAppeal.executor}</span></div>}
              {selectedAppeal.settlement && <div className={styles.df}><span className={styles.dl}>Нас. пункт</span><span>{selectedAppeal.settlement}</span></div>}
              {selectedAppeal.address && <div className={styles.df}><span className={styles.dl}>Адрес</span><span>{selectedAppeal.address}</span></div>}
            </div>

            {selectedAppeal.description && (
              <div className={styles.detailDesc}>
                <span className={styles.dl}>Описание</span>
                <p>{selectedAppeal.description}</p>
              </div>
            )}

            {selectedAppeal.source_number && (
              <a
                href={`https://dobrodel.mosreg.ru/appeal/${selectedAppeal.source_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.dobrodelLink}
              >
                Открыть в Добродел
              </a>
            )}

            <button
              className={styles.copyBtn}
              onClick={() => {
                navigator.clipboard.writeText(formatTelegramMessage(selectedAppeal));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Скопировано!' : 'Копировать для Telegram'}
            </button>

            {/* Moderation */}
            <div className={styles.modSection}>
              <span className={styles.modLabel}>Модерация балла:</span>
              <div className={styles.modButtons}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                  <button
                    key={s}
                    className={`${styles.modScoreBtn} ${selectedAppeal.sentiment_score === s ? styles.modScoreBtnActive : ''}`}
                    style={{ background: selectedAppeal.sentiment_score === s ? scoreColor(s) : undefined }}
                    onClick={() => handleOverrideScore(selectedAppeal.id, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                className={styles.modExcludeBtn}
                onClick={() => handleOverrideScore(selectedAppeal.id, null)}
              >
                Исключить из ИСН (спам / неадекват)
              </button>
            </div>
          </div>
        )}
      </SlideOver>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default ISN;
