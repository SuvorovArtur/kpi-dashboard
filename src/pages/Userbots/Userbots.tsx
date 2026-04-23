import { useMemo, useState } from 'react';
import { Bot, Plus, Trash2, Save, X, CheckCircle2, CircleOff } from 'lucide-react';
import { Header, EmptyState, Skeleton, Badge } from '../../shared/ui';
import { useSocialMonitor, type TgUserbot } from '../../shared/hooks/useSocialMonitor';
import styles from './Userbots.module.css';

interface FormState {
  id?: number;
  label: string;
  sessionName: string;
  phone: string;
  apiIdHint: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  label: '',
  sessionName: '',
  phone: '',
  apiIdHint: '',
  isActive: true,
};

function minutesAgo(iso: string | null): string {
  if (!iso) return 'никогда';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return new Date(iso).toLocaleString('ru-RU');
}

function liveness(iso: string | null): 'green' | 'yellow' | 'red' {
  if (!iso) return 'red';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5 * 60_000) return 'green';
  if (diff < 60 * 60_000) return 'yellow';
  return 'red';
}

export function Userbots() {
  const { userbots, chats, isLoading, saveUserbot, deleteUserbot } = useSocialMonitor();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of chats) {
      if (c.userbotId) map.set(c.userbotId, (map.get(c.userbotId) ?? 0) + 1);
    }
    return map;
  }, [chats]);

  const startAdd = () => { setError(null); setForm({ ...EMPTY_FORM }); };
  const startEdit = (u: TgUserbot) => {
    setError(null);
    setForm({
      id: u.id,
      label: u.label,
      sessionName: u.sessionName,
      phone: u.phone ?? '',
      apiIdHint: u.apiIdHint ?? '',
      isActive: u.isActive,
    });
  };

  const cancel = () => { setForm(null); setError(null); };

  const submit = async () => {
    if (!form) return;
    if (!form.label.trim() || !form.sessionName.trim()) {
      setError('Метка и session_name обязательны');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveUserbot({
        id: form.id,
        label: form.label.trim(),
        sessionName: form.sessionName.trim(),
        phone: form.phone.trim() || null,
        apiIdHint: form.apiIdHint.trim() || null,
        isActive: form.isActive,
      });
      setForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: TgUserbot) => {
    const linked = chatCounts.get(u.id) ?? 0;
    const msg = linked > 0
      ? `Удалить userbot «${u.label}»? К нему привязано ${linked} чат(ов), они останутся без userbot_id.`
      : `Удалить userbot «${u.label}»?`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await deleteUserbot(u.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header
        title="Userbots"
        subtitle="Pyrogram-сессии, которые слушают Telegram-чаты и каналы"
      >
        {!form && (
          <button className={styles.primaryBtn} onClick={startAdd} disabled={busy}>
            <Plus size={14} /> Добавить userbot
          </button>
        )}
      </Header>

      {form && (
        <section className={styles.formCard}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Метка</span>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="например: Основной userbot"
              />
            </label>
            <label className={styles.field}>
              <span>Session name (TG_SESSION)</span>
              <input
                type="text"
                value={form.sessionName}
                onChange={e => setForm({ ...form, sessionName: e.target.value })}
                placeholder="socpulse_bot"
                disabled={!!form.id}
              />
            </label>
            <label className={styles.field}>
              <span>Телефон (опц.)</span>
              <input
                type="text"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                placeholder="+7..."
              />
            </label>
            <label className={styles.field}>
              <span>API ID hint (4 цифры)</span>
              <input
                type="text"
                value={form.apiIdHint}
                onChange={e => setForm({ ...form, apiIdHint: e.target.value })}
                placeholder="1234"
                maxLength={6}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldRow}`}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => setForm({ ...form, isActive: e.target.checked })}
              />
              <span>Активен</span>
            </label>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formActions}>
            <button className={styles.primaryBtn} onClick={submit} disabled={busy}>
              <Save size={14} /> {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
            <button className={styles.ghostBtn} onClick={cancel} disabled={busy}>
              <X size={14} /> Отмена
            </button>
          </div>
          <div className={styles.hint}>
            Session name должен точно совпадать с переменной <code>TG_SESSION</code> на хосте,
            где запущен соответствующий процесс <code>bot.py</code>. После создания бот сам
            обновит <code>last_seen_at</code> в течение минуты.
          </div>
        </section>
      )}

      {isLoading ? (
        <Skeleton variant="card" />
      ) : userbots.length === 0 ? (
        <EmptyState
          title="Userbots пока нет"
          description="Запусти первый bot.py на сервере — он зарегистрирует себя автоматически. Или добавь запись вручную через кнопку выше."
        />
      ) : (
        <div className={styles.list}>
          {userbots.map(u => {
            const tone = liveness(u.lastSeenAt);
            const linked = chatCounts.get(u.id) ?? 0;
            return (
              <div key={u.id} className={styles.row}>
                <div className={styles.rowIcon}><Bot size={18} /></div>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitleLine}>
                    <span className={styles.rowLabel}>{u.label}</span>
                    <Badge status={tone} label={tone === 'green' ? 'онлайн' : tone === 'yellow' ? 'затих' : 'офлайн'} size="sm" />
                    {u.isActive ? (
                      <span className={styles.activeOn}><CheckCircle2 size={12} /> активен</span>
                    ) : (
                      <span className={styles.activeOff}><CircleOff size={12} /> отключён</span>
                    )}
                  </div>
                  <div className={styles.rowMeta}>
                    <span><code>{u.sessionName}</code></span>
                    {u.phone && <span>· {u.phone}</span>}
                    {u.apiIdHint && <span>· api_id …{u.apiIdHint}</span>}
                    <span>· heartbeat: {minutesAgo(u.lastSeenAt)}</span>
                    <span>· чатов: <strong>{linked}</strong></span>
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <button className={styles.ghostBtn} onClick={() => startEdit(u)} disabled={busy}>
                    Править
                  </button>
                  <button className={styles.dangerBtn} onClick={() => remove(u)} disabled={busy}>
                    <Trash2 size={12} /> Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Userbots;
