import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './app/App';

// Restore saved appearance (theme / density / card style) before React mounts
// so the first paint is already in the user's preferred mode.
try {
  const raw = localStorage.getItem('socpulse-appearance');
  if (raw) {
    const a = JSON.parse(raw) as { theme?: string; density?: string; cardStyle?: string };
    const html = document.documentElement;
    if (a.theme) html.setAttribute('data-theme', a.theme);
    if (a.density) html.setAttribute('data-density', a.density);
    if (a.cardStyle) html.setAttribute('data-card', a.cardStyle);
  }
} catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
