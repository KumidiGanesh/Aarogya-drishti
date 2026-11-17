import axios from 'axios';
import i18n from '../i18n.js';
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore.js';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api',
  timeout: 15000,
  withCredentials: true,
});
const refreshClient = axios.create({ timeout: 15000, withCredentials: true });
let refreshRequest;

api.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  config.headers['Accept-Language'] = i18n.language;
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    localizeServerError(error);
    if (
      error.response?.status !== 401
      || !originalRequest
      || originalRequest._retry
      || ['/auth/login', '/auth/register', '/auth/refresh-token']
        .some((path) => originalRequest.url?.includes(path))
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    refreshRequest ??= refreshClient
      .post(`${api.defaults.baseURL}/auth/refresh-token`, {})
      .then(({ data }) => {
        if (!data.success || !data.data?.accessToken) {
          throw new Error('Refresh response did not contain an access token');
        }
        setAccessToken(data.data.accessToken);
        return data.data.accessToken;
      })
      .catch((refreshError) => {
        clearAccessToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('aarogya:auth-expired'));
        }
        throw refreshError;
      })
      .finally(() => {
        refreshRequest = undefined;
      });

    const accessToken = await refreshRequest;
    originalRequest.headers.Authorization = `Bearer ${accessToken}`;
    return api(originalRequest);
  },
);

export default api;

function localizeServerError(error) {
  const responseData = error.response?.data;
  if (!responseData?.code) return;
  const translated = i18n.t(`phase10.serverErrors.${responseData.code}`, { defaultValue: '' });
  if (translated) responseData.message = translated;
}
