import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Pill, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

function todayInIndia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function speechLanguage(language) {
  return { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' }[language] || 'en-IN';
}

function dateOffset(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function MedicineReminderPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState(user.profile?.id || '');
  const [items, setItems] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [logs, setLogs] = useState([]);
  const [adherence, setAdherence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [times, setTimes] = useState(['09:00']);
  const [frequency, setFrequency] = useState('once_daily');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (user.role === 'patient') {
      if (user.profile?.id) setPatientId(user.profile.id);
      else {
        api.get('/auth/profile')
          .then(({ data }) => active && setPatientId(data.data.user.profile?.id || ''))
          .catch(() => active && notify(t('phase9.loadError'), 'error'));
      }
    } else {
      api.get('/patients', { params: { limit: 100, page: 1 } })
        .then(({ data }) => {
          if (active) {
            const list = data.data.items || [];
            setPatients(list);
            setPatientId((current) => current || list[0]?.id || '');
          }
        })
        .catch(() => active && notify(t('phase9.loadError'), 'error'));
    }
    return () => { active = false; };
  }, [notify, t, user.profile?.id, user.role]);

  const load = useCallback(async () => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [medicines, reminderData, logData] = await Promise.all([
        api.get('/medicines', { params: { patient_id: patientId, limit: 100 } }),
        api.get('/medicine-reminders', { params: { patient_id: patientId, limit: 100 } }),
        api.get('/medicine-logs', { params: { patient_id: patientId, summary: 'true', limit: 100 } }),
      ]);
      setItems(medicines.data.data.items || []);
      setReminders(reminderData.data.data.items || []);
      setLogs(logData.data.data.items || []);
      setAdherence(logData.data.data.adherence || []);
    } catch {
      notify(t('phase9.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, patientId, t]);

  useEffect(() => { void load(); }, [load]);

  const todaysLogs = useMemo(
    () => logs.filter((log) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(log.scheduled_for)) === todayInIndia()),
    [logs],
  );
  const weeklyDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => dateOffset(todayInIndia(), index - 6)),
    [],
  );

  const changeFrequency = (value) => {
    setFrequency(value);
    const count = { once_daily: 1, twice_daily: 2, thrice_daily: 3 }[value];
    if (count) {
      setTimes((current) => Array.from({ length: count }, (_, index) => current[index] || ['09:00', '14:00', '20:00'][index]));
    }
  };

  const addTime = () => setTimes((current) => [...current, '18:00']);
  const updateTime = (index, value) => setTimes((current) => current.map((time, itemIndex) => itemIndex === index ? value : time));

  const save = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const dosage = String(form.get('dosage') || '').trim();
    const formName = String(form.get('form') || '').trim();
    if (!patientId || !name || !dosage || !formName) return;
    if (new Set(times).size !== times.length || times.some((time) => !time)) {
      notify(t('phase9.frequencyError'), 'error');
      return;
    }
    setSaving(true);
    try {
      const medicineResponse = await api.post('/medicines', {
        patient_id: patientId,
        name,
        dosage,
        form: formName,
        instructions: String(form.get('instructions') || ''),
      });
      await api.post('/medicine-reminders', {
        medicine_id: medicineResponse.data.data.medicine.id,
        frequency,
        reminder_times: times,
        start_date: String(form.get('start_date')),
        end_date: String(form.get('end_date') || '') || undefined,
        channel: String(form.get('channel')),
      });
      formElement.reset();
      setFrequency('once_daily');
      setTimes(['09:00']);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase9.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const recordDose = async (log, status) => {
    try {
      await api.post('/medicine-logs', {
        reminder_id: log.reminder_id,
        scheduled_for: new Date(log.scheduled_for).toISOString(),
        status,
      });
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase9.doseError'), 'error');
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const readInstructions = (instructions) => {
    if (!instructions || !window.speechSynthesis) {
      notify(t('phase9.noSpeech'), 'info');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(instructions);
    utterance.lang = speechLanguage(i18n.language);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="page-content__inner phase9-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow"><Pill aria-hidden="true" size={16} /> {t('phase9.medicineTitle')}</p>
          <h1>{t('phase9.medicineTitle')}</h1>
          <p>{t('phase9.medicineSubtitle')}</p>
        </div>
        <Button onClick={requestNotificationPermission} type="button" variant="outline">
          <BellRing aria-hidden="true" size={18} /> {t('phase9.enableNotifications')}
        </Button>
      </header>

      {notificationPermission === 'granted' && <p className="phase9-status" role="status">{t('phase9.notificationEnabled')}</p>}
      {notificationPermission === 'denied' && <p className="phase9-status phase9-status--warning" role="status">{t('phase9.permissionDenied')}</p>}
      {user.role !== 'patient' && (
        <Select id="medicine-patient" label={t('phase9.patient')} onChange={(event) => setPatientId(event.target.value)} value={patientId}>
          <option value="">{t('phase9.choosePatient')}</option>
          {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} · {patient.patient_code}</option>)}
        </Select>
      )}

      <Card className="phase9-card">
        <h2>{t('phase9.medicineTitle')}</h2>
        <form className="phase9-form" onSubmit={save}>
          <Input id="medicine-name" label={t('phase9.medicineName')} name="name" required maxLength={200} />
          <Input id="medicine-dosage" label={t('phase9.dosage')} name="dosage" required maxLength={200} />
          <Input id="medicine-form" label={t('phase9.form')} name="form" required maxLength={80} />
          <Input id="medicine-instructions" label={t('phase9.instructions')} name="instructions" maxLength={2000} />
          <Select id="medicine-frequency" label={t('phase9.frequency')} onChange={(event) => changeFrequency(event.target.value)} value={frequency}>
            <option value="once_daily">{t('phase9.onceDaily')}</option>
            <option value="twice_daily">{t('phase9.twiceDaily')}</option>
            <option value="thrice_daily">{t('phase9.thriceDaily')}</option>
            <option value="custom">{t('phase9.custom')}</option>
          </Select>
          <div className="phase9-time-list">
            <span className="field__label">{t('phase9.reminderTimes')}</span>
            {times.map((time, index) => (
              <Input key={`${index}-${times.length}`} aria-label={`${t('phase9.reminderTimes')} ${index + 1}`} type="time" value={time} onChange={(event) => updateTime(index, event.target.value)} />
            ))}
            {frequency === 'custom' && times.length < 10 && <Button onClick={addTime} type="button" variant="outline">{t('phase9.addTime')}</Button>}
          </div>
          <Input id="medicine-start-date" label={t('phase9.startDate')} name="start_date" type="date" defaultValue={todayInIndia()} required />
          <Input id="medicine-end-date" label={t('phase9.endDate')} name="end_date" type="date" />
          <Select id="medicine-channel" label={t('phase9.channel')} name="channel" defaultValue="in_app">
            <option value="in_app">{t('phase9.channelInApp')}</option>
            <option value="sms">{t('phase9.channelSms')}</option>
            <option value="push">{t('phase9.channelPush')}</option>
            <option value="all">{t('phase9.channelAll')}</option>
          </Select>
          <Button disabled={saving || !patientId} type="submit">{saving ? t('phase9.loading') : t('phase9.saveMedicine')}</Button>
        </form>
      </Card>

      {loading ? <Loading /> : (
        <>
          <section aria-labelledby="phase9-todays-doses" className="phase9-section">
            <h2 id="phase9-todays-doses">{t('phase9.todaysDoses')}</h2>
            {!todaysLogs.length && <Card><p>{t('phase9.noDoses')}</p></Card>}
            <div className="phase9-dose-grid">
              {todaysLogs.map((log) => (
                <Card className="phase9-dose-card" key={log.id}>
                  <strong>{log.medicine_name}</strong>
                  <span>{log.dosage} · {new Date(log.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`phase9-dose-status phase9-dose-status--${log.status}`}>{t(`phase9.${log.status}`)}</span>
                  {log.status === 'pending' && (
                    <div className="phase9-actions">
                      <Button onClick={() => recordDose(log, 'taken')} type="button">{t('phase9.taken')}</Button>
                      <Button onClick={() => recordDose(log, 'missed')} type="button" variant="outline">{t('phase9.missed')}</Button>
                    </div>
                  )}
                  {log.instructions && <Button aria-label={`${t('phase9.readInstructions')}: ${log.medicine_name}`} onClick={() => readInstructions(log.instructions)} type="button" variant="ghost"><Volume2 aria-hidden="true" /> {t('phase9.readInstructions')}</Button>}
                </Card>
              ))}
            </div>
          </section>
          <section aria-labelledby="phase9-history" className="phase9-section">
            <div className="phase9-section-heading">
              <div><h2 id="phase9-history">{t('phase9.history')}</h2><p>{t('phase9.reviewHistory')}</p></div>
            </div>
            {adherence.map((item) => (
              <Card className="phase9-adherence" key={item.medicine_id}>
                <strong>{item.medicine_name}</strong>
                <span>{t('phase9.adherence')}: {item.adherence_percent === null ? '—' : `${item.adherence_percent}%`}</span>
                <span>{t('phase9.weeklyAdherence')}: {item.weekly_adherence_percent === null ? '—' : `${item.weekly_adherence_percent}%`}</span>
                <span>{t('phase9.monthlyAdherence')}: {item.monthly_adherence_percent === null ? '—' : `${item.monthly_adherence_percent}%`}</span>
                <span>{item.taken} / {item.completed}</span>
                <div
                  aria-label={`${t('phase9.adherence')} ${item.adherence_percent ?? 0}%`}
                  aria-valuemax="100"
                  aria-valuemin="0"
                  aria-valuenow={item.adherence_percent ?? 0}
                  className="phase9-adherence-bar"
                  role="progressbar"
                >
                  <span style={{ width: `${item.adherence_percent ?? 0}%` }} />
                </div>
              </Card>
            ))}
            <h3>{t('phase9.medicationPlan')}</h3>
            <div className="phase9-dose-grid">
              {reminders.map((reminder) => (
                <Card className="phase9-dose-card" key={reminder.id}>
                  <strong>{reminder.medicine_name}</strong>
                  <span>{reminder.dosage} · {reminder.reminder_times.join(', ')}</span>
                  <span>{t(`phase9.${reminder.frequency.replace('_daily', 'Daily')}`)}</span>
                  {reminder.instructions && (
                    <Button onClick={() => readInstructions(reminder.instructions)} type="button" variant="ghost">
                      <Volume2 aria-hidden="true" /> {t('phase9.readInstructions')}
                    </Button>
                  )}
                </Card>
              ))}
              {!items.length && !reminders.length && <Card><p>{t('phase9.noMedicines')}</p></Card>}
            </div>
            <h3>{t('phase9.weeklyHistory')}</h3>
            <div className="phase9-calendar" role="list" aria-label={t('phase9.weeklyHistory')}>
              {weeklyDates.map((date) => {
                const dayLogs = logs.filter((log) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(log.scheduled_for)) === date);
                const completed = dayLogs.filter((log) => log.status === 'taken').length;
                return (
                  <div className="phase9-calendar-day" key={date} role="listitem">
                    <strong>{new Intl.DateTimeFormat(i18n.language, { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`))}</strong>
                    <span>{date.slice(5)}</span>
                    <span>{completed}/{dayLogs.length}</span>
                  </div>
                );
              })}
            </div>
            <div className="phase9-history-list">
              {logs.slice(0, 30).map((log) => (
                <div className="phase9-history-item" key={log.id}>
                  <span>{new Date(log.scheduled_for).toLocaleString()}</span>
                  <strong>{log.medicine_name}</strong>
                  <span className={`phase9-dose-status phase9-dose-status--${log.status}`}>{t(`phase9.${log.status}`)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
