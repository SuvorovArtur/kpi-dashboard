import { useState } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/ui';
import { AppRoutes } from './routes';
import styles from './App.module.css';

const navItems = [
  { key: 'overview', label: 'Обзор', icon: 'BarChart3', path: '/' },
  { key: 'kpi', label: 'KPI подробно', icon: 'Target', path: '/kpi' },
  { key: 'territories', label: 'Территории', icon: 'Map', path: '/territories' },
  { key: 'appeals', label: 'Обращения', icon: 'MessageSquare', path: '/appeals' },
  { key: 'staff', label: 'Кадры', icon: 'Users', path: '/staff' },
  { key: 'roadmap', label: 'Дорожная карта', icon: 'Calendar', path: '/roadmap' },
  { key: 'settings', label: 'Настройки', icon: 'Settings', path: '/settings' },
];

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const activeKey = navItems.find(
    item => item.path === location.pathname ||
    (item.path !== '/' && location.pathname.startsWith(item.path))
  )?.key || 'overview';

  return (
    <div className={styles.layout}>
      <Sidebar
        items={navItems}
        activeKey={activeKey}
        onNavigate={(path) => navigate(path)}
        collapsed={collapsed}
      />
      <button
        className={styles.collapseBtn}
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
      >
        {collapsed ? '»' : '«'}
      </button>
      <main className={styles.main}>
        <AppRoutes />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
