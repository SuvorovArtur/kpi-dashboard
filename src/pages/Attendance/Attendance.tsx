import { useState, useMemo, useCallback } from 'react';
import { Card, Header, Skeleton, Toast } from '../../shared/ui';
import { useAttendance } from '../../shared/hooks/useAttendance';
import { TARGET_PCT, MONTHS, QUARTERS, daysInMonth, pct, avg, statusColor, monthAvg, formatDateISO } from './utils';
import styles from './Attendance.module.css';

type Tab = 'input' | 'month' | 'quarter' | 'year';

function PctBadge({ val, size }: { val: number | null; size?: 'sm' | 'md' }) {
  if (val === null || val === undefined) return <span className={styles.pctEmpty}>—</span>;
  const color = statusColor(val);
  const display = val > 999 ? '>999%' : `${val}%`;
  return <span className={`${styles.pctBadge} ${styles[`pct_${color}`]} ${size === 'sm' ? styles.pctSm : ''}`}>{display}</span>;
}

function MiniBar({ val }: { val: number | null }) {
  if (val === null) return null;
  const w = Math.min(100, Math.max(0, val));
  const color = val >= TARGET_PCT ? 'var(--color-status-green)' : val >= 70 ? 'var(--color-orange)' : 'var(--color-red)';
  return <div className={styles.miniBar}><div className={styles.miniBarFill} style={{ width: `${w}%`, background: color }} /></div>;
}

