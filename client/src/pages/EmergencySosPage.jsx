import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, MapPin, Phone, Siren, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Input from '../components/ui/Input.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

export default function EmergencySosPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState(user.profile?.id || '');
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [shareLocation, setShareLocation] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [editingContact, setEditingContact] = useState(null);

  useEffect(() => {
    let active = true;
    if (user.role === 'patient') {
      if (user.profile?.id) setPatientId(user.profile.id);
      else api.get('/auth/profile')
        .then(({ data }) => active && setPatientId(data.data.user.profile?.id || ''))
        .catch(() => active && notify(t('phase9.loadError'), 'error'));
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
    if (!patientId) return;
    try {
      const [contactResult, facilityResult] = await Promise.all([
        api.get('/emergency/contacts', { params: { patient_id: patientId, include: 'requests' } }),
        api.get('/emergency/nearby-hospitals', {
          params: user.role === 'health_worker' ? { patient_id: patientId } : {},
        }),
      ]);
      setContacts(contactResult.data.data.contacts || []);
      setRequests(contactResult.data.data.requests || []);
      setHospitals(facilityResult.data.data.hospitals || []);
    } catch {
      notify(t('phase9.loadError'), 'error');
    }
  }, [notify, patientId, t, user.role]);

  useEffect(() => { void load(); }, [load]);

  const addContact = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setContactSaving(true);
    try {
      await api.post('/emergency/contacts', {
        ...(user.role === 'health_worker' ? { patient_id: patientId } : {}),
        ...(editingContact ? { action: 'update', contact_id: editingContact.id } : {}),
        name: String(form.get('name')),
        relationship: String(form.get('relationship')),
        mobile: String(form.get('mobile')),
        is_primary: form.get('is_primary') === 'on',
      });
      formElement.reset();
      setEditingContact(null);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('phase9.addContactError'), 'error');
    } finally {
      setContactSaving(false);
    }
  };

  const confirmSos = async () => {
    setSubmitting(true);
    try {
      let coordinates = null;
      if (shareLocation && navigator.geolocation) {
        coordinates = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
          );
        });
      }
      const locationConsent = Boolean(shareLocation && coordinates);
      const { data } = await api.post('/emergency/sos', {
        ...(user.role === 'health_worker' ? { patient_id: patientId } : {}),
        location_consent: locationConsent,
        ...(coordinates && locationConsent ? coordinates : {}),
        contact_ids: selectedContacts,
      });
      notify(t('phase9.sosSaved'), 'success');
      setConfirming(false);
      setShareLocation(false);
      await load();
      setHospitals(data.data.callable_options.hospitals || []);
    } catch (error) {
      notify(error.response?.data?.message || t('phase9.saveError'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleContact = (id) => {
    setSelectedContacts((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 5 ? [...current, id] : current);
  };

  const readGuidance = () => {
    if (!window.speechSynthesis) {
      notify(t('phase9.noSpeech'), 'info');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`${t('phase9.emergencyNote')} ${t('phase9.locationPermission')}`);
    utterance.lang = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN', or: 'or-IN' }[i18n.language] || 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="page-content__inner phase9-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow"><Siren aria-hidden="true" size={17} /> {t('phase9.emergencyTitle')}</p>
          <h1>{t('phase9.emergencyTitle')}</h1>
          <p>{t('phase9.emergencySubtitle')}</p>
        </div>
      </header>
      {user.role !== 'patient' && (
        <Select id="emergency-patient" label={t('phase9.patient')} onChange={(event) => setPatientId(event.target.value)} value={patientId}>
          <option value="">{t('phase9.choosePatient')}</option>
          {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name} · {patient.patient_code}</option>)}
        </Select>
      )}
      <Card className="phase9-sos-card">
        <div className="phase9-emergency-note" role="alert">
          <AlertTriangle aria-hidden="true" />
          <strong>{t('phase9.emergencyNote')}</strong>
        </div>
        <Button onClick={readGuidance} type="button" variant="outline"><Volume2 aria-hidden="true" /> {t('phase9.readGuidance')}</Button>
        <a className="phase9-call108" href="tel:108"><Phone aria-hidden="true" size={23} /> {t('phase9.call108')}</a>
        <button
          aria-label={t('phase9.requestSos')}
          className="phase9-sos-button"
          disabled={!patientId}
          onClick={() => setConfirming(true)}
          type="button"
        >
          <Siren aria-hidden="true" size={44} />
          <span>{t('phase9.requestSos')}</span>
        </button>
      </Card>

      {confirming && (
        <div aria-labelledby="sos-confirm-heading" aria-modal="true" className="phase9-confirm-backdrop" role="dialog">
          <Card className="phase9-confirm-card">
            <h2 id="sos-confirm-heading">{t('phase9.confirmSos')}</h2>
            <p><MapPin aria-hidden="true" size={18} /> {t('phase9.locationQuestion')}</p>
            <p className="phase9-muted">{t('phase9.locationPermission')}</p>
            <label className="phase9-checkbox">
              <input checked={shareLocation} onChange={(event) => setShareLocation(event.target.checked)} type="checkbox" />
              {t('phase9.shareLocation')}
            </label>
            <fieldset className="phase9-contact-picker">
              <legend>{t('phase9.contactSelection')}</legend>
              {contacts.map((contact) => (
                <label className="phase9-checkbox" key={contact.id}>
                  <input checked={selectedContacts.includes(contact.id)} onChange={() => toggleContact(contact.id)} type="checkbox" />
                  {contact.name} · {contact.mobile}
                </label>
              ))}
            </fieldset>
            <div className="phase9-actions">
              <Button disabled={submitting} onClick={confirmSos} type="button">{submitting ? t('phase9.loading') : t('phase9.confirmSos')}</Button>
              <Button onClick={() => setConfirming(false)} type="button" variant="outline">{t('phase9.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}

      <section className="phase9-section">
        <h2>{t('phase9.contacts')}</h2>
        {!contacts.length && <Card><p>{t('phase9.noContacts')}</p></Card>}
        <div className="phase9-contact-list">
          {contacts.map((contact) => (
            <Card key={contact.id}>
              <strong>{contact.name}</strong>
              <span>{contact.relationship} · {contact.mobile}</span>
              {contact.is_primary && <span>{t('phase9.primary')}</span>}
              <Button onClick={() => setEditingContact(contact)} type="button" variant="outline">{t('phase9.edit')}</Button>
            </Card>
          ))}
        </div>
        <Card>
          <h3>{t('phase9.addContact')}</h3>
          <form className="phase9-form" key={editingContact?.id || 'new-contact'} onSubmit={addContact}>
            <Input defaultValue={editingContact?.name || ''} id="emergency-contact-name" label={t('phase9.name')} name="name" required maxLength={160} />
            <Input defaultValue={editingContact?.relationship || ''} id="emergency-contact-relationship" label={t('phase9.relationship')} name="relationship" required maxLength={80} />
            <Input defaultValue={editingContact?.mobile || ''} id="emergency-contact-mobile" label={t('phase9.mobile')} name="mobile" type="tel" required pattern="(?:\+91[\s-]?)?[6-9][0-9]{9}" />
            <label className="phase9-checkbox"><input defaultChecked={editingContact?.is_primary || false} name="is_primary" type="checkbox" /> {t('phase9.primary')}</label>
            <Button disabled={contactSaving || !patientId} type="submit">{contactSaving ? t('phase9.loading') : editingContact ? t('phase9.saveChanges') : t('phase9.addContact')}</Button>
            {editingContact && <Button onClick={() => setEditingContact(null)} type="button" variant="outline">{t('phase9.cancel')}</Button>}
          </form>
        </Card>
      </section>

      <section className="phase9-section">
        <h2>{t('phase9.hospitals')}</h2>
        {!hospitals.length && <Card><p>{t('phase9.noHospital')}</p></Card>}
        <div className="phase9-contact-list">
          {hospitals.map((hospital) => (
            <Card key={`${hospital.facility_type || hospital.name}-${hospital.id || hospital.name}`}>
              <strong>{hospital.name}</strong>
              <span>{hospital.address}</span>
              {hospital.ambulance_info && <p><strong>{t('phase9.ambulanceInfo')}:</strong> {hospital.ambulance_info}</p>}
              <div className="phase9-actions">
                {(hospital.emergency_phone || hospital.phone) && <a className="button button--outline" href={`tel:${hospital.emergency_phone || hospital.phone}`}>{t('phase9.call')}</a>}
                {hospital.directions_url && <a className="button button--outline" href={hospital.directions_url} rel="noreferrer" target="_blank">{t('phase9.directions')}</a>}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="phase9-section">
        <h2>{t('phase9.requests')}</h2>
        <div className="phase9-history-list">
          {requests.map((request) => (
            <div className="phase9-history-item" key={request.id}>
              <span>{new Date(request.created_at).toLocaleString()}</span>
              <strong>{t(`phase9.${request.status}`)}</strong>
              <span>{request.location_shared ? t('phase9.locationShared') : t('phase9.locationNotShared')}</span>
              <span>{request.notified_contact_ids?.length || 0}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
