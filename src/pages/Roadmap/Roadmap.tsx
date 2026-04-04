import { useState, useMemo, useCallback } from 'react';
import { Card, Header, Skeleton, EmptyState, Toast } from '../../shared/ui';
import { useRoadmap, useKpiData } from '../../shared/hooks';
import { formatDate } from '../../shared/utils/formatters';
import { supabase } from '../../shared/lib/supabase';
import type { RoadmapItem } from '../../shared/types';
import styles from './Roadmap.module.css';

type TrackFilter = 'all' | 'tu' | 'mbu';

const STATUS_LABELS: Record<RoadmapItem['status'], string> = {
  done: 'Выполнено',
  in_progress: 'В работе',
  planned: 'Запланировано',
};

const TRACK_LABELS: Record<string, string> = {
  tu: 'Территориальные управления',
  mbu: 'МБУ МТХ',
};

export function Roadmap() {
  const [filter, setFilter] = useState<TrackFilter>('all');
  const { data, isLoading, refetch } = useRoadmap(
    filter === 'all' ? {} : { track: filter },
  );
  const { definitions } = useKpiData();

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formTrack, setFormTrack] = useState<'tu' | 'mbu'>('mbu');
  const [formTitle, setFormTitle] = useState('');
  const [formStartDate, setFormStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [formStatus, setFormStatus] = useState<RoadmapItem['status']>('planned');
  const [formLinkedKpis, setFormLinkedKpis] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleAdd = useCallback(async () => {
    if (!formTitle.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('roadmap').insert({
        track: formTrack,
        title: formTitle.trim(),
        start_date: formStartDate,
        end_date: formEndDate,
        status: formStatus,
        linked_kpis: formLinkedKpis,
      });
      if (error) throw error;
      setToast({ message: 'Пункт добавлен', type: 'success' });
      setShowForm(false);
      setFormTitle('');
      setFormLinkedKpis([]);
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [formTrack, formTitle, formStartDate, formEndDate, formStatus, formLinkedKpis, refetch]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('roadmap').delete().eq('id', id);
      if (error) throw error;
      setToast({ message: 'Пункт удалён', type: 'success' });
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [refetch]);

  const handleStatusChange = useCallback(async (id: string, newStatus: RoadmapItem['status']) => {
    try {
      const { error } = await supabase.from('roadmap').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setToast({ message: 'Статус обновлён', type: 'success' });
      refetch();
    } catch (err) {
      setToast({ message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [refetch]);

  const toggleLinkedKpi = useCallback((kpiId: string) => {
    setFormLinkedKpis((prev) =>
      prev.includes(kpiId) ? prev.filter((k) => k !== kpiId) : [...prev, kpiId],
    );
  }, []);

  const groupedByTrack = useMemo(() => {
    const groups = new Map<string, RoadmapItem[]>();
    for (const item of data) {
      if (!groups.has(item.track)) groups.set(item.track, []);
      groups.get(item.track)!.push(item);
    }
    for (const [, items] of groups) {
      items.sort((a, b) => a.startDate.localeCompare(b.startDate));
    }
    return groups;
  }, [data]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Header title="Дорожная карта" />
        <div className={styles.skeletons}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="card" height={100} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header title="Дорожная карта">
        <button className={styles.addBtn} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </Header>

      {/* Add Form */}
      {showForm && (
        <Card>
          <h3 className={styles.formTitle}>Новый пункт дорожной карты</h3>
          <div className={styles.addForm}>
            <div className={styles.addFormRow}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Название</label>
                <input type="text" className={styles.formInput} value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Описание задачи" />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Трек</label>
                <select className={styles.formInput} value={formTrack} onChange={(e) => setFormTrack(e.target.value as 'tu' | 'mbu')}>
                  <option value="mbu">МБУ МТХ</option>
                  <option value="tu">ТУ</option>
                </select>
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Дата начала</label>
                <input type="date" className={styles.formInput} value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)} />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Дата окончания</label>
                <input type="date" className={styles.formInput} value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Статус</label>
                <select className={styles.formInput} value={formStatus} onChange={(e) => setFormStatus(e.target.value as RoadmapItem['status'])}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            {definitions.length > 0 && (
              <div className={styles.formField} style={{ marginBottom: 12 }}>
                <label className={styles.formLabel}>Связанные KPI</label>
                <div className={styles.kpiCheckboxes}>
                  {definitions.map((def) => (
                    <label key={def.id} className={styles.kpiCheckbox}>
                      <input type="checkbox" checked={formLinkedKpis.includes(def.id)} onChange={() => toggleLinkedKpi(def.id)} />
                      {def.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button className={styles.saveBtn} onClick={handleAdd} disabled={saving || !formTitle.trim()}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </Card>
      )}

      {/* Filter Tabs */}
      <div className={styles.filterTabs}>
        {(['all', 'tu', 'mbu'] as TrackFilter[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.filterTab} ${filter === tab ? styles.filterTabActive : ''}`}
            onClick={() => setFilter(tab)}
          >
            {tab === 'all' ? 'Все' : tab === 'tu' ? 'ТУ' : 'МБУ'}
          </button>
        ))}
      </div>

      {data.length === 0 ? (
        <EmptyState title="Нет данных" description="Добавьте первый пункт дорожной карты" />
      ) : (
        Array.from(groupedByTrack.entries()).map(([track, items]) => (
          <Card key={track}>
            <h3 className={styles.trackTitle}>
              {TRACK_LABELS[track] ?? track}
            </h3>

            <div className={styles.timeline}>
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className={`${styles.timelineItem} ${styles[item.status]}`}
                >
                  <div className={styles.timelineConnector}>
                    <div className={styles.timelineNode} />
                    {index < items.length - 1 && (
                      <div className={styles.timelineLine} />
                    )}
                  </div>

                  <div className={styles.timelineDates}>
                    <span className={styles.dateRange}>
                      {formatDate(item.startDate)} — {formatDate(item.endDate)}
                    </span>
                  </div>

                  <div className={styles.timelineCard}>
                    <div className={styles.timelineCardHeader}>
                      <span className={styles.timelineTitle}>{item.title}</span>
                      <div className={styles.timelineActions}>
                        <select
                          className={styles.statusSelect}
                          value={item.status}
                          onChange={(e) => handleStatusChange(item.id, e.target.value as RoadmapItem['status'])}
                        >
                          {Object.entries(STATUS_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(item.id)}
                          title="Удалить"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    {item.linkedKpis && item.linkedKpis.length > 0 && (
                      <div className={styles.linkedKpis}>
                        {item.linkedKpis.map((kpi) => (
                          <span key={kpi} className={styles.kpiBadge}>
                            {definitions.find((d) => d.id === kpi)?.name ?? kpi}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Roadmap;
