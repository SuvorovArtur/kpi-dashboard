import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, MapPin, Hash, Trash2, X, Search, Edit2, Camera, Upload, Image as ImageIcon } from 'lucide-react';
import { Header, EmptyState, Skeleton, Pill, Badge, Toast } from '../../shared/ui';
import { useAuth } from '../../shared/hooks/useAuth';
import { supabase } from '../../shared/lib/supabase';
import type { Kp, Settlement } from '../../shared/types/ontology';
import { settlementLabel, settlementLevel, settlementBreadcrumb } from '../../shared/types/ontology';
import styles from './KP.module.css';

const MYTISHCHI: [number, number] = [55.911, 37.736];
const ZOOM = 12;

type Mode = { kind: 'idle' } | { kind: 'placing-new' } | { kind: 'moving'; id: string };
type ToastState = { message: string; type: 'success' | 'error' } | null;

interface NewKpDraft {
  lat: number;
  lng: number;
  settlement_id: string | null;
  settlement: string;          // legacy free-text fallback (auto-filled from picker)
  registry_number: string;
  holder: string;
  has_br_camera: boolean;
}

type EditingField = 'settlement' | 'registry' | 'holder';

function buildIcon(hasRegistry: boolean, selected: boolean): L.DivIcon {
  const color = hasRegistry ? 'var(--color-status-green, #16a34a)' : 'var(--color-orange, #FFB460)';
  const ring = selected ? '0 0 0 3px rgba(14, 92, 93, 0.45)' : '0 0 0 2px rgba(255, 255, 255, 0.9)';
  return L.divIcon({
    className: '',
    html: `<span style="
      display:inline-block;width:14px;height:14px;border-radius:50%;
      background:${color};box-shadow:${ring}, 0 1px 3px rgba(0,0,0,0.3);
    "></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function KP() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'editor' || profile?.role === 'admin';
  const canDelete = profile?.role === 'admin';

  const mapRef = useRef<L.Map | null>(null);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const [rows, setRows] = useState<Kp[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<NewKpDraft | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [editing, setEditing] = useState<{ field: EditingField; value: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [autoLinkPreview, setAutoLinkPreview] = useState<Settlement | null>(null);
  const [settPickerQuery, setSettPickerQuery] = useState('');

  interface NearbyAppeal {
    id: number;
    date: string;
    subtopic: string | null;
    fact: string | null;
    status: string | null;
    description: string | null;
    address: string | null;
    distance_m: number;
    sentiment_score: number | null;
    is_repeated: boolean | null;
  }
  const [appeals, setAppeals] = useState<NearbyAppeal[]>([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealsRadius, setAppealsRadius] = useState<100 | 200 | 500>(200);
  const [appealsDays, setAppealsDays] = useState<30 | 60 | 90>(60);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('kp_view').select('*').order('seq');
    if (error) {
      setToast({ message: `Не удалось загрузить КП: ${error.message}`, type: 'error' });
    }
    setRows((data ?? []) as Kp[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // --- Settlements directory (for picker) -------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('settlements_view').select('*').order('name');
      if (!cancelled) setSettlements((data ?? []) as Settlement[]);
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Fetch nearby appeals for the selected КП ------------------------------
  useEffect(() => {
    if (!selectedId) { setAppeals([]); return; }
    let cancelled = false;
    setAppealsLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('kp_nearby_appeals', {
        p_kp_id: selectedId,
        p_radius_m: appealsRadius,
        p_days: appealsDays,
      });
      if (cancelled) return;
      if (error) {
        setAppeals([]);
      } else {
        setAppeals((data ?? []) as NearbyAppeal[]);
      }
      setAppealsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedId, appealsRadius, appealsDays]);

  // --- Auto-link preview: which settlement polygon contains the draft point? --
  useEffect(() => {
    if (!draft || draft.settlement_id) { setAutoLinkPreview(null); return; }
    let cancelled = false;
    (async () => {
      const { data: sid } = await supabase.rpc('ontology_find_settlement_by_point', {
        p_lat: draft.lat, p_lng: draft.lng,
      });
      if (cancelled) return;
      const match = sid ? (settlements.find(s => s.id === sid) ?? null) : null;
      setAutoLinkPreview(match);
    })();
    return () => { cancelled = true; };
  }, [draft, settlements]);

  // --- Initialise Leaflet once -------------------------------------------------
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const el = mapElRef.current;
    const map = L.map(el, {
      center: MYTISHCHI, zoom: ZOOM, zoomControl: true, scrollWheelZoom: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // When the surrounding grid row grows (e.g. right panel expands with a long
    // photo gallery), tell Leaflet to repaint its tile layer.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  // --- Click-to-place handler (toggled by mode) --------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = async (e: L.LeafletMouseEvent) => {
      if (mode.kind === 'placing-new') {
        setDraft({
          lat: e.latlng.lat, lng: e.latlng.lng,
          settlement_id: null, settlement: '',
          registry_number: '', holder: '', has_br_camera: false,
        });
      } else if (mode.kind === 'moving') {
        const id = mode.id;
        const { error } = await supabase.rpc('ontology_kp_move', {
          p_id: id, p_lat: e.latlng.lat, p_lng: e.latlng.lng,
        });
        if (error) setToast({ message: `Перемещение не удалось: ${error.message}`, type: 'error' });
        else setToast({ message: 'Координаты обновлены', type: 'success' });
        setMode({ kind: 'idle' });
        fetchData();
      }
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [mode, fetchData]);

  // --- Sync markers with rows --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = new Set(rows.map(r => r.id));
    // remove stale
    markersRef.current.forEach((m, id) => {
      if (!live.has(id)) { m.remove(); markersRef.current.delete(id); }
    });
    // add/update
    for (const r of rows) {
      const icon = buildIcon(!!r.registry_number, r.id === selectedId);
      const existing = markersRef.current.get(r.id);
      if (existing) {
        existing.setLatLng([r.lat, r.lng]).setIcon(icon);
      } else {
        const m = L.marker([r.lat, r.lng], { icon })
          .addTo(map)
          .on('click', () => { setSelectedId(r.id); setEditing(null); });
        m.bindTooltip(`${r.number} · ${r.settlement_name ?? r.settlement}`, { direction: 'top', offset: [0, -8] });
        markersRef.current.set(r.id, m);
      }
    }
  }, [rows, selectedId]);

  // --- Filtered list -----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.number.toLowerCase().includes(q) ||
      r.settlement.toLowerCase().includes(q) ||
      (r.settlement_name ?? '').toLowerCase().includes(q) ||
      (r.registry_number || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const selected = useMemo(() => rows.find(r => r.id === selectedId) ?? null, [rows, selectedId]);

  // --- Actions -----------------------------------------------------------------
  const startPlaceNew = () => {
    setMode({ kind: 'placing-new' });
    setSelectedId(null);
    setDraft(null);
  };

  const saveDraft = async () => {
    if (!draft) return;
    // Derive legacy settlement text from picker → auto-link preview → manual input
    const pickedSettlement = settlements.find(s => s.id === draft.settlement_id) ?? null;
    const settlementText =
      (pickedSettlement && settlementLabel(pickedSettlement)) ||
      draft.settlement.trim() ||
      (autoLinkPreview && settlementLabel(autoLinkPreview)) ||
      '';
    if (!settlementText) {
      setToast({ message: 'Выбери НП из справочника или впиши вручную', type: 'error' });
      return;
    }
    const { data, error } = await supabase.rpc('ontology_kp_create', {
      p_settlement: settlementText,
      p_lat: draft.lat,
      p_lng: draft.lng,
      p_registry_number: draft.registry_number.trim() || null,
    });
    if (error) {
      setToast({ message: `Создание не удалось: ${error.message}`, type: 'error' });
      return;
    }
    const createdId = (data as Kp)?.id;
    // Optional follow-ups for fields not in create signature
    if (createdId && draft.settlement_id) {
      await supabase.rpc('ontology_kp_set_settlement', { p_id: createdId, p_settlement_id: draft.settlement_id });
    }
    if (createdId && draft.holder.trim()) {
      await supabase.rpc('ontology_kp_set_holder', { p_id: createdId, p_holder: draft.holder.trim() });
    }
    if (createdId && draft.has_br_camera) {
      await supabase.rpc('ontology_kp_set_br_camera', { p_id: createdId, p_has_br_camera: true });
    }
    setToast({ message: `Создана ${(data as Kp)?.number ?? 'КП'}`, type: 'success' });
    setDraft(null);
    setMode({ kind: 'idle' });
    await fetchData();
    setSelectedId(createdId ?? null);
  };

  const saveField = async () => {
    if (!editing || !selected) return;
    const rpcMap = {
      settlement: { rpc: 'ontology_kp_rename_settlement', arg: 'p_settlement' },
      registry:   { rpc: 'ontology_kp_set_registry',     arg: 'p_registry_number' },
      holder:     { rpc: 'ontology_kp_set_holder',       arg: 'p_holder' },
    } as const;
    const { rpc, arg } = rpcMap[editing.field];
    const { error } = await supabase.rpc(rpc, { p_id: selected.id, [arg]: editing.value.trim() || null });
    if (error) setToast({ message: `Сохранение не удалось: ${error.message}`, type: 'error' });
    else setToast({ message: 'Сохранено', type: 'success' });
    setEditing(null);
    fetchData();
  };

  const setSettlement = async (settlementId: string | null) => {
    if (!selected) return;
    const { error } = await supabase.rpc('ontology_kp_set_settlement', {
      p_id: selected.id, p_settlement_id: settlementId,
    });
    if (error) setToast({ message: `Не удалось: ${error.message}`, type: 'error' });
    else setToast({ message: settlementId ? 'Привязано к НП' : 'Привязка снята', type: 'success' });
    fetchData();
  };

  const toggleBrCamera = async () => {
    if (!selected) return;
    const { error } = await supabase.rpc('ontology_kp_set_br_camera', {
      p_id: selected.id, p_has_br_camera: !selected.has_br_camera,
    });
    if (error) setToast({ message: `Не удалось: ${error.message}`, type: 'error' });
    else setToast({ message: selected.has_br_camera ? 'Камера снята' : 'Камера отмечена', type: 'success' });
    fetchData();
  };

  const uploadPhoto = async (file: File) => {
    if (!selected) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${selected.id}/${Date.now()}.${ext.toLowerCase()}`;
      const { error: upErr } = await supabase.storage.from('kp-photos').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('kp-photos').getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: rpcErr } = await supabase.rpc('ontology_kp_add_photo', {
        p_id: selected.id, p_url: url,
      });
      if (rpcErr) throw rpcErr;
      setToast({ message: 'Фото добавлено', type: 'success' });
      fetchData();
    } catch (e: any) {
      setToast({ message: `Загрузка не удалась: ${e.message ?? e}`, type: 'error' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = async (url: string) => {
    if (!selected) return;
    if (!confirm('Удалить фото?')) return;
    // remove from DB array
    const { error: rpcErr } = await supabase.rpc('ontology_kp_remove_photo', {
      p_id: selected.id, p_url: url,
    });
    if (rpcErr) {
      setToast({ message: `Не удалось: ${rpcErr.message}`, type: 'error' });
      return;
    }
    // best-effort delete from Storage (path = everything after /kp-photos/)
    const marker = '/kp-photos/';
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      const path = url.slice(idx + marker.length);
      await supabase.storage.from('kp-photos').remove([path]);
    }
    setToast({ message: 'Фото удалено', type: 'success' });
    fetchData();
  };

  const deleteKp = async () => {
    if (!selected) return;
    if (!confirm(`Удалить ${selected.number}?`)) return;
    const { error } = await supabase.rpc('ontology_kp_delete', { p_id: selected.id });
    if (error) setToast({ message: `Удаление не удалось: ${error.message}`, type: 'error' });
    else {
      setToast({ message: 'Удалена', type: 'success' });
      setSelectedId(null);
    }
    fetchData();
  };

  // ---------------------------------------------------------------------------

  return (
    <div className={styles.page}>
      <Header
        title="Контейнерные площадки"
        subtitle="Реестр контейнерных площадок Мытищ. Жалобы будут привязываться к ближайшей в радиусе 100 м."
      />

      <div className={styles.layout}>
        {/* LEFT: list + search */}
        <aside className={styles.left}>
          <div className={styles.searchRow}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text" placeholder="Поиск по номеру / н.п. / реестру"
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
                title={rows.length === 0 ? 'Реестр пуст' : 'Ничего не найдено'}
                description={rows.length === 0 ? 'Создайте первую КП кликом по карте.' : 'Попробуйте другой запрос.'}
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
                    mapRef.current?.flyTo([r.lat, r.lng], 16);
                  }}
                >
                  <div className={styles.rowHead}>
                    <span className={styles.rowNumber}>{r.number}</span>
                    {r.registry_number ? (
                      <Badge status="green" label={r.registry_number} size="sm" />
                    ) : (
                      <Badge status="yellow" label="без реестра" size="sm" />
                    )}
                  </div>
                  <div className={styles.rowSettlement}>
                    {r.settlement_name && (
                      <>
                        <MapPin size={12} />{' '}
                        {settlementLabel({ name: r.settlement_name, type: r.settlement_type ?? '' })}
                      </>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* CENTER: map */}
        <div className={styles.mapWrap}>
          <div ref={mapElRef} className={styles.map} />
          <div className={styles.mapOverlay}>
            {canEdit && mode.kind === 'idle' && (
              <button className={styles.fab} onClick={startPlaceNew}>
                <Plus size={16} /> Новая КП
              </button>
            )}
            {mode.kind === 'placing-new' && (
              <div className={styles.modeHint}>
                Кликни по карте, чтобы поставить точку
                <button onClick={() => { setMode({ kind: 'idle' }); setDraft(null); }}>
                  <X size={14} /> Отмена
                </button>
              </div>
            )}
            {mode.kind === 'moving' && (
              <div className={styles.modeHint}>
                Кликни по карте — туда переместится КП
                <button onClick={() => setMode({ kind: 'idle' })}><X size={14} /> Отмена</button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: details / form */}
        <aside className={styles.right}>
          {draft ? (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <h3>Новая контейнерная площадка</h3>
                <button onClick={() => { setDraft(null); setMode({ kind: 'idle' }); }}><X size={14} /></button>
              </div>
              <label className={styles.field}>
                <span>Населённый пункт *</span>
                <select
                  autoFocus
                  value={draft.settlement_id ?? ''}
                  onChange={e => {
                    const sid = e.target.value || null;
                    const s = settlements.find(x => x.id === sid);
                    setDraft({
                      ...draft,
                      settlement_id: sid,
                      settlement: s ? settlementLabel(s) : draft.settlement,
                    });
                  }}
                >
                  <option value="">— выбери из справочника —</option>
                  {settlements.map(s => (
                    <option key={s.id} value={s.id}>{settlementLabel(s)}</option>
                  ))}
                </select>
                <small style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  Нужного НП нет? Добавь его в{' '}
                  <a href="/settlements" target="_blank" rel="noreferrer" style={{ color: 'var(--color-teal)' }}>
                    справочник
                  </a>.
                </small>
                {!draft.settlement_id && autoLinkPreview && (
                  <small style={{ fontSize: 11, color: 'var(--color-teal, #0d9488)', marginTop: 2 }}>
                    Точка внутри полигона <b>{settlementLabel(autoLinkPreview)}</b> — будет авто-привязка при сохранении.
                  </small>
                )}
              </label>
              <label className={styles.field}>
                <span>…или впиши вручную (legacy)</span>
                <input
                  type="text" value={draft.settlement}
                  onChange={e => setDraft({ ...draft, settlement: e.target.value })}
                  placeholder="д. Беляниново"
                  disabled={!!draft.settlement_id}
                />
              </label>
              <label className={styles.field}>
                <span>Реестровый номер РО (необязательно)</span>
                <input
                  type="text" value={draft.registry_number}
                  onChange={e => setDraft({ ...draft, registry_number: e.target.value })}
                  placeholder="RO-2024-1156"
                />
              </label>
              <label className={styles.field}>
                <span>Балансодержатель (необязательно)</span>
                <input
                  type="text" value={draft.holder}
                  onChange={e => setDraft({ ...draft, holder: e.target.value })}
                  placeholder="УК «Мытищи-Сервис»"
                />
              </label>
              <label className={`${styles.field} ${styles.checkboxField}`}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Camera size={12} /> Камера «Безопасный регион»
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox" checked={draft.has_br_camera}
                    onChange={e => setDraft({ ...draft, has_br_camera: e.target.checked })}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {draft.has_br_camera ? 'есть' : 'нет'}
                  </span>
                </div>
              </label>
              <div className={styles.field}>
                <span>Координаты</span>
                <div className={styles.coords}>
                  {draft.lat.toFixed(6)}, {draft.lng.toFixed(6)}
                </div>
              </div>
              <div className={styles.actions}>
                <button className={styles.btnPrimary} onClick={saveDraft}>Сохранить</button>
                <button className={styles.btnGhost} onClick={() => { setDraft(null); setMode({ kind: 'idle' }); }}>
                  Отмена
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className={styles.detail}>
              <div className={styles.detailHead}>
                <h3>{selected.number}</h3>
                <button onClick={() => setSelectedId(null)}><X size={14} /></button>
              </div>

              <div className={styles.field}>
                <span>Населённый пункт</span>
                {canEdit ? (
                  <div className={styles.settPicker}>
                    <div className={styles.settPickerCurrent}>
                      <span>
                        {selected.settlement_name
                          ? settlementLabel({ name: selected.settlement_name, type: selected.settlement_type ?? '' })
                          : <span className={styles.muted}>— не привязан —</span>}
                      </span>
                      {selected.settlement_id && (
                        <button
                          className={styles.settPickerClear}
                          onClick={() => setSettlement(null)}
                          title="Снять привязку"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      className={styles.settPickerSearch}
                      placeholder="Поиск НП…"
                      value={settPickerQuery}
                      onChange={e => setSettPickerQuery(e.target.value)}
                    />
                    {settPickerQuery.trim() && (() => {
                      const q = settPickerQuery.trim().toLowerCase();
                      const matches = settlements
                        .filter(s => s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q))
                        .slice(0, 30);
                      if (matches.length === 0) {
                        return <div className={styles.settPickerEmpty}>Ничего не найдено</div>;
                      }
                      return (
                        <div className={styles.settPickerList}>
                          {matches.map(s => (
                            <button
                              key={s.id}
                              className={styles.settPickerOption}
                              data-selected={s.id === selected.settlement_id}
                              onClick={() => { setSettlement(s.id); setSettPickerQuery(''); }}
                            >
                              {settlementLabel(s)}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.settlement_name
                      ? settlementLabel({ name: selected.settlement_name, type: selected.settlement_type ?? '' })
                      : selected.settlement || <span className={styles.muted}>—</span>}
                  </div>
                )}
                {!selected.settlement_id && selected.settlement && (
                  <small style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Legacy-ввод: «{selected.settlement}». Привяжи к НП из справочника.
                  </small>
                )}
                {selected.settlement_id && (() => {
                  const linked = settlements.find(s => s.id === selected.settlement_id);
                  if (!linked) return null;
                  const path = settlementBreadcrumb(linked, settlements);
                  return (
                    <small style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {path.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}> › </span>}
                          L{settlementLevel(p.type)} · {settlementLabel(p)}
                        </span>
                      ))}
                    </small>
                  );
                })()}
              </div>

              <div className={styles.field}>
                <span>Реестровый номер РО</span>
                {editing?.field === 'registry' ? (
                  <div className={styles.inlineEdit}>
                    <input
                      autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })}
                      placeholder="RO-..."
                    />
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.registry_number || <span className={styles.muted}>—</span>}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'registry', value: selected.registry_number || '' })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Балансодержатель</span>
                {editing?.field === 'holder' ? (
                  <div className={styles.inlineEdit}>
                    <input
                      autoFocus value={editing.value}
                      onChange={e => setEditing({ ...editing, value: e.target.value })}
                      placeholder="УК / администрация / частник"
                    />
                    <button onClick={saveField}>OK</button>
                    <button onClick={() => setEditing(null)}><X size={12} /></button>
                  </div>
                ) : (
                  <div className={styles.fieldValue}>
                    {selected.holder || <span className={styles.muted}>—</span>}
                    {canEdit && (
                      <button onClick={() => setEditing({ field: 'holder', value: selected.holder || '' })}>
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <span>Камера «Безопасный регион»</span>
                <div className={styles.fieldValue}>
                  {selected.has_br_camera
                    ? <Badge status="green" label="есть" size="sm" />
                    : <Badge status="yellow" label="нет" size="sm" />}
                  {canEdit && (
                    <button onClick={toggleBrCamera}>
                      <Camera size={12} /> {selected.has_br_camera ? 'Снять' : 'Отметить'}
                    </button>
                  )}
                </div>
              </div>

              <div className={styles.field}>
                <span>Координаты</span>
                <div className={styles.fieldValue}>
                  <span className={styles.coords}>{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</span>
                  {canEdit && (
                    <button onClick={() => setMode({ kind: 'moving', id: selected.id })}>
                      <MapPin size={12} /> Переместить
                    </button>
                  )}
                </div>
              </div>

              <div className={styles.field}>
                <span>Фото ({selected.photos.length})</span>
                <div className={styles.photoGrid}>
                  {selected.photos.map(url => (
                    <div key={url} className={styles.photoTile}>
                      <img src={url} alt="" loading="lazy" />
                      {canEdit && (
                        <button
                          className={styles.photoRemove}
                          onClick={() => removePhoto(url)}
                          aria-label="Удалить фото"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  {selected.photos.length === 0 && (
                    <div className={styles.photoEmpty}>
                      <ImageIcon size={20} /> <span>Фото нет</span>
                    </div>
                  )}
                </div>
                {canEdit && (
                  <>
                    <input
                      ref={fileInputRef} type="file" accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(f);
                      }}
                    />
                    <button
                      className={styles.btnGhost}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      style={{ marginTop: 8 }}
                    >
                      <Upload size={14} /> {uploading ? 'Загрузка…' : 'Загрузить фото'}
                    </button>
                  </>
                )}
              </div>

              <div className={styles.appealsSection}>
                <div className={styles.appealsHead}>
                  <span>Жалобы ({appeals.length})</span>
                  <div className={styles.appealsFilters}>
                    {[100, 200, 500].map(r => (
                      <button
                        key={r}
                        className={styles.appealsChip}
                        data-active={appealsRadius === r}
                        onClick={() => setAppealsRadius(r as 100 | 200 | 500)}
                      >{r}м</button>
                    ))}
                    <span style={{ opacity: 0.5, fontSize: 11 }}>·</span>
                    {[30, 60, 90].map(d => (
                      <button
                        key={d}
                        className={styles.appealsChip}
                        data-active={appealsDays === d}
                        onClick={() => setAppealsDays(d as 30 | 60 | 90)}
                      >{d}д</button>
                    ))}
                  </div>
                </div>
                {appealsLoading ? (
                  <div className={styles.appealsEmpty}>Загрузка…</div>
                ) : appeals.length === 0 ? (
                  <div className={styles.appealsEmpty}>
                    Нет жалоб в радиусе {appealsRadius}м за {appealsDays} дней
                  </div>
                ) : (
                  <div className={styles.appealsList}>
                    {appeals.map(a => (
                      <div key={a.id} className={styles.appealCard}>
                        <div className={styles.appealHead}>
                          <span className={styles.appealDate}>
                            {new Date(a.date).toLocaleDateString('ru-RU')}
                          </span>
                          <span className={styles.appealDist}>{Math.round(a.distance_m)}м</span>
                          {a.is_repeated && <Badge status="yellow" label="повтор" size="sm" />}
                          {a.status && a.status !== 'Неизвестно' && (
                            <Badge
                              status={a.status.toLowerCase().includes('закрыт') ? 'green' : 'yellow'}
                              label={a.status}
                              size="sm"
                            />
                          )}
                        </div>
                        <div className={styles.appealSubtopic}>
                          {a.subtopic || a.fact || 'Без темы'}
                        </div>
                        {a.description && (
                          <div className={styles.appealDesc}>
                            {a.description.length > 200
                              ? a.description.slice(0, 200) + '…'
                              : a.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.meta}>
                <Hash size={12} /> seq {selected.seq} · создана {new Date(selected.created_at).toLocaleDateString('ru-RU')}
              </div>

              {canDelete && (
                <div className={styles.actions}>
                  <button className={styles.btnDanger} onClick={deleteKp}>
                    <Trash2 size={14} /> Удалить
                  </button>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="Выберите КП"
              description={canEdit
                ? 'Клик по маркеру на карте или строке слева. Кнопка «Новая КП» — чтобы добавить.'
                : 'Клик по маркеру на карте или строке слева, чтобы посмотреть детали.'}
            />
          )}
        </aside>
      </div>

      {toast && (
        <Toast
          message={toast.message} type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
