import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import WebRtcCallRoom from '../components/consultations/WebRtcCallRoom.jsx';
import Card from '../components/ui/Card.jsx';
import api from '../services/api.js';
import { createSignalingSocket, emitSignal } from '../services/signaling.js';

function callErrorMessage(t, error) {
  const keys = {
    APPOINTMENT_NOT_ACTIVE: 'appointmentNotActive',
    CALL_BUSY: 'callBusy',
    CALL_SIGNALING_UNAVAILABLE: 'signalingUnavailable',
    CONSULTATION_NOT_AVAILABLE: 'consultationNotAvailable',
    CONSULTATION_OUTSIDE_WINDOW: 'consultationOutsideWindow',
    ICE_SERVERS_UNAVAILABLE: 'turnUnavailable',
    TELECONSULTATION_CONSENT_REQUIRED: 'teleconsultationConsentRequired',
  };
  return t(`phase11.${keys[error?.code] || 'callCouldNotStart'}`);
}

function doctorBookingPath(doctor, mode) {
  const params = new URLSearchParams({
    doctor_id: doctor.id,
    mode,
  });
  if (doctor.hospital_id) params.set('facility', `hospital:${doctor.hospital_id}`);
  else if (doctor.phc_id) params.set('facility', `phc:${doctor.phc_id}`);
  return `/appointments/book?${params}`;
}

