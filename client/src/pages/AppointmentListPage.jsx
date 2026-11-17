import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

export default function AppointmentListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const location = useLocation();
  const calendarView = location.pathname.endsWith('/calendar');
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [slots, setSlots] = useState([]);
  const [preferences, setPreferences] = useState({ enabled: true, reminders_24h: true, reminders_2h: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appointments, reminderPrefs] = await Promise.all([
        api.get('/appointments', {
          params: calendarView
            ? { upcoming: 'true', limit: 100 }
            : tab === 'upcoming'
              ? { upcoming: 'true', limit: 100 }
              : { status: tab, limit: 100 },
        }),
        api.get('/appointments', { params: { preferences: true } }),
      ]);
      setItems(appointments.data.data.items || []);
      setPreferences(reminderPrefs.data.data.preferences || { enabled: true, reminders_24h: true, reminders_2h: true });
    } catch {
      notify(t('phase8.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [calendarView, notify, tab, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (action?.type !== 'reschedule' || !date) return;
    api.get('/appointments', { params: { doctor_id: action.item.doctor_id, appointment_date: date, limit: 1 } })
      .then(({ data }) => setSlots(data.data.available_slots || []))
      .catch(() => notify(t('phase8.loadError'), 'error'));
  }, [action, date, notify, t]);

  const update = async (item, payload) => {
    try {
      await api.put(`/appointments/${item.id}`, payload);
      setAction(null);
      setReason('');
      setSlot('');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase8.saveError'), 'error');
    }
  };

  const savePreferences = async () => {
    if (!items[0]) {
      notify(t('phase8.emptyAppointments'), 'error');
      return;
    }
    await update(items[0], { action: 'reminder_preferences', ...preferences });
    notify(t('phase8.savePreferences'), 'success');
  };

  const remove = async (item) => {
    try {
      await api.delete(`/appointments/${item.id}`);
      setAction(null);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase8.saveError'), 'error');
    }
  };

  const dateGroups = calendarView
    ? items.reduce((groups, item) => {
      const key = new Date(item.scheduled_at).toLocaleDateString();
      groups[key] = [...(groups[key] || []), item];
      return groups;
    }, {})
    : null;

  return (
    <div className="page-content__inner">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('phase8.appointmentsTitle')}</p>
          <h1>{calendarView ? t('phase8.calendar') : t('phase8.myAppointments')}</h1>
        </div>
        <div className="phase8-actions">
          {user.role === 'doctor' && <Link className="button button--outline" to="/appointments/calendar">{t('phase8.calendar')}</Link>}
          {['patient', 'health_worker', 'admin'].includes(user.role) && <Link className="button button--primary" to="/appointments/book">{t('phase8.bookAppointment')}</Link>}
        </div>
      </header>
      {!calendarView && (
        <div className="phase8-tabs" role="tablist">
          {['upcoming', 'completed', 'cancelled'].map((value) => (
            <button aria-selected={tab === value} className={tab === value ? 'phase8-tab phase8-tab--active' : 'phase8-tab'} key={value} onClick={() => setTab(value)} role="tab" type="button">{t(`phase8.${value}`)}</button>
          ))}
        </div>
      )}
      {['admin', 'super_admin'].includes(user.role) && (
        <Card className="phase8-stat-card"><CalendarDays aria-hidden="true" /><strong>{t('phase8.adminAppointments')}</strong><span>{items.length}</span></Card>
      )}
      {!calendarView && items.length > 0 && (
        <Card className="phase8-preferences">
          <strong>{t('phase8.reminders')}</strong>
          <label><input checked={preferences.enabled} onChange={(event) => setPreferences((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" />{t('phase8.remindersEnabled')}</label>
          <label><input checked={preferences.reminders_24h} onChange={(event) => setPreferences((current) => ({ ...current, reminders_24h: event.target.checked }))} type="checkbox" />{t('phase8.remind24h')}</label>
          <label><input checked={preferences.reminders_2h} onChange={(event) => setPreferences((current) => ({ ...current, reminders_2h: event.target.checked }))} type="checkbox" />{t('phase8.remind2h')}</label>
          <Button onClick={() => void savePreferences()} type="button" variant="outline">{t('phase8.savePreferences')}</Button>
        </Card>
      )}
      {loading ? <Loading label={t('phase8.loading')} /> : items.length ? (
        <div className="phase8-record-list">
          {(calendarView ? Object.entries(dateGroups) : [['', items]]).map(([group, entries]) => (
            <section className="phase8-day-group" key={group || 'appointments'}>
              {group && <h2>{group}</h2>}
              {entries.map((item) => (
                <Card className="phase8-record" key={item.id}>
                  <div className="phase8-record__main">
                    <div className="phase8-record__icon"><CalendarDays aria-hidden="true" /></div>
                    <div>
                      <h2>{user.role === 'patient' ? item.doctor_name : item.patient_name}</h2>
                      <p>{item.doctor_name} · {item.specialty} · {item.facility_name}</p>
                      <span><Clock3 aria-hidden="true" size={15} />{new Date(item.scheduled_at).toLocaleString()} · {t(`phase8.${item.mode === 'in_person' ? 'inPerson' : item.mode}`)}</span>
                    </div>
                  </div>
                  <span className={`phase8-status phase8-status--${item.status}`}>{t(`phase8.${item.status === 'confirmed' ? 'appointment_confirmed' : ['booked', 'rescheduled'].includes(item.status) ? 'pendingFacilityConfirmation' : item.status}`)}</span>
                  {['upcoming'].includes(tab) && !calendarView && (
                    <div className="phase8-record__actions">
                      {['doctor', 'admin', 'super_admin'].includes(user.role) && ['booked', 'rescheduled'].includes(item.status) && (
                        <Button onClick={() => void update(item, { action: 'confirm' })} type="button">{t('phase8.confirmAppointment')}</Button>
                      )}
                      {(user.role === 'patient' || user.role === 'doctor' || user.role === 'health_worker' || ['admin', 'super_admin'].includes(user.role)) && (
                        <Button onClick={() => { setAction({ type: 'reschedule', item }); setDate(''); }} type="button" variant="outline">{t('phase8.reschedule')}</Button>
                      )}
                      {user.role === 'doctor' && <Button onClick={() => void update(item, { action: 'complete' })} type="button">{t('phase8.complete')}</Button>}
                      {user.role === 'doctor' && <Button onClick={() => void update(item, { action: 'no_show' })} type="button" variant="outline">{t('phase8.markNoShow')}</Button>}
                      {['patient', 'doctor', 'health_worker', 'admin', 'super_admin'].includes(user.role) && (
                        <Button onClick={() => setAction({ type: 'cancel', item })} type="button" variant="outline">{t('phase8.cancelAppointment')}</Button>
                      )}
                      {user.role === 'patient' && <Button onClick={() => setAction({ type: 'delete', item })} type="button" variant="outline">{t('phase8.cancelAppointment')}</Button>}
                    </div>
                  )}
                </Card>
              ))}
            </section>
          ))}
        </div>
      ) : <Card><p>{t('phase8.emptyAppointments')}</p></Card>}
      {action && (
        <div aria-labelledby="appointment-action-title" aria-modal="true" className="phase8-modal-backdrop" role="dialog">
          <Card className="phase8-modal">
            <h2 id="appointment-action-title">{t(action.type === 'reschedule' ? 'phase8.reschedule' : 'phase8.cancelAppointment')}</h2>
            {action.type === 'reschedule' ? (
              <>
                <Input id="reschedule-date" label={t('phase8.chooseDate')} min={new Date().toISOString().slice(0, 10)} onChange={(event) => { setDate(event.target.value); setSlot(''); }} type="date" value={date} />
                <div className="phase8-slot-grid">
                  {slots.map((value) => <button aria-pressed={slot === value} className={`phase8-slot ${slot === value ? 'phase8-slot--selected' : ''}`} key={value} onClick={() => setSlot(value)} type="button">{value}</button>)}
                </div>
                <Button disabled={!date || !slot} onClick={() => void update(action.item, { action: 'reschedule', appointment_date: date, time_slot: slot })} type="button">{t('phase8.save')}</Button>
              </>
            ) : action.type === 'delete' ? (
              <>
                <p>{t('phase8.confirmDelete')}</p>
                <Button onClick={() => void remove(action.item)} type="button">{t('phase8.cancelAppointment')}</Button>
              </>
            ) : (
              <>
                <Input id="cancel-reason" label={t('phase8.cancelReason')} onChange={(event) => setReason(event.target.value)} value={reason} />
                <Button disabled={!reason.trim()} onClick={() => void update(action.item, { action: 'cancel', reason })} type="button">{t('phase8.cancelAppointment')}</Button>
              </>
            )}
            <Button onClick={() => setAction(null)} type="button" variant="outline">{t('phase8.back')}</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
