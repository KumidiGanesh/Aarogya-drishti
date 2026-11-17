const { createHash } = require('node:crypto');

const ttsCache = new Map();
const MAX_CACHE_ENTRIES = 100;
const LANGUAGE_CODES = {
  'en-IN': 'en',
  'te-IN': 'te',
  'hi-IN': 'hi',
  'or-IN': 'or',
};
const fallbackHints = {
  en: 'Use browser speech synthesis or read the text.',
  te: 'బ్రౌజర్ వాయిస్ ప్లేబ్యాక్ ఉపయోగించండి లేదా వచనాన్ని చదవండి.',
  hi: 'ब्राउज़र की आवाज़ सुविधा का उपयोग करें या पाठ पढ़ें।',
  or: 'ବ୍ରାଉଜରର ସ୍ୱର ବ୍ୟବହାର କରନ୍ତୁ କିମ୍ବା ଲେଖା ପଢ଼ନ୍ତୁ।',
};

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function audioType(buffer) {
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'audio/webm';
  return null;
}

function wavDuration(buffer) {
  let offset = 12;
  let sampleRate;
  let channels;
  let bitsPerSample;
  let dataLength;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunk === 'fmt ' && size >= 16 && start + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    }
    if (chunk === 'data') {
      dataLength = Math.min(size, buffer.length - start);
      break;
    }
    offset = start + size + (size % 2);
  }
  if (!sampleRate || !channels || !bitsPerSample || !dataLength) return null;
  return dataLength / (sampleRate * channels * (bitsPerSample / 8));
}

function webmDuration(buffer) {
  const durationIndex = buffer.indexOf(Buffer.from([0x44, 0x89]));
  if (durationIndex < 0 || durationIndex + 3 >= buffer.length) return null;
  const sizeByte = buffer[durationIndex + 2];
  const sizeLength = Math.clz32(sizeByte) - 24 + 1;
  if (sizeLength < 1 || sizeLength > 8) return null;
  const size = sizeByte & (0xff >> sizeLength);
  if (size !== 4 && size !== 8) return null;
  const start = durationIndex + 2 + sizeLength;
  if (start + size > buffer.length) return null;
  const duration = size === 8 ? buffer.readDoubleBE(start) : buffer.readFloatBE(start);
  const scaleIndex = buffer.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  let scale = 1000000;
  if (scaleIndex >= 0 && scaleIndex + 4 < buffer.length) {
    const scaleSize = buffer[scaleIndex + 3];
    if (scaleSize >= 0x81 && scaleSize <= 0x84) {
      const integerLength = scaleSize & 0x7f;
      if (scaleIndex + 4 + integerLength <= buffer.length) {
        scale = 0;
        for (let index = 0; index < integerLength; index += 1) {
          scale = (scale * 256) + buffer[scaleIndex + 4 + index];
        }
      }
    }
  }
  const seconds = duration * scale / 1e9;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function validateAudio(file, declaredDuration) {
  if (!file?.buffer?.length) throw httpError(400, 'AUDIO_REQUIRED', 'Choose an audio recording');
  const detectedType = audioType(file.buffer);
  if (!detectedType) throw httpError(422, 'UNSUPPORTED_AUDIO_TYPE', 'Audio must be a valid WebM or WAV recording');
  const declaredType = file.mimetype.split(';')[0];
  if (declaredType !== detectedType && !(detectedType === 'audio/wav' && declaredType === 'audio/x-wav')) {
    throw httpError(422, 'AUDIO_MIME_MISMATCH', 'Audio content does not match its declared type');
  }
  const measuredDuration = detectedType === 'audio/wav' ? wavDuration(file.buffer) : webmDuration(file.buffer);
  const duration = measuredDuration ?? Number(declaredDuration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
    throw httpError(422, 'AUDIO_DURATION_INVALID', 'Audio recording must be no longer than 60 seconds');
  }
  return detectedType;
}

function isMp3(buffer) {
  let offset = 0;
  if (buffer.subarray(0, 3).toString() === 'ID3' && buffer.length >= 10) {
    const tagSize = buffer[6] * 0x200000
      + buffer[7] * 0x4000
      + buffer[8] * 0x80
      + buffer[9];
    offset = 10 + tagSize + ((buffer[5] & 0x10) ? 10 : 0);
  }
  return offset + 1 < buffer.length
    && buffer[offset] === 0xff
    && (buffer[offset + 1] & 0xe0) === 0xe0;
}

async function geminiSpeechToText(file, language, contentType) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw httpError(
      501,
      'SERVER_STT_UNAVAILABLE',
      'Server speech recognition is not configured. Use browser voice dictation if available or type your message.',
    );
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `Transcribe the spoken words exactly in the language identified by this locale: ${language}. Return only the transcript. Do not answer, translate, interpret, or add commentary.`,
            }],
          },
          contents: [{
            role: 'user',
            parts: [
              { text: 'Transcribe this audio recording verbatim.' },
              { inline_data: { mime_type: contentType, data: file.buffer.toString('base64') } },
            ],
          }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0 },
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw httpError(504, 'GEMINI_STT_TIMEOUT', 'Gemini speech recognition timed out');
    }
    throw httpError(502, 'GEMINI_STT_FAILED', 'Gemini speech recognition could not be reached');
  }
  if (!response.ok) {
    const codes = {
      401: 'GEMINI_AUTH_FAILED',
      403: 'GEMINI_AUTH_FAILED',
      404: 'GEMINI_MODEL_UNAVAILABLE',
      429: 'GEMINI_QUOTA_EXCEEDED',
    };
    const code = codes[response.status] || 'GEMINI_STT_FAILED';
    throw httpError(502, code, 'Gemini speech recognition could not complete the request');
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw httpError(502, 'GEMINI_STT_INVALID_RESPONSE', 'Gemini returned invalid speech recognition data');
  }
  const transcript = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('\n')
    .trim();
  if (!transcript) {
    throw httpError(502, 'GEMINI_STT_INVALID_RESPONSE', 'Gemini returned no transcript');
  }
  return { transcript, language };
}

