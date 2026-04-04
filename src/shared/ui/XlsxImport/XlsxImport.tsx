import { useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import styles from './XlsxImport.module.css';

interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
}

interface XlsxImportProps {
  onComplete: (result: ImportResult) => void;
  onError: (message: string) => void;
}

function excelDateToISO(serial: unknown): string {
  if (typeof serial === 'number') {
    return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);
  }
  return String(serial);
}

export function XlsxImport({ onComplete, onError }: XlsxImportProps) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setProgress('Чтение файла...');

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];

      setProgress(`Найдено ${raw.length} строк. Обработка...`);

      let autoId = 0;
      const seen = new Set<string>();
      const rows: Record<string, unknown>[] = [];

      for (const r of raw) {
        let ecur = String(r['Номер ЕЦУР'] ?? '').trim();
        if (!ecur) {
          ecur = `AUTO-${++autoId}-${r['Номер в источнике'] ?? Date.now()}`;
        }
        if (seen.has(ecur)) continue;
        seen.add(ecur);

        rows.push({
          ecur_number: ecur,
          source_number: r['Номер в источнике'] ? String(r['Номер в источнике']) : null,
          date: excelDateToISO(r['Дата (первого взятия в работу)']),
          direction: r['Направление'] || 'Прочее',
          synth_group: r['Синт. группа'] || null,
          fact: r['Факт'] || null,
          subtopic: r['Подтема'] || null,
          status: r['Статус'] || 'Неизвестно',
          curator: r['Куратор'] || null,
          executor: r['Исполнитель'] || null,
          omsu: r['ОМСУ'] || null,
          source: r['Источник'] || null,
          is_spam: r['Спам'] === 'Да',
          message_type: r['Тип сообщения'] || 'Проблемы',
          description: r['Описание'] || null,
          address: r['Адрес (формат)'] || null,
          district: r['Район'] || null,
          settlement: r['Населенный пункт'] || null,
          street: r['Улица'] || null,
          house: r['Дом'] || null,
          tu_to: r['ТУ/ТО'] || null,
          sector: r['Сектор'] || null,
        });
      }

      // Get existing ecur_numbers to count skips
      const { data: existing } = await supabase
        .from('appeals')
        .select('ecur_number');
      const existingSet = new Set((existing ?? []).map((r: { ecur_number: string }) => r.ecur_number));
      const newRows = rows.filter(r => !existingSet.has(r.ecur_number as string));
      const skipped = rows.length - newRows.length;

      if (newRows.length === 0) {
        onComplete({ total: rows.length, inserted: 0, skipped });
        setImporting(false);
        setProgress('');
        if (fileRef.current) fileRef.current.value = '';
        return;
      }

      setProgress(`Загрузка ${newRows.length} новых обращений...`);

      for (let i = 0; i < newRows.length; i += 200) {
        const batch = newRows.slice(i, i + 200);
        const { error } = await supabase.from('appeals').insert(batch);
        if (error) throw new Error(error.message);
        setProgress(`Загружено ${Math.min(i + 200, newRows.length)} / ${newRows.length}`);
      }

      onComplete({ total: rows.length, inserted: newRows.length, skipped });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setProgress('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [onComplete, onError]);

  return (
    <div className={styles.wrapper}>
      <label className={styles.uploadBtn}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFile}
          disabled={importing}
          className={styles.fileInput}
        />
        {importing ? progress : 'Загрузить XLSX из ЕЦУР'}
      </label>
    </div>
  );
}
