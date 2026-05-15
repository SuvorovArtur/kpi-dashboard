import type { Appeal } from '../../types';
import { formatDate } from '../../utils/formatters';
import styles from './AppealDetail.module.css';

interface AppealDetailProps {
  appeal: Appeal | null;
}

export function AppealDetail({ appeal }: AppealDetailProps) {
  if (!appeal) return null;

  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <span className={styles.label}>Дата</span>
        <span className={styles.value}>{formatDate(appeal.date)}</span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>Номер ЕЦУР</span>
        <span className={styles.value}>{appeal.ecur_number}</span>
      </div>
      {appeal.source_number && (
        <div className={styles.field}>
          <span className={styles.label}>Номер в источнике</span>
          <span className={styles.value}>{appeal.source_number}</span>
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.label}>Направление</span>
        <span className={styles.value}>{appeal.direction}</span>
      </div>
      {appeal.subtopic && (
        <div className={styles.field}>
          <span className={styles.label}>Подтема</span>
          <span className={styles.value}>{appeal.subtopic}</span>
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.label}>Статус</span>
        <span className={styles.value}>{appeal.status}</span>
      </div>
      {appeal.source && (
        <div className={styles.field}>
          <span className={styles.label}>Источник</span>
          <span className={styles.value}>{appeal.source}</span>
        </div>
      )}
      {appeal.executor && (
        <div className={styles.field}>
          <span className={styles.label}>Исполнитель</span>
          <span className={styles.value}>{appeal.executor}</span>
        </div>
      )}
      {appeal.curator && (
        <div className={styles.field}>
          <span className={styles.label}>Куратор</span>
          <span className={styles.value}>{appeal.curator}</span>
        </div>
      )}
      {appeal.settlement && (
        <div className={styles.field}>
          <span className={styles.label}>Населённый пункт</span>
          <span className={styles.value}>{appeal.settlement}</span>
        </div>
      )}
      {appeal.address && (
        <div className={styles.field}>
          <span className={styles.label}>Адрес</span>
          <span className={styles.value}>{appeal.address}</span>
        </div>
      )}
      {appeal.fact && (
        <div className={styles.field}>
          <span className={styles.label}>Факт</span>
          <span className={styles.value}>{appeal.fact}</span>
        </div>
      )}
      {appeal.sentiment_score != null && (
        <div className={styles.field}>
          <span className={styles.label}>ИСН балл</span>
          <span className={styles.value}>{appeal.sentiment_score}/10</span>
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.label}>Тип сообщения</span>
        <span className={styles.value}>{appeal.message_type ?? '—'}</span>
      </div>
      {appeal.sector && (
        <div className={styles.field}>
          <span className={styles.label}>Сектор</span>
          <span className={styles.value}>{appeal.sector}</span>
        </div>
      )}
      {appeal.description && (
        <div className={styles.fieldFull}>
          <span className={styles.label}>Описание</span>
          <p className={styles.description}>{appeal.description}</p>
        </div>
      )}
      {appeal.source_number && (
        <a
          href={`https://dobrodel.mosreg.ru/appeal/${appeal.source_number}`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.dobrodelLink}
        >
          Открыть в Добродел
        </a>
      )}
    </div>
  );
}
