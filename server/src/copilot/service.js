const geminiChat = require('../adapters/geminiChat');

async function answer({ text, language, history }) {
  const response = await geminiChat.chat({
    text,
    source_lang: language,
    history,
    domain: 'general-health',
  });
  return {
    answer: response,
    disclaimer: geminiChat.CHATBOT_NOTICE,
    source: 'gemini',
  };
}

function health() {
  return { configured: Boolean(process.env.GEMINI_API_KEY) };
}

module.exports = { answer, health };
