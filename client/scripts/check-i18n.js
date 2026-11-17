import { createServer } from 'vite';

const languages = ['en', 'te', 'hi', 'or'];

function flatten(value, prefix = '', result = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, result));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key, result);
    }
  } else if (prefix) {
    result.set(prefix, value);
  }
  return result;
}

const untranslatedAllowlist = new Set(['brandName', 'phase9.channelSms', 'phase11.sms']);

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'silent',
});
let resources;
try {
  ({ resources } = await server.ssrLoadModule('/src/i18n/index.js'));
} finally {
  await server.close();
}
const keySets = Object.fromEntries(languages.map((language) => [
  language,
  flatten(resources[language]?.translation),
]));
const reference = keySets.en;
const missing = [];

for (const language of languages.slice(1)) {
  for (const [key, englishValue] of reference) {
    if (!keySets[language].has(key)) missing.push(`${language}: missing ${key}`);
    else if (
      typeof englishValue === 'string'
      && englishValue.trim()
      && keySets[language].get(key) === englishValue
      && !untranslatedAllowlist.has(key)
    ) {
      missing.push(`${language}: untranslated ${key}`);
    }
  }
  for (const key of keySets[language].keys()) {
    if (!reference.has(key)) missing.push(`${language}: extra ${key}`);
  }
}

if (missing.length) {
  console.error(`i18n coverage mismatch:\n${missing.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`i18n coverage matches across ${languages.join(', ')} (${reference.size} keys).`);
}
