import { useMemo, useState } from 'react';
import { Bot, Plus, Trash2, Save, X, CheckCircle2, CircleOff, Clock, AlertTriangle, Copy } from 'lucide-react';
import { Header, EmptyState, Skeleton, Badge } from '../../shared/ui';
import { useSocialMonitor, type TgUserbot, type TgUserbotDraft } from '../../shared/hooks/useSocialMonitor';
import styles from './Userbots.module.css';

type FormMode = 'add' | 'edit';

interface FormState {
  mode: FormMode;
  id?: number;
  label: string;
  sessionName: string;
  phone: string;
  // Only used in 'add' (draft) mode
  apiId: string;
  apiHash: string;
  // Only used in 'edit' mode
  apiIdHint: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  mode: 'add',
  label: '',
  sessionName: '',
  phone: '',
  apiId: '',
  apiHash: '',
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
  const {
    userbots, userbotDrafts, chats, isLoading,
    saveUserbot, deleteUserbot, createUserbotDraft, deleteUserbotDraft,
  } = useSocialMonitor();
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

  const pendingDrafts = useMemo(
    () => userbotDrafts.filter(d => d.status !== 'authorized'),
    [userbotDrafts],
  );

  const startAdd = () => { setError(null); setForm({ ...EMPTY_FORM, mode: 'add' }); };
  const startEdit = (u: TgUserbot) => {
    setError(null);
    setForm({
      mode: 'edit',
      id: u.id,
      label: u.label,
      sessionName: u.sessionName,
      phone: u.phone ?? '',
      apiIdHint: u.apiIdHint ?? '',
      apiId: '',
      apiHash: '',
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
      if (form.mode === 'add') {
        const apiIdNum = Number(form.apiId.trim());
        if (!Number.isInteger(apiIdNum) || apiIdNum <= 0) {
          setError('api_id должен быть целым числом');
          setBusy(false);
          return;
        }
        if (!form.apiHash.trim() || !form.phone.trim()) {
          setError('api_hash и phone обязательны');
          setBusy(false);
          return;
        }
        await createUserbotDraft({
          label: form.label.trim(),
          sessionName: form.sessionName.trim(),
          apiId: apiIdNum,
          apiHash: form.apiHash.trim(),
          phone: form.phone.trim(),
        });
      } else {
        await saveUserbot({
          id: form.id,
          label: form.label.trim(),
          sessionName: form.sessionName.trim(),
          phone: form.phone.trim() || null,
          apiIdHint: form.apiIdHint.trim() || null,
          isActive: form.isActive,
        });
      }
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

  const removeDraft = async (d: TgUserbotDraft) => {
    if (!confirm(`Удалить черновик «${d.label}» (session: ${d.sessionName})?`)) return;
    setBusy(true);
    try {
      await deleteUserbotDraft(d.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyCmd = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
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
          <div className={styles.formTitle}>
            {form.mode === 'add' ? 'Новый userbot (черновик)' : `Редактировать «${form.label}»`}
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Метка</span>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="например: Мониторинг Мытищи-2"
              />
            </label>
            <label className={styles.field}>
              <span>Session name (TG_SESSION)</span>
              <input
                type="text"
                value={form.sessionName}
                onChange={e => setForm({ ...form, sessionName: e.target.value })}
                placeholder="mytishi_secondary"
                disabled={form.mode === 'edit'}
              />
            </label>

            {form.mode === 'add' ? (
              <>
                <label className={styles.field}>
                  <span>Телефон (с +7...)</span>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+79991234567"
                  />
                </label>
                <label className={styles.field}>
                  <span>api_id (my.telegram.org)</span>
                  <input
                    type="text"
                    value={form.apiId}
                    onChange={e => setForm({ ...form, apiId: e.target.value })}
                    placeholder="1234567"
                  />
                </label>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span>api_hash</span>
                  <input
                    type="text"
                    value={form.apiHash}
                    onChange={e => setForm({ ...form, apiHash: e.target.value })}
                    placeholder="32 hex characters"
                  />
                </label>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span>Телефон</span>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>api_id hint</span>
                  <input
                    type="text"
                    value={form.apiIdHint}
                    onChange={e => setForm({ ...form, apiIdHint: e.target.value })}
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
              </>
            )}
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formActions}>
            <button className={styles.primaryBtn} onClick={submit} disabled={busy}>
              <Save size={14} /> {busy ? 'Сохраняю…' : form.mode === 'add' ? 'Создать черновик' : 'Сохранить'}
            </button>
            <button className={styles.ghostBtn} onClick={cancel} disabled={busy}>
              <X size={14} /> Отмена
            </button>
          </div>
          {form.mode === 'add' && (
            <div className={styles.hint}>
              После сохранения появится черновик в разделе «Ожидает авторизации». Чтобы
              завершить вход и получить SMS-код, админ запускает на сервере команду:<br />
              <code>python /opt/tg-bot/auth_draft.py &lt;id&gt;</code><br />
              Скрипт спросит код из SMS (и 2FA-пароль, если включён), создаст session-файл
              <code> /opt/tg-bot/&lt;session_name&gt;.session</code> и стартанёт сервис
              <code> tg-bot@&lt;session_name&gt;</code>. Бот сам зарегистрируется в
              <code> tg_userbots</code>, и черновик перейдёт в статус <code>authorized</code>.
            </div>
          )}
        </section>
      )}

      {/* Pending drafts */}
      {pendingDrafts.length > 0 && (
        <section>
          <div className={styles.sectionTitle}>Ожидает авторизации ({pendingDrafts.length})</div>
          <div className={styles.list}>
            {pendingDrafts.map(d => {
              const cmd = `python /opt/tg-bot/auth_draft.py ${d.id}`;
              const isFailed = d.status === 'failed';
              return (
                <div key={d.id} className={styles.row} data-status={d.status}>
                  <div className={styles.rowIcon}>
                    {isFailed ? <AlertTriangle size={18} /> : <Clock size={18} />}
                  </div>
                  <div className={styles.rowBody}>
                    <div className={styles.rowTitleLine}>
                      <span className={styles.rowLabel}>{d.label}</span>
                      <Badge
                        status={isFailed ? 'red' : 'yellow'}
                        label={isFailed ? 'ошибка' : 'ожидает'}
                        size="sm"
                      />
                    </div>
                    <div className={styles.rowMeta}>
                      <span><code>{d.sessionName}</code></span>
                      <span>· {d.phone}</span>
                      <span>· api_id {d.apiId}</span>
                      <span>· создан {minutesAgo(d.createdAt)}</span>
                    </div>
                    {isFailed && d.error && (
                      <div className={styles.errorInline}>Ошибка: {d.error}</div>
                    )}
                    <div className={styles.cmdLine}>
                      <code>{cmd}</code>
                      <button
                        className={styles.ghostBtn}
                        onClick={() => copyCmd(cmd)}
                        title="Скопировать"
                      >
                        <Copy size={12} /> Копировать
                      </button>
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <button className={styles.dangerBtn} onClick={() => removeDraft(d)} disabled={busy}>
                      <Trash2 size={12} /> Удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active userbots */}
      {isLoading ? (
        <Skeleton variant="card" />
      ) : userbots.length === 0 && pendingDrafts.length === 0 ? (
        <EmptyState
          title="Userbots пока нет"
          description="Добавьте черновик через «+ Добавить userbot» — потом на сервере запустите auth_draft.py для завершения авторизации."
        />
      ) : userbots.length > 0 ? (
        <section>
          {pendingDrafts.length > 0 && <div className={styles.sectionTitle}>Активные userbot'ы ({userbots.length})</div>}
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
        </section>
      ) : null}
    </div>
  );
}

export default Userbots;
