import { useState, type FormEvent } from 'react';
import { useAuth } from '../../shared/hooks/useAuth';
import styles from './Login.module.css';

// Accept either a full email or a Russian phone number. If the input
// has no `@`, normalize as `<digits>@socpulse.ru` — matches the auth
// accounts provisioned for МБУ МТХ staff.
function normalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@socpulse.ru` : trimmed;
}

export default function Login() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const err = await signIn(normalizeIdentifier(identifier), password);
    if (err) {
      setError(err === 'Invalid login credentials' ? 'Неверный логин или пароль' : err);
    }
    setSubmitting(false);
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logo}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <h1 className={styles.title}>SocPulse</h1>
        </div>
        <p className={styles.subtitle}>Дашборд управления по развитию сельскими территориями</p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          Телефон или email
          <input
            className={styles.input}
            type="text"
            inputMode="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoComplete="username"
            placeholder="+7XXXXXXXXXX или user@socpulse.ru"
            autoFocus
          />
        </label>

        <label className={styles.label}>
          Пароль
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
