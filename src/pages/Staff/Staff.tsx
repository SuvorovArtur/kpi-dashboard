import { useState, useMemo, useCallback } from 'react';
import { Card, KpiCard, Chart, DataTable, Header, Skeleton, Toast } from '../../shared/ui';
import { useStaff } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import { supabase } from '../../shared/lib/supabase';
import type { StaffMetrics } from '../../shared/types';
import type { Column } from '../../shared/ui';
import styles from './Staff.module.css';

export function Staff() {
  const { data, isLoading, refetch } = useStaff();

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formTotalStaff, setFormTotalStaff] = useState('');
  const [formAup, setFormAup] = useState('');
  const [formWorkers, setFormWorkers] = useState('');
  const [formVacancies, setFormVacancies] = useState('');
  const [formVacancies30d, setFormVacancies30d] = useState('');
  const [formTurnover, setFormTurnover] = useState('');
  const [formSalary, setFormSalary] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAdd = useCallback(async () => {
    if (!formTotalStaff) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('staff_metrics').upsert(
        {
          date: formDate,
          total_staff: parseInt(formTotalStaff),
          aup: parseInt(formAup) || 0,
          workers: parseInt(formWorkers) || 0,
          vacancies: parseInt(formVacancies) || 0,
          vacancies_over_30d: parseInt(formVacancies30d) || 0,
          turnover_percent: parseFloat(formTurnover) || 0,
          avg_worker_salary: parseFloat(formSalary) || 0,
        },
        { onConflict: 'date' },
      );
      if (error) throw error;
      setToast({ message: 'Кадровые данные сохранены', type: 'success' });
      setShowAddForm(false);
      setFormTotalStaff('');
      setFormAup('');
      setFormWorkers('');
      setFormVacancies('');
      setFormVacancies30d('');
      setFormTurnover('');
      setFormSalary('');
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [formDate, formTotalStaff, formAup, formWorkers, formVacancies, formVacancies30d, formTurnover, formSalary, refetch]);

  const handleDelete = useCallback(async (date: string) => {
    try {
      const { error } = await supabase.from('staff_metrics').delete().eq('date', date);
      if (error) throw error;
      setToast({ message: 'Запись удалена', type: 'success' });
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [refetch]);

  const latest = useMemo(() => {
    if (data.length === 0) return null;
    return data[data.length - 1];
  }, [data]);

  const turnoverChartData = useMemo(() => {
    return data.map((d) => ({
      date: formatDate(d.date),
      'Текучесть, %': d.turnoverPercent,
    }));
  }, [data]);

  const ratioChartData = useMemo(() => {
    if (!latest) return [];
    return [
      { name: 'АУП', value: latest.aup },
      { name: 'Рабочие', value: latest.workers },
    ];
  }, [latest]);

  const staffingChartData = useMemo(() => {
    return data.map((d) => ({
      date: formatDate(d.date),
      'Штатная': 200,
      'Фактическая': d.totalStaff,
    }));
  }, [data]);

  const columns: Column<Record<string, unknown>>[] = useMemo(() => [
    { key: 'date', title: 'Квартал', sortable: true },
    { key: 'totalStaff', title: 'Штат', sortable: true },
    { key: 'aup', title: 'АУП', sortable: true },
    { key: 'workers', title: 'Рабочие', sortable: true },
    { key: 'vacancies', title: 'Вакансии', sortable: true },
    { key: 'vacanciesOver30d', title: 'Вак. >30д', sortable: true },
    {
      key: 'turnoverPercent',
      title: 'Текучесть',
      sortable: true,
      render: (value: unknown) => formatPercent(value as number),
    },
    {
      key: 'avgWorkerSalary',
      title: 'Ср. ЗП',
      sortable: true,
      render: (value: unknown) => `${formatNumber(value as number)} \u20BD`,
    },
    {
      key: 'rawDate',
      title: '',
      render: (_val: unknown, row: Record<string, unknown>) => (
        <button
          className={styles.deleteBtn}
          onClick={() => handleDelete(String(row.rawDate))}
          title="Удалить"
        >
          &times;
        </button>
      ),
    },
  ], [handleDelete]);

  const tableData = useMemo(() => {
    return data.map((d: StaffMetrics) => ({
      date: formatDate(d.date),
      rawDate: d.date,
      totalStaff: d.totalStaff,
      aup: d.aup,
      workers: d.workers,
      vacancies: d.vacancies,
      vacanciesOver30d: d.vacanciesOver30d,
      turnoverPercent: d.turnoverPercent,
      avgWorkerSalary: d.avgWorkerSalary,
    } as Record<string, unknown>));
  }, [data]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Кадры" />
        <div className={styles.kpiGrid}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="card" height={140} />
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
      <Header title="Кадры" />

      {/* KPI Cards */}
      {latest && (
        <div className={styles.kpiGrid}>
          <KpiCard
            label="Численность персонала"
            value={formatNumber(latest.totalStaff)}
            target={200}
            unit="чел."
            status={latest.totalStaff >= 190 ? 'green' : latest.totalStaff >= 170 ? 'yellow' : 'red'}
            trend="flat"
            progress={0}
          />
          <KpiCard
            label="Текучесть кадров"
            value={formatPercent(latest.turnoverPercent)}
            target={5}
            unit="%"
            status={latest.turnoverPercent <= 5 ? 'green' : latest.turnoverPercent <= 8 ? 'yellow' : 'red'}
            trend="flat"
            progress={0}
          />
          <KpiCard
            label="Вакансии >30 дней"
            value={formatNumber(latest.vacanciesOver30d)}
            target={0}
            unit="шт"
            status={latest.vacanciesOver30d <= 3 ? 'green' : latest.vacanciesOver30d <= 8 ? 'yellow' : 'red'}
            trend="flat"
            progress={0}
          />
          <KpiCard
            label="Средняя ЗП рабочих"
            value={`${formatNumber(latest.avgWorkerSalary)} \u20BD`}
            target={55000}
            unit={'\u20BD'}
            status={latest.avgWorkerSalary >= 52000 ? 'green' : latest.avgWorkerSalary >= 45000 ? 'yellow' : 'red'}
            trend="flat"
            progress={0}
          />
        </div>
      )}

      {/* Charts */}
      {data.length > 0 && (
        <>
          <div className={styles.chartsRow}>
            <Card>
              <Chart type="line" data={turnoverChartData} xKey="date" yKey="Текучесть, %" title="Текучесть кадров по кварталам" height={300} />
            </Card>
            <Card>
              <Chart type="pie" data={ratioChartData} xKey="name" yKey="value" title="АУП vs Рабочие (цель 65:135)" height={300} />
            </Card>
          </div>
          <Card>
            <Chart type="bar" data={staffingChartData} xKey="date" yKey={['Штатная', 'Фактическая']} title="Штатная vs фактическая численность (цель — 200)" height={320} />
          </Card>
        </>
      )}

      {/* Data Table */}
      <Card>
        <div className={styles.tableHeader}>
          <h3 className={styles.sectionTitle}>Кадровые показатели по кварталам</h3>
          <button className={styles.addBtn} onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Отмена' : '+ Добавить данные'}
          </button>
        </div>

        {showAddForm && (
          <div className={styles.addForm}>
            <div className={styles.addFormRow}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Дата (конец квартала)</label>
                <input type="date" className={styles.formInput} value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Общая численность</label>
                <input type="number" className={styles.formInput} value={formTotalStaff} onChange={(e) => setFormTotalStaff(e.target.value)} placeholder="200" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>АУП</label>
                <input type="number" className={styles.formInput} value={formAup} onChange={(e) => setFormAup(e.target.value)} placeholder="65" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Рабочие</label>
                <input type="number" className={styles.formInput} value={formWorkers} onChange={(e) => setFormWorkers(e.target.value)} placeholder="135" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Вакансии</label>
                <input type="number" className={styles.formInput} value={formVacancies} onChange={(e) => setFormVacancies(e.target.value)} placeholder="0" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Вакансии &gt;30 дней</label>
                <input type="number" className={styles.formInput} value={formVacancies30d} onChange={(e) => setFormVacancies30d(e.target.value)} placeholder="0" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Текучесть, %</label>
                <input type="number" step="0.1" className={styles.formInput} value={formTurnover} onChange={(e) => setFormTurnover(e.target.value)} placeholder="0.0" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Ср. ЗП рабочих, &#8381;</label>
                <input type="number" className={styles.formInput} value={formSalary} onChange={(e) => setFormSalary(e.target.value)} placeholder="50000" />
              </div>
            </div>
            <button className={styles.saveBtn} onClick={handleAdd} disabled={saving || !formTotalStaff}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        )}

        {tableData.length === 0 ? (
          <div className={styles.emptyMessage}>Нет данных о кадрах. Добавьте первую запись.</div>
        ) : (
          <DataTable columns={columns} data={tableData} pageSize={10} exportFilename="staff-data" />
        )}
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Staff;
