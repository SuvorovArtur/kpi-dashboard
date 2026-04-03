import { colors } from '../config/theme';

export const chartColors = [
  colors.teal,
  colors.orange,
  colors.red,
  colors.tealLight,
  '#6366F1',
  '#EC4899',
  '#14B8A6',
  '#F59E0B',
];

export const chartTheme = {
  fontFamily: "'Lato', 'Inter', sans-serif",
  fontSize: 12,
  colors: chartColors,
  grid: {
    stroke: colors.border,
    strokeDasharray: '3 3',
  },
  tooltip: {
    backgroundColor: colors.cardBg,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
  },
};
