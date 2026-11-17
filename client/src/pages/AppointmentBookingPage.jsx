import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock3, Stethoscope, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import SearchableSelect from '../components/ui/SearchableSelect.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

function localDateOffset(days) {
  const date = new Date(Date.now() + days * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
}

export default function AppointmentBookingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const requestedMode = searchParams.get('mode');
  const [directory, setDirectory] = useState({ doctors: [], hospitals: [], phcs: [] });
  const [patients, setPatients] = useState([]);
  const [patientProfile, setPatientProfile] = useState(null);
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState(() => searchParams.get('doctor_id') || '');
  const [facilityKey, setFacilityKey] = useState(() => searchParams.get('facility') || '');
  const [date, setDate] = useState(localDateOffset(1));
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [timeSlot, setTimeSlot] = useState('');
  const [mode, setMode] = useState(() => (
    ['audio', 'video'].includes(requestedMode) ? requestedMode : 'in_person'
  ));
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [reminder24, setReminder24] = useState(true);
  const [reminder2, setReminder2] = useState(true);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError(false);
    try {
      const { data } = await api.get('/appointments', { params: { directory: true } });
      const result = data.data.directory;
      if (!result || !Array.isArray(result.doctors) || (
        !Array.isArray(result.facilities) &&
        !(Array.isArray(result.hospitals) && Array.isArray(result.phcs))
      )) {
        throw new Error('Invalid facility directory response');
      }
      setDirectory({
        doctors: result.doctors,
        facilities: result.facilities || [],
        hospitals: result.hospitals || [],
        phcs: result.phcs || [],
      });
    } catch {
      setDirectoryError(true);
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadDirectory();
    const loadPatients = async () => {
      try {
        if (user.role === 'patient') {
          const { data } = await api.get('/auth/profile');
          if (!active) return;
          const profile = data.data.user.profile || null;
          setPatientProfile(profile);
          setPatientId(profile?.id || '');
        } else {
          const { data } = await api.get('/patients', { params: { limit: 100, page: 1 } });
          if (!active) return;
          setPatients(data.data.items || []);
        }
      } catch {
        if (active) notify(t('phase8.loadError'), 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadPatients();
    return () => {
      active = false;
    };
  }, [loadDirectory, notify, t, user.role]);

  const facilities = useMemo(() => {
    return [
      ...(directory.facilities?.length
        ? directory.facilities
        : [
            ...directory.hospitals,
            ...directory.phcs.map((item) => ({
              ...item,
              facility_type: item.facility_type || 'phc',
            })),
          ]),
    ].map((item) => ({
      ...item,
      value: `${item.facility_type}:${item.id}`,
      label: item.name,
    }));
  }, [directory]);

  const selectedFacility = facilities.find((item) => item.value === facilityKey);
  const doctor = directory.doctors.find((item) => item.id === doctorId);
  useEffect(() => {
    if (facilityKey || !doctorId) return;
    const requestedDoctor = directory.doctors.find((item) => item.id === doctorId);
    if (requestedDoctor?.hospital_id) setFacilityKey(`hospital:${requestedDoctor.hospital_id}`);
    else if (requestedDoctor?.phc_id) setFacilityKey(`phc:${requestedDoctor.phc_id}`);
  }, [directory.doctors, doctorId, facilityKey]);
  useEffect(() => {
    if (!doctorId || !date || !facilityKey) {
      setSlots([]);
      setSlotsLoading(false);
      setTimeSlot('');
      return;
    }
    let active = true;
    const facility = facilities.find((item) => item.value === facilityKey);
    if (!facility) {
      setSlots([]);
      setSlotsLoading(false);
      setTimeSlot('');
      return;
    }
    setSlotsLoading(true);
    setSlots([]);
    api.get('/appointments', {
      params: {
        doctor_id: doctorId,
        appointment_date: date,
        ...(facility.facility_type === 'hospital'
          ? { hospital_id: facility.id }
          : { phc_id: facility.id }),
        limit: 1,
      },
    })
      .then(({ data }) => {
        if (active) setSlots(data.data.available_slots || []);
      })
      .catch(() => {
        if (active) {
          setSlots([]);
          notify(t('phase8.loadError'), 'error');
        }
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, doctorId, facilityKey, facilities, notify, t]);

  const selectedPatient = user.role === 'patient'
    ? patientProfile
    : patients.find((item) => item.id === patientId);
  const doctorOptions = directory.doctors
    .filter((item) => selectedFacility && (
      selectedFacility.facility_type === 'hospital'
        ? item.hospital_id === selectedFacility.id
        : item.phc_id === selectedFacility.id
    ))
    .map((item) => ({
    value: item.id,
    is_demo: item.is_demo === true,
    label: `${item.is_demo ? `${t('phase8.demoLabel')} · ` : ''}${item.name} · ${item.specialty || t('phase8.doctor')}`,
  }));
  const hasDemoDoctors = doctorOptions.some((option) => option.is_demo);
  const facilityOptions = facilities.map(({ value, label }) => ({ value, label }));

  const continueToTime = () => {
    const errors = {};
    if (user.role !== 'patient' && !patientId) errors.patient = t('phase8.selectPatientError');
    if (!doctorId) errors.doctor = t('phase8.selectDoctorError');
    if (!facilityKey) errors.facility = t('phase8.selectFacilityError');
    setValidationErrors(errors);
    if (Object.keys(errors).length) return;
    setStep(2);
  };

  const continueToConfirm = () => {
    const errors = {};
    if (!date) errors.date = t('phase8.selectDateError');
    if (!timeSlot) errors.timeSlot = t('phase8.selectTimeError');
    setValidationErrors(errors);
    if (Object.keys(errors).length) return;
    setStep(3);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!patientId || !doctor || !selectedFacility || !date || !timeSlot || !reason.trim()) {
      setValidationErrors({
        ...(!patientId ? { patient: t('phase8.selectPatientError') } : {}),
        ...(!doctor ? { doctor: t('phase8.selectDoctorError') } : {}),
        ...(!selectedFacility ? { facility: t('phase8.selectFacilityError') } : {}),
        ...(!date ? { date: t('phase8.selectDateError') } : {}),
        ...(!timeSlot ? { timeSlot: t('phase8.selectTimeError') } : {}),
        ...(!reason.trim() ? { reason: t('phase8.reasonRequired') } : {}),
      });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/appointments', {
        patient_id: patientId,
        doctor_id: doctorId,
        ...(selectedFacility.facility_type === 'hospital'
          ? { hospital_id: selectedFacility.id }
          : { phc_id: selectedFacility.id }),
        appointment_date: date,
        time_slot: timeSlot,
        mode,
        reason,
        reminder_preferences: { enabled: remindersEnabled, reminders_24h: reminder24, reminders_2h: reminder2 },
      });
      setBooking(data.data.appointment);
      notify(t('phase8.bookingSuccess'), 'success');
    } catch (error) {
      notify(error.response?.data?.message || t('phase8.saveError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label={t('phase8.loading')} />;
  if (booking) {
    return (
      <div className="page-content__inner">
        <Card className="phase8-success">
          <CheckCircle2 aria-hidden="true" size={40} />
          <h1>{t('phase8.bookingSuccess')}</h1>
          <dl className="phase8-confirmation">
            <div><dt>{t('phase8.reference')}</dt><dd>{booking.id}</dd></div>
            <div><dt>{t('phase8.patient')}</dt><dd>{selectedPatient?.full_name || user.full_name} · {selectedPatient?.patient_code || selectedPatient?.patient_id || patientId}</dd></div>
            {(selectedPatient?.mobile || user.mobile) && (
              <div><dt>{t('phase8.contact')}</dt><dd>{selectedPatient?.mobile || user.mobile}</dd></div>
            )}
            <div><dt>{t('phase8.doctor')}</dt><dd>{doctor?.name}</dd></div>
            <div><dt>{t('phase8.facility')}</dt><dd>{selectedFacility?.name}</dd></div>
            <div><dt>{t('phase8.date')}</dt><dd>{date}</dd></div>
            <div><dt>{t('phase8.timeSlot')}</dt><dd>{timeSlot} IST</dd></div>
            <div><dt>{t('phase8.status')}</dt><dd>{t(`phase8.${booking.status === 'confirmed' ? 'appointment_confirmed' : 'pendingFacilityConfirmation'}`)}</dd></div>
            <div><dt>{t('phase8.reason')}</dt><dd>{reason}</dd></div>
          </dl>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-content__inner">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('phase8.stepDoctor')}</p>
          <h1>{t('phase8.bookAppointment')}</h1>
          <p className="page-heading__description">
            {t('phase8.stepDoctor')} · {t('phase8.stepTime')} · {t('phase8.stepConfirm')}
          </p>
        </div>
      </header>
      <ol aria-label={t('phase8.bookingSteps')} className="phase8-progress">
        {[t('phase8.stepDoctor'), t('phase8.stepTime'), t('phase8.stepConfirm')].map((label, index) => (
          <li aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'phase8-progress__step phase8-progress__step--active' : 'phase8-progress__step'} key={label}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      <form className="phase8-form" onSubmit={(event) => void submit(event)}>
        {step === 1 && (
          <Card className="phase8-card">
            {user.role !== 'patient' && (
              <Select id="appointment-patient" label={t('phase8.patient')} value={patientId} onChange={(event) => { setPatientId(event.target.value); setValidationErrors((errors) => ({ ...errors, patient: '' })); }} required>
                <option value="">{t('phase8.selectPatient')}</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} · {patient.patient_code}</option>)}
              </Select>
            )}
            {validationErrors.patient && <p className="field__error" role="alert">{validationErrors.patient}</p>}
            <SearchableSelect
              emptyMessage={t('phase8.noFacilities')}
              disabled={directoryLoading || directoryError}
              error={validationErrors.facility}
              id="appointment-facility"
              label={t('phase8.facility')}
              onChange={(value) => {
                setFacilityKey(value);
                setDoctorId('');
                setTimeSlot('');
                setValidationErrors({});
              }}
              options={facilityOptions}
              placeholder={t('phase8.searchFacility')}
              value={facilityKey}
            />
            {directoryLoading && <p className="phase8-muted" role="status">{t('phase8.directoryLoading')}</p>}
            {directoryError && (
              <div role="alert">
                <p className="field__error">{t('phase8.facilityLoadError')}</p>
                <Button onClick={() => void loadDirectory()} type="button" variant="outline">
                  {t('phase8.retryDirectory')}
                </Button>
              </div>
            )}
            {selectedFacility && (
              <Button
                aria-label={t('phase8.clearFacility')}
                className="phase8-clear-facility"
                onClick={() => {
                  setFacilityKey('');
                  setDoctorId('');
                  setTimeSlot('');
                  setValidationErrors({});
                }}
                type="button"
                variant="outline"
              >
                <X aria-hidden="true" size={16} />
                {t('phase8.clearFacility')}
              </Button>
            )}
            <SearchableSelect
              emptyMessage={selectedFacility ? t('phase8.noFacilityDoctors') : t('phase8.chooseFacilityFirst')}
              error={validationErrors.doctor}
              id="appointment-doctor"
              label={t('phase8.doctor')}
              onChange={(value) => {
                setDoctorId(value);
                setTimeSlot('');
                setValidationErrors((errors) => ({ ...errors, doctor: '' }));
              }}
              options={doctorOptions}
              placeholder={t('phase8.searchDoctor')}
              value={doctorId}
            />
            {selectedFacility && !doctorOptions.length && (
              <p className="phase8-muted" role="status">{t('phase8.noFacilityDoctors')}</p>
            )}
            {hasDemoDoctors && (
              <p className="phase8-demo-notice" role="note">{t('phase8.demoAppointmentNotice')}</p>
            )}
            <Button onClick={continueToTime} type="button">{t('phase8.next')}</Button>
          </Card>
        )}
        {step === 2 && (
          <Card className="phase8-card">
            <Input id="appointment-date" label={t('phase8.chooseDate')} type="date" min={localDateOffset(0)} value={date} onChange={(event) => { setDate(event.target.value); setTimeSlot(''); setValidationErrors((errors) => ({ ...errors, date: '' })); }} required />
            {validationErrors.date && <p className="field__error" role="alert">{validationErrors.date}</p>}
            <div className="field">
              <span className="field__label">{t('phase8.availableSlots')}</span>
              {slotsLoading ? <p className="phase8-muted" role="status">{t('phase8.loading')}</p> : slots.length ? (
                <div className="phase8-slot-grid">
                  {slots.map((slot) => (
                    <button aria-pressed={timeSlot === slot} className={`phase8-slot ${timeSlot === slot ? 'phase8-slot--selected' : ''}`} key={slot} onClick={() => { setTimeSlot(slot); setValidationErrors((errors) => ({ ...errors, timeSlot: '' })); }} type="button">
                      <Clock3 aria-hidden="true" size={16} />{slot}
                    </button>
                  ))}
                </div>
              ) : <p className="phase8-muted">{t('phase8.noSlots')}</p>}
              {validationErrors.timeSlot && <p className="field__error" role="alert">{validationErrors.timeSlot}</p>}
            </div>
            <div className="phase8-actions">
              <Button onClick={() => setStep(1)} type="button" variant="outline">{t('phase8.back')}</Button>
              <Button disabled={slotsLoading || !slots.length} onClick={continueToConfirm} type="button">{t('phase8.next')}</Button>
            </div>
          </Card>
        )}
        {step === 3 && (
          <Card className="phase8-card">
            <div className="phase8-summary">
              <Stethoscope aria-hidden="true" />
              <div>
                <strong>{selectedPatient?.full_name || user.full_name} · {selectedPatient?.patient_code || selectedPatient?.patient_id || patientId}</strong>
                <span>{doctor?.name} · {doctor?.specialty}</span>
                <span>{selectedFacility?.name} · {date} · {timeSlot} IST</span>
                <span>{t('phase8.status')}: {t('phase8.pendingFacilityConfirmation')}</span>
                <span>{t('phase8.availabilityRechecked')}</span>
              </div>
            </div>
            <Select id="appointment-mode" label={t('phase8.mode')} value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="in_person">{t('phase8.inPerson')}</option>
              <option value="audio">{t('phase8.audio')}</option>
              <option value="video">{t('phase8.video')}</option>
            </Select>
            <label className="field" htmlFor="appointment-reason">
              <span className="field__label">{t('phase8.reason')}</span>
              <textarea className="field__control phase8-textarea" id="appointment-reason" maxLength={2000} onChange={(event) => setReason(event.target.value)} required value={reason} />
            </label>
            {validationErrors.reason && <p className="field__error" role="alert">{validationErrors.reason}</p>}
            <div className="phase8-preferences">
              <strong>{t('phase8.reminders')}</strong>
              <label><input checked={remindersEnabled} onChange={(event) => setRemindersEnabled(event.target.checked)} type="checkbox" />{t('phase8.remindersEnabled')}</label>
              <label><input checked={reminder24} onChange={(event) => setReminder24(event.target.checked)} type="checkbox" />{t('phase8.remind24h')}</label>
              <label><input checked={reminder2} onChange={(event) => setReminder2(event.target.checked)} type="checkbox" />{t('phase8.remind2h')}</label>
            </div>
            <div className="phase8-actions">
              <Button onClick={() => setStep(2)} type="button" variant="outline">{t('phase8.back')}</Button>
              <Button disabled={saving} type="submit">{saving ? t('phase8.loading') : t('phase8.confirmBooking')}</Button>
            </div>
          </Card>
        )}
      </form>
    </div>
  );
}
