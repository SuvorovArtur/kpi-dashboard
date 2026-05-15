import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Hash, Trash2, X, Search, Edit2, Pentagon, User, Undo2, Check } from 'lucide-react';
import { Header, EmptyState, Skeleton, Pill, Toast } from '../../shared/ui';
import { useAuth } from '../../shared/hooks/useAuth';
import { supabase } from '../../shared/lib/supabase';
import type { Settlement, SettlementType } from '../../shared/types/ontology';
import { TYPE_PREFIX, settlementLabel, settlementLevel, TYPES_BY_LEVEL, LEVEL_LABEL, settlementBreadcrumb } from '../../shared/types/ontology';
import styles from './Settlements.module.css';

const MYTISHCHI: [number, number] = [55.911, 37.736];
const ZOOM = 11;

type Mode =
  | { kind: 'idle' }
  | { kind: 'drawing-new' }              // drawing polygon for a new НП
  | { kind: 'drawing-bounds'; id: string };  // redrawing polygon for an existing НП
type ToastState = { message: string; type: 'success' | 'error' } | null;
type EditingField = 'name' | 'type' | 'parent' | 'population' | 'notes';

interface NewDraft {
  vertices: [number, number][];          // polygon ring [lat, lng]; we close it on save
  name: string;
  type: SettlementType;
  parent_id: string | null;
}

function polygonCentroid(vertices: [number, number][]): [number, number] {
  const lat = vertices.reduce((a, [v]) => a + v, 0) / vertices.length;
  const lng = vertices.reduce((a, [, v]) => a + v, 0) / vertices.length;
  return [lat, lng];
}

