export const territories = [
  { id: 'pirogovsky', name: 'Участок Пироговский' },
  { id: 'fedoskino', name: 'Участок Федоскино' },
  { id: 'total', name: 'Общая территория' },
] as const;

export const appealCategories = [
  'Дороги',
  'Благоустройство',
  'ЖКХ',
  'Экология',
  'Освещение',
  'Содержание территории',
  'Вывоз мусора',
  'Детские площадки',
] as const;

export const kpiThresholds = {
  green: 0.9,
  yellow: 0.7,
} as const;
