import { useState, useMemo } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { Sidebar } from '../shared/ui';
import { useAppSettings } from '../shared/hooks';
import { AppRoutes } from './routes';
import styles from './App.module.css';

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { get } = useAppSettings();

  const navItems = useMemo(() => {
    const items = [
      { key: 'overview', label: 'Обзор', icon: 'BarChart3', path: '/' },
      ...(get('show_kpi_detail') === 'true' ? [{ key: 'kpi', label: 'KPI подробно', icon: 'Target', path: '/kpi' }] : []),
      { key: 'appeals', label: 'Обращения', icon: 'MessageSquare', path: '/appeals' },
      { key: 'isn', label: 'ИСН', icon: 'Activity', path: '/isn' },
      { key: 'settings', label: 'Настройки', icon: 'Settings', path: '/settings' },
    ];
    return items;
  }, [get]);

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