function buildIcon(level: 1 | 2 | 3 | 0, selected: boolean): L.DivIcon {
  const color =
    level === 1 ? 'var(--color-teal, #0d9488)' :
    level === 2 ? 'var(--color-orange, #FFB460)' :
    level === 3 ? '#6366f1' : '#94a3b8';
  const size = level === 1 ? 18 : level === 2 ? 13 : level === 3 ? 9 : 10;
  const ring = selected ? '0 0 0 3px rgba(14, 92, 93, 0.45)' : '0 0 0 2px rgba(255, 255, 255, 0.9)';
  return L.divIcon({
    className: '',
    html: `<span style="
      display:inline-block;width:${size}px;height:${size}px;border-radius:50%;
      background:${color};box-shadow:${ring}, 0 1px 3px rgba(0,0,0,0.3);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function Settlements() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'editor' || profile?.role === 'admin';
  const canDelete = profile?.role === 'admin';

  const mapRef = useRef<L.Map | null>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const boundsLayersRef = useRef<Map<string, L.Polygon>>(new Map());
  const drawingLayerRef = useRef<L.Polyline | null>(null);

  // Drawing state for polygon mode. Stored as [lat, lng][].
  const [drawingVertices, setDrawingVertices] = useState<[number, number][]>([]);

  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<NewDraft | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [editing, setEditing] = useState<{ field: EditingField; value: string } | null>(null);

  const root = useMemo(() => rows.find(r => r.type === 'городской_округ' && !r.parent_id) ?? null, [rows]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('settlements_view').select('*').order('seq');
    if (error) setToast({ message: `Не удалось загрузить НП: ${error.message}`, type: 'error' });
    setRows((data ?? []) as Settlement[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- map init --------------------------------------------------------------
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const el = mapElRef.current;
    const map = L.map(el, {
      center: MYTISHCHI, zoom: ZOOM, scrollWheelZoom: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  // --- click handlers --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = async (e: L.LeafletMouseEvent) => {
      if (mode.kind === 'drawing-new' || mode.kind === 'drawing-bounds') {
        setDrawingVertices(prev => [...prev, [e.latlng.lat, e.latlng.lng]]);
      }
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [mode, root?.id, fetchData]);

  // --- markers (fallback only for settlements without a polygon) --------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const liveIds = new Set(rows.filter(r => !r.bounds_geojson).map(r => r.id));
    markersRef.current.forEach((m, id) => {
      if (!liveIds.has(id)) { m.remove(); markersRef.current.delete(id); }
    });
    for (const r of rows) {
      if (r.bounds_geojson) continue;  // polygon is its own visual
      const icon = buildIcon(settlementLevel(r.type), r.id === selectedId);
      const ex = markersRef.current.get(r.id);
      if (ex) {
        ex.setLatLng([r.lat, r.lng]).setIcon(icon);
      } else {
        const m = L.marker([r.lat, r.lng], { icon })
          .addTo(map)
          .on('click', () => { setSelectedId(r.id); setEditing(null); });
        m.bindTooltip(settlementLabel(r), { direction: 'top', offset: [0, -8] });
        markersRef.current.set(r.id, m);
      }
    }
  }, [rows, selectedId]);

  // --- saved-bounds polygons ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = new Set(rows.filter(r => r.bounds_geojson).map(r => r.id));
    boundsLayersRef.current.forEach((layer, id) => {
      if (!live.has(id)) { layer.remove(); boundsLayersRef.current.delete(id); }
    });
    for (const r of rows) {
      if (!r.bounds_geojson) continue;
      const ring = r.bounds_geojson.coordinates[0];
      const latlngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
      const isSel = r.id === selectedId;
      const ex = boundsLayersRef.current.get(r.id);
      if (ex) {
        ex.setLatLngs(latlngs);
        ex.setStyle({
          color: isSel ? 'var(--color-teal, #0d9488)' : '#6366f1',
          weight: isSel ? 3 : 2,
          fillOpacity: isSel ? 0.15 : 0.08,
        });
      } else {
        const poly = L.polygon(latlngs, {
          color: isSel ? 'var(--color-teal, #0d9488)' : '#6366f1',
          weight: isSel ? 3 : 2,
          fillOpacity: isSel ? 0.15 : 0.08,
        }).addTo(map);
        poly.bindTooltip(settlementLabel(r), { sticky: true });
        poly.on('click', () => { setSelectedId(r.id); setEditing(null); });
        boundsLayersRef.current.set(r.id, poly);
      }
    }
  }, [rows, selectedId]);

  // --- drafting polyline / polygon preview ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawingLayerRef.current) {
      drawingLayerRef.current.remove();
      drawingLayerRef.current = null;
    }
    // 1) Active drawing — open polyline that follows the vertices added so far
    if ((mode.kind === 'drawing-new' || mode.kind === 'drawing-bounds') && drawingVertices.length > 0) {
      const layer = L.polyline(drawingVertices, {
        color: 'var(--color-teal, #0d9488)', weight: 3, dashArray: '6, 4',
      }).addTo(map);
      drawingLayerRef.current = layer;
      return;
    }
    // 2) New-НП form is open (mode=idle, draft.vertices present) — closed preview polygon
    if (mode.kind === 'idle' && draft && draft.vertices.length >= 3) {
      const layer = L.polygon(draft.vertices, {
        color: 'var(--color-teal, #0d9488)', weight: 2, fillOpacity: 0.15,
      }).addTo(map) as unknown as L.Polyline;
      drawingLayerRef.current = layer;
    }
  }, [mode, drawingVertices, draft]);

  // Drawing mode side-effects: disable dblclick-zoom + apply crosshair cursor
  // via Leaflet's built-in `.leaflet-crosshair` class (works on touch + desktop)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    const isDrawing = mode.kind === 'drawing-new' || mode.kind === 'drawing-bounds';
    if (isDrawing) {
      map.doubleClickZoom.disable();
      container.classList.add('leaflet-crosshair');
    } else {
      map.doubleClickZoom.enable();
      container.classList.remove('leaflet-crosshair');
    }
  }, [mode]);

  const startDrawBounds = (id: string) => {
    setMode({ kind: 'drawing-bounds', id });
    setDrawingVertices([]);
  };

  const finishDrawBounds = async () => {
    if (mode.kind !== 'drawing-bounds') return;
    if (drawingVertices.length < 3) {
      setToast({ message: 'Минимум 3 вершины', type: 'error' });
      return;
    }
    const coords = drawingVertices.map(([lat, lng]) => [lng, lat]);
    coords.push(coords[0]); // close ring
    const geojson = { type: 'Polygon', coordinates: [coords] };
    const { error } = await supabase.rpc('ontology_settlement_set_bounds', {
      p_id: mode.id, p_geojson: JSON.stringify(geojson),
    });
    if (error) setToast({ message: `Не удалось: ${error.message}`, type: 'error' });
    else setToast({ message: 'Границы сохранены', type: 'success' });
    setDrawingVertices([]);
    setMode({ kind: 'idle' });
    fetchData();
  };

  const cancelDrawBounds = () => {
    setDrawingVertices([]);
    setMode({ kind: 'idle' });
  };

  const undoLastVertex = () => {
    setDrawingVertices(prev => prev.slice(0, -1));
  };

  const clearBounds = async () => {
    if (!selected) return;
    if (!confirm('Удалить границы?')) return;
    const { error } = await supabase.rpc('ontology_settlement_set_bounds', {
      p_id: selected.id, p_geojson: null,
    });
    if (error) setToast({ message: `Не удалось: ${error.message}`, type: 'error' });
    else setToast({ message: 'Границы удалены', type: 'success' });
    fetchData();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.parent_name ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selected = useMemo(() => rows.find(r => r.id === selectedId) ?? null, [rows, selectedId]);

  const startPlaceNew = () => {
    setMode({ kind: 'drawing-new' });
    setSelectedId(null);
    setDraft(null);
    setDrawingVertices([]);
  };

  const finishDrawNew = async () => {
    if (mode.kind !== 'drawing-new') return;
    if (drawingVertices.length < 3) {
      setToast({ message: 'Минимум 3 вершины', type: 'error' });
      return;
    }
    // Auto-resolve parent at polygon centroid for the default type (L2 деревня)
    const [cLat, cLng] = polygonCentroid(drawingVertices);
    const defaultType: SettlementType = 'деревня';
    const { data: pid } = await supabase.rpc('ontology_find_parent_settlement_for_point', {
      p_lat: cLat, p_lng: cLng, p_target_type: defaultType,
    });
    setDraft({
      vertices: drawingVertices,
      name: '',
      type: defaultType,
      parent_id: (pid as string | null) ?? root?.id ?? null,
    });
    setMode({ kind: 'idle' });   // form takes over; vertices preserved in draft
  };

  const cancelDrawNew = () => {
    setDrawingVertices([]);
    setMode({ kind: 'idle' });
    setDraft(null);
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setToast({ message: 'Заполни название', type: 'error' });
      return;
    }
    if (draft.vertices.length < 3) {
      setToast({ message: 'Полигон требует минимум 3 вершины', type: 'error' });
      return;
    }
    const ring = draft.vertices.map(([lat, lng]) => [lng, lat]);
    ring.push(ring[0]); // close the linear ring
    const geojson = { type: 'Polygon', coordinates: [ring] };
    const { data, error } = await supabase.rpc('ontology_settlement_create_polygon', {
      p_name: draft.name.trim(),
      p_type: draft.type,
      p_parent_id: draft.parent_id,
      p_geojson: JSON.stringify(geojson),
    });
    if (error) {
      setToast({ message: `Создание не удалось: ${error.message}`, type: 'error' });
      return;
    }
    setToast({ message: `Создан ${(data as Settlement)?.code}`, type: 'success' });
    setDraft(null);
    setDrawingVertices([]);
    setMode({ kind: 'idle' });
    await fetchData();
    setSelectedId((data as Settlement)?.id ?? null);
  };

  const saveField = async () => {
    if (!editing || !selected) return;
    const rpcMap = {
      name:       { rpc: 'ontology_settlement_rename',         arg: 'p_name' },
      type:       { rpc: 'ontology_settlement_set_type',       arg: 'p_type' },
      notes:      { rpc: 'ontology_settlement_set_notes',      arg: 'p_notes' },
    } as const;
    if (editing.field === 'parent') {
      const { error } = await supabase.rpc('ontology_settlement_set_parent', {
        p_id: selected.id, p_parent_id: editing.value || null,
      });
      if (error) setToast({ message: error.message, type: 'error' });
      else setToast({ message: 'Сохранено', type: 'success' });
    } else if (editing.field === 'population') {
      const parsed = editing.value.trim() === '' ? null : parseInt(editing.value, 10);
      const { error } = await supabase.rpc('ontology_settlement_set_population', {
        p_id: selected.id, p_population: parsed,
      });
      if (error) setToast({ message: error.message, type: 'error' });
      else setToast({ message: 'Сохранено', type: 'success' });
    } else {
      const { rpc, arg } = rpcMap[editing.field];
      const { error } = await supabase.rpc(rpc, { p_id: selected.id, [arg]: editing.value });
      if (error) setToast({ message: error.message, type: 'error' });
      else setToast({ message: 'Сохранено', type: 'success' });
    }
    setEditing(null);
    fetchData();
  };

  const deleteSettlement = async () => {
    if (!selected) return;
    if (selected.id === root?.id) {
      setToast({ message: 'Нельзя удалить корневой г.о.', type: 'error' });
      return;
    }
    if (!confirm(`Удалить «${settlementLabel(selected)}»?`)) return;
    const { error } = await supabase.rpc('ontology_settlement_delete', { p_id: selected.id });
    if (error) setToast({ message: `Удаление не удалось: ${error.message}`, type: 'error' });
    else {
      setToast({ message: 'Удалён', type: 'success' });
      setSelectedId(null);
    }
    fetchData();
  };

  return (
    <div className={styles.page}>
      <Header
        title="Населённые пункты"
        subtitle="Справочник. Используется в КП и других объектах как объектная привязка."
      />

      <div className={styles.layout}>
        <aside className={styles.left}>
          <div className={styles.searchRow}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text" placeholder="Поиск по названию / коду"
              value={search} onChange={e => setSearch(e.target.value)}
              className={styles.search}
            />
          </div>
          <div className={styles.listHead}>
            <span>Всего</span>
            <Pill>{filtered.length}{filtered.length !== rows.length ? ` / ${rows.length}` : ''}</Pill>
          </div>
          <div className={styles.list}>
            {loading ? (
              <Skeleton variant="card" />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={rows.length === 0 ? 'Справочник пуст' : 'Ничего не найдено'}
                description={rows.length === 0 ? 'Добавь первый населённый пункт кликом по карте.' : 'Попробуй другой запрос.'}
              />
            ) : (
              filtered.map(r => (
                <button
                  key={r.id}
                  className={styles.row}
                  data-selected={r.id === selectedId}
                  onClick={() => {
                    setSelectedId(r.id);
                    setEditing(null);
                    mapRef.current?.flyTo([r.lat, r.lng], 14);
                  }}
                >
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{settlementLabel(r)}</span>
                    <span className={styles.rowMeta}>{r.code}</span>
                  </div>
                  <div className={styles.rowMeta}>
                    {r.parent_name ? `↑ ${r.parent_name}` : <span className={styles.muted}>— root —</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className={`${styles.mapWrap} ${
          (mode.kind === 'drawing-new' || mode.kind === 'drawing-bounds') ? styles.drawing : ''
        }`}>
          <div ref={mapElRef} className={styles.map} />
          <div className={styles.mapOverlay}>
            {canEdit && mode.kind === 'idle' && (
              <button className={styles.fab} onClick={startPlaceNew}>
                <Plus size={16} /> Новый НП
              </button>
            )}
            {mode.kind === 'drawing-new' && (
              <div className={styles.modeHint}>
                Кликай по карте — обводи границы ({drawingVertices.length} вершин)
                <button onClick={undoLastVertex} disabled={drawingVertices.length === 0}>
                  <Undo2 size={12} /> Откатить
                </button>
                <button onClick={finishDrawNew} disabled={drawingVertices.length < 3}>
                  <Check size={12} /> Готово
                </button>
                <button onClick={cancelDrawNew}><X size={14} /> Отмена</button>
              </div>
            )}
            {mode.kind === 'drawing-bounds' && (
              <div className={styles.modeHint}>
                Кликай по карте — добавляй вершины ({drawingVertices.length})
                <button onClick={undoLastVertex} disabled={drawingVertices.length === 0}>
                  <Undo2 size={12} /> Откатить
                </button>
                <button onClick={finishDrawBounds} disabled={drawingVertices.length < 3}>
                  <Check size={12} /> Готово
                </button>
                <button onClick={cancelDrawBounds}><X size={14} /> Отмена</button>
              </div>
            )}
          </div>
        </div>

        <aside className={styles.right}>
          {draft ? (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <h3>Новый населённый пункт</h3>
                <button onClick={() => { setDraft(null); setMode({ kind: 'idle' }); }}><X size={14} /></button>
              </div>
              <label className={styles.field}>
                <span>Название *</span>
                <input
                  type="text" autoFocus value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Беляниново"
                />
              </label>
              <label className={styles.field}>
                <span>Тип (уровень {settlementLevel(draft.type) || '?'})</span>
                <select
                  value={draft.type}
                  onChange={async e => {
                    const newType = e.target.value as SettlementType;
                    const [cLat, cLng] = polygonCentroid(draft.vertices);
                    const { data: pid } = await supabase.rpc('ontology_find_parent_settlement_for_point', {
                      p_lat: cLat, p_lng: cLng, p_target_type: newType,
                    });
                    setDraft({
                      ...draft, type: newType,
                      parent_id: (pid as string | null) ?? root?.id ?? null,
                    });
                  }}
                >
                  {([1, 2, 3] as const).map(lvl => (
                    <optgroup key={lvl} label={LEVEL_LABEL[lvl]}>
                      {TYPES_BY_LEVEL[lvl].map(t => (
                        <option key={t} value={t}>{t} ({TYPE_PREFIX[t]})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Входит в состав</span>
                <select
                  value={draft.parent_id ?? ''}
                  onChange={e => setDraft({ ...draft, parent_id: e.target.value || null })}
                >
                  <option value="">— нет —</option>
                  {rows
                    .filter(r => settlementLevel(r.type) < settlementLevel(draft.type))
                    .map(r => (
                      <option key={r.id} value={r.id}>{settlementLabel(r)} (L{settlementLevel(r.type)})</option>
                    ))}
                </select>
                <small style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  Авто-определён по полигону. Покажет только НП уровнем выше.
                </small>
              </label>
              <div className={styles.field}>
                <span>Полигон</span>
                <div className={styles.coords}>{draft.vertices.length} вершин</div>
              </div>
              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={saveDraft}>Сохранить</button>
                <button className={styles.btnGhost} onClick={() => { setDraft(null); setDrawingVertices([]); setMode({ kind: 'idle' }); }}>Отмена</button>
              </div>
            </div>
          ) : selected ? (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <h3>{settlementLabel(selected)}</h3>
                <button onClick={() => setSelectedId(null)}><X size={14} /></button>
              </div>

              {(() => {
                const path = settlementBreadcrumb(selected, rows);
                if (path.length <= 1) return null;
                return (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {path.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}> › </span>}
                        <span style={{ color: p.id === selected.id ? 'var(--text-primary)' : undefined, fontWeight: p.id === selected.id ? 600 : 400 }}>
                          L{settlementLevel(p.type)} · {settlementLabel(p)}
                        </span>
                      </span>
                    ))}
                  </div>
                );
              })()}

              <div className={styles.field}>
                <span>Название</span>
                {editing?.field === 'name' ? (
                  <div className={styles.inlineEdit}>
                    <input autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })} />
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.name}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'name', value: selected.name })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Тип (уровень {settlementLevel(selected.type) || '?'})</span>
                {editing?.field === 'type' ? (
                  <div className={styles.inlineEdit}>
                    <select autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })}>
                      {([1, 2, 3] as const).map(lvl => (
                        <optgroup key={lvl} label={LEVEL_LABEL[lvl]}>
                          {TYPES_BY_LEVEL[lvl].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.type}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'type', value: selected.type })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Входит в состав</span>
                {editing?.field === 'parent' ? (
                  <div className={styles.inlineEdit}>
                    <select autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })}>
                      <option value="">— нет —</option>
                      {rows
                        .filter(r => r.id !== selected.id && settlementLevel(r.type) < settlementLevel(selected.type))
                        .map(r => (
                          <option key={r.id} value={r.id}>{settlementLabel(r)} (L{settlementLevel(r.type)})</option>
                        ))}
                    </select>
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.parent_name || <span className={styles.muted}>— нет —</span>}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'parent', value: selected.parent_id || '' })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Население</span>
                {editing?.field === 'population' ? (
                  <div className={styles.inlineEdit}>
                    <input type="number" autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })} />
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.population ?? <span className={styles.muted}>—</span>}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'population', value: String(selected.population ?? '') })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Границы</span>
                <div className={styles.fieldValue}>
                  {selected.bounds_geojson
                    ? `Полигон, ${selected.bounds_geojson.coordinates[0].length - 1} вершин`
                    : <span className={styles.muted}>— нет —</span>}
                  {canEdit && (
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button onClick={() => startDrawBounds(selected.id)}>
                        <Pentagon size={12} /> {selected.bounds_geojson ? 'Перерисовать' : 'Нарисовать'}
                      </button>
                      {selected.bounds_geojson && (
                        <button onClick={clearBounds}>
                          <X size={12} /> Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.field}>
                <span>Староста</span>
                <div className={styles.fieldValue}>
                  <span className={styles.muted}>
                    <User size={12} style={{ display: 'inline', marginRight: 4 }} />
                    {selected.current_starosta_id
                      ? `id: ${selected.current_starosta_id.slice(0, 8)}…`
                      : '— нет —'}
                  </span>
                </div>
                <small style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  Будет отдельный объект <code>ontology.starostas</code>. Сейчас зарезервирована FK-колонка.
                </small>
              </div>

              <div className={styles.field}>
                <span>Примечания</span>
                {editing?.field === 'notes' ? (
                  <div className={styles.inlineEdit}>
                    <input autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })} />
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.notes || <span className={styles.muted}>—</span>}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'notes', value: selected.notes ?? '' })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.meta}>
                <Hash size={12} /> {selected.code} · создан {new Date(selected.created_at).toLocaleDateString('ru-RU')}
              </div>

              {canDelete && selected.id !== root?.id && (
                <div className={styles.actions}>
                  <button className={styles.btnDanger} onClick={deleteSettlement}>
                    <Trash2 size={14} /> Удалить
                  </button>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="Выберите населённый пункт"
              description={canEdit
                ? 'Кликни по маркеру или строке слева. «+ Новый НП» — добавить.'
                : 'Кликни по маркеру или строке слева, чтобы посмотреть детали.'}
            />
          )}
        </aside>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
