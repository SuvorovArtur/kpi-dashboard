interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'var(--brand-primary)',
  fill = true,
}: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i): [number, number] => [
    i * step,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const path = points
    .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1))
    .join(' ');
  const area = fill ? `${path} L ${width},${height} L 0,${height} Z` : null;

  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      {fill && area && <path d={area} fill={color} opacity="0.12" />}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
