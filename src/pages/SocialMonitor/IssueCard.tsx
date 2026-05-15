import { useState } from 'react';
import { type TgIssue } from '../../shared/hooks/useSocialMonitor';
import { copyToClipboard } from '../../shared/utils/kpi-helpers';
import { STATUS_LABELS, STATUS_COLORS, severityColor, timeAgo, tgLink } from './social-monitor-helpers';
import styles from './SocialMonitor.module.css';

interface IssueMessage {
  id: number;
  chatId: number;
  messageId: number;
  date: string;
  senderName: string | null;
  text: string;
}

interface IssueCardProps {
  issue: TgIssue;
  chats: { chatId: number; title: string }[];
  fetchMessages: () => Promise<IssueMessage[]>;
  onStatusChange: (s: TgIssue['status']) => void;
}

export function IssueCard({ issue, chats, fetchMessages, onStatusChange }: IssueCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msgs, setMsgs] = useState<IssueMessage[] | null>(null);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !msgs) {
      const data = await fetchMessages();
      setMsgs(data);
    }
  };

  return (
    <div className={`${styles.issueCard} ${issue.severity >= 8 ? styles.issueCritical : ''}`}>
      <div className={styles.issueHeader} onClick={handleExpand}>
        <div className={styles.issueSeverity} style={{ background: severityColor(issue.severity) }}>
          {issue.severity}
        </div>
        <div className={styles.issueInfo}>
          <span className={styles.issueTitle}>{issue.title}</span>
          <div className={styles.issueMeta}>
            {issue.location && <span className={styles.issueLocation}>{issue.location}</span>}
            {issue.direction && <span className={styles.issueDirection}>{issue.direction}</span>}
            <span className={styles.issueTime}>{timeAgo(issue.lastSeen)}</span>
            <span className={styles.issueMsgCount}>{issue.messageCount} сообщ.</span>
          </div>
        </div>
        <div className={styles.issueStatus} style={{ color: STATUS_COLORS[issue.status] }}>
          {STATUS_LABELS[issue.status]}
        </div>
      </div>

      {expanded && (
        <div className={styles.issueExpanded}>
          {issue.summary && <p className={styles.issueSummary}>{issue.summary}</p>}

          {/* Messages */}
          {msgs && msgs.length > 0 && (
            <div className={styles.issueMsgList}>
              {msgs.slice(0, 5).map(m => {
                const chat = chats.find(c => c.chatId === m.chatId);
                return (
                  <a key={m.id} href={tgLink(m.chatId, m.messageId)} target="_blank" rel="noopener noreferrer" className={styles.issueMsgItem}>
                    <div className={styles.issueMsgMeta}>
                      <span className={styles.issueMsgSender}>{m.senderName ?? '?'}</span>
                      <span className={styles.issueMsgTime}>{timeAgo(m.date)}</span>
                      {chat && <span className={styles.issueMsgChat}>{chat.title}</span>}
                    </div>
                    <p className={styles.issueMsgText}>{m.text.slice(0, 200)}{m.text.length > 200 ? '…' : ''}</p>
                  </a>
                );
              })}
            </div>
          )}

          <div className={styles.issueActions}>
            <button className={styles.issueCopyBtn} onClick={(e) => {
              e.stopPropagation();
              const icon = issue.severity >= 9 ? '🚨' : issue.severity >= 7 ? '⚠️' : 'ℹ️';
              const lines: string[] = [];

              lines.push(`${icon} ${issue.title}`);
              lines.push(`Острота: ${issue.severity}/10`);
              lines.push('');

              if (issue.location && issue.location !== 'не указана') lines.push(`Где: ${issue.location}`);
              if (issue.direction) lines.push(`Тема: ${issue.direction}`);

              if (issue.summary) {
                const clean = issue.summary.split('\n\nЦитаты:')[0];
                lines.push('', clean);
              }

              if (msgs && msgs.length > 0) {
                lines.push('');
                msgs.slice(0, 3).forEach(m => {
                  const link = tgLink(m.chatId, m.messageId);
                  const text = m.text.slice(0, 80).replace(/\n/g, ' ') + (m.text.length > 80 ? '…' : '');
                  lines.push(`— "${text}"  [→]( ${link} )`);
                });
              }

              lines.push('', `${issue.messageCount} сообщ. · SocPulse`);
              const text = lines.join('\n');
              copyToClipboard(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? '✓ Скопировано' : 'Копировать для Telegram'}
            </button>
            {(['watching', 'escalated', 'resolved', 'ignored'] as TgIssue['status'][])
              .filter(s => s !== issue.status)
              .map(s => (
                <button key={s} className={styles.issueActionBtn} style={{ color: STATUS_COLORS[s] }}
                  onClick={(e) => { e.stopPropagation(); onStatusChange(s); }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
