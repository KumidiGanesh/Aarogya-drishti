const { getDb } = require('../db/mongo');
const geminiChat = require('./geminiChat');

const REVIEW_NOTICE = 'AI-assisted translation. Medical translations must be reviewed by qualified clinicians before real-world deployment.';

const curatedExplanations = {
  brushing: {
    en: 'Brush your teeth gently twice each day with fluoride toothpaste. Clean between your teeth and visit a dental professional regularly.',
    te: 'ఫ్లోరైడ్ టూత్‌పేస్ట్‌తో రోజుకు రెండుసార్లు పళ్లను మృదువుగా తోమండి. పళ్ల మధ్య శుభ్రం చేసి, క్రమం తప్పకుండా దంత వైద్యుడిని కలవండి.',
    hi: 'फ्लोराइड टूथपेस्ट से दिन में दो बार धीरे-धीरे दाँत साफ करें। दाँतों के बीच सफाई करें और नियमित रूप से दंत चिकित्सक से मिलें।',
    or: 'ଫ୍ଲୋରାଇଡ୍ ଟୁଥପେଷ୍ଟରେ ଦିନକୁ ଦୁଇଥର ଧୀରେ ଦାନ୍ତ ଘଷନ୍ତୁ। ଦାନ୍ତ ମଧ୍ୟରେ ସଫା କରନ୍ତୁ ଏବଂ ନିୟମିତ ଦନ୍ତ ଡାକ୍ତରଙ୍କୁ ଦେଖାନ୍ତୁ।',
  },
  tobacco: {
    en: 'Tobacco, gutkha, and areca nut can harm the mouth. Stopping their use is an important step for better oral health. Ask a health professional for support.',
    te: 'పొగాకు, గుట్కా, వక్క నోటికి హాని చేయవచ్చు. వీటిని మానడం మంచి నోటి ఆరోగ్యానికి ముఖ్యమైన అడుగు. సహాయం కోసం ఆరోగ్య నిపుణుడిని అడగండి.',
    hi: 'तंबाकू, गुटखा और सुपारी मुँह को नुकसान पहुँचा सकते हैं। इन्हें छोड़ना मुँह के स्वास्थ्य के लिए एक महत्वपूर्ण कदम है। सहायता के लिए स्वास्थ्यकर्मी से बात करें।',
    or: 'ତମାଖୁ, ଗୁଟଖା ଏବଂ ଗୁଆ ପାଟିକୁ କ୍ଷତି କରିପାରେ। ଏଗୁଡ଼ିକ ଛାଡ଼ିବା ମୁଖ ସ୍ୱାସ୍ଥ୍ୟ ପାଇଁ ଏକ ଜରୁରୀ ପଦକ୍ଷେପ। ସହାୟତା ପାଇଁ ସ୍ୱାସ୍ଥ୍ୟ କର୍ମୀଙ୍କୁ ପଚାରନ୍ତୁ।',
  },
  ulcer: {
    en: 'Many mouth sores improve, but a sore that lasts longer than two weeks should be checked by a qualified doctor. This information cannot identify the cause.',
    te: 'చాలా నోటి పుండ్లు తగ్గుతాయి. అయితే రెండు వారాలకంటే ఎక్కువ ఉండే పుండును అర్హత కలిగిన వైద్యుడు పరిశీలించాలి. ఈ సమాచారం కారణాన్ని గుర్తించదు.',
    hi: 'मुँह के कई छाले ठीक हो जाते हैं, लेकिन दो सप्ताह से अधिक रहने वाले घाव को योग्य डॉक्टर से दिखाएँ। यह जानकारी कारण की पहचान नहीं करती।',
    or: 'ଅନେକ ମୁଖ ଘା ଭଲ ହୋଇଯାଏ, କିନ୍ତୁ ଦୁଇ ସପ୍ତାହରୁ ଅଧିକ ରହିଥିବା ଘାକୁ ଯୋଗ୍ୟ ଡାକ୍ତରଙ୍କୁ ଦେଖାନ୍ତୁ। ଏହି ସୂଚନା କାରଣ ଚିହ୍ନଟ କରେ ନାହିଁ।',
  },
};

const instructionText = {
  en: '1. Brush gently with fluoride toothpaste twice each day. 2. Clean between your teeth. 3. Avoid tobacco, gutkha, and areca nut. 4. Ask a qualified health professional when you have concerns.',
  te: '1. ఫ్లోరైడ్ టూత్‌పేస్ట్‌తో రోజుకు రెండుసార్లు మృదువుగా తోమండి. 2. పళ్ల మధ్య శుభ్రం చేయండి. 3. పొగాకు, గుట్కా, వక్కను మానండి. 4. సందేహాలుంటే అర్హత కలిగిన ఆరోగ్య నిపుణుడిని అడగండి.',
  hi: '1. फ्लोराइड टूथपेस्ट से दिन में दो बार धीरे से ब्रश करें। 2. दाँतों के बीच सफाई करें। 3. तंबाकू, गुटखा और सुपारी से बचें। 4. चिंता होने पर योग्य स्वास्थ्यकर्मी से बात करें।',
  or: '1. ଫ୍ଲୋରାଇଡ୍ ଟୁଥପେଷ୍ଟରେ ଦିନକୁ ଦୁଇଥର ଧୀରେ ଘଷନ୍ତୁ। 2. ଦାନ୍ତ ମଧ୍ୟରେ ସଫା କରନ୍ତୁ। 3. ତମାଖୁ, ଗୁଟଖା ଏବଂ ଗୁଆ ଏଡ଼ାନ୍ତୁ। 4. ଚିନ୍ତା ଥିଲେ ଯୋଗ୍ୟ ସ୍ୱାସ୍ଥ୍ୟ କର୍ମୀଙ୍କୁ ପଚାରନ୍ତୁ।',
};

