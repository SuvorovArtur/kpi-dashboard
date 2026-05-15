import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Header, Skeleton, Toast, Pill } from '../../shared/ui';
import { useKpiData, useTerritories, useAppSettings } from '../../shared/hooks';
import { formatNumber } from '../../shared/utils/formatters';
import { exportToCsv, exportToPdf } from '../../shared/utils/export';
import { supabase } from '../../shared/lib/supabase';
import type { KpiDefinition } from '../../shared/types';
import styles from './Settings.module.css';

interface EditableTargets {
  d90: number;
  d180: number;
  d360: number;
}

export function Settings() {
  const { data, definitions, isLoading, refetch: refetchKpi } = useKpiData();
  const { data: territoriesList, isLoading: terrLoading, add: addTerritory, remove: removeTerritory } = useTerritories();
  const { get: getSetting, update: updateSetting, isLoading: settingsLoading } = useAppSettings();

  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [populationValue, setPopulationValue] = useState('');
  const [populationLoaded, setPopulationLoaded] = useState(false);
  const [editValues, setEditValues] = useState<EditableTargets>({ d90: 0, d180: 0, d360: 0 });
  const [newTerritoryName, setNewTerritoryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Load population setting
  useEffect(() => {
    if (!settingsLoading && !populationLoaded) {
      setPopulationValue(getSetting('population') ?? '88876');
      setPopulationLoaded(true);
    }
  }, [settingsLoading, populationLoaded, getSetting]);

  const handleSavePopulation = useCallback(async () => {
    try {
      await updateSetting('population', populationValue);
      setToast({ message: 'Население сохранено', type: 'success' });
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [populationValue, updateSetting]);

  const getTargets = useCallback((def: KpiDefinition) => ({
    d90: def.d90 ?? 0,
    d180: def.d180 ?? 0,
    d360: def.d360 ?? 0,
  }), []);

  const startEdit = useCallback((def: KpiDefinition) => {
    const targets = getTargets(def);
    setEditingRow(def.id);
    setEditValues({ d90: targets.d90, d180: targets.d180, d360: targets.d360 });
  }, [getTargets]);

  const saveEdit = useCallback(async () => {
    if (!editingRow) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('kpi_definitions')
        .update({ d90: editValues.d90, d180: editValues.d180, d360: editValues.d360 })
        .eq('id', editingRow);
      if (error) throw error;
      setToast({ message: 'Целевые значения сохранены', type: 'success' });
      setEditingRow(null);
      refetchKpi();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [editingRow, editValues, refetchKpi]);

  const cancelEdit = useCallback(() => {
    setEditingRow(null);
  }, []);

  const handleAddTerritory = useCallback(async () => {
    const name = newTerritoryName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-zа-яё0-9_]/gi, '');
    if (territoriesList.some((t) => t.id === id)) {
      setToast({ message: 'Территория с таким ID уже существует', type: 'error' });
      return;
    }
    try {
      await addTerritory(id, name);
      setNewTerritoryName('');
      setToast({ message: `Территория "${name}" добавлена`, type: 'success' });
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [newTerritoryName, territoriesList, addTerritory]);

  const handleRemoveTerritory = useCallback(async (id: string) => {
    try {
      await removeTerritory(id);
      setToast({ message: 'Территория удалена', type: 'success' });
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [removeTerritory]);

  // Export handlers
  const handleExportCsv = useCallback(() => {
    const columns = [
      { key: 'date', title: 'Дата' },
      { key: 'kpiId', title: 'KPI' },
      { key: 'value', title: 'Значение' },
      { key: 'territory', title: 'Территория' },
    ];
    const rows = data.map((d) => ({
      date: d.date,
      kpiId: d.kpiId,
      value: d.value,
      territory: d.territory ?? '',
    }));
    exportToCsv(rows, columns, 'kpi-data-export');
  }, [data]);

  const handleExportPdf = useCallback(async () => {
    await exportToPdf('root', 'kpi-report');
  }, []);

  const sortedDefs = useMemo(
    () => [...definitions].sort((a, b) => a.name.localeCompare(b.name)),
    [definitions],
  );

  if (isLoading || terrLoading || settingsLoading) {
    return (
      <div className={styles.page}>
        <Header title="Настройки" />
        <Skeleton variant="card" height={300} />
        <Skeleton variant="card" height={200} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="Настройки" />

      {/* Appearance — live design-system tweaks */}
      <Card>
        <h3 className={styles.sectionTitle}>Внешний вид</h3>
        <AppearancePanel />
      </Card>

      {/* KPI Targets */}
      <Card>
        <h3 className={styles.sectionTitle}>Целевые значения KPI</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>KPI</th>
                <th title="Цель на горизонте 90 дней">90 дней</th>
                <th title="Цель на горизонте 180 дней">180 дней</th>
                <th title="Цель на горизонте 360 дней">360 дней</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedDefs.map((def) => {
                const targets = getTargets(def);
                const isEditing = editingRow === def.id;

                return (
                  <tr key={def.id}>
                    <td className={styles.kpiName}>{def.name}</td>
                    {isEditing ? (
                      <>
                        <td>
                          <input
                            type="number"
                            className={styles.inlineInput}
                            value={editValues.d90}
                            onChange={(e) => setEditValues((v) => ({ ...v, d90: Number(e.target.value) }))}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.inlineInput}
                            value={editValues.d180}
                            onChange={(e) => setEditValues((v) => ({ ...v, d180: Number(e.target.value) }))}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.inlineInput}
                            value={editValues.d360}
                            onChange={(e) => setEditValues((v) => ({ ...v, d360: Number(e.target.value) }))}
                          />
                        </td>
                        <td>
                          <div className={styles.editActions}>
                            <button className={styles.btnSave} onClick={saveEdit} disabled={saving}>
                              {saving ? '...' : 'Сохранить'}
                            </button>
                            <button className={styles.btnCancel} onClick={cancelEdit}>Отмена</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{formatNumber(targets.d90)}</td>
                        <td>{formatNumber(targets.d180)}</td>
                        <td>{formatNumber(targets.d360)}</td>
                        <td>
                          <button className={styles.btnEdit} onClick={() => startEdit(def)}>Изменить</button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Territories */}
      <Card>
        <h3 className={styles.sectionTitle}>Территориальные участки</h3>
        <div className={styles.territoryList}>
          {territoriesList.map((t) => (
            <div key={t.id} className={styles.territoryItem}>
              <span>{t.name}</span>
              <span className={styles.territoryId}>{t.id}</span>
              <button
                className={styles.btnRemove}
                onClick={() => handleRemoveTerritory(t.id)}
                title="Удалить"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <div className={styles.addRow}>
          <input
            type="text"
            className={styles.textInput}
            placeholder="Название нового участка"
            value={newTerritoryName}
            onChange={(e) => setNewTerritoryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTerritory()}
          />
          <button className={styles.btnAdd} onClick={handleAddTerritory}>
            Добавить
          </button>
        </div>
      </Card>

      {/* Population */}
      <Card>
        <h3 className={styles.sectionTitle}>Население сельских территорий</h3>
        <p className={styles.settingHint}>
          Используется для расчёта KPI «Обращений на 1000 жителей». Источник: Росстат.
        </p>
        <div className={styles.addRow}>
          <input
            type="number"
            className={styles.textInput}
            value={populationValue}
            onChange={(e) => setPopulationValue(e.target.value)}
            placeholder="88876"
          />
          <span className={styles.settingUnit}>чел.</span>
          <button className={styles.btnAdd} onClick={handleSavePopulation}>
            Сохранить
          </button>
        </div>
      </Card>

      {/* Menu sections toggle */}
      <Card>
        <h3 className={styles.sectionTitle}>Разделы меню</h3>
        <p className={styles.settingHint}>Включение дополнительных страниц в боковом меню.</p>
        <div className={styles.toggleRow}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              className={styles.toggleInput}
              checked={getSetting('show_kpi_detail') === 'true'}
              onChange={async (e) => {
                try {
                  await updateSetting('show_kpi_detail', e.target.checked ? 'true' : 'false');
                  setToast({ message: e.target.checked ? 'Раздел «KPI подробно» включён' : 'Раздел «KPI подробно» скрыт', type: 'success' });
                } catch (err) {
                  setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
                }
              }}
            />
            <span className={styles.toggleSwitch} />
            <span>KPI подробно</span>
          </label>
          <span className={styles.toggleHint}>Ручной ввод и паспорта KPI-показателей</span>
        </div>
      </Card>

      {/* Export */}
      <Card>
        <h3 className={styles.sectionTitle}>Экспорт</h3>
        <div className={styles.exportRow}>
          <button className={styles.btnExport} onClick={handleExportCsv}>
            Скачать данные CSV
          </button>
          <button className={styles.btnExport} onClick={handleExportPdf}>
            Скачать отчёт PDF
          </button>
        </div>
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Settings;


/* ---------------- Appearance panel ---------------- */

type Theme = 'light' | 'dark';
type Density = 'compact' | 'default' | 'airy';
type CardStyle = 'shadow' | 'outlined' | 'flat';

const LS_KEY = 'socpulse-appearance';

function readAppearance() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { theme: Theme; density: Density; cardStyle: CardStyle };
  } catch { /* ignore */ }
  return { theme: 'light' as Theme, density: 'default' as Density, cardStyle: 'shadow' as CardStyle };
}

function applyAppearance(a: { theme: Theme; density: Density; cardStyle: CardStyle }) {
  const html = document.documentElement;
  html.setAttribute('data-theme', a.theme);
  html.setAttribute('data-density', a.density);
  html.setAttribute('data-card', a.cardStyle);
  localStorage.setItem(LS_KEY, JSON.stringify(a));
}

function AppearancePanel() {
  const [theme, setTheme] = useState<Theme>(() => readAppearance().theme);
  const [density, setDensity] = useState<Density>(() => readAppearance().density);
  const [cardStyle, setCardStyle] = useState<CardStyle>(() => readAppearance().cardStyle);

  useEffect(() => { applyAppearance({ theme, density, cardStyle }); }, [theme, density, cardStyle]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div className={styles.appearanceLabel}>Тема</div>
        <div className={styles.appearanceRow}>
          <Pill active={theme === 'light'} onClick={() => setTheme('light')}>Светлая</Pill>
          <Pill active={theme === 'dark'} onClick={() => setTheme('dark')}>Тёмная</Pill>
        </div>
      </div>
      <div>
        <div className={styles.appearanceLabel}>Плотность</div>
        <div className={styles.appearanceRow}>
          <Pill active={density === 'compact'} onClick={() => setDensity('compact')}>Компактно</Pill>
          <Pill active={density === 'default'} onClick={() => setDensity('default')}>Обычно</Pill>
          <Pill active={density === 'airy'} onClick={() => setDensity('airy')}>Просторно</Pill>
        </div>
      </div>
      <div>
        <div className={styles.appearanceLabel}>Карточки</div>
        <div className={styles.appearanceRow}>
          <Pill active={cardStyle === 'shadow'} onClick={() => setCardStyle('shadow')}>С тенью</Pill>
          <Pill active={cardStyle === 'outlined'} onClick={() => setCardStyle('outlined')}>Контур</Pill>
          <Pill active={cardStyle === 'flat'} onClick={() => setCardStyle('flat')}>Плоские</Pill>
        </div>
      </div>
    </div>
  );
}
