import { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { Header, Card, DateRangePicker } from '../../shared/ui';
import { useDateRange } from '../../shared/hooks';
import { useHeatmapData } from '../../shared/hooks/useHeatmapData';
import { MapPin, Flame, Navigation, Download } from 'lucide-react';
import clsx from 'clsx';
import styles from './HeatMap.module.css';

declare module 'leaflet' {
  function heatLayer(
    latlngs: [number, number, number?][],
    options?: Record<string, unknown>,
  ): L.Layer & { setLatLngs: (l: [number, number, number?][]) => void };
}

const MYTISHCHI: [number, number] = [55.911, 37.736];
const ZOOM = 12;

const GRADIENT: Record<number, string> = {
  0.0: '#00ff00',
  0.2: '#adff2f',
  0.4: '#ffff00',
  0.6: '#ff8c00',
  0.8: '#ff4500',
  1.0: '#ff0000',
};

function getLastWeekRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function HeatMap() {
  const { range, setRange } = useDateRange(getLastWeekRange());
  const [direction, setDirection] = useState<string>('Все');

  const { points, allAppeals, isLoading, geocoding, startGeocoding } = useHeatmapData({
    dateFrom: range.from,
    dateTo: range.to,
    direction: direction === 'Все' ? undefined : direction,
  });

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const heatLayerRef = useRef<ReturnType<typeof L.heatLayer> | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // Unique directions from data
  const availableDirections = useMemo(() => {
    const dirs = new Set(allAppeals.map(a => a.direction).filter(Boolean));
    return ['Все', ...Array.from(dirs).sort()];
  }, [allAppeals]);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, { minZoom: 10, attributionControl: false }).setView(MYTISHCHI, ZOOM);

    // Faded background tiles (full coverage)
    map.createPane('bgPane');
    map.getPane('bgPane')!.style.zIndex = '150';
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      pane: 'bgPane',
      opacity: 0.15,
      crossOrigin: 'anonymous',
      maxZoom: 19,
    }).addTo(map);

    // Full-brightness tiles (will be visually clipped by mask)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      crossOrigin: 'anonymous',
      maxZoom: 19,
    }).addTo(map);

    // Load boundary and create mask + outline
    // Helper: extract LatLng rings from GeoJSON geometry
    const extractRings = (geojson: { type: string; coordinates: number[][][][] }): [number, number][][] => {
      const rings: [number, number][][] = [];
      if (geojson.type === 'Polygon') {
        rings.push((geojson.coordinates as unknown as number[][][])[0].map(c => [c[1], c[0]]));
      } else if (geojson.type === 'MultiPolygon') {
        (geojson.coordinates as number[][][][]).forEach(poly =>
          rings.push(poly[0].map(c => [c[1], c[0]] as [number, number])),
        );
      }
      return rings;
    };

    // Load both boundaries: district (округ) and city (город)
    Promise.all([
      fetch('/mytishchi-boundary.geojson').then(r => r.json()),
      fetch('/mytishchi-city.geojson').then(r => r.json()),
    ]).then(([district, city]) => {
      const worldCover: [number, number][] = [
        [-90, -360], [90, -360], [90, 360], [-90, 360],
      ];
      const districtRings = extractRings(district);

      // Mask pane above heatmap
      map.createPane('maskPane');
      map.getPane('maskPane')!.style.zIndex = '450';

      // 1) World mask with district punched out
      L.polygon([worldCover, ...districtRings], {
        pane: 'maskPane',
        fillColor: '#f0f2f5',
        fillOpacity: 1,
        stroke: false,
        interactive: false,
      }).addTo(map);

      // 2) City mask — пропускаем мкр. Пироговский (polygon 3,4)
      const cityRings = extractRings(city);
      cityRings.forEach((ring) => {
        // Polygon 3 = мкр. Пироговский (55.978, 37.750), Polygon 4 = анклав рядом
        // Определяем по центру: если lat > 55.97 и lng > 37.73 — это Пироговский
        const avgLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const avgLng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        if (avgLat > 55.97 && avgLng > 37.73) return; // пропускаем Пироговский

        L.polygon([ring], {
          pane: 'maskPane',
          fillColor: '#f0f2f5',
          fillOpacity: 0.45,
          stroke: false,
          interactive: false,
        }).addTo(map);
      });

      // 3) Лосиный остров — нац. парк, не наша территория
      // 3) Лосиный остров — весь юго-восток округа (нац. парк + пригороды)
      const losinyOstrov: [number, number][] = [
        [55.915, 37.745], [55.920, 37.760], [55.915, 37.790],
        [55.910, 37.820], [55.910, 37.900], [55.900, 37.920],
        [55.880, 37.920], [55.860, 37.910], [55.840, 37.900],
        [55.820, 37.880], [55.810, 37.850], [55.810, 37.800],
        [55.815, 37.770], [55.830, 37.740], [55.850, 37.725],
        [55.870, 37.720], [55.890, 37.725], [55.905, 37.735],
      ];
      L.polygon([losinyOstrov], {
        pane: 'maskPane',
        fillColor: '#f0f2f5',
        fillOpacity: 0.45,
        stroke: false,
        interactive: false,
      }).addTo(map);

      // District boundary outline
      const boundary = L.geoJSON(district as GeoJSON.GeoJsonObject, {
        style: { color: '#0E5C5D', weight: 2.5, fill: false, opacity: 0.7 },
      }).addTo(map);

      // City boundary outline (lighter, dashed)
      L.geoJSON(city as GeoJSON.GeoJsonObject, {
        style: { color: '#0E5C5D', weight: 1.5, fill: false, opacity: 0.3, dashArray: '6,4' },
      }).addTo(map);

      // Fit and constrain to district
      const bounds = boundary.getBounds();
      map.fitBounds(bounds);
      map.setMaxBounds(bounds.pad(0.3));
    }).catch(() => { /* boundaries load failed */ });

    // Heatmap pane between tiles and mask
    map.createPane('heatPane');
    map.getPane('heatPane')!.style.zIndex = '420';

    const heat = L.heatLayer([], {
      pane: 'heatPane',
      radius: 22,
      blur: 20,
      maxZoom: 16,
      max: 1.0,
      minOpacity: 0.25,
      gradient: GRADIENT,
    });
    heat.addTo(map);

    const markers = L.layerGroup();

    // Switch layers by zoom
    map.on('zoomend', () => {
      const z = map.getZoom();
      if (z >= 15) {
        if (map.hasLayer(heat)) map.removeLayer(heat);
        if (!map.hasLayer(markers)) map.addLayer(markers);
      } else {
        if (map.hasLayer(markers)) map.removeLayer(markers);
        if (!map.hasLayer(heat)) map.addLayer(heat);
      }
    });

    mapInstanceRef.current = map;
    heatLayerRef.current = heat;
    markersRef.current = markers;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      heatLayerRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Fix grey tiles when returning from another tab/page
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && mapInstanceRef.current) {
        try { mapInstanceRef.current.invalidateSize(); } catch { /* map destroyed */ }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Also fix on initial mount (SPA navigation)
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.invalidateSize(); } catch { /* map destroyed */ }
      }
    }, 300);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
    };
  }, []);

  // Track whether we've done fitBounds for current filter
  const hasFittedRef = useRef(false);
  const prevFilterRef = useRef('');
  const filterKey = `${range.from}_${range.to}_${direction}`;
  if (filterKey !== prevFilterRef.current) {
    hasFittedRef.current = false;
    prevFilterRef.current = filterKey;
  }

  // Update data on map
  useEffect(() => {
    const heat = heatLayerRef.current;
    const markers = markersRef.current;
    const map = mapInstanceRef.current;
    if (!heat || !markers || !map) return;

    try {
      // Heatmap — percentile normalization
      const sorted = [...points].sort((a, b) => a.intensity - b.intensity);
      const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)]?.intensity || 1 : 1;
      const heatData: [number, number, number][] = points.map(p => [
        p.lat,
        p.lng,
        Math.min(p.intensity / p95, 1.0),
      ]);
      heat.setLatLngs(heatData);

      // Auto-fit only on first data load, not on every update
      if (points.length > 0 && !hasFittedRef.current) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        hasFittedRef.current = true;
      }
    } catch {
      // Map may have been destroyed during navigation
    }

    // Markers for zoom-in
    markers.clearLayers();
    points.forEach(p => {
      const a = p.appeal;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        fillColor: '#DD4526',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.85,
      }).bindPopup(
        `<div style="font-size:13px;line-height:1.5">
          <b>${a.direction || 'Обращение'}</b><br/>
          ${a.address || ''}<br/>
          <span style="color:#6b7280">${a.date}</span><br/>
          ${a.ecur_number ? `<span style="color:#999">ЕЦУР: ${a.ecur_number}</span>` : ''}
          ${a.description ? `<br/><span style="font-size:12px;color:#555">${a.description.slice(0, 150)}${a.description.length > 150 ? '...' : ''}</span>` : ''}
        </div>`,
      );
      markers.addLayer(marker);
    });
  }, [points]);

  // KPI stats
  const totalAppeals = allAppeals.length;
  const geocodedCount = points.length;
  const ungeocodedCount = totalAppeals - geocodedCount;
  const [showHotspots, setShowHotspots] = useState<false | 'critical' | 'hot'>(false);

  // Группировка по населённому пункту / улице (логический кластер, не геосетка)
  const allHotspots = useMemo(() => {
    const groups = new Map<string, { lats: number[]; lngs: number[]; count: number }>();
    points.forEach(p => {
      // Ключ: населённый пункт или улица — логическая группа
      const key = p.appeal.settlement || p.appeal.street || p.appeal.address || 'Без адреса';
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.lats.push(p.lat);
        existing.lngs.push(p.lng);
      } else {
        groups.set(key, { lats: [p.lat], lngs: [p.lng], count: 1 });
      }
    });
    return Array.from(groups.entries())
      .filter(([, g]) => g.count >= 5)
      .map(([name, g]) => ({
        lat: g.lats.reduce((a, b) => a + b, 0) / g.lats.length,
        lng: g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length,
        count: g.count,
        address: name.replace('Россия, Московская область, ', '').replace('городской округ Мытищи, ', ''),
      }))
      .sort((a, b) => b.count - a.count);
  }, [points]);

  const hotspotsCritical = useMemo(() => allHotspots.filter(h => h.count >= 10), [allHotspots]);
  const hotspotsWarm = useMemo(() => allHotspots.filter(h => h.count >= 5 && h.count < 10), [allHotspots]);

  const flyToHotspot = (lat: number, lng: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 16, { duration: 0.8 });
    }
    setShowHotspots(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportMapPng = async () => {
    const container = mapRef.current;
    if (!container) return;
    setExporting(true);
    try {
      // Hide controls
      const hide = container.querySelectorAll<HTMLElement>(
        '.leaflet-control-zoom',
      );
      hide.forEach(el => el.style.display = 'none');

      // Force all tile images to crossOrigin before capture
      container.querySelectorAll<HTMLImageElement>('.leaflet-tile').forEach(img => {
        if (!img.crossOrigin) img.crossOrigin = 'anonymous';
      });

      await new Promise(r => setTimeout(r, 800));

      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(container, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#f0f2f5',
        scale: 2,
        logging: false,
        removeContainer: true,
      });

      hide.forEach(el => el.style.display = '');

      const link = document.createElement('a');
      link.download = `карта-обращений-${range.from}_${range.to}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // fallback
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header title="Карта обращений">
        <button
          className={styles.exportBtn}
          onClick={exportMapPng}
          disabled={exporting}
          title="Экспорт карты в PNG"
        >
          <Download size={16} />
          {exporting ? 'Экспорт...' : 'PNG'}
        </button>
        <DateRangePicker value={range} onChange={setRange} />
      </Header>

      <div className={styles.kpiRow}>
        <Card>
          <div className={styles.statCard}>
            <MapPin size={20} className={styles.statIcon} />
            <div>
              <div className={styles.statValue}>{totalAppeals}</div>
              <div className={styles.statLabel}>Всего обращений</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className={styles.statCard}>
            <Navigation size={20} className={styles.statIcon} />
            <div>
              <div className={styles.statValue}>{geocodedCount}</div>
              <div className={styles.statLabel}>На карте ({totalAppeals > 0 ? Math.round(geocodedCount / totalAppeals * 100) : 0}%)</div>
            </div>
          </div>
        </Card>
        <Card>
          <div
            className={clsx(styles.statCard, styles.statCardClickable)}
            onClick={() => hotspotsCritical.length > 0 && setShowHotspots(showHotspots === 'critical' ? false : 'critical')}
          >
            <Flame size={20} className={styles.statIconDanger} />
            <div>
              <div className={styles.statValue}>{hotspotsCritical.length}</div>
              <div className={styles.statLabel}>Критичные (10+)</div>
            </div>
          </div>
          {showHotspots === 'critical' && hotspotsCritical.length > 0 && (
            <div className={styles.hotspotList}>
              {hotspotsCritical.map((h, i) => (
                <button key={i} className={styles.hotspotItem} onClick={() => flyToHotspot(h.lat, h.lng)}>
                  <span className={clsx(styles.hotspotCount, styles.hotspotCountDanger)}>{h.count}</span>
                  <span className={styles.hotspotAddr}>{h.address}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div
            className={clsx(styles.statCard, styles.statCardClickable)}
            onClick={() => hotspotsWarm.length > 0 && setShowHotspots(showHotspots === 'hot' ? false : 'hot')}
          >
            <Flame size={20} className={styles.statIconOrange} />
            <div>
              <div className={styles.statValue}>{hotspotsWarm.length}</div>
              <div className={styles.statLabel}>Горячие (5–9)</div>
            </div>
          </div>
          {showHotspots === 'hot' && hotspotsWarm.length > 0 && (
            <div className={styles.hotspotList}>
              {hotspotsWarm.map((h, i) => (
                <button key={i} className={styles.hotspotItem} onClick={() => flyToHotspot(h.lat, h.lng)}>
                  <span className={styles.hotspotCount}>{h.count}</span>
                  <span className={styles.hotspotAddr}>{h.address}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className={styles.controls}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Направление:</span>
            {availableDirections.map(d => (
              <button
                key={d}
                className={clsx(styles.filterBtn, direction === d && styles.filterBtnActive)}
                onClick={() => setDirection(d)}
              >
                {d}
              </button>
            ))}
          </div>

          {ungeocodedCount > 0 && (
            <button
              className={styles.geocodeBtn}
              onClick={startGeocoding}
              disabled={geocoding.active}
            >
              {geocoding.active
                ? `Геокодинг ${geocoding.done}/${geocoding.total}...`
                : `Геокодировать (${ungeocodedCount})`}
            </button>
          )}

          <span className={styles.stats}>
            {isLoading ? 'Загрузка...' : `${geocodedCount} точек на карте`}
          </span>
        </div>
      </Card>

      <div className={styles.mapWrapper}>
        <div ref={mapRef} className={styles.mapContainer} />
        <div className={styles.legend}>
          <p className={styles.legendTitle}>Плотность обращений</p>
          <div className={styles.legendBar} />
          <div className={styles.legendLabels}>
            <span>Низкая</span>
            <span>Средняя</span>
            <span>Высокая</span>
          </div>
        </div>
      </div>
    </div>
  );
}
