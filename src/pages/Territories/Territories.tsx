import { useMemo } from 'react';
import { Card, Chart, Badge, Header, DateRangePicker, EmptyState, Skeleton } from '../../shared/ui';
import { useKpiData, useDateRange, useTerritories } from '../../shared/hooks';
import { formatNumber, formatPercent } from '../../shared/utils/formatters';
import { getKpiStatus, getProgressToTarget } from '../../shared/utils/kpi-helpers';
import type { KpiDefinition, KpiDataPoint } from '../../shared/types';
import styles from './Territories.module.css';

function getTargets(def: KpiDefinition) {
  return {
    d90: def.d90 ?? 0,
    d180: def.d180 ?? 0,
    d360: def.d360 ?? 0,
    base: def.base ?? 0,
  };
}

export function Territories() {
  const { range, setRange } = useDateRange();
  const { data, definitions, isLoading, error } = useKpiData({
    dateFrom: range.from,
    dateTo: range.to,
  });
  const { data: territories, isLoading: terrLoading } = useTerritories();

  const latestByKpiTerritory = useMemo(() => {
    const map = new Map<string, KpiDataPoint>();
    for (const point of data) {
      const key = `${point.kpiId}__${point.territory ?? 'total'}`;
      const existing = map.get(key);
      if (!existing || point.date > existing.date) {
        map.set(key, point);
      }
    }
    return map;
  }, [data]);

  const comparisonRows = useMemo(() => {
    return definitions.map((def) => {
      const targets = getTargets(def);
      const cells = territories.map((t) => {
        const key = `${def.id}__${t.id}`;
        const point = latestByKpiTerritory.get(key);
        const value = point?.value ?? def.current ?? 0;
        const status = getKpiStatus(value, targets.d90, def.direction);
        return { territory: t.id, value, status };
      });
      return { def, targets, cells };
    });
  }, [definitions, territories, latestByKpiTerritory]);

  const barChartData = useMemo(() => {
    return definitions.map((def) => {
      const targets = getTargets(def);
      const entry: Record<string, unknown> = {
        name: def.name.length > 20 ? def.name.slice(0, 18) + '...' : def.name,
      };
      for (const t of territories) {
        const key = `${def.id}__${t.id}`;
        const point = latestByKpiTerritory.get(key);
        const value = point?.value ?? def.current ?? 0;
        const progress = getProgressToTarget(value, targets.base, targets.d90);
        entry[t.name] = Math.round(progress);
      }
      return entry;
    });
  }, [definitions, territories, latestByKpiTerritory]);

  const territoryCards = useMemo(() => {
    return territories.map((t) => {
      const metrics = definitions.map((def) => {
        const targets = getTargets(def);
        const key = `${def.id}__${t.id}`;
        const point = latestByKpiTerritory.get(key);
        const value = point?.value ?? def.current ?? 0;
        const status = getKpiStatus(value, targets.d90, def.direction);
        const progress = getProgressToTarget(value, targets.base, targets.d90);
        return { def, value, status, progress, target: targets.d90 };
      });

      const greenCount = metrics.filter((m) => m.status === 'green').length;
      const yellowCount = metrics.filter((m) => m.status === 'yellow').length;
      const redCount = metrics.filter((m) => m.status === 'red').length;
      const avgProgress =
        metrics.length > 0
          ? Math.round(metrics.reduce((sum, m) => sum + m.progress, 0) / metrics.length)
          : 0;

      return { territory: t, metrics, greenCount, yellowCount, redCount, avgProgress };
    });
  }, [definitions, territories, latestByKpiTerritory]);

  if (isLoading || terrLoading) {
    return (
      <div className={styles.page}>
        <Header title="Территории" />
        <Skeleton variant="card" height={300} />
        <Skeleton variant="chart" height={320} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Header title="Территории" />
        <EmptyState title="Ошибка загрузки" description={error.message} />
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className={styles.page}>
        <Header title="Территории" />
        <EmptyState title="Нет данных" description="Данные KPI не найдены для отображения" />
      </div>
    );
  }

  if (territories.length === 0) {
    return (
      <div className={styles.page}>
        <Header title="Территории" />
        <EmptyState title="Нет территорий" description="Добавьте территории в Настройках" />
      </div>
    );
  }

  const formatValue = (value: number, def: KpiDefinition) =>
    def.unit === '%' || def.unit === '%/кв' ? formatPercent(value) : formatNumber(value, 1);

  return (
    <div className={styles.page}>
      <Header title="Территории">
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      {/* Comparison Table */}
      <Card>
        <h3 className={styles.sectionTitle}>Сравнение территорий по KPI</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.comparisonTable}>
            <thead>
              <tr>
                <th className={styles.kpiNameCol}>Показатель</th>
                {territories.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.def.id}>
                  <td className={styles.kpiNameCol}>
                    <span className={styles.kpiName}>{row.def.name}</span>
                    <span className={styles.kpiUnit}>{row.def.unit}</span>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={cell.territory} className={styles.valueCell}>
                      <span className={styles.cellValue}>
                        {formatValue(cell.value, row.def)}
                      </span>
                      <Badge status={cell.status} size="sm" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bar Chart */}
      <Card>
        <Chart
          type="bar"
          data={barChartData}
          xKey="name"
          yKey={territories.map((t) => t.name)}
          title="Достижение целей по территориям, % от D90"
          height={360}
        />
      </Card>

      {/* Territory Cards */}
      <div className={styles.cardsRow}>
        {territoryCards.map((card) => (
          <Card key={card.territory.id}>
            <div className={styles.territoryCard}>
              <h3 className={styles.territoryName}>{card.territory.name}</h3>

              <div className={styles.summaryRow}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{card.avgProgress}%</span>
                  <span className={styles.summaryLabel}>Среднее достижение</span>
                </div>
                <div className={styles.statusSummary}>
                  <span className={styles.statusCount}>
                    <Badge status="green" size="sm" /> {card.greenCount}
                  </span>
                  <span className={styles.statusCount}>
                    <Badge status="yellow" size="sm" /> {card.yellowCount}
                  </span>
                  <span className={styles.statusCount}>
                    <Badge status="red" size="sm" /> {card.redCount}
                  </span>
                </div>
              </div>

              <div className={styles.metricsList}>
                {card.metrics.map((m) => (
                  <div key={m.def.id} className={styles.metricItem}>
                    <span className={styles.metricName}>{m.def.name}</span>
                    <div className={styles.metricValues}>
                      <span className={styles.metricValue}>
                        {formatValue(m.value, m.def)}
                      </span>
                      <Badge status={m.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default Territories;