const glossary = [
  ['oral health', 'mouth and teeth health'],
  ['gum', 'tissue around the teeth'],
  ['ulcer', 'sore inside the mouth'],
  ['fluoride toothpaste', 'toothpaste that helps protect teeth'],
  ['areca nut', 'supari'],
  ['qualified clinician', 'qualified doctor or health professional'],
];

function safeText(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackTopic(text) {
  const topic = text.toLowerCase();
  if (/(brush|toothpaste|brushing|పళ్లు|తోమ|ब्रश|दाँत|ଦାନ୍ତ|ଘଷ)/u.test(topic)) return 'brushing';
  if (/(tobacco|gutkha|areca|వక్క|గుట్కా|పొగాకు|तंबाकू|गुटखा|सुपारी|ତମାଖୁ|ଗୁଟଖା|ଗୁଆ)/u.test(topic)) return 'tobacco';
  if (/(ulcer|sore|patch|పుండు|మచ్చ|घाव|छाला|ଘା|ଦାଗ)/u.test(topic)) return 'ulcer';
  return null;
}

async function lookupTranslation(text, sourceLanguage, targetLanguage, namespace) {
  const db = await getDb();
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = await db.collection('translation_contents').findOne({
    language_code: sourceLanguage,
    value: { $regex: `^${escapedText}$`, $options: 'i' },
    ...(namespace ? { key: { $regex: `^${namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.` } } : {}),
  });
  if (!source) return null;
  const target = await db.collection('translation_contents').findOne({
    key: source.key,
    language_code: targetLanguage,
  });
  return target?.value || null;
}

async function providerTranslate(text, sourceLanguage, targetLanguage, mode) {
  const endpoint = process.env.TRANSLATION_PROVIDER_URL;
  const token = process.env.TRANSLATION_PROVIDER_TOKEN;
  if (!endpoint || !token) return null;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      mode,
      glossary,
      instructions: 'Preserve the meaning. Do not diagnose or recommend medicines or treatment doses. Return only translated text.',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(`Translation provider returned HTTP ${response.status}`);
    error.status = 502;
    error.code = 'TRANSLATION_PROVIDER_FAILED';
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error('Translation provider returned invalid JSON');
    error.status = 502;
    error.code = 'TRANSLATION_PROVIDER_INVALID_RESPONSE';
    throw error;
  }
  const translatedText = result && (result.translatedText || result.translation || result.text);
  if (typeof translatedText !== 'string' || !translatedText.trim()) {
    const error = new Error('Translation provider response did not contain translated text');
    error.status = 502;
    error.code = 'TRANSLATION_PROVIDER_INVALID_RESPONSE';
    throw error;
  }
  return translatedText.trim();
}

async function translate({
  text: rawText,
  source_lang: sourceLanguage,
  target_lang: targetLanguage,
  mode = 'translate',
  history = [],
}) {
  const text = safeText(rawText);
  if (!text) {
    const error = new Error('Text is empty after sanitization');
    error.status = 400;
    error.code = 'TRANSLATION_TEXT_EMPTY';
    throw error;
  }

  if (mode === 'chat') {
    const response = await geminiChat.chat({
      text,
      source_lang: sourceLanguage,
      history: history.map(({ role, text: message }) => ({
        role,
        text: safeText(message),
      })),
    });
    return {
      translated_text: response,
      disclaimer: geminiChat.CHATBOT_NOTICE,
      source: 'gemini',
      mode,
    };
  }

  let translatedText;
  let source = 'provider';
  if (mode === 'explain_oral_health') {
    const topic = fallbackTopic(text);
    if (topic) {
      translatedText = curatedExplanations[topic][targetLanguage];
      source = 'curated';
    }
  } else if (
    mode === 'patient_instruction'
    && /(basic oral hygiene|daily oral hygiene|simple patient instructions|మౌలిక నోటి|सरल मुख|ସରଳ ମୁଖ)/iu.test(text)
  ) {
    translatedText = instructionText[targetLanguage];
    source = 'curated';
  }
  if (!translatedText) {
    translatedText = await providerTranslate(text, sourceLanguage, targetLanguage, mode);
  }
  if (!translatedText) {
    translatedText = await lookupTranslation(text, sourceLanguage, targetLanguage);
    source = translatedText ? 'translation_contents' : 'unavailable';
  }
  if (!translatedText) {
    const error = new Error('No translation provider or matching offline phrase is available');
    error.status = 501;
    error.code = 'TRANSLATION_UNAVAILABLE';
    throw error;
  }
  return { translated_text: translatedText, disclaimer: REVIEW_NOTICE, source, mode };
}

module.exports = { translate, safeText, REVIEW_NOTICE, curatedExplanations, instructionText };
