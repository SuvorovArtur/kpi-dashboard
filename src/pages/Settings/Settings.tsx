import { useState, useMemo, useCallback } from 'react';
import { Card, Header, Skeleton } from '../../shared/ui';
import { useKpiData } from '../../shared/hooks';
import { formatNumber } from '../../shared/utils/formatters';
import { exportToCsv, exportToPdf } from '../../shared/utils/export';
import { territories } from '../../shared/config/kpi-config';
import type { KpiDefinition } from '../../shared/types';
import styles from './Settings.module.css';

interface EditableTargets {
  d90: number;
  d180: number;
  d360: number;
}

export function Settings() {
  const { data, definitions, isLoading } = useKpiData();

  // Editable KPI targets (local state)
  const [targetOverrides, setTargetOverrides] = useState<
    Map<string, EditableTargets>
  >(new Map());
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditableTargets>({
    d90: 0,
    d180: 0,
    d360: 0,
  });

  // Territories (local state)
  const [localTerritories, setLocalTerritories] = useState<{id: string; name: string}[]>(() =>
    territories.map((t) => ({ id: t.id, name: t.name })),
  );
  const [newTerritoryName, setNewTerritoryName] = useState('');

  // Thresholds
  const [greenThreshold, setGreenThreshold] = useState(0.9);
  const [yellowThreshold, setYellowThreshold] = useState(0.7);

  // Get targets for a definition, considering overrides
  const getTargets = useCallback(
    (def: KpiDefinition) => {
      const override = targetOverrides.get(def.id);
      if (override) return override;
      return {
        d90: def.d90 ?? 0,
        d180: def.d180 ?? 0,
        d360: def.d360 ?? 0,
      };
    },
    [targetOverrides],
  );

  const startEdit = useCallback(
    (def: KpiDefinition) => {
      const targets = getTargets(def);
      setEditingRow(def.id);
      setEditValues({
        d90: targets.d90,
        d180: targets.d180,
        d360: targets.d360,
      });
    },
    [getTargets],
  );

  const saveEdit = useCallback(() => {
    if (!editingRow) return;
    setTargetOverrides((prev) => {
      const next = new Map(prev);
      next.set(editingRow, { ...editValues });
      return next;
    });
    setEditingRow(null);
  }, [editingRow, editValues]);

  const cancelEdit = useCallback(() => {
    setEditingRow(null);
  }, []);

  // Territory management
  const addTerritory = useCallback(() => {
    const name = newTerritoryName.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/\s+/g, '_');
    if (localTerritories.some((t) => t.id === id)) return;
    setLocalTerritories((prev) => [...prev, { id, name }]);
    setNewTerritoryName('');
  }, [newTerritoryName, localTerritories]);

  const removeTerritory = useCallback((id: string) => {
    setLocalTerritories((prev) => prev.filter((t) => t.id !== id));
  }, []);

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

  // Memoize sorted definitions for display
  const sortedDefs = useMemo(
    () => [...definitions].sort((a, b) => a.name.localeCompare(b.name)),
    [definitions],
  );

  if (isLoading) {
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

      {/* KPI Targets */}
      <Card>
        <h3 className={styles.sectionTitle}>Целевые значения KPI</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>KPI</th>
                <th>D90</th>
                <th>D180</th>
                <th>D360</th>
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
                            onChange={(e) =>
                              setEditValues((v) => ({
                                ...v,
                                d90: Number(e.target.value),
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.inlineInput}
                            value={editValues.d180}
                            onChange={(e) =>
                              setEditValues((v) => ({
                                ...v,
                                d180: Number(e.target.value),
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className={styles.inlineInput}
                            value={editValues.d360}
                            onChange={(e) =>
                              setEditValues((v) => ({
                                ...v,
                                d360: Number(e.target.value),
                              }))
                            }
                          />
                        </td>
                        <td>
                          <div className={styles.editActions}>
                            <button
                              className={styles.btnSave}
                              onClick={saveEdit}
                            >
                              Сохранить
                            </button>
                            <button
                              className={styles.btnCancel}
                              onClick={cancelEdit}
                            >
                              Отмена
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{formatNumber(targets.d90)}</td>
                        <td>{formatNumber(targets.d180)}</td>
                        <td>{formatNumber(targets.d360)}</td>
                        <td>
                          <button
                            className={styles.btnEdit}
                            onClick={() => startEdit(def)}
                          >
                            Изменить
                          </button>
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
          {localTerritories.map((t) => (
            <div key={t.id} className={styles.territoryItem}>
              <span>{t.name}</span>
              <button
                className={styles.btnRemove}
                onClick={() => removeTerritory(t.id)}
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
            onKeyDown={(e) => e.key === 'Enter' && addTerritory()}
          />
          <button className={styles.btnAdd} onClick={addTerritory}>
            Добавить
          </button>
        </div>
      </Card>

      {/* Thresholds */}
      <Card>
        <h3 className={styles.sectionTitle}>Пороги светофора</h3>
        <div className={styles.thresholdGrid}>
          <div className={styles.thresholdField}>
            <label className={styles.label}>
              Зелёный порог (от целевого значения)
            </label>
            <div className={styles.thresholdInputRow}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                className={styles.thresholdInput}
                value={greenThreshold}
                onChange={(e) => setGreenThreshold(Number(e.target.value))}
              />
              <span className={styles.thresholdHint}>
                ({Math.round(greenThreshold * 100)}%)
              </span>
              <span
                className={styles.thresholdDot}
                style={{ background: '#22c55e' }}
              />
            </div>
          </div>
          <div className={styles.thresholdField}>
            <label className={styles.label}>
              Жёлтый порог (от целевого значения)
            </label>
            <div className={styles.thresholdInputRow}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                className={styles.thresholdInput}
                value={yellowThreshold}
                onChange={(e) => setYellowThreshold(Number(e.target.value))}
              />
              <span className={styles.thresholdHint}>
                ({Math.round(yellowThreshold * 100)}%)
              </span>
              <span
                className={styles.thresholdDot}
                style={{ background: '#eab308' }}
              />
            </div>
          </div>
        </div>
        <p className={styles.thresholdNote}>
          Ниже жёлтого порога — красный статус
        </p>
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
    </div>
  );
}

export default Settings;
