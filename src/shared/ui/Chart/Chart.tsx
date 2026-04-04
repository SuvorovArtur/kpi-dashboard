import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import type { ValueType } from 'recharts/types/component/DefaultTooltipContent';
import styles from './Chart.module.css';

interface ChartProps {
  type: 'line' | 'bar' | 'area' | 'pie' | 'radar' | 'horizontal-bar';
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string | string[];
  color?: string | string[];
  title?: string;
  height?: number;
}

const DEFAULT_COLORS = [
  'var(--color-teal)',
  'var(--color-orange)',
  'var(--color-red)',
  'var(--color-status-green)',
  'var(--color-status-yellow)',
];

function resolveColors(color: string | string[] | undefined, count: number): string[] {
  if (!color) return DEFAULT_COLORS.slice(0, count);
  if (Array.isArray(color)) return color;
  return [color];
}

function formatRu(val: ValueType): string {
  if (typeof val === 'number') {
    return val.toLocaleString('ru-RU');
  }
  return String(val);
}

function CustomTooltip(props: any) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{String(label)}</div>
      {payload.map((entry: any, i: number) => (
        <div key={i} className={styles.tooltipItem}>
          <span
            className={styles.tooltipDot}
            style={{ background: entry.color }}
          />
          <span style={{ color: entry.color }}>
            {entry.name}: {formatRu(entry.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RadarTooltip(props: any) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{d.subject}</div>
      <div className={styles.tooltipItem}>
        <span style={{ fontWeight: 600 }}>Факт: {d.displayValue}</span>
      </div>
      {d.targetLabel && (
        <div className={styles.tooltipItem}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{d.targetLabel}</span>
        </div>
      )}
      <div className={styles.tooltipItem}>
        <span className={styles.tooltipDot} style={{ background: d.value >= 70 ? 'var(--color-status-green)' : d.value >= 40 ? 'var(--color-orange)' : 'var(--color-red)' }} />
        <span>Исполнение: {d.value}%</span>
      </div>
    </div>
  );
}

export function Chart({
  type,
  data,
  xKey,
  yKey,
  color,
  title,
  height = 300,
}: ChartProps) {
  const yKeys = Array.isArray(yKey) ? yKey : [yKey];
  const colors = resolveColors(color, yKeys.length);

  const renderCartesian = (
    ChartComponent: typeof LineChart | typeof BarChart | typeof AreaChart,
    renderSeries: () => React.ReactNode,
  ) => (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComponent data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
          axisLine={{ stroke: 'var(--color-border)' }}
          tickLine={false}
          angle={ChartComponent === BarChart ? -30 : 0}
          textAnchor={ChartComponent === BarChart ? 'end' : 'middle'}
          height={ChartComponent === BarChart ? 80 : 30}
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => v.toLocaleString('ru-RU')}
        />
        <RechartsTooltip content={<CustomTooltip />} />
        {yKeys.length > 1 && <Legend />}
        {renderSeries()}
      </ChartComponent>
    </ResponsiveContainer>
  );

  return (
    <div className={styles.wrapper}>
      {title && <h4 className={styles.title}>{title}</h4>}

      {type === 'line' &&
        renderCartesian(LineChart, () =>
          yKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          )),
        )}

      {type === 'bar' &&
        renderCartesian(BarChart, () =>
          yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              radius={[4, 4, 0, 0]}
            />
          )),
        )}

      {type === 'area' &&
        renderCartesian(AreaChart, () =>
          yKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          )),
        )}

      {type === 'pie' && (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={height / 3}
              label={(props: any) =>
                `${String(props.name || '')}: ${formatRu(props.value as number)}`
              }
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={colors[i % colors.length]}
                />
              ))}
            </Pie>
            <RechartsTooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}

      {type === 'horizontal-bar' && (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toLocaleString('ru-RU')}
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
              axisLine={false}
              tickLine={false}
              width={160}
            />
            <RechartsTooltip content={<CustomTooltip />} />
            {yKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                radius={[0, 4, 4, 0]}
                barSize={20}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {type === 'radar' && (
        <ResponsiveContainer width="100%" height={height}>
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="48%">
            <PolarGrid stroke="var(--color-border)" gridType="polygon" />
            <PolarAngleAxis
              dataKey="subject"
              tick={(tickProps: any) => {
                const { x, y, payload } = tickProps;
                const item = data.find((d: any) => d.subject === payload.value);
                const fact = item?.displayValue ?? '';
                const pct = item?.value ?? 0;
                const factColor = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';
                return (
                  <g>
                    <text x={x} y={y - 2} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-text-primary)">
                      {payload.value}
                    </text>
                    <text x={x} y={y + 14} textAnchor="middle" fontSize={14} fontWeight={700} fill={factColor}>
                      {fact}
                    </text>
                  </g>
                );
              }}
            />
            <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
            <Radar
              dataKey="value"
              stroke={colors[0]}
              fill={colors[0]}
              fillOpacity={0.25}
              strokeWidth={2.5}
              dot={{ r: 4, fill: colors[0], strokeWidth: 0 }}
            />
            <RechartsTooltip content={<RadarTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
