import {
  Activity,
  BarChart3,
  Target,
  Map,
  MessageSquare,
  Users,
  Calendar,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import styles from './Sidebar.module.css';

export interface NavItem {
  key: string;
  label: string;
  icon: string;
  path: string;
}

interface SidebarProps {
  items: NavItem[];
  activeKey: string;
  onNavigate: (path: string) => void;
  collapsed?: boolean;
  userName?: string;
  onSignOut?: () => void;
}

const iconMap: Record<string, LucideIcon> = {
  Activity,
  BarChart3,
  Target,
  Map,
  MessageSquare,
  Users,
  Calendar,
  Settings,
};

export function Sidebar({
  items,
  activeKey,
  onNavigate,
  collapsed = false,
  userName,
  onSignOut,
}: SidebarProps) {
  return (
    <aside className={clsx(styles.sidebar, collapsed ? styles.collapsed : styles.expanded)}>
      <div className={styles.logo}>
        <BarChart3 size={24} />
        {!collapsed && <span>SocPulse</span>}
      </div>

      <nav className={styles.nav}>
        {items.map((item) => {
          const Icon = iconMap[item.icon] ?? BarChart3;
          return (
            <button
              key={item.key}
              className={clsx(
                styles.navItem,
                activeKey === item.key && styles.navItemActive,
              )}
              onClick={() => onNavigate(item.path)}
              type="button"
            >
              <span className={styles.navIcon}>
                <Icon size={20} />
              </span>
              {!collapsed && <span className={styles.navLabel}>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className={styles.userBlock}>
        {!collapsed && (
          <span className={styles.userName}>{userName || 'Пользователь'}</span>
        )}
        {onSignOut && (
          <button
            className={styles.signOutBtn}
            onClick={onSignOut}
            type="button"
            title="Выйти"
          >
            <LogOut size={collapsed ? 20 : 16} />
          </button>
        )}
      </div>
    </aside>
  );
}