export function Attendance() {
  const today = new Date();
  const [tab, setTab] = useState<Tab>('input');
  const [selYear, setSelYear] = useState(today.getFullYear());
  const [selMonth, setSelMonth] = useState(today.getMonth());
  const [selQuarter, setSelQuarter] = useState(Math.floor(today.getMonth() / 3));
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { isLoading, getPlan, saveRecord, deleteRecord, savePlan, getMonthRecords } = useAttendance();

  const curMonthRecs = useMemo(() => getMonthRecords(selYear, selMonth), [getMonthRecords, selYear, selMonth]);
  const curPlan = getPlan(selYear, selMonth);

  const getMonthAvg = useCallback((y: number, m: number) => {
    return monthAvg(getMonthRecords(y, m), getPlan(y, m), y, m);
  }, [getMonthRecords, getPlan]);

  const getQuarterAvg = useCallback((y: number, q: number) => {
    return avg(QUARTERS[q].map(m => getMonthAvg(y, m)));
  }, [getMonthAvg]);

  const getYearAvg = useCallback((y: number) => {
    return avg(Array.from({ length: 12 }, (_, m) => getMonthAvg(y, m)));
  }, [getMonthAvg]);

  if (isLoading) {
    return <div className={styles.page}><Header title="Выход сотрудников на линию" /><Skeleton variant="card" height={300} /></div>;
  }

  return (
    <div className={styles.page}>
      <Header title="Выход сотрудников на линию">
        <div className={styles.yearAvgBadge}>
          <span className={styles.yearAvgLabel}>{selYear}</span>
          <PctBadge val={getYearAvg(selYear)} />
        </div>
      </Header>

      {/* Toolbar: tabs + period selectors in one row */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {([['input', 'Ввод'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год']] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div className={styles.controls}>
          <select className={styles.select} value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
            {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {tab !== 'year' && tab !== 'quarter' && (
            <select className={styles.select} value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          )}
          {tab === 'quarter' && (
            <select className={styles.select} value={selQuarter} onChange={e => setSelQuarter(Number(e.target.value))}>
              {[0, 1, 2, 3].map(q => <option key={q} value={q}>Q{q + 1}</option>)}
            </select>
          )}
        </div>
      </div>

      {tab === 'input' && <InputTab curMonthRecs={curMonthRecs} curPlan={curPlan} selYear={selYear} selMonth={selMonth} today={today} getMonthAvg={getMonthAvg} savePlan={savePlan} saveRecord={saveRecord} deleteRecord={deleteRecord} setToast={setToast} />}
      {tab === 'month' && <MonthTab curMonthRecs={curMonthRecs} curPlan={curPlan} selYear={selYear} selMonth={selMonth} today={today} getMonthAvg={getMonthAvg} />}
      {tab === 'quarter' && <QuarterTab selYear={selYear} selQuarter={selQuarter} getMonthAvg={getMonthAvg} getQuarterAvg={getQuarterAvg} />}
      {tab === 'year' && <YearTab selYear={selYear} getMonthAvg={getMonthAvg} getQuarterAvg={getQuarterAvg} getYearAvg={getYearAvg} today={today} />}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ===== INPUT TAB — compact single card ===== */
function InputTab({ curMonthRecs, curPlan, selYear, selMonth, today, getMonthAvg, savePlan, saveRecord, deleteRecord, setToast }: any) {
  const [editDay, setEditDay] = useState(today.getDate());
  const [inputFact, setInputFact] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [tempPlan, setTempPlan] = useState('');

  const curRec = curMonthRecs.get(editDay) ?? null;
  const curFact = inputFact !== '' ? Number(inputFact) : (curRec?.fact ?? null);
  const curPct = curFact !== null ? pct(curFact, curPlan) : null;

  async function handleSave() {
    if (inputFact === '') return;
    setSaving(true);
    try {
      await saveRecord(formatDateISO(selYear, selMonth, editDay), Number(inputFact), curPlan);
      setToast({ message: 'Сохранено', type: 'success' });
    } catch (err: any) { setToast({ message: err.message, type: 'error' }); }
    setSaving(false);
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteRecord(formatDateISO(selYear, selMonth, editDay));
      setInputFact('');
      setToast({ message: 'Удалено', type: 'success' });
    } catch (err: any) { setToast({ message: err.message, type: 'error' }); }
    setSaving(false);
  }

  return (
    <Card>
      {/* Header row: month avg + plan */}
      <div className={styles.inputHeader}>
        <div className={styles.inputAvg}>
          <span className={styles.inputAvgLabel}>Среднее:</span>
          <PctBadge val={getMonthAvg(selYear, selMonth)} />
        </div>
        <div className={styles.planEdit}>
          <span className={styles.planLabel}>План:</span>
          {editingPlan ? (
            <div className={styles.planEditRow}>
              <input type="number" value={tempPlan} onChange={e => setTempPlan(e.target.value)} className={styles.planInput} />
              <button onClick={() => { savePlan(selYear, selMonth, Number(tempPlan)); setEditingPlan(false); }} className={styles.planSaveBtn}>Сохранить</button>
              <button onClick={() => setEditingPlan(false)} className={styles.planCancelBtn} aria-label="Отменить изменение плана">Отмена</button>
            </div>
          ) : (
            <div className={styles.planDisplay}>
              <strong>{curPlan}</strong>
              <button onClick={() => { setTempPlan(String(curPlan)); setEditingPlan(true); }} className={styles.planEditBtn} aria-label="Изменить план">Изменить</button>
            </div>
          )}
        </div>
      </div>

      {/* Compact day grid */}
      <div className={styles.dayGrid}>
        {Array.from({ length: daysInMonth(selYear, selMonth) }, (_, i) => {
          const d = i + 1;
          const rec = curMonthRecs.get(d);
          const hasFact = !!rec;
          const isActive = d === editDay;
          const isToday = d === today.getDate() && selMonth === today.getMonth() && selYear === today.getFullYear();
          return (
            <button key={d}
              onClick={() => { setEditDay(d); setInputFact(rec?.fact?.toString() ?? ''); }}
              className={`${styles.dayBtn} ${isActive ? styles.dayBtnActive : hasFact ? styles.dayBtnFilled : ''} ${isToday ? styles.dayBtnToday : ''}`}
            >{d}</button>
          );
        })}
      </div>

      {/* Inline fact input */}
      <div className={styles.factRow}>
        <span className={styles.factLabel}>День {editDay}</span>
        <input type="number" value={inputFact} onChange={e => setInputFact(e.target.value)}
          className={styles.factField} placeholder="—"
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
        <span className={styles.factOf}>/ {curPlan}</span>
        <PctBadge val={curPct} />
        <div className={styles.factActions}>
          <button onClick={handleSave} disabled={saving || inputFact === ''} className={styles.saveBtn}>
            {saving ? '…' : 'Сохранить'}
          </button>
          {curRec && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className={styles.deleteBtn}
              aria-label="Удалить запись за этот день"
              title="Удалить запись за этот день"
            >
              Удалить
            </button>
          )}
        </div>
      </div>

      {/* Chart integrated */}
      <AttendanceChart curMonthRecs={curMonthRecs} curPlan={curPlan} selYear={selYear} selMonth={selMonth} />
    </Card>
  );
}

/* ===== MONTH TAB — table + chart in one card ===== */
function MonthTab({ curMonthRecs, curPlan, selYear, selMonth, today, getMonthAvg }: any) {
  const days = daysInMonth(selYear, selMonth);
  return (
    <Card>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>День</th><th>План</th><th>Факт</th><th>%</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1;
              const rec = curMonthRecs.get(d);
              const isToday = d === today.getDate() && selMonth === today.getMonth() && selYear === today.getFullYear();
              return (
                <tr key={d} className={isToday ? styles.rowToday : i % 2 === 0 ? styles.rowEven : ''}>
                  <td className={styles.tdDay}>{d}{isToday ? ' •' : ''}</td>
                  <td className={styles.tdCenter}>{curPlan}</td>
                  <td className={styles.tdCenter}>{rec ? rec.fact : '—'}</td>
                  <td className={styles.tdCenter}><PctBadge val={rec ? pct(rec.fact, curPlan) : null} size="sm" /></td>
                </tr>
              );
            })}
            <tr className={styles.rowAvg}>
              <td className={styles.tdDay}>Среднее</td>
              <td /><td />
              <td className={styles.tdCenter}><PctBadge val={getMonthAvg(selYear, selMonth)} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className={styles.chartSection}>
        <AttendanceChart curMonthRecs={curMonthRecs} curPlan={curPlan} selYear={selYear} selMonth={selMonth} />
      </div>
    </Card>
  );
}

/* ===== QUARTER TAB — compact 3-column layout ===== */
function QuarterTab({ selYear, selQuarter, getMonthAvg, getQuarterAvg }: any) {
  return (
    <div className={styles.stack}>
      <Card>
        <div className={styles.quarterHeader}>
          <span className={styles.quarterTitle}>Q{selQuarter + 1} {selYear}</span>
          <PctBadge val={getQuarterAvg(selYear, selQuarter)} />
        </div>
        <div className={styles.quarterGrid}>
          {QUARTERS[selQuarter].map((m: number) => {
            const val = getMonthAvg(selYear, m);
            return (
              <div key={m} className={styles.quarterCell}>
                <div className={styles.quarterCellHeader}>
                  <span>{MONTHS[m]}</span>
                  <PctBadge val={val} size="sm" />
                </div>
                <MiniBar val={val} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ===== YEAR TAB — table with mini bars ===== */
function YearTab({ selYear, getMonthAvg, getQuarterAvg, getYearAvg, today }: any) {
  return (
    <Card>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Период</th><th className={styles.thBar}></th><th>%</th></tr></thead>
          <tbody>
            {MONTHS.map((mon, m) => {
              const val = getMonthAvg(selYear, m);
              const isCur = m === today.getMonth() && selYear === today.getFullYear();
              return (
                <tr key={m} className={isCur ? styles.rowToday : m % 2 === 0 ? styles.rowEven : ''}>
                  <td className={styles.tdDay}>{mon}{isCur ? ' •' : ''}</td>
                  <td><MiniBar val={val} /></td>
                  <td className={styles.tdCenter}><PctBadge val={val} size="sm" /></td>
                </tr>
              );
            })}
            {[0, 1, 2, 3].map(q => (
              <tr key={`q${q}`} className={styles.rowQuarter}>
                <td className={styles.tdDay}>Q{q + 1}</td>
                <td><MiniBar val={getQuarterAvg(selYear, q)} /></td>
                <td className={styles.tdCenter}><PctBadge val={getQuarterAvg(selYear, q)} size="sm" /></td>
              </tr>
            ))}
            <tr className={styles.rowAvg}>
              <td className={styles.tdDay}>Год</td>
              <td><MiniBar val={getYearAvg(selYear)} /></td>
              <td className={styles.tdCenter}><PctBadge val={getYearAvg(selYear)} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ===== SVG LINE CHART WITH TOOLTIP ===== */
function AttendanceChart({ curMonthRecs, curPlan, selYear, selMonth }: any) {
  const [tooltip, setTooltip] = useState<{ svgX: number; day: number; fact: number; plan: number; val: number } | null>(null);
  const days = daysInMonth(selYear, selMonth);
  const W = 600, H = 150, PL = 32, PR = 20, PT = 12, PB = 22;
  const cw = W - PL - PR, ch = H - PT - PB;

  const points: { day: number; val: number; fact: number }[] = [];
  for (let d = 1; d <= days; d++) {
    const rec = curMonthRecs.get(d);
    if (rec) {
      const p = pct(rec.fact, curPlan);
      if (p !== null) points.push({ day: d, val: p, fact: rec.fact });
    }
  }

  const maxVal = Math.max(100, ...points.map(p => p.val));
  const yMax = Math.ceil(maxVal / 25) * 25 + 10;
  const n = points.length;
  const sx = (day: number) => PL + ((day - 1) / (days - 1)) * cw;
  const sy = (v: number) => PT + ch - (v / yMax) * ch;
  const targetY = sy(TARGET_PCT);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (n === 0) { setTooltip(null); return; }
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const mx = pt.matrixTransform(svg.getScreenCTM()!.inverse()).x;

    let closest = points[0], minDist = Infinity;
    for (const p of points) { const d = Math.abs(sx(p.day) - mx); if (d < minDist) { minDist = d; closest = p; } }
    if (minDist > 15) { setTooltip(null); return; }
    setTooltip({ svgX: sx(closest.day), day: closest.day, fact: closest.fact, plan: curPlan, val: closest.val });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      {[0, 25, 50, 75, 100].map(t => (
        <g key={t}>
          <line x1={PL} y1={sy(t)} x2={W - PR} y2={sy(t)} stroke="#f3f4f6" strokeWidth="1" />
          <text x={PL - 4} y={sy(t) + 3} textAnchor="end" fontSize="8" fill="#bbb">{t}</text>
        </g>
      ))}
      <line x1={PL} y1={targetY} x2={W - PR} y2={targetY} stroke="#ef4444" strokeWidth="1.2" strokeDasharray="4,3" />
      <text x={W - PR + 2} y={targetY + 3} fontSize="8" fill="#ef4444">{TARGET_PCT}%</text>
      {n > 1 && <polyline points={points.map(p => `${sx(p.day)},${sy(p.val)}`).join(' ')} fill="none" stroke="var(--color-teal)" strokeWidth="2" strokeLinejoin="round" />}
      {points.map((p, i) => <circle key={i} cx={sx(p.day)} cy={sy(p.val)} r={tooltip?.day === p.day ? 5 : 3} fill="var(--color-teal)" />)}
      {Array.from({ length: days }, (_, i) => i + 1).filter(d => d % Math.ceil(days / 10) === 0 || d === 1).map(d => (
        <text key={d} x={sx(d)} y={H - 4} textAnchor="middle" fontSize="8" fill="#bbb">{d}</text>
      ))}
      {tooltip && (() => {
        const tx = Math.min(Math.max(tooltip.svgX + 6, PL), W - 110);
        const color = tooltip.val >= TARGET_PCT ? '#16a34a' : tooltip.val >= 70 ? '#ca8a04' : '#dc2626';
        return (
          <g>
            <line x1={tooltip.svgX} y1={PT} x2={tooltip.svgX} y2={H - PB} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,2" />
            <rect x={tx} y={PT} width={100} height={42} rx="5" fill="white" stroke="#e2e8f0" />
            <text x={tx + 6} y={PT + 13} fontSize="9" fontWeight="bold" fill="#475569">День {tooltip.day}</text>
            <text x={tx + 6} y={PT + 26} fontSize="8" fill="#64748b">{tooltip.fact} из {tooltip.plan}</text>
            <text x={tx + 6} y={PT + 38} fontSize="10" fontWeight="bold" fill={color}>{tooltip.val}%</text>
          </g>
        );
      })()}
    </svg>
  );
}

export default Attendance;
