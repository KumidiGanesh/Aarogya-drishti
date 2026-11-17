import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import PatientProfilePage from './PatientProfilePage.jsx';
import api from '../services/api.js';
import { useToast } from '../components/ui/Toast.jsx';

export default function PatientRecordsPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [patientId, setPatientId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get('/auth/profile')
      .then(({ data }) => {
        if (active) setPatientId(data.data.user.profile?.id || null);
      })
      .catch(() => {
        if (active) notify(t('patient.registrationError'), 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify, t]);

  if (loading) return <Loading label={t('patient.loading')} />;
  if (!patientId) {
    return (
      <Card>
        <p>{t('patient.noData')}</p>
      </Card>
    );
  }
  return <PatientProfilePage patientId={patientId} />;
}