async function speechToText(file, language, declaredDuration) {
  const contentType = validateAudio(file, declaredDuration);
  const endpoint = process.env.SPEECH_TO_TEXT_PROVIDER_URL;
  const token = process.env.SPEECH_TO_TEXT_PROVIDER_TOKEN;
  if (!endpoint || !token) {
    return geminiSpeechToText(file, language, contentType);
  }
  const form = new FormData();
  form.append('audio', new Blob([file.buffer], { type: contentType }), `recording.${contentType === 'audio/wav' ? 'wav' : 'webm'}`);
  form.append('language', language);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw httpError(502, 'SPEECH_PROVIDER_FAILED', `Speech provider returned HTTP ${response.status}`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw httpError(502, 'SPEECH_PROVIDER_INVALID_RESPONSE', 'Speech provider returned invalid JSON');
  }
  if (!result || typeof result.transcript !== 'string' || !result.transcript.trim()) {
    throw httpError(502, 'SPEECH_PROVIDER_INVALID_RESPONSE', 'Speech provider response did not contain a transcript');
  }
  return { transcript: result.transcript.trim(), language };
}

async function fallbackSpeech(language) {
  const code = LANGUAGE_CODES[language];
  return fallbackHints[code];
}

async function textToSpeech(text, language) {
  const hash = createHash('sha256').update(`${language}\0${text}`).digest('hex');
  if (ttsCache.has(hash)) {
    const cached = ttsCache.get(hash);
    ttsCache.delete(hash);
    ttsCache.set(hash, cached);
    return { ...cached, cached: true };
  }
  const endpoint = process.env.TEXT_TO_SPEECH_PROVIDER_URL;
  const token = process.env.TEXT_TO_SPEECH_PROVIDER_TOKEN;
  if (!endpoint || !token) {
    const result = {
      fallback: true,
      voice_language: language,
      hint: await fallbackSpeech(language),
      cache_key: hash,
    };
    ttsCache.set(hash, result);
    while (ttsCache.size > MAX_CACHE_ENTRIES) ttsCache.delete(ttsCache.keys().next().value);
    return result;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw httpError(502, 'TTS_PROVIDER_FAILED', `Speech synthesis provider returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !isMp3(bytes)) {
    throw httpError(502, 'TTS_PROVIDER_INVALID_AUDIO', 'Speech provider returned invalid audio');
  }
  const result = { audio: bytes, cache_key: hash };
  ttsCache.set(hash, result);
  while (ttsCache.size > MAX_CACHE_ENTRIES) ttsCache.delete(ttsCache.keys().next().value);
  return { ...result, cached: false };
}

module.exports = {
  speechToText,
  textToSpeech,
  validateAudio,
  wavDuration,
  webmDuration,
  isMp3,
  geminiSpeechToText,
};
