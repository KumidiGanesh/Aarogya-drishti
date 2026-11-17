import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, CheckCircle2, ClipboardList, HeartPulse, Printer, Stethoscope, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import AiOutputBanner from '../components/screenings/AiOutputBanner.jsx';
import Button from '../components/ui/Button.jsx';
import Card from '../components/ui/Card.jsx';
import Loading from '../components/ui/Loading.jsx';
import Select from '../components/ui/Select.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';

function displayHistory(history, t) {
  if (!history) return [];
  return Object.entries(history).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === '') return [];
    const formatted =
      typeof value === 'boolean'
        ? t(`screening.${value ? 'yes' : 'no'}`)
        : Array.isArray(value)
          ? value.join(', ')
          : value;
    return [`${t(`screening.historyFields.${key}`, key)}: ${formatted}`];
  });
}

export default function ScreeningDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useToast();
  const [screening, setScreening] = useState(null);
  const [imageUrls, setImageUrls] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [grantingAiConsent, setGrantingAiConsent] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [sendingToDoctor, setSendingToDoctor] = useState(false);
  const [startingDoctorReview, setStartingDoctorReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [observations, setObservations] = useState('');
  const [provisionalNotes, setProvisionalNotes] = useState('');
  const [followUpRecommendation, setFollowUpRecommendation] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [recommendReferral, setRecommendReferral] = useState(false);
  const [investigations, setInvestigations] = useState('');
  const [reviewStatus, setReviewStatus] = useState('completed');
  const [aiDecisions, setAiDecisions] = useState({});
  const canAnalyze = ['health_worker', 'doctor', 'specialist', 'patient'].includes(user.role);
  const canReview = ['doctor', 'specialist'].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    setScreening(null);
    setImageUrls({});
    try {
      const { data } = await api.get(`/screenings/${id}`);
      setScreening(data.data.screening);
    } catch {
      notify(t('screening.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [id, notify, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    if (user.role !== 'patient' || !screening?.images?.length || screening.doctor_request)
      return () => {
        active = false;
      };
    api
      .get('/screenings/doctors')
      .then(({ data }) => {
        if (active) setDoctors(data.data.items || []);
      })
      .catch(() => {
        if (active) notify(t('screening.doctorsLoadFailed'), 'error');
      });
    return () => {
      active = false;
    };
  }, [notify, screening, t, user.role]);

  useEffect(() => {
    let active = true;
    const urls = {};
    async function loadImages() {
      for (const image of screening?.images || []) {
        try {
          const response = await api.get(`/screenings/${id}`, {
            params: { image_id: image.id },
            responseType: 'blob',
          });
          if (!active) return;
          urls[image.id] = URL.createObjectURL(response.data);
          setImageUrls((current) => ({ ...current, [image.id]: urls[image.id] }));
        } catch {
          if (active) {
            setImageUrls((current) => ({ ...current, [image.id]: null }));
          }
        }
      }
    }
    void loadImages();
    return () => {
      active = false;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [id, screening?.images]);

  const runAnalysis = async () => {
    setRunning(true);
    try {
      await api.post(`/screenings/${id}/ai-analysis`);
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('screening.aiFailed'), 'error');
    } finally {
      setRunning(false);
    }
  };

  const sendToDoctor = async () => {
    if (!selectedDoctor) return;
    setSendingToDoctor(true);
    try {
      await api.post(`/screenings/${id}/doctor-request`, { doctor_id: selectedDoctor });
      notify(t('screening.doctorRequestSent'), 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('screening.doctorRequestFailed'), 'error');
    } finally {
      setSendingToDoctor(false);
    }
  };

  const startDoctorReview = async () => {
    setStartingDoctorReview(true);
    try {
      await api.post(`/screenings/${id}/doctor-request/status`, { status: 'under_review' });
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('screening.doctorRequestFailed'), 'error');
    } finally {
      setStartingDoctorReview(false);
    }
  };

  const grantAiConsent = async () => {
    setGrantingAiConsent(true);
    try {
      await api.post(`/patients/${screening.patient.id}/consent`, {
        consent_type: 'ai_processing',
        granted: true,
        version: screening.ai_processing_consent_version || 1,
        language: ['en', 'te', 'hi', 'or'].includes(user.preferred_language)
          ? user.preferred_language
          : 'en',
      });
      notify(t('screening.aiConsentSaved'), 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('screening.aiConsentSaveFailed'), 'error');
    } finally {
      setGrantingAiConsent(false);
    }
  };

  const saveReview = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`/screenings/${id}/clinical-review`, {
        observations,
        provisional_notes: provisionalNotes,
        follow_up_recommendation: followUpRecommendation,
        ...(followUpDate ? { follow_up_date: followUpDate } : {}),
        recommend_referral: recommendReferral,
        recommended_investigations: investigations
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        ai_observation_decisions: Object.entries(aiDecisions).map(([index, value]) => ({
          observation_index: Number(index),
          decision: value.decision,
          correction: value.correction || '',
        })),
        review_status: reviewStatus,
      });
      notify(
        recommendReferral ? t('screening.referralCreated') : t('screening.reviewSaved'),
        'success',
      );
      setObservations('');
      setProvisionalNotes('');
      setFollowUpRecommendation('');
      setFollowUpDate('');
      setInvestigations('');
      setAiDecisions({});
      await load();
    } catch (error) {
      notify(error.response?.data?.message || t('screening.reviewFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label={t('loading')} />;
  if (!screening) {
    return (
      <Card>
        <p>{t('screening.loadFailed')}</p>
        <Link className="button button--outline" to="/screenings">
          {t('screening.back')}
        </Link>
      </Card>
    );
  }

  const result = screening.ai_result;
  const resultData = result?.result_data || {};
  const history = displayHistory(screening.patient_history, t);

  return (
    <div className="screening-page screening-detail-page">
      <header className="page-heading screening-heading">
        <div>
          <p className="eyebrow screening-title-badge"><Activity aria-hidden="true" size={15} />{t('screening.detail')}</p>
          <h1>{screening.patient?.full_name || t('screening.patient')}</h1>
          <p className="page-heading__description">
            {[`${t('screening.title')}: ${screening.id}`, screening.patient?.patient_code, screening.patient?.village_name]
              .filter(Boolean)
              .join(' · ')}
            {' · '}{new Date(screening.screened_at || screening.created_at).toLocaleString()}
          </p>
        </div>
        <Button onClick={() => window.print()} type="button" variant="outline">
          <Printer aria-hidden="true" size={18} />
          {t('screening.print')}
        </Button>
      </header>
      <div className="screening-detail-grid">
        <Card>
          <h2 className="screening-card-heading"><span className="screening-card-icon screening-card-icon--cyan"><HeartPulse aria-hidden="true" /></span>{t('screening.symptomsStep')}</h2>
          <ul className="screening-symptom-list">
            {screening.symptoms.map((symptom) => (
              <li key={symptom.id}>
                <strong>
                  {t(
                    `screening.symptomNames.${symptom.symptom_code}`,
                    symptom.symptom_code.replaceAll('_', ' '),
                  )}
                </strong>
                <span>
                  <span className={`screening-severity screening-severity--${symptom.severity}`}>
                    {t(`screening.${symptom.severity}`)}
                  </span>
                  {symptom.duration_days != null && <> · {symptom.duration_days} {t('screening.symptomDuration')}</>}
                </span>
              </li>
            ))}
          </ul>
          {screening.notes && <p>{screening.notes}</p>}
        </Card>
        {(user.role === 'patient' || screening.doctor_request) && (
          <Card className="screening-doctor-request">
            <h2 className="screening-card-heading"><span className="screening-card-icon screening-card-icon--blue"><Stethoscope aria-hidden="true" /></span>{t('screening.doctorRequestTitle')}</h2>
            <p>{t('screening.doctorRequestDescription')}</p>
            {screening.doctor_request ? (
              <>
                <p>
                  <strong>{t('screening.assignedDoctor')}:</strong>{' '}
                  {screening.doctor_request.doctor_name || t('screening.doctor')}
                </p>
                <p>
                  <strong>{t('screening.doctorRequestStatus')}:</strong>{' '}
                  <span className={`screening-request-status screening-request-status--${screening.doctor_request.status}`}>
                    {t(`screening.doctorRequestStatuses.${screening.doctor_request.status}`)}
                  </span>
                </p>
                {user.role === 'doctor' && screening.doctor_request.status === 'submitted' && (
                  <Button
                    disabled={startingDoctorReview}
                    onClick={() => void startDoctorReview()}
                    type="button"
                  >
                    {startingDoctorReview ? t('loading') : t('screening.startDoctorReview')}
                  </Button>
                )}
              </>
            ) : user.role === 'patient' && screening.images.length > 0 ? (
              <div className="form-grid">
                <Select
                  id="screening-doctor"
                  label={t('screening.selectDoctor')}
                  onChange={(event) => setSelectedDoctor(event.target.value)}
                  value={selectedDoctor}
                >
                  <option value="">{t('screening.chooseDoctor')}</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.full_name}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </option>
                  ))}
                </Select>
                {!doctors.length && <p>{t('screening.noDoctorsAvailable')}</p>}
                <Button
                  disabled={!selectedDoctor || sendingToDoctor}
                  onClick={() => void sendToDoctor()}
                  type="button"
                >
                  {sendingToDoctor ? t('loading') : t('screening.sendToDoctor')}
                </Button>
              </div>
            ) : null}
          </Card>
        )}
        <Card>
          <h2 className="screening-card-heading"><span className="screening-card-icon screening-card-icon--teal"><ClipboardList aria-hidden="true" /></span>{t('screening.patientHistory')}</h2>
          {history.length ? (
            <ul className="screening-history-facts">
              {history.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>{t('screening.noHistory')}</p>
          )}
        </Card>
      </div>
      <Card className="screening-images-card" id="screening-images">
        <h2 className="screening-card-heading"><span className="screening-card-icon screening-card-icon--blue"><Activity aria-hidden="true" /></span>{t('screening.images')}</h2>
        {screening.images.length ? (
          <div className="screening-secure-image-grid">
            {screening.images.map((image) => (
              <article className="screening-secure-image" key={image.id}>
                {imageUrls[image.id] ? (
                  <button
                    aria-label={`${t('screening.openImage')} ${t(`screening.${image.site}`)}`}
                    className="screening-secure-image__preview"
                    onClick={() => setSelectedImage(image)}
                    type="button"
                  >
                    <img alt={t(`screening.${image.site}`)} src={imageUrls[image.id]} />
                    <span>
                      <ZoomIn aria-hidden="true" />
                      {t('screening.openImage')}
                    </span>
                  </button>
                ) : imageUrls[image.id] === null ? (
                  <p role="alert">{t('screening.imageUnavailable')}</p>
                ) : (
                  <div aria-busy="true" className="screening-secure-image__loading" />
                )}
                <dl>
                  <div>
                    <dt>{t('screening.imageSite')}</dt>
                    <dd>{t(`screening.${image.site}`)}</dd>
                  </div>
                  <div>
                    <dt>{t('screening.imageQuality')}</dt>
                    <dd>
                      {image.quality_status === 'accepted' && <CheckCircle2 aria-label={t('screening.imageQualityStatus.accepted')} className="screening-quality-check" size={16} />}
                      {t(`screening.imageQualityStatus.${image.quality_status || 'not_assessed'}`)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p>{t('screening.noPhotos')}</p>
        )}
      </Card>
      <Card className="screening-ai-card">
        <h2>{t('screening.aiStep')}</h2>
        <AiOutputBanner
          isDemo={Boolean(result?.is_demo)}
          isFailed={result?.inference_status === 'failed'}
        />
        <p className="screening-ai-consent">
          {screening.ai_provider_configured
            ? t(
                screening.ai_processing_consent_granted
                  ? 'screening.aiConsentGranted'
                  : 'screening.aiConsentRequired',
              )
            : t('screening.aiProviderUnavailable')}
        </p>
        {result ? (
          <div className="screening-ai-result">
            <section>
              <h3>{t('screening.inferenceStatus')}</h3>
              <p>
                {t(
                  `screening.inferenceStatuses.${result.inference_status || resultData.inference_status || resultData.analysis_status || 'unknown'}`,
                )}
              </p>
              <p>
                {resultData.image_analyzed
                  ? t('screening.imageInferenceCompleted')
                  : t('screening.imageInferenceNotCompleted')}
              </p>
              {resultData.oral_region_detected !== null &&
                resultData.oral_region_detected !== undefined && (
                  <p>
                    {t(
                      resultData.oral_region_detected
                        ? 'screening.oralRegionDetected'
                        : 'screening.oralRegionNotDetected',
                    )}
                  </p>
                )}
              {result.model_provider && (
                <p>
                  {t('screening.modelProvider')}: {result.model_provider} (
                  {result.model_version || t('screening.modelVersionUnavailable')})
                </p>
              )}
              {result.analysis_timestamp && (
                <p>
                  {t('screening.analysisTimestamp')}:{' '}
                  {new Date(result.analysis_timestamp).toLocaleString()}
                </p>
              )}
            </section>
            {result.inference_status === 'failed' && canAnalyze && (
              <Button disabled={running} onClick={() => void runAnalysis()} type="button">
                {running ? t('screening.runningAnalysis') : t('screening.retryAnalysis')}
              </Button>
            )}
            {resultData.image_quality && (
              <section>
                <h3>{t('screening.aiImageQuality')}</h3>
                <strong>
                  {t(`screening.imageQualityStatus.${resultData.image_quality.status}`)}
                </strong>
                <p>{resultData.image_quality.explanation}</p>
                {resultData.image_quality.concerns?.length > 0 && (
                  <ul>
                    {resultData.image_quality.concerns.map((concern, index) => (
                      <li key={`${concern}-${index}`}>{concern}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {resultData.reported_symptoms?.length > 0 && (
              <section>
                <h3>{t('screening.reportedSymptoms')}</h3>
                <ul>
                  {resultData.reported_symptoms.map((symptom, index) => (
                    <li key={`${symptom.code}-${index}`}>
                      {t(
                        `screening.symptomNames.${symptom.code}`,
                        symptom.code.replaceAll('_', ' '),
                      )}
                      {symptom.severity ? ` · ${t(`screening.${symptom.severity}`)}` : ''}
                      {symptom.duration_days
                        ? ` · ${symptom.duration_days} ${t('screening.symptomDuration')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {Object.values(resultData.reported_risk_factors || {}).some(Boolean) && (
              <section>
                <h3>{t('screening.reportedRiskFactors')}</h3>
                <ul>
                  {Object.entries(resultData.reported_risk_factors)
                    .filter(([, reported]) => reported)
                    .map(([factor]) => (
                      <li key={factor}>{t(`screening.historyFields.${factor}`, factor)}</li>
                    ))}
                </ul>
              </section>
            )}
            {resultData.visible_observations?.length > 0 && (
              <section>
                <h3>{t('screening.visibleObservations')}</h3>
                <p>{t('screening.observationReviewNotice')}</p>
                <ul>
                  {resultData.visible_observations.map((observation, index) => (
                    <li key={`${observation.type}-${index}`}>
                      <strong>{t(`screening.observationTypes.${observation.type}`)}</strong>
                      {' · '}
                      {observation.location}: {observation.description}
                      {canReview && (
                        <div className="screening-ai-review-controls">
                          <label>
                            <span>{t('screening.clinicianReviewObservation')}</span>
                            <select
                              aria-label={t('screening.observationReviewLabel', { count: index + 1 })}
                              onChange={(event) =>
                                setAiDecisions((current) => ({
                                  ...current,
                                  [index]: { ...current[index], decision: event.target.value },
                                }))
                              }
                              value={aiDecisions[index]?.decision || ''}
                            >
                              <option value="">{t('screening.notReviewed')}</option>
                              <option value="accepted">{t('screening.accept')}</option>
                              <option value="rejected">{t('screening.reject')}</option>
                              <option value="corrected">{t('screening.correct')}</option>
                            </select>
                          </label>
                          {aiDecisions[index]?.decision === 'corrected' && (
                            <input
                              aria-label={t('screening.observationCorrectionLabel', { count: index + 1 })}
                              onChange={(event) =>
                                setAiDecisions((current) => ({
                                  ...current,
                                  [index]: { ...current[index], correction: event.target.value },
                                }))
                              }
                              placeholder={t('screening.clinicianCorrection')}
                              value={aiDecisions[index]?.correction || ''}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div>
              <strong>{t('screening.explanation')}</strong>
              <p>{resultData.explanation || resultData.findings}</p>
            </div>
            <section>
              <h3>{t('screening.recommendedNextSteps')}</h3>
              <ul>
                {(
                  resultData.recommended_next_steps || [
                    resultData.recommendation || t('screening.doctorReview'),
                  ]
                ).map((step, index) => (
                  <li key={`${step}-${index}`}>{step}</li>
                ))}
              </ul>
            </section>
            {resultData.image_limitations?.length > 0 && (
              <section>
                <h3>{t('screening.imageLimitations')}</h3>
                <ul>
                  {resultData.image_limitations.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            {resultData.uncertainty?.length > 0 && (
              <section>
                <h3>{t('screening.uncertainty')}</h3>
                <ul>
                  {resultData.uncertainty.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="screening-medical-limitations">
              <strong>{t('screening.medicalLimitations')}</strong>{' '}
              {resultData.medical_limitations || t('screening.aiMedicalLimitations')}
            </p>
          </div>
        ) : screening.ai_provider_configured &&
          !screening.ai_processing_consent_granted &&
          user.role === 'patient' ? (
          <Button disabled={grantingAiConsent} onClick={() => void grantAiConsent()} type="button">
            {grantingAiConsent ? t('loading') : t('screening.grantAiConsent')}
          </Button>
        ) : (
          canAnalyze && screening.ai_provider_configured && (
            <Button disabled={running} onClick={() => void runAnalysis()} type="button">
              {running ? t('screening.runningAnalysis') : t('screening.runAnalysis')}
            </Button>
          )
        )}
      </Card>
      <Card>
        <h2>{t('screening.reviewStep')}</h2>
        {screening.clinical_reviews.length > 0 && (
          <div className="screening-review-list">
            {screening.clinical_reviews.map((review) => (
              <article key={review.id}>
                <strong>{review.reviewer_name}</strong>
                <span>{t(`screening.${review.review_status}`)}</span>
                <p>{review.observations}</p>
                {review.provisional_notes && (
                  <p>
                    <strong>{t('screening.provisionalNotes')}:</strong> {review.provisional_notes}
                  </p>
                )}
                {review.follow_up_recommendation && (
                  <p>
                    <strong>{t('screening.followUpRecommendation')}:</strong>{' '}
                    {review.follow_up_recommendation}
                    {review.follow_up_date
                      ? ` · ${t('screening.followUpDate')}: ${review.follow_up_date}`
                      : ''}
                  </p>
                )}
                {review.recommended_investigations?.length > 0 && (
                  <p>
                    <strong>{t('screening.investigations')}:</strong>{' '}
                    {review.recommended_investigations.join(', ')}
                  </p>
                )}
                {review.ai_observation_decisions?.length > 0 && (
                  <ul aria-label="Clinician decisions on AI observations">
                    {review.ai_observation_decisions.map((decision) => (
                      <li key={decision.observation_index}>
                        AI observation {decision.observation_index + 1}: {decision.decision}
                        {decision.decision === 'corrected' ? ` — ${decision.correction}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {review.recommend_referral && (
                  <p className="screening-high-review">{t('screening.referralCreated')}</p>
                )}
              </article>
            ))}
          </div>
        )}
        {canReview && (
          <form className="screening-review-form" onSubmit={(event) => void saveReview(event)}>
            <label className="field" htmlFor="screening-observations">
              <span className="field__label">{t('screening.observations')}</span>
              <textarea
                className="field__control screening-textarea"
                id="screening-observations"
                onChange={(event) => setObservations(event.target.value)}
                required
                rows={3}
                value={observations}
              />
            </label>
            <label className="field" htmlFor="screening-review-notes">
              <span className="field__label">{t('screening.provisionalNotes')}</span>
              <textarea
                className="field__control screening-textarea"
                id="screening-review-notes"
                onChange={(event) => setProvisionalNotes(event.target.value)}
                rows={3}
                value={provisionalNotes}
              />
            </label>
            <label className="field" htmlFor="screening-investigations">
              <span className="field__label">{t('screening.investigations')}</span>
              <input
                className="field__control"
                id="screening-investigations"
                onChange={(event) => setInvestigations(event.target.value)}
                placeholder={t('screening.investigationsHint')}
                value={investigations}
              />
            </label>
            <label className="field" htmlFor="screening-follow-up-recommendation">
              <span className="field__label">{t('screening.followUpRecommendation')}</span>
              <textarea
                className="field__control screening-textarea"
                id="screening-follow-up-recommendation"
                onChange={(event) => setFollowUpRecommendation(event.target.value)}
                rows={2}
                value={followUpRecommendation}
              />
            </label>
            <label className="field" htmlFor="screening-follow-up-date">
              <span className="field__label">{t('screening.followUpDate')}</span>
              <input
                className="field__control"
                id="screening-follow-up-date"
                onChange={(event) => setFollowUpDate(event.target.value)}
                type="date"
                value={followUpDate}
              />
            </label>
            <Select
              id="screening-review-status"
              label={t('screening.reviewStatus')}
              onChange={(event) => setReviewStatus(event.target.value)}
              value={reviewStatus}
            >
              {['pending', 'in_review', 'completed', 'needs_more_info'].map((value) => (
                <option key={value} value={value}>
                  {t(`screening.${value}`)}
                </option>
              ))}
            </Select>
            <label className="screening-override">
              <input
                checked={recommendReferral}
                onChange={(event) => setRecommendReferral(event.target.checked)}
                type="checkbox"
              />
              <span>{t('screening.recommendReferral')}</span>
            </label>
            <Button disabled={saving || !observations.trim()} type="submit">
              {saving ? t('loading') : t('screening.saveReview')}
            </Button>
          </form>
        )}
      </Card>
      <p className="screening-translation-notice">{t('screening.translationNotice')}</p>
      {selectedImage && imageUrls[selectedImage.id] && (
        <div
          aria-label={t('screening.images')}
          aria-modal="true"
          className="screening-image-modal"
          onClick={() => setSelectedImage(null)}
          role="dialog"
        >
          <Button
            aria-label={t('screening.closeImage')}
            className="screening-image-modal__close"
            onClick={() => setSelectedImage(null)}
            type="button"
            variant="outline"
          >
            {t('screening.closeImage')}
          </Button>
          <div
            className="screening-image-with-localizations"
            onClick={(event) => event.stopPropagation()}
          >
            <img alt={t(`screening.${selectedImage.site}`)} src={imageUrls[selectedImage.id]} />
            {resultData.visible_observations?.some(
              (observation) =>
                observation.image_id === selectedImage.id && observation.localization,
            ) && (
              <svg
                aria-label="Model-provided observation locations"
                className="screening-image-localizations"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                {resultData.visible_observations
                  .filter(
                    (observation) =>
                      observation.image_id === selectedImage.id && observation.localization,
                  )
                  .map((observation, index) => {
                    const box = observation.localization;
                    return (
                      <g key={`${observation.type}-${index}`}>
                        <title>
                          {observation.type}: {observation.description}
                        </title>
                        <rect
                          fill="none"
                          height={(box.y_max - box.y_min) * 100}
                          stroke="#d62728"
                          strokeWidth="0.6"
                          width={(box.x_max - box.x_min) * 100}
                          x={box.x_min * 100}
                          y={box.y_min * 100}
                        />
                      </g>
                    );
                  })}
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
