const gemini = require('./geminiScreening');
const { normalizeProviderResult } = require('./oralVisionContract');

const providers = new Map([['gemini', gemini]]);

// A provider may be registered by a separately deployed, validated model adapter.
// Registration does not imply clinical validation; adapters must report their own metadata.
function registerProvider(name, provider) {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(key) || !provider || typeof provider.analyze !== 'function') {
    throw new TypeError('A provider name and analyze(input) implementation are required');
  }
  providers.set(key, provider);
}

// Stable provider boundary: a future validated model can implement the same analyze(images) contract.
function getProvider() {
  const provider = (process.env.ORAL_SCREENING_MODEL_PROVIDER || 'gemini').trim().toLowerCase();
  if (providers.has(provider)) return providers.get(provider);
  const error = new Error('The configured oral screening model provider is unavailable');
  error.status = 503;
  error.code = 'SCREENING_MODEL_UNAVAILABLE';
  throw error;
}

function isConfigured() {
  const provider = (process.env.ORAL_SCREENING_MODEL_PROVIDER || 'gemini').trim().toLowerCase();
  const adapter = providers.get(provider);
  if (!adapter) return false;
  if (provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY?.trim());
  return typeof adapter.isConfigured !== 'function' || adapter.isConfigured();
}

async function analyze(input) {
  const name = (process.env.ORAL_SCREENING_MODEL_PROVIDER || 'gemini').trim().toLowerCase();
  return normalizeProviderResult(await getProvider().analyze(input), name);
}

module.exports = { analyze, getProvider, isConfigured, registerProvider, providers };
