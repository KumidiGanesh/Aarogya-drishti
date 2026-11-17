const DEMO_DISCLAIMER = 'DEMO AI OUTPUT – NOT FOR CLINICAL USE.';
const SAFETY_SENTENCE =
  'This tool does not diagnose and does not replace professional medical evaluation.';
function generateDemoResult({ symptoms = [], images = [] }) {
  const reportedSymptoms = symptoms.map((symptom) => ({
    code: typeof symptom === 'string' ? symptom : symptom.symptom_code || symptom.code,
    severity: typeof symptom === 'string' ? null : symptom.severity || null,
    duration_days: typeof symptom === 'string' ? null : Number(symptom.duration_days) || 0,
  }));
  return {
    risk_category: null,
    confidence: null,
    model_version: 'questionnaire-demo-v2',
    is_demo: true,
    disclaimer: DEMO_DISCLAIMER,
    result_data: {
      source: 'questionnaire_demo',
      analysis_status: 'demonstration_only',
      image_analyzed: false,
      image_status: images.length ? 'not_analyzed' : 'no_image_uploaded',
      reported_symptoms: reportedSymptoms,
      visible_observations: [],
      findings:
        'Demonstration only. This result summarizes reported questionnaire information and is not a medical assessment.',
      recommendation: 'A qualified clinician should review persistent or concerning symptoms.',
      medical_limitations: SAFETY_SENTENCE,
    },
    safety_sentence: SAFETY_SENTENCE,
  };
}
module.exports = { generateDemoResult, DEMO_DISCLAIMER, SAFETY_SENTENCE };
