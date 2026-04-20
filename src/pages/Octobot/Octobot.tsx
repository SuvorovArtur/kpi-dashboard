import { Bot } from 'lucide-react';
import { Card, Header, EmptyState } from '../../shared/ui';
import styles from './Octobot.module.css';

export function Octobot() {
  return (
    <div className={styles.page}>
      <Header
        title="Octobot"
        subtitle="Автоматизация и бот-сценарии SocPulse"
      />
      <Card>
        <EmptyState
          icon={<Bot size={24} />}
          title="Раздел в разработке"
          description="Здесь появятся сценарии и настройки Octobot. Поделись что именно он должен делать — подключим нужные источники и выведем управляющие элементы."
        />
      </Card>
    </div>
  );
}

export default Octobot;
