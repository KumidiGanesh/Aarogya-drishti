import {
  Building2,
  CalendarDays,
  Download,
  MapPin,
  RefreshCw,
  Stethoscope,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';

const LIVE_REFRESH_MS = 30_000;

function responseItems(response) {
  const items = response?.data?.data?.items;
  return Array.isArray(items) ? items : [];
}

function formatDate(value, locale) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function safeCsvCell(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  const safeText = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function getFollowUps(consultations, history) {
  const rows = [
    ...consultations.flatMap((consultation) =>
      consultation.follow_up_recommendation
        ? [{
            id: `consultation-${consultation.id}`,
            date: consultation.follow_up_at,
            text: consultation.follow_up_recommendation,
            source: consultation.doctor_name,
          }]
        : [],
    ),
    ...history.flatMap((event) => {
      const details = event.details || {};
      if (event.type === 'clinical_review' && details.follow_up_recommendation) {
        return [{
          id: `review-${event.occurred_at}-${details.review_status || ''}`,
          date: details.follow_up_date || event.occurred_at,
          text: details.follow_up_recommendation,
          source: event.title,
        }];
      }
      if (event.type === 'follow_up') {
        const followUp = details.details || {};
        const text = followUp.recommendation || followUp.notes || followUp.feedback;
        if (text) {
          return [{
            id: `referral-${event.occurred_at}-${details.event_type || ''}`,
            date: followUp.follow_up_date || event.occurred_at,
            text,
            source: event.title,
          }];
        }
      }
      return [];
    }),
  ];
  const uniqueRows = [...new Map(rows.map((row) => [`${row.text}|${row.date || ''}`, row])).values()];
  return uniqueRows.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
}

export default function PatientDashboardOverview({ user }) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [screenings, setScreenings] = useState([]);
  const [appointments, setAppointments] = useState(null);
  const [consultations, setConsultations] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [liveErrors, setLiveErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [downloadError, setDownloadError] = useState(false);

  const loadPatientData = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(false);
    try {
      const profileResponse = await api.get('/patient/profile');
      const patient = profileResponse.data?.data?.user?.profile;
      if (!patient?.id) throw new Error('Patient profile is unavailable');
      setProfile(patient);
      const [historyResponse, screeningResponse] = await Promise.all([
        api.get(`/patients/${patient.id}/history`, { params: { limit: 100 } }),
        api.get('/screenings', { params: { limit: 100 } }),
      ]);
      setHistory(responseItems(historyResponse));
      setScreenings(responseItems(screeningResponse));
    } catch {
      setProfileError(true);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadLiveData = useCallback(async () => {
    setLiveLoading(true);
    const results = await Promise.allSettled([
      api.get('/appointments', { params: { upcoming: 'true', limit: 100 } }),
      api.get('/consultations', { params: { limit: 100 } }),
      api.get('/appointments', { params: { directory: 'true' } }),
    ]);
    const errors = {};
    if (results[0].status === 'fulfilled') {
      setAppointments(responseItems(results[0].value));
    } else {
      errors.appointments = true;
    }
    if (results[1].status === 'fulfilled') {
      setConsultations(responseItems(results[1].value));
    } else {
      errors.consultations = true;
    }
    if (results[2].status === 'fulfilled') {
      setDirectory(results[2].value.data?.data?.directory || null);
    } else {
      errors.directory = true;
    }
    setLiveErrors(errors);
    setLastUpdated(new Date());
    setLiveLoading(false);
  }, []);

  useEffect(() => {
    void loadPatientData();
    void loadLiveData();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadLiveData();
    }, LIVE_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadLiveData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadPatientData, loadLiveData, user?.id]);

  const upcomingAppointments = useMemo(
    () =>
      [...(appointments || [])]
        .sort((left, right) => new Date(left.scheduled_at) - new Date(right.scheduled_at))
        .slice(0, 5),
    [appointments],
  );
  const followUps = useMemo(
    () => getFollowUps(consultations || [], history).slice(0, 5),
    [consultations, history],
  );
  const doctors = useMemo(
    () =>
      [...(directory?.doctors || [])]
        .filter((doctor) => doctor.is_demo !== true)
        .sort((left, right) => Number(right.online_status === 'online') - Number(left.online_status === 'online'))
        .slice(0, 6),
    [directory],
  );
  const facilities = directory?.facilities || [];

  const refresh = async () => {
    await Promise.all([loadPatientData(), loadLiveData()]);
  };

  const downloadReport = () => {
    if (!profile) return;
    setDownloadError(false);
    try {
      const rows = [
        [t('patient.dashboardReportTitle')],
        [t('patient.fullName'), profile.full_name],
        [t('patient.patientCode'), profile.patient_code],
        [t('patient.dashboardReportType'), t('patient.dashboardReportDate'), t('patient.dashboardReportStatus'), t('patient.dashboardReportDetails')],
        ...(appointments || []).map((appointment) => [
          t('patient.dashboardUpcomingAppointments'),
          formatDate(appointment.scheduled_at, i18n.language),
          t(`phase8.${appointment.status}`, { defaultValue: appointment.status }),
          [appointment.doctor_name, appointment.facility_name, appointment.mode].filter(Boolean).join(' · '),
        ]),
        ...(consultations || []).map((consultation) => [
          t('patient.dashboardVideoConsultations'),
          formatDate(consultation.scheduled_at, i18n.language),
          consultation.status,
          [consultation.doctor_name, consultation.follow_up_recommendation].filter(Boolean).join(' · '),
        ]),
        ...screenings.map((screening) => [
          t('patient.dashboardScreenings'),
          formatDate(screening.screened_at, i18n.language),
          screening.status,
          screening.inference_status || '',
        ]),
        ...followUps.map((followUp) => [
          t('patient.dashboardFollowUps'),
          formatDate(followUp.date, i18n.language),
          followUp.source,
          followUp.text,
        ]),
      ];
      const content = `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(',')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `aarogya-care-summary-${profile.patient_code || 'patient'}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError(true);
    }
  };

  const statusLabel = (status) =>
    t(`phase8.${status}`, { defaultValue: status || t('patient.none') });

  return (
    <section aria-labelledby="patient-dashboard-overview-title" className="patient-dashboard">
      <div className="patient-dashboard__heading">
        <div>
          <p className="eyebrow">{t('patient.dashboardTitle')}</p>
          <h2 id="patient-dashboard-overview-title">{t('patient.dashboardSummary')}</h2>
        </div>
        <div className="patient-dashboard__heading-actions">
          {lastUpdated && (
            <span className="patient-dashboard__updated">
              {t('patient.dashboardUpdated', { time: formatDate(lastUpdated, i18n.language) })}
            </span>
          )}
          <Button
            className="patient-dashboard__refresh"
            disabled={liveLoading || profileLoading}
            onClick={refresh}
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {t('patient.dashboardRefresh')}
          </Button>
        </div>
      </div>

      {(profileError || Object.values(liveErrors).some(Boolean)) && (
        <div className="patient-dashboard__alert" role="alert">
          <span>{t('patient.dashboardLoadError')}</span>
          <Button disabled={liveLoading || profileLoading} onClick={refresh} type="button" variant="secondary">
            {t('patient.dashboardRetry')}
          </Button>
        </div>
      )}

      <div className="patient-dashboard__grid">
        <Card aria-labelledby="patient-dashboard-appointments" className="patient-dashboard__card">
          <div className="patient-dashboard__card-heading">
            <span className="patient-dashboard__icon patient-dashboard__icon--blue">
              <CalendarDays aria-hidden="true" size={21} />
            </span>
            <div>
              <h3 id="patient-dashboard-appointments">{t('patient.dashboardUpcomingAppointments')}</h3>
              <p>{t('phase8.appointmentsTitle')}</p>
            </div>
          </div>
          {liveLoading && appointments === null ? (
            <p className="patient-dashboard__message" role="status">{t('patient.dashboardLoading')}</p>
          ) : liveErrors.appointments && appointments === null ? (
            <p className="patient-dashboard__message">{t('patient.dashboardLoadError')}</p>
          ) : upcomingAppointments.length ? (
            <ul className="patient-dashboard__records">
              {upcomingAppointments.map((appointment) => {
                const consultation = (consultations || []).find(
                  (item) => item.appointment_id === appointment.id,
                );
                return (
                  <li className="patient-dashboard__record" key={appointment.id}>
                    <div className="patient-dashboard__record-copy">
                      <strong>{appointment.doctor_name || t('phase8.doctor')}</strong>
                      <span>{appointment.facility_name || t('patient.dashboardFacilities')}</span>
                      <span>{formatDate(appointment.scheduled_at, i18n.language)}</span>
                      <span className="patient-dashboard__status">{statusLabel(appointment.status)}</span>
                    </div>
                    {appointment.mode === 'video' && (
                      <Link
                        className="patient-dashboard__action-link"
                        to="/consultations"
                      >
                        <Video aria-hidden="true" size={15} />
                        {consultation?.join_available
                          ? t('phase11.joinConsultation')
                          : t('patient.dashboardOpenConsultations')}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="patient-dashboard__message">{t('patient.dashboardNoAppointments')}</p>
          )}
          <Link className="patient-dashboard__text-link" to="/appointments">
            {t('patient.dashboardViewAppointments')}
          </Link>
        </Card>

        <Card aria-labelledby="patient-dashboard-consultations" className="patient-dashboard__card">
          <div className="patient-dashboard__card-heading">
            <span className="patient-dashboard__icon patient-dashboard__icon--teal">
              <Video aria-hidden="true" size={21} />
            </span>
            <div>
              <h3 id="patient-dashboard-consultations">{t('patient.dashboardVideoConsultations')}</h3>
              <p>{t('phase11.consultationsTitle')}</p>
            </div>
          </div>
          {liveLoading && consultations === null ? (
            <p className="patient-dashboard__message" role="status">{t('patient.dashboardLoading')}</p>
          ) : liveErrors.consultations && consultations === null ? (
            <p className="patient-dashboard__message">{t('patient.dashboardLoadError')}</p>
          ) : (
            <>
              {(consultations || []).filter((item) => item.join_available).length > 0 ? (
                <ul className="patient-dashboard__records">
                  {(consultations || [])
                    .filter((item) => item.join_available)
                    .slice(0, 3)
                    .map((consultation) => (
                      <li className="patient-dashboard__record" key={consultation.id}>
                        <div className="patient-dashboard__record-copy">
                          <strong>{consultation.doctor_name || t('phase8.doctor')}</strong>
                          <span>{formatDate(consultation.scheduled_at, i18n.language)}</span>
                          <span className="patient-dashboard__status">{consultation.status}</span>
                        </div>
                        <Link className="patient-dashboard__action-link" to="/consultations">
                          <Video aria-hidden="true" size={15} />
                          {t('phase11.joinConsultation')}
                        </Link>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="patient-dashboard__message">{t('patient.dashboardNoConsultations')}</p>
              )}
            </>
          )}
          <Link className="patient-dashboard__text-link" to="/consultations">
            {t('patient.dashboardOpenConsultations')}
          </Link>
        </Card>

        <Card aria-labelledby="patient-dashboard-followups" className="patient-dashboard__card">
          <div className="patient-dashboard__card-heading">
            <span className="patient-dashboard__icon patient-dashboard__icon--aqua">
              <Stethoscope aria-hidden="true" size={21} />
            </span>
            <div>
              <h3 id="patient-dashboard-followups">{t('patient.dashboardFollowUps')}</h3>
              <p>{t('patient.dashboardFollowUpsDescription')}</p>
            </div>
          </div>
          {profileLoading && !history.length ? (
            <p className="patient-dashboard__message" role="status">{t('patient.dashboardLoading')}</p>
          ) : followUps.length ? (
            <ul className="patient-dashboard__records">
              {followUps.map((followUp) => (
                <li className="patient-dashboard__record" key={followUp.id}>
                  <div className="patient-dashboard__record-copy">
                    <strong>{followUp.text}</strong>
                    {followUp.date && <span>{formatDate(followUp.date, i18n.language)}</span>}
                    <span>{followUp.source}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="patient-dashboard__message">{t('patient.dashboardNoFollowUps')}</p>
          )}
        </Card>

        <Card aria-labelledby="patient-dashboard-facilities" className="patient-dashboard__card">
          <div className="patient-dashboard__card-heading">
            <span className="patient-dashboard__icon patient-dashboard__icon--violet">
              <MapPin aria-hidden="true" size={21} />
            </span>
            <div>
              <h3 id="patient-dashboard-facilities">{t('patient.dashboardFacilities')}</h3>
              <p>{t('patient.dashboardLocationDisclosure')}</p>
            </div>
          </div>
          {liveLoading && directory === null ? (
            <p className="patient-dashboard__message" role="status">{t('patient.dashboardLoading')}</p>
          ) : liveErrors.directory && directory === null ? (
            <p className="patient-dashboard__message">{t('patient.dashboardDirectoryFailed')}</p>
          ) : (
            <>
              {facilities.length ? (
                <ul className="patient-dashboard__facility-list">
                  {facilities.map((facility) => (
                    <li className="patient-dashboard__facility" key={facility.id}>
                      <Building2 aria-hidden="true" size={17} />
                      <span>{facility.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="patient-dashboard__message">{t('patient.dashboardNoFacilities')}</p>
              )}
              {doctors.length ? (
                <ul className="patient-dashboard__doctor-list">
                  {doctors.map((doctor) => (
                    <li className="patient-dashboard__doctor" key={doctor.id}>
                      <div>
                        <strong>{doctor.name}</strong>
                        <span>{[doctor.specialty, doctor.facility_name].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className={`patient-dashboard__presence patient-dashboard__presence--${doctor.online_status}`}>
                        <span aria-hidden="true" />
                        {doctor.online_status === 'online'
                          ? t('patient.dashboardOnline')
                          : t('patient.dashboardOffline')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="patient-dashboard__message">{t('patient.dashboardNoClinicians')}</p>
              )}
            </>
          )}
          <Link className="patient-dashboard__text-link" to="/appointments">
            {t('patient.dashboardBookAppointment')}
          </Link>
        </Card>
      </div>

      <div className="patient-dashboard__report">
        <div>
          <h3>{t('patient.dashboardReportTitle')}</h3>
          <p>{t('patient.dashboardReportDescription')}</p>
        </div>
        <Button
          disabled={!profile || profileLoading}
          onClick={downloadReport}
          type="button"
          variant="secondary"
        >
          <Download aria-hidden="true" size={17} />
          {t('patient.dashboardDownloadReport')}
        </Button>
        {downloadError && <p className="patient-dashboard__download-error" role="alert">{t('patient.dashboardReportDownloadError')}</p>}
      </div>
    </section>
  );
}
