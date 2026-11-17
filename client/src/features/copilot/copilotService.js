import api from '../../services/api.js';

export async function getCopilotHealth() {
  const { data } = await api.get('/copilot/health', { timeout: 5000 });
  return data.data;
}

export async function askCopilot({ text, language, history }) {
  const { data } = await api.post('/copilot/chat', {
    text,
    language,
    history,
  });
  return data.data;
}
