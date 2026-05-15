export const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  watching: 'На контроле',
  escalated: 'Эскалация',
  resolved: 'Решена',
  ignored: 'Игнор',
};

export const STATUS_COLORS: Record<string, string> = {
  new: '#dc2626',
  watching: '#ca8a04',
  escalated: '#dc2626',
  resolved: '#16a34a',
  ignored: '#9ca3af',
};

export function severityColor(s: number): string {
  if (s >= 8) return '#dc2626';
  if (s >= 5) return '#ca8a04';
  return '#16a34a';
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}м назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days}д назад`;
}

export function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) {
    const mins = Math.floor(-diff / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `просрочен на ${mins}м`;
    const hrs = Math.floor(mins / 60);
    return `просрочен на ${hrs}ч`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'сейчас';
  if (mins < 60) return `через ${mins}м`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `через ${hrs}ч`;
  const days = Math.floor(hrs / 24);
  return `через ${days}д`;
}

export function tgLink(chatId: number, messageId: number): string {
  // Convert -100XXXXXXXXXX → XXXXXXXXXX for t.me/c/ format
  const raw = Math.abs(chatId);
  const stripped = raw > 1000000000000 ? raw - 1000000000000 : raw;
  return `https://t.me/c/${stripped}/${messageId}`;
}

export interface NewsItem {
  id: number;
  chatId: number;
  messageId: number;
  text: string;
  photoUrl: string | null;
  summary: string;
  topic: string;
  location: string;
  severity: number;
  channelName: string;
  postUrl: string | null;
  createdAt: string;
}
