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
  type: 'line' | 'bar' | 'area' | 'pie' | 'radar';
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
          tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
          axisLine={{ stroke: 'var(--color-border)' }}
          tickLine={false}
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

      {type === 'radar' && (
        <ResponsiveContainer width="100%" height={height}>
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
            />
            <PolarRadiusAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} />
            <Radar
              dataKey="value"
              stroke={colors[0]}
              fill={colors[0]}
              fillOpacity={0.2}
              strokeWidth={2}
            />
            <RechartsTooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
