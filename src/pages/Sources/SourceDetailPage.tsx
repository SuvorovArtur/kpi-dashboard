import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, Skeleton } from '../../shared/ui';
import { supabase } from '../../shared/lib/supabase';
import { SourceDetail, type SourceRow } from './Sources';
import styles from './Sources.module.css';

export function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [row, setRow] = useState<SourceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('tg_sources_overview')
        .select('*')
        .eq('id', Number(id))
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
      } else {
        setRow(data as SourceRow | null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className={styles.page}>
      <button type="button" className={styles.backBtn} onClick={() => navigate('/sources')}>
        <ArrowLeft size={14} /> К списку источников
      </button>

      {loading ? (
        <Skeleton variant="card" />
      ) : error ? (
        <EmptyState title="Не удалось загрузить источник" description={error} />
      ) : !row ? (
        <EmptyState
          title="Источник не найден"
          description="Возможно, он был удалён или id некорректен"
        />
      ) : (
        <SourceDetail source={row} />
      )}
    </div>
  );
}

export default SourceDetailPage;
