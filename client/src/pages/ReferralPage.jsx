import { useCallback, useEffect, useState } from 'react';
import { Download, HeartHandshake, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

const STATUSES = ['pending', 'accepted', 'in_progress', 'completed', 'rejected'];

export default function ReferralPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [referrals, setReferrals] = useState([]);
  const [directory, setDirectory] = useState({ specialists: [], hospitals: [] });
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [screeningId, setScreeningId] = useState('');
  const [specialistId, setSpecialistId] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState('routine');
  const [documents, setDocuments] = useState([]);
  const [followUp, setFollowUp] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const canCreate = user.role === 'doctor';
  const canFollowUp = ['doctor', 'health_worker'].includes(user.role);
  const isAdmin = ['admin', 'super_admin'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requests = [api.get('/referrals', { params: { limit: 100 } })];
      if (canCreate) {
        requests.push(api.get('/referrals', { params: { directory: true } }));
        requests.push(api.get('/patients', { params: { limit: 100, page: 1 } }));
      }
      const responses = await Promise.all(requests);
      setReferrals(responses[0].data.data.items || []);
      if (canCreate) {
        setDirectory(responses[1].data.data.directory);
        setPatients(responses[2].data.data.items || []);
      }
    } catch {
      notify(t('phase8.referralError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [canCreate, notify, t]);

  useEffect(() => { void load(); }, [load]);

  const createReferral = async (event) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData();
    form.append('action', 'create');
    form.append('patient_id', patientId);
    if (screeningId.trim()) form.append('screening_id', screeningId.trim());
    form.append('specialist_id', specialistId);
    form.append('referral_hospital_id', hospitalId);
    form.append('reason', reason);
    form.append('urgency', urgency);
    for (const file of documents) form.append('supporting_documents[]', file);
    try {
      await api.post('/referrals', form);
      setPatientId('');
      setScreeningId('');
      setSpecialistId('');
      setHospitalId('');
      setReason('');
      setDocuments([]);
      notify(t('phase8.referralSuccess'), 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase8.referralError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const act = async (action, referral, fields = {}) => {
    setSaving(true);
    try {
      await api.post('/referrals', { action, referral_id: referral.id, ...fields });
      notify(t('phase8.actionSaved'), 'success');
      setFeedback(null);
      setFollowUp(null);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase8.referralError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async (document) => {
    try {
      const response = await api.get('/referrals', {
        params: { download: document.id },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.original_name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      notify(t('phase8.referralError'), 'error');
    }
  };

  const counts = referrals.reduce((result, referral) => {
    result[referral.status] = (result[referral.status] || 0) + 1;
    return result;
  }, {});

  return (
    <div className="page-content__inner">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{t('phase8.referralsTitle')}</p>
          <h1>{user.role === 'specialist' ? t('phase8.specialistInbox') : t('phase8.referralTracker')}</h1>
        </div>
      </header>
      {isAdmin && (
        <div className="phase8-stat-grid">
          <Card className="phase8-stat-card"><HeartHandshake aria-hidden="true" /><strong>{t('phase8.adminReferralStats')}</strong><span>{referrals.length}</span></Card>
          {['pending', 'accepted', 'in_progress', 'completed'].map((status) => (
            <Card className="phase8-stat-card" key={status}><strong>{t(`phase8.${status}`)}</strong><span>{counts[status] || 0}</span></Card>
          ))}
        </div>
      )}
      {canCreate && (
        <Card className="phase8-card">
          <h2>{t('phase8.newReferral')}</h2>
          <form className="phase8-form" onSubmit={(event) => void createReferral(event)}>
            <Select id="referral-patient" label={t('phase8.patient')} onChange={(event) => setPatientId(event.target.value)} required value={patientId}>
              <option value="">{t('phase8.patientRequired')}</option>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} · {patient.patient_code}</option>)}
            </Select>
            <Input id="referral-screening" label={t('phase8.screening')} onChange={(event) => setScreeningId(event.target.value)} value={screeningId} />
            <Select id="referral-specialist" label={t('phase8.specialist')} onChange={(event) => setSpecialistId(event.target.value)} required value={specialistId}>
              <option value="">{t('phase8.specialist')}</option>
              {directory.specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.name} · {specialist.specialty}</option>)}
            </Select>
            <Select id="referral-hospital" label={t('phase8.hospital')} onChange={(event) => setHospitalId(event.target.value)} required value={hospitalId}>
              <option value="">{t('phase8.hospital')}</option>
              {directory.hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}
            </Select>
            <Select id="referral-urgency" label={t('phase8.urgency')} onChange={(event) => setUrgency(event.target.value)} value={urgency}>
              {['routine', 'soon', 'urgent'].map((value) => <option key={value} value={value}>{t(`phase8.${value}`)}</option>)}
            </Select>
            <label className="field" htmlFor="referral-reason">
              <span className="field__label">{t('phase8.referralReason')}</span>
              <textarea className="field__control phase8-textarea" id="referral-reason" maxLength={3000} onChange={(event) => setReason(event.target.value)} required value={reason} />
            </label>
            <label
              className="field phase8-drop-zone"
              htmlFor="referral-documents"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setDocuments(Array.from(event.dataTransfer.files || []));
              }}
            >
              <span className="field__label">{t('phase8.supportingDocuments')}</span>
              <input accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="field__control phase8-file-input" id="referral-documents" multiple onChange={(event) => setDocuments(Array.from(event.target.files || []))} type="file" />
            </label>
            {!!documents.length && <p className="phase8-muted">{documents.map((file) => file.name).join(', ')}</p>}
            <Button disabled={saving || !patientId || !specialistId || !hospitalId || !reason.trim()} type="submit">
              <Send aria-hidden="true" size={17} />{saving ? t('phase8.loading') : t('phase8.createReferral')}
            </Button>
          </form>
        </Card>
      )}
      {loading ? <Loading label={t('phase8.loading')} /> : referrals.length ? (
        <div className="phase8-record-list">
          {referrals.map((referral) => {
            const events = referral.timeline || [];
            const canSpecialistManage = user.role === 'specialist' && referral.status !== 'completed' && referral.status !== 'rejected';
            const canUpdateStatus = (canSpecialistManage || isAdmin) && !['completed', 'rejected'].includes(referral.status);
            return (
              <Card className="phase8-referral-card" key={referral.id}>
                <div className="phase8-record__header">
                  <div>
                    <span className="eyebrow">{referral.patient_code}</span>
                    <h2>{referral.patient_name}</h2>
                    <p>{referral.specialist_name} · {referral.hospital_name}</p>
                  </div>
                  <span className={`phase8-status phase8-status--${referral.status}`}>{t(`phase8.${referral.status}`)}</span>
                </div>
                <p>{referral.reason}</p>
                <div className={`phase8-urgency phase8-urgency--${referral.urgency}`}>{t(`phase8.${referral.urgency}`)}</div>
                <details className="phase8-details">
                  <summary>{t('phase8.timeline')}</summary>
                  <ol className="phase8-timeline">
                    {events.map((event) => (
                      <li key={event.id}>
                        <strong>{t(`phase8.event${event.event_type.replace(/(^|_)([a-z])/g, (_match, _separator, letter) => letter.toUpperCase())}`, t('phase8.eventUpdate'))}</strong>
                        <span>{event.actor_name} · {new Date(event.created_at).toLocaleString()}</span>
                        <small>
                          {event.details?.note || event.details?.feedback || event.details?.notes || ''}
                          {event.details?.from && event.details?.to ? ` · ${t('phase8.statusTransition', {
                            from: t(`phase8.${event.details.from}`),
                            to: t(`phase8.${event.details.to}`),
                          })}` : ''}
                          {event.details?.follow_up_date ? ` · ${event.details.follow_up_date} · ${t(`phase8.${event.details.follow_up_status}`)}` : ''}
                          {event.details?.recommended_investigations?.length ? ` · ${t('phase8.investigations')}: ${event.details.recommended_investigations.join(', ')}` : ''}
                        </small>
                      </li>
                    ))}
                  </ol>
                </details>
                {!!referral.feedback && <p><strong>{t('phase8.feedback')}:</strong> {referral.feedback}</p>}
                {!!referral.documents?.length && (
                  <div className="phase8-document-list">
                    <strong>{t('phase8.documents')}</strong>
                    {referral.documents.map((document) => (
                      <Button key={document.id} onClick={() => void download(document)} type="button" variant="outline">
                        <Download aria-hidden="true" size={16} />{document.original_name}
                      </Button>
                    ))}
                  </div>
                )}
                {canUpdateStatus && (
                  <div className="phase8-record__actions">
                    {referral.status === 'pending' && <Button disabled={saving} onClick={() => void act('update_status', referral, { status: 'accepted' })} type="button">{t('phase8.accept')}</Button>}
                    {referral.status !== 'in_progress' && <Button disabled={saving} onClick={() => void act('update_status', referral, { status: 'in_progress' })} type="button" variant="outline">{t('phase8.startReview')}</Button>}
                    {['accepted', 'in_review', 'in_progress'].includes(referral.status) && <Button disabled={saving} onClick={() => void act('update_status', referral, { status: 'completed' })} type="button" variant="outline">{t('phase8.finish')}</Button>}
                    <Button disabled={saving} onClick={() => void act('update_status', referral, { status: 'rejected' })} type="button" variant="outline">{t('phase8.reject')}</Button>
                    {user.role === 'specialist' && <Button onClick={() => setFeedback({ referral, text: referral.feedback || '', investigations: '' })} type="button" variant="outline">{t('phase8.feedback')}</Button>}
                  </div>
                )}
                {canFollowUp && (
                  <Button onClick={() => setFollowUp({ referral, date: '', status: 'scheduled', notes: '' })} type="button" variant="outline">{t('phase8.followUp')}</Button>
                )}
              </Card>
            );
          })}
        </div>
      ) : <Card><p>{t('phase8.emptyReferrals')}</p></Card>}
      {feedback && (
        <div aria-modal="true" className="phase8-modal-backdrop" role="dialog">
          <Card className="phase8-modal">
            <h2>{t('phase8.feedback')}</h2>
            <label className="field" htmlFor="referral-feedback">
              <span className="field__label">{t('phase8.feedbackText')}</span>
              <textarea className="field__control phase8-textarea" id="referral-feedback" onChange={(event) => setFeedback((current) => ({ ...current, text: event.target.value }))} value={feedback.text} />
            </label>
            <Input id="referral-investigations" label={t('phase8.investigations')} onChange={(event) => setFeedback((current) => ({ ...current, investigations: event.target.value }))} value={feedback.investigations} />
            <Button disabled={saving || !feedback.text.trim()} onClick={() => void act('specialist_feedback', feedback.referral, {
              feedback: feedback.text,
              recommended_investigations: feedback.investigations.split(',').map((item) => item.trim()).filter(Boolean),
            })} type="button">{t('phase8.saveFeedback')}</Button>
            <Button onClick={() => setFeedback(null)} type="button" variant="outline">{t('phase8.back')}</Button>
          </Card>
        </div>
      )}
      {followUp && (
        <div aria-modal="true" className="phase8-modal-backdrop" role="dialog">
          <Card className="phase8-modal">
            <h2>{t('phase8.followUp')}</h2>
            <Input id="follow-up-date" label={t('phase8.followUpDate')} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setFollowUp((current) => ({ ...current, date: event.target.value }))} type="date" value={followUp.date} />
            <Select id="follow-up-status" label={t('phase8.followUpStatus')} onChange={(event) => setFollowUp((current) => ({ ...current, status: event.target.value }))} value={followUp.status}>
              {['scheduled', 'completed', 'missed', 'cancelled'].map((value) => <option key={value} value={value}>{t(`phase8.${value}`)}</option>)}
            </Select>
            <Input id="follow-up-notes" label={t('phase8.followUpNotes')} onChange={(event) => setFollowUp((current) => ({ ...current, notes: event.target.value }))} value={followUp.notes} />
            <Button disabled={saving || !followUp.date} onClick={() => void act('follow_up', followUp.referral, {
              follow_up_date: followUp.date,
              follow_up_status: followUp.status,
              notes: followUp.notes,
            })} type="button">{t('phase8.saveFollowUp')}</Button>
            <Button onClick={() => setFollowUp(null)} type="button" variant="outline">{t('phase8.back')}</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
