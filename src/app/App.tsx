import { useState, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter, useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from '../shared/ui';
import { useAppSettings } from '../shared/hooks';
import { AuthProvider, useAuth } from '../shared/hooks/useAuth';
import { AppRoutes } from './routes';
import styles from './App.module.css';

const Login = lazy(() => import('../pages/Login/Login'));

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { get } = useAppSettings();
  const { profile, signOut } = useAuth();

  const navItems = useMemo(() => {
    const items = [
      { key: 'overview', label: 'Обзор', icon: 'BarChart3', path: '/' },
      ...(get('show_kpi_detail') === 'true' ? [{ key: 'kpi', label: 'KPI подробно', icon: 'Target', path: '/kpi' }] : []),
      { key: 'appeals', label: 'Обращения', icon: 'MessageSquare', path: '/appeals' },
      { key: 'isn', label: 'ИСН', icon: 'Activity', path: '/isn' },
      { key: 'attendance', label: 'Яндекс Вектор', icon: 'Calendar', path: '/attendance' },
      { key: 'social', label: 'Соцсети', icon: 'MessageSquare', path: '/social' },
      { key: 'map', label: 'Карта', icon: 'Map', path: '/map' },
      { key: 'staff', label: 'Кадры', icon: 'Users', path: '/staff' },
      { key: 'territories', label: 'Территории', icon: 'Map', path: '/territories' },
      { key: 'roadmap', label: 'Дорожная карта', icon: 'Target', path: '/roadmap' },
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
        userName={profile?.display_name}
        onSignOut={signOut}
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

function AuthGate() {
  const { session, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={
          session ? (
            <Navigate to="/" replace />
          ) : (
            <Suspense fallback={null}>
              <Login />
            </Suspense>
          )
        }
      />
      <Route
        path="*"
        element={session ? <AppLayout /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  );
}
