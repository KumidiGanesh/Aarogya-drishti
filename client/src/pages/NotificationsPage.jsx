import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../services/api.js';
import Card from '../components/ui/Card.jsx';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications', { params: { page: 1, limit: 50 } });
      setItems(data.data.items);
      setUnread(data.data.unread_count);
      setError('');
    } catch {
      setError(t('phase11.settingsError'));
    }
  }, [t]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await load();
    } catch {
      setError(t('phase11.settingsError'));
    }
  };
  const markAllRead = async () => {
    try {
      await api.put('/notifications/all/read');
      await load();
    } catch {
      setError(t('phase11.settingsError'));
    }
  };

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <h1>{t('phase11.notificationsTitle')}</h1>
          <p>{t('phase11.unreadCount', { count: unread })}</p>
        </div>
        <button className="button button--secondary" onClick={markAllRead} type="button">
          {t('phase11.markAllRead')}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 ? <Card>{t('phase11.notificationsEmpty')}</Card> : (
        <div className="admin-list">
          {items.map((item) => (
            <Card className={`notification-card ${item.read_at ? '' : 'notification-card--unread'}`} key={item.id}>
              <div className="page-heading">
                <div>
                  <h2>{item.title}</h2>
                  <p>{item.body}</p>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </div>
                {!item.read_at && (
                  <button className="button button--secondary" onClick={() => markRead(item.id)} type="button">
                    {t('phase11.markRead')}
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