export default function ConsultationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const [callSignalingConfigured, setCallSignalingConfigured] = useState(null);
  const [note, setNote] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketError, setSocketError] = useState('');
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const socketRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const pendingCallEventsRef = useRef(new Map());
  const incomingDialogRef = useRef(null);

  const updateActiveCall = useCallback((next) => {
    activeCallRef.current = next;
    setActiveCall(next);
  }, []);
  const updateIncomingCall = useCallback((next) => {
    incomingCallRef.current = next;
    setIncomingCall(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const availabilityRequest = user.role === 'patient'
        ? api.get('/consultations', { params: { availability: 'true' } })
        : Promise.resolve(null);
      const [appointmentResult, consultationResult, availabilityResult] = await Promise.all([
        api.get('/appointments', { params: { upcoming: 'true', limit: 100 } }),
        api.get('/consultations', { params: { limit: 50 } }),
        availabilityRequest,
      ]);
      setAppointments(
        appointmentResult.data.data.items.filter((item) => ['audio', 'video'].includes(item.mode)),
      );
      setConsultations(consultationResult.data.data.items);
      setAvailableDoctors(availabilityResult?.data.data.availability || []);
      setCallSignalingConfigured(
        consultationResult.data.data.call_signaling_configured === true,
      );
      setError('');
    } catch (requestError) {
      console.error('Failed to load scheduled consultations', requestError);
      setError(t('phase11.settingsError'));
    }
  }, [t, user.role]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (incomingCall) incomingDialogRef.current?.focus();
  }, [incomingCall]);

  useEffect(() => {
    if (!user?.id || !['doctor', 'patient'].includes(user.role)) return undefined;
    const socket = createSignalingSocket();
    socketRef.current = socket;
    const onConnect = () => {
      setSocketConnected(true);
      setSocketError('');
      const current = activeCallRef.current;
      if (!current) return;
      void emitSignal(socket, 'call:resume', {
        consultation_id: current.consultationId,
        call_id: current.callId,
      }).then((resumed) => {
        updateActiveCall({
          ...current,
          callToken: resumed.call_token,
          iceServers: resumed.ice_servers,
          status: resumed.status,
        });
      }).catch((resumeError) => {
        setError(callErrorMessage(t, resumeError));
      });
    };
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = () => setSocketError(t('phase11.signalingUnavailable'));
    const onIncoming = (payload) => {
      if (activeCallRef.current) return;
      updateIncomingCall({
        callId: payload.call_id,
        consultationId: payload.consultation_id,
        type: payload.type,
        callToken: payload.call_token,
        iceServers: payload.ice_servers,
        participantName: payload.caller_name,
        participantCode: user.role === 'doctor' ? payload.patient_code : undefined,
        status: 'ringing',
      });
    };
    const onAccepted = (payload) => {
      const current = activeCallRef.current;
      if (current?.callId === payload.call_id) {
        updateActiveCall({ ...current, status: 'accepted' });
      } else {
        pendingCallEventsRef.current.set(payload.call_id, 'accepted');
      }
    };
    const onEnded = (payload) => {
      const current = activeCallRef.current;
      if (current?.callId === payload.call_id) {
        updateActiveCall(null);
        setNotice(
          payload.status === 'missed'
            ? t('phase11.callMissed')
            : payload.status === 'rejected'
              ? t('phase11.callRejected')
              : t('phase11.callEnded'),
        );
      }
      const hadIncoming = incomingCallRef.current?.callId === payload.call_id;
      if (hadIncoming) updateIncomingCall(null);
      if (!current && !hadIncoming) {
        pendingCallEventsRef.current.set(payload.call_id, payload.status || 'ended');
      }
    };
    const onBusy = () => setNotice(t('phase11.callBusy'));
    const onCallError = (payload) => {
      if (payload.code === 'SESSION_EXPIRED' || payload.code === 'SESSION_REVOKED') {
        setSocketError(t('phase11.sessionExpired'));
        return;
      }
      setError(callErrorMessage(t, payload));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('call:incoming', onIncoming);
    socket.on('call:accept', onAccepted);
    socket.on('call:reject', onEnded);
    socket.on('call:end', onEnded);
    socket.on('call:missed', onEnded);
    socket.on('call:busy', onBusy);
    socket.on('call:error', onCallError);
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [t, updateActiveCall, updateIncomingCall, user?.id, user?.role]);

  const act = async (payload) => {
    try {
      const result = await api.post('/consultations', payload);
      setError('');
      setNotice(
        payload.action === 'schedule'
          ? t('phase11.consultationPrepared')
          : t(`phase11.status.${result.data.data.status}`, { defaultValue: '' }),
      );
      await load();
      return true;
    } catch (requestError) {
      setError(callErrorMessage(t, requestError.response?.data || requestError));
      return false;
    }
  };

  const startCall = async (consultation) => {
    setError('');
    setNotice('');
    if (!callSignalingConfigured) {
      setError(t('phase11.callServiceUnavailable'));
      return;
    }
    try {
      const result = await emitSignal(socketRef.current, 'call:initiate', {
        consultation_id: consultation.id,
      });
      const pendingEvent = pendingCallEventsRef.current.get(result.id);
      pendingCallEventsRef.current.delete(result.id);
      const otherName = user.role === 'doctor' ? consultation.patient_name : consultation.doctor_name;
      updateActiveCall({
        callId: result.id,
        consultationId: result.consultation_id,
        type: result.type,
        callToken: result.call_token,
        iceServers: result.ice_servers,
        participantName: otherName || t('phase11.otherParticipant'),
        participantCode: user.role === 'doctor' ? consultation.patient_code : undefined,
        initiatedByMe: true,
        status: pendingEvent === 'accepted' ? 'accepted' : 'ringing',
      });
      if (pendingEvent && pendingEvent !== 'accepted') {
        updateActiveCall(null);
        setNotice(pendingEvent === 'rejected' ? t('phase11.callRejected') : t('phase11.callEnded'));
        return;
      }
      if (!result.recipient_online) setNotice(t('phase11.participantOffline'));
    } catch (callError) {
      setError(callErrorMessage(t, callError));
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    setError('');
    try {
      await emitSignal(socketRef.current, 'call:accept', {
        consultation_id: incomingCall.consultationId,
        call_id: incomingCall.callId,
      });
      updateActiveCall({
        ...incomingCall,
        initiatedByMe: false,
        status: 'accepted',
      });
      updateIncomingCall(null);
    } catch (callError) {
      setError(callErrorMessage(t, callError));
    }
  };

  const rejectIncomingCall = async () => {
    if (!incomingCall) return;
    try {
      await emitSignal(socketRef.current, 'call:reject', {
        consultation_id: incomingCall.consultationId,
        call_id: incomingCall.callId,
      });
      updateIncomingCall(null);
    } catch (callError) {
      setError(callErrorMessage(t, callError));
    }
  };

  const saveNote = async (id) => {
    const saved = await act({
      action: 'add_note',
      consultation_id: id,
      note,
      follow_up_recommendation: recommendation || undefined,
      follow_up_date: followUpDate || undefined,
    });
    if (saved) {
      setNote('');
      setRecommendation('');
      setFollowUpDate('');
    }
  };

  const closeCall = useCallback((warning) => {
    updateActiveCall(null);
    if (warning) setNotice(warning);
  }, [updateActiveCall]);

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <h1>{t('phase11.consultationsTitle')}</h1>
          <p>{t('phase11.consultationsDescription')}</p>
          <p>{t('phase11.mediaPrivacyNotice')}</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p className={socketConnected ? 'webrtc-connectivity webrtc-connectivity--online' : 'webrtc-connectivity'}>
        {socketConnected ? t('phase11.signalingConnected') : socketError || t('phase11.signalingConnecting')}
      </p>
      {callSignalingConfigured === false && (
        <p role="alert">{t('phase11.callServiceUnavailable')}</p>
      )}
      {user.role === 'patient' && (
        <Card>
          <h2>{t('phase11.availableDoctors')}</h2>
          {availableDoctors.length ? (
            <div className="admin-list">
              {availableDoctors.map((doctor) => (
                <div className="admin-list__row" key={doctor.id}>
                  <span>
                    <strong>{doctor.full_name}</strong>
                    <br />
                    {t('phase11.specialization')}: {doctor.specialty || doctor.qualification || t('phase11.specializationNotListed')}
                    {doctor.facility_name ? ` · ${doctor.facility_name}` : ''}
                    {' · '}
                    {t(`phase11.${doctor.online_status}`)}
                  </span>
                  <span>
                    <Link
                      className="button button--secondary"
                      to={doctorBookingPath(doctor, 'audio')}
                    >
                      {t('phase11.bookAudioConsultation')}
                    </Link>
                    {' '}
                    <Link
                      className="button button--primary"
                      to={doctorBookingPath(doctor, 'video')}
                    >
                      {t('phase11.bookVideoConsultation')}
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p>{t('phase11.noDoctorsAvailable')}</p>
          )}
        </Card>
      )}
      <Card>
        <h2>{t('phase11.appointmentSelect')}</h2>
        <div className="admin-list">
          {appointments
            .filter(
              (item) =>
                !consultations.some((consultation) => consultation.appointment_id === item.id),
            )
            .map((item) => (
              <div className="admin-list__row" key={item.id}>
                <span>
                  {item.patient_name} · {item.doctor_name} ·{' '}
                  {new Date(item.scheduled_at).toLocaleString()}
                  {' · '}
                  {t(`phase11.${item.mode}`)}
                </span>
                <button
                  className="button"
                  onClick={() => void act({ action: 'schedule', appointment_id: item.id })}
                  type="button"
                >
                  {t('phase11.scheduleConsultation')}
                </button>
              </div>
            ))}
          {appointments.length > 0 &&
            appointments.every((item) =>
              consultations.some((consultation) => consultation.appointment_id === item.id),
            ) && <p>{t('phase11.allAppointmentsPrepared')}</p>}
          {appointments.length === 0 && (
            <div>
              <p>{t('phase11.noEligibleAppointments')}</p>
              {['patient', 'doctor'].includes(user.role) && (
                <Link className="button button--primary" to="/appointments/book">
                  {t('phase11.bookAudioVideoAppointment')}
                </Link>
              )}
            </div>
          )}
        </div>
      </Card>
      <section className="admin-list">
        {consultations.length === 0 && <Card>{t('phase11.noConsultations')}</Card>}
        {consultations.map((item) => (
          <Card key={item.id}>
            <div className="page-heading">
              <div>
                <h2>
                  {item.patient_name}
                  {user.role === 'doctor' && item.patient_code ? ` · ${t('phase11.patientId')}: ${item.patient_code}` : ''}
                  {' · '}
                  {item.doctor_name}
                </h2>
                <p>
                  {new Date(item.scheduled_at).toLocaleString()}
                  {' · '}
                  {t(`phase11.${item.mode}`)}
                  {' · '}
                  {t(`phase11.status.${item.status}`, { defaultValue: item.status })}
                </p>
              </div>
              {item.join_available && (
                <button
                  className="button button--primary"
                  disabled={!socketConnected || callSignalingConfigured !== true || Boolean(activeCall)}
                  onClick={() => void startCall(item)}
                  type="button"
                >
                  {user.role === 'doctor' && item.status === 'scheduled'
                    ? t('phase11.startConsultation')
                    : t('phase11.joinConsultation')}
                </button>
              )}
            </div>
            {!item.call_window_open && ['scheduled', 'in_progress'].includes(item.status) && (
              <p>{t('phase11.consultationWindow')}</p>
            )}
            {user.role === 'doctor' && item.status === 'in_progress' && !activeCall && (
              <button
                className="button button--secondary"
                onClick={() => void act({ action: 'end', consultation_id: item.id })}
                type="button"
              >
                {t('phase11.endConsultation')}
              </button>
            )}
            {item.call_window_open && !item.teleconsultation_consent_granted && (
              <p>{t('phase11.teleconsultationConsentRequired')}</p>
            )}
            {item.notes?.map((clinicalNote, index) => (
              <p key={`${item.id}-${index}`}>{clinicalNote.note}</p>
            ))}
            {user.role === 'doctor' && (
              <div className="form-grid">
                <label>
                  {t('phase11.consultationNotes')}
                  <textarea
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t('phase11.notePlaceholder')}
                    value={note}
                  />
                </label>
                <label>
                  {t('phase11.followUpRecommendation')}
                  <textarea
                    onChange={(event) => setRecommendation(event.target.value)}
                    value={recommendation}
                  />
                </label>
                <label>
                  {t('phase11.followUpDate')}
                  <input
                    onChange={(event) => setFollowUpDate(event.target.value)}
                    type="date"
                    value={followUpDate}
                  />
                </label>
                <button className="button" onClick={() => void saveNote(item.id)} type="button">
                  {t('phase11.saveNote')}
                </button>
              </div>
            )}
          </Card>
        ))}
      </section>

      {incomingCall && (
        <div className="webrtc-overlay">
          <section
            aria-labelledby="incoming-call-title"
            aria-modal="true"
            className="webrtc-incoming"
            ref={incomingDialogRef}
            role="alertdialog"
            tabIndex="-1"
          >
            <h2 id="incoming-call-title">{t('phase11.incomingCall')}</h2>
            <p>
              {incomingCall.participantName} · {t(`phase11.${incomingCall.type}`)}
            </p>
            {incomingCall.participantCode && (
              <p>{t('phase11.patientId')}: {incomingCall.participantCode}</p>
            )}
            <p>{t('phase11.callConsentNotice')}</p>
            <div className="webrtc-incoming__actions">
              <button
                className="button button--primary"
                disabled={!socketConnected}
                onClick={() => void acceptIncomingCall()}
                type="button"
              >
                {t('phase11.acceptCall')}
              </button>
              <button className="button button--danger" onClick={() => void rejectIncomingCall()} type="button">
                {t('phase11.rejectCall')}
              </button>
            </div>
          </section>
        </div>
      )}
      {activeCall && (
        <div className="webrtc-overlay">
          <WebRtcCallRoom
            call={activeCall}
            onCallUpdate={updateActiveCall}
            onEnd={closeCall}
            socket={socketRef.current}
          />
        </div>
      )}
    </div>
  );
}
