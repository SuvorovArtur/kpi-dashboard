import { useMemo, useState } from 'react';
import { Bot, Plus, Trash2, Save, X, CheckCircle2, CircleOff, Clock, AlertTriangle, Copy, KeyRound, ChevronDown, ChevronRight, Hash, Radio, MessageCircle, Unlink } from 'lucide-react';
import { Header, EmptyState, Skeleton, Badge } from '../../shared/ui';
import { useSocialMonitor, type TgUserbot, type TgUserbotDraft } from '../../shared/hooks/useSocialMonitor';
import styles from './Userbots.module.css';

type AuthStage = 'starting' | 'code' | 'password' | 'done' | 'error';

interface AuthFlow {
  draft: TgUserbotDraft;
  stage: AuthStage;
  error?: string;
  successLabel?: string;
}

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
    authStart, authSubmitCode, authSubmitPassword,
    addChat, setChatUserbot,
  } = useSocialMonitor();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authFlow, setAuthFlow] = useState<AuthFlow | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [srcForm, setSrcForm] = useState<{ userbotId: number; title: string; username: string; chatId: string; type: 'chat' | 'channel' } | null>(null);
  const [srcError, setSrcError] = useState<string | null>(null);

  const chatCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of chats) {
      if (c.userbotId) map.set(c.userbotId, (map.get(c.userbotId) ?? 0) + 1);
    }
    return map;
  }, [chats]);

  const chatsByUserbot = useMemo(() => {
    const map = new Map<number, typeof chats>();
    for (const c of chats) {
      if (!c.userbotId) continue;
      const list = map.get(c.userbotId) ?? [];
      list.push(c);
      map.set(c.userbotId, list);
    }
    return map;
  }, [chats]);

  const toggleExpand = (id: number) => {
    setExpandedId(cur => cur === id ? null : id);
    setSrcForm(null);
    setSrcError(null);
  };

  const startAddSource = (userbotId: number, type: 'chat' | 'channel') => {
    setSrcError(null);
    setSrcForm({ userbotId, title: '', username: '', chatId: '', type });
  };

  const submitAddSource = async () => {
    if (!srcForm) return;
    const chatIdNum = Number(srcForm.chatId.trim());
    if (!Number.isInteger(chatIdNum) || chatIdNum === 0) {
      setSrcError('chat_id должен быть целым числом (обычно отрицательный, например -1001234567890)');
      return;
    }
    if (!srcForm.title.trim()) {
      setSrcError('Укажи название');
      return;
    }
    setBusy(true);
    setSrcError(null);
    try {
      await addChat(
        chatIdNum,
        srcForm.title.trim(),
        srcForm.username.trim().replace(/^@/, '') || undefined,
        srcForm.type,
        srcForm.userbotId,
      );
      setSrcForm(null);
    } catch (e) {
      setSrcError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlinkChatRow = async (chatId: number, label: string) => {
    if (!confirm(`Отвязать «${label}» от этого userbot? (чат останется в источниках, но userbot_id обнулится)`)) return;
    setBusy(true);
    try {
      await setChatUserbot(chatId, null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
        if (!form.phone.trim()) {
          setError('Укажите номер телефона');
          setBusy(false);
          return;
        }
        await createUserbotDraft({
          label: form.label.trim(),
          sessionName: form.sessionName.trim(),
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

  const beginAuth = async (d: TgUserbotDraft) => {
    setAuthFlow({ draft: d, stage: 'starting' });
    setCodeInput('');
    setPasswordInput('');
    setAuthBusy(true);
    try {
      await authStart(d.id);
      setAuthFlow({ draft: d, stage: 'code' });
    } catch (e) {
      setAuthFlow({ draft: d, stage: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const submitCode = async () => {
    if (!authFlow) return;
    setAuthBusy(true);
    try {
      const res = await authSubmitCode(authFlow.draft.id, codeInput.trim());
      if (res.status === 'needs_password') {
        setAuthFlow({ ...authFlow, stage: 'password' });
      } else if (res.status === 'done') {
        setAuthFlow({ ...authFlow, stage: 'done', successLabel: res.label });
      }
    } catch (e) {
      setAuthFlow({ ...authFlow, stage: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const submitPassword = async () => {
    if (!authFlow) return;
    setAuthBusy(true);
    try {
      const res = await authSubmitPassword(authFlow.draft.id, passwordInput);
      setAuthFlow({ ...authFlow, stage: 'done', successLabel: res.label });
    } catch (e) {
      setAuthFlow({ ...authFlow, stage: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const closeAuth = () => {
    setAuthFlow(null);
    setCodeInput('');
    setPasswordInput('');
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
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Телефон (с +7...)</span>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="+79991234567"
                />
              </label>
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
              Используются общие <code>TG_API_ID</code> / <code>TG_API_HASH</code> с сервера —
              отдельно регистрировать приложение на my.telegram.org не надо. После сохранения
              на VPS админ запускает:<br />
              <code>python /opt/tg-bot/auth_draft.py &lt;id&gt;</code><br />
              Скрипт попросит код из SMS (и 2FA-пароль, если включён), создаст session-файл и
              стартанёт сервис <code>tg-bot@&lt;session_name&gt;</code>. Бот сам зарегистрируется
              в <code>tg_userbots</code>.
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
                    <button className={styles.primaryBtn} onClick={() => beginAuth(d)} disabled={busy || authBusy}>
                      <KeyRound size={12} /> Авторизовать
                    </button>
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
              const expanded = expandedId === u.id;
              const linkedChats = chatsByUserbot.get(u.id) ?? [];
              return (
                <div key={u.id} className={styles.userbotBlock}>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.rowIconBtn}
                      onClick={() => toggleExpand(u.id)}
                      title={expanded ? 'Свернуть' : 'Развернуть'}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Bot size={16} />
                    </button>
                    <div
                      className={styles.rowBody}
                      onClick={() => toggleExpand(u.id)}
                      style={{ cursor: 'pointer' }}
                    >
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

                  {expanded && (
                    <div className={styles.expansion}>
                      <div className={styles.expansionHead}>
                        <span>Источники ({linkedChats.length})</span>
                        <div className={styles.expansionActions}>
                          <button className={styles.ghostBtn} onClick={() => startAddSource(u.id, 'chat')} disabled={busy}>
                            <Plus size={12} /> Добавить чат
                          </button>
                          <button className={styles.ghostBtn} onClick={() => startAddSource(u.id, 'channel')} disabled={busy}>
                            <Plus size={12} /> Добавить канал
                          </button>
                        </div>
                      </div>

                      {srcForm && srcForm.userbotId === u.id && (
                        <div className={styles.srcForm}>
                          <div className={styles.formTitle}>
                            {srcForm.type === 'channel' ? 'Новый канал' : 'Новый чат'}
                          </div>
                          <div className={styles.formGrid}>
                            <label className={styles.field}>
                              <span>Название</span>
                              <input
                                type="text"
                                value={srcForm.title}
                                onChange={e => setSrcForm({ ...srcForm, title: e.target.value })}
                                placeholder={srcForm.type === 'channel' ? 'Новости Мытищи' : 'Староста ЖК Скандинавский'}
                              />
                            </label>
                            <label className={styles.field}>
                              <span>@username (опц.)</span>
                              <input
                                type="text"
                                value={srcForm.username}
                                onChange={e => setSrcForm({ ...srcForm, username: e.target.value })}
                                placeholder="mytishi_news"
                              />
                            </label>
                            <label className={`${styles.field} ${styles.fieldWide}`}>
                              <span>chat_id (из Telegram; для супергрупп начинается с -100)</span>
                              <input
                                type="text"
                                value={srcForm.chatId}
                                onChange={e => setSrcForm({ ...srcForm, chatId: e.target.value.replace(/[^0-9-]/g, '') })}
                                placeholder="-1001234567890"
                              />
                            </label>
                          </div>
                          {srcError && <div className={styles.errorInline}>{srcError}</div>}
                          <div className={styles.formActions}>
                            <button className={styles.primaryBtn} onClick={submitAddSource} disabled={busy}>
                              <Save size={12} /> Сохранить
                            </button>
                            <button className={styles.ghostBtn} onClick={() => { setSrcForm(null); setSrcError(null); }} disabled={busy}>
                              <X size={12} /> Отмена
                            </button>
                          </div>
                          <div className={styles.hint}>
                            Если у канала/чата есть @username — бот сам подпишется при следующем старте.
                            Для приватных чатов сначала добавь бота как участника вручную в Telegram,
                            потом вставь сюда chat_id (проще всего взять из URL вида t.me/c/&lt;...&gt; или через @username_to_id_bot).
                          </div>
                        </div>
                      )}

                      {linkedChats.length === 0 ? (
                        <div className={styles.detailEmpty}>Нет привязанных чатов. Добавь через кнопки выше.</div>
                      ) : (
                        <div className={styles.chatList}>
                          {linkedChats.map(c => (
                            <div key={c.id} className={styles.chatRow}>
                              <div className={styles.chatIcon}>
                                {c.type === 'channel' ? <Radio size={14} /> : <MessageCircle size={14} />}
                              </div>
                              <div className={styles.chatBody}>
                                <div className={styles.chatTitle}>{c.title}</div>
                                <div className={styles.chatMeta}>
                                  <span>{c.type === 'channel' ? 'Канал' : 'Чат'}</span>
                                  {c.username && <span>· <Hash size={10} />@{c.username}</span>}
                                  <span>· chat_id <code>{c.chatId}</code></span>
                                  <span>· подписчиков {c.subscribers}</span>
                                </div>
                              </div>
                              <button
                                className={styles.ghostBtn}
                                onClick={() => unlinkChatRow(c.chatId, c.title)}
                                disabled={busy}
                                title="Отвязать от userbot"
                              >
                                <Unlink size={12} /> Отвязать
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {authFlow && (
        <div className={styles.modalBackdrop} onClick={authBusy ? undefined : closeAuth}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <KeyRound size={16} />
              <span>Авторизация «{authFlow.draft.label}»</span>
              <button className={styles.modalClose} onClick={closeAuth} disabled={authBusy}>
                <X size={14} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalStep}>
                Номер: <code>{authFlow.draft.phone}</code> · session: <code>{authFlow.draft.sessionName}</code>
              </div>

              {authFlow.stage === 'starting' && (
                <div className={styles.modalStep}>Отправляю код в Telegram…</div>
              )}

              {authFlow.stage === 'code' && (
                <>
                  <div className={styles.modalStep}>
                    Telegram прислал код на <strong>{authFlow.draft.phone}</strong>. Введи его ниже.
                  </div>
                  <input
                    type="text"
                    autoFocus
                    inputMode="numeric"
                    className={styles.modalInput}
                    value={codeInput}
                    onChange={e => setCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="12345"
                    maxLength={8}
                    onKeyDown={e => { if (e.key === 'Enter' && codeInput.length >= 4) submitCode(); }}
                  />
                  <div className={styles.formActions}>
                    <button className={styles.primaryBtn} onClick={submitCode} disabled={authBusy || codeInput.length < 4}>
                      {authBusy ? 'Проверяю…' : 'Подтвердить код'}
                    </button>
                  </div>
                </>
              )}

              {authFlow.stage === 'password' && (
                <>
                  <div className={styles.modalStep}>
                    У аккаунта включена двухфакторная авторизация. Введи cloud-password.
                  </div>
                  <input
                    type="password"
                    autoFocus
                    className={styles.modalInput}
                    value={passwordInput}
                    onChange={e => setPasswordInput(e.target.value)}
                    placeholder="2FA пароль"
                    onKeyDown={e => { if (e.key === 'Enter' && passwordInput) submitPassword(); }}
                  />
                  <div className={styles.formActions}>
                    <button className={styles.primaryBtn} onClick={submitPassword} disabled={authBusy || !passwordInput}>
                      {authBusy ? 'Проверяю…' : 'Войти'}
                    </button>
                  </div>
                </>
              )}

              {authFlow.stage === 'done' && (
                <>
                  <div className={`${styles.modalStep} ${styles.modalSuccess}`}>
                    ✓ Авторизация успешна: <strong>{authFlow.successLabel ?? '—'}</strong>.
                    Сервис <code>tg-bot@{authFlow.draft.sessionName}</code> запущен. Через ~60с
                    бот зарегистрируется в списке.
                  </div>
                  <div className={styles.formActions}>
                    <button className={styles.primaryBtn} onClick={closeAuth}>Готово</button>
                  </div>
                </>
              )}

              {authFlow.stage === 'error' && (
                <>
                  <div className={styles.errorInline}>Ошибка: {authFlow.error}</div>
                  <div className={styles.formActions}>
                    <button className={styles.ghostBtn} onClick={() => beginAuth(authFlow.draft)} disabled={authBusy}>
                      Попробовать снова
                    </button>
                    <button className={styles.ghostBtn} onClick={closeAuth}>Закрыть</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Userbots;
