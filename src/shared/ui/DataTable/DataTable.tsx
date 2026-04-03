import { type ReactNode, useState, useMemo, useCallback } from 'react';
import { Download, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  title: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => ReactNode;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  pageSize?: number;
  exportFilename?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onSort,
  pageSize = 10,
  exportFilename,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const handleSort = useCallback(
    (key: string) => {
      const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
      setSortKey(key);
      setSortDir(newDir);
      onSort?.(key, newDir);
    },
    [sortKey, sortDir, onSort],
  );

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), 'ru');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const pageData = sortedData.slice(page * pageSize, (page + 1) * pageSize);

  const exportCsv = useCallback(() => {
    if (!exportFilename) return;
    const header = columns.map((c) => c.title).join(',');
    const rows = sortedData.map((row) =>
      columns
        .map((c) => {
          const val = row[c.key];
          const str = String(val ?? '');
          return str.includes(',') || str.includes('"')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename.endsWith('.csv') ? exportFilename : `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [columns, sortedData, exportFilename]);

  const renderSortIcon = (col: Column<T>) => {
    if (!col.sortable) return null;
    const isActive = sortKey === col.key;
    if (!isActive) {
      return (
        <span className={styles.sortIcon}>
          <ChevronsUpDown size={14} />
        </span>
      );
    }
    return (
      <span className={clsx(styles.sortIcon, styles.sortActive)}>
        {sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </span>
    );
  };

  return (
    <div className={styles.wrapper}>
      {exportFilename && (
        <div className={styles.toolbar}>
          <button className={styles.exportBtn} onClick={exportCsv} type="button">
            <Download size={14} />
            Экспорт CSV
          </button>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(col.sortable && styles.sortable)}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                {col.title}
                {renderSortIcon(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageData.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              className={clsx(styles.pageBtn, page === i && styles.pageBtnActive)}
              onClick={() => setPage(i)}
              type="button"
            >
              {i + 1}
            </button>
          ))}
          <button
            className={styles.pageBtn}
            disabled={page === totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
