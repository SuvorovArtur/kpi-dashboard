import { useState, useMemo } from 'react';
import { Card, Badge, Header, Skeleton, EmptyState } from '../../shared/ui';
import { useRoadmap } from '../../shared/hooks';
import { formatDate } from '../../shared/utils/formatters';
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
  const { data, isLoading } = useRoadmap(
    filter === 'all' ? {} : { track: filter },
  );

  const groupedByTrack = useMemo(() => {
    const groups = new Map<string, RoadmapItem[]>();
    for (const item of data) {
      if (!groups.has(item.track)) groups.set(item.track, []);
      groups.get(item.track)!.push(item);
    }
    // Sort items within each track by startDate
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
      <Header title="Дорожная карта" />

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
        <EmptyState title="Нет данных" description="Нет элементов дорожной карты" />
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
                  {/* Connector line */}
                  <div className={styles.timelineConnector}>
                    <div className={styles.timelineNode} />
                    {index < items.length - 1 && (
                      <div className={styles.timelineLine} />
                    )}
                  </div>

                  {/* Date column */}
                  <div className={styles.timelineDates}>
                    <span className={styles.dateRange}>
                      {formatDate(item.startDate)} — {formatDate(item.endDate)}
                    </span>
                  </div>

                  {/* Content card */}
                  <div className={styles.timelineCard}>
                    <div className={styles.timelineCardHeader}>
                      <span className={styles.timelineTitle}>{item.title}</span>
                      <Badge
                        status={
                          item.status === 'done'
                            ? 'green'
                            : item.status === 'in_progress'
                              ? 'yellow'
                              : 'red'
                        }
                        label={STATUS_LABELS[item.status]}
                        size="sm"
                      />
                    </div>
                    {item.linkedKpis && item.linkedKpis.length > 0 && (
                      <div className={styles.linkedKpis}>
                        {item.linkedKpis.map((kpi) => (
                          <span key={kpi} className={styles.kpiBadge}>
                            {kpi}
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
    </div>
  );
}

export default Roadmap;
