import { useMemo } from 'react';
import { Card, KpiCard, Chart, DataTable, Header, Skeleton } from '../../shared/ui';
import { useStaff } from '../../shared/hooks';
import { formatNumber, formatPercent, formatDate } from '../../shared/utils/formatters';
import type { StaffMetrics } from '../../shared/types';
import type { Column } from '../../shared/ui';
import styles from './Staff.module.css';

export function Staff() {
  const { data, isLoading } = useStaff();

  const latest = useMemo(() => {
    if (data.length === 0) return null;
    return data[data.length - 1];
  }, [data]);

  // Turnover by quarter line chart
  const turnoverChartData = useMemo(() => {
    return data.map((d) => ({
      date: formatDate(d.date),
      'Текучесть, %': d.turnoverPercent,
    }));
  }, [data]);

  // Donut chart: AUP vs Workers (latest quarter)
  const ratioChartData = useMemo(() => {
    if (!latest) return [];
    return [
      { name: 'АУП', value: latest.aup },
      { name: 'Рабочие', value: latest.workers },
    ];
  }, [latest]);

  // Stacked bar: staffing vs target
  const staffingChartData = useMemo(() => {
    return data.map((d) => ({
      date: formatDate(d.date),
      'Штатная': 200,
      'Фактическая': d.totalStaff,
    }));
  }, [data]);

  // Table columns
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
  ], []);

  const tableData = useMemo(() => {
    return data.map((d: StaffMetrics) => ({
      date: formatDate(d.date),
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
        <Skeleton variant="chart" height={300} />
      </div>
    );
  }

  if (!latest) {
    return (
      <div className={styles.page}>
        <Header title="Кадры" />
        <div className={styles.emptyMessage}>Нет данных о кадрах</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="Кадры" />

      {/* KPI Cards */}
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
          unit="\u20BD"
          status={latest.avgWorkerSalary >= 52000 ? 'green' : latest.avgWorkerSalary >= 45000 ? 'yellow' : 'red'}
          trend="flat"
          progress={0}
        />
      </div>

      {/* Charts Row: Turnover + Ratio */}
      <div className={styles.chartsRow}>
        <Card>
          <Chart
            type="line"
            data={turnoverChartData}
            xKey="date"
            yKey="Текучесть, %"
            title="Текучесть кадров по кварталам"
            height={300}
          />
        </Card>
        <Card>
          <Chart
            type="pie"
            data={ratioChartData}
            xKey="name"
            yKey="value"
            title={`АУП vs Рабочие (цель 65:135)`}
            height={300}
          />
        </Card>
      </div>

      {/* Stacked bar: Staffing */}
      <Card>
        <Chart
          type="bar"
          data={staffingChartData}
          xKey="date"
          yKey={['Штатная', 'Фактическая']}
          title="Штатная vs фактическая численность (цель — 200)"
          height={320}
        />
      </Card>

      {/* Data Table */}
      <Card>
        <h3 className={styles.sectionTitle}>Кадровые показатели по кварталам</h3>
        <DataTable
          columns={columns}
          data={tableData}
          pageSize={10}
          exportFilename="staff-data"
        />
      </Card>
    </div>
  );
}

export default Staff;
