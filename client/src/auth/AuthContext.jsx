import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api.js';
import { clearAccessToken, setAccessToken } from '../services/tokenStore.js';
import i18n, { supportedLanguages } from '../i18n.js';

const AuthContext = createContext(null);
const OFFLINE_USER_KEY = 'aarogya-offline-user';
let refreshRequest;

function refreshSession() {
  refreshRequest ??= api.post('/auth/refresh-token', {}).finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}

function readOfflineUser() {
  try {
    const user = JSON.parse(localStorage.getItem(OFFLINE_USER_KEY) || 'null');
    return user?.role === 'health_worker'
      ? {
          id: user.id,
          full_name: user.full_name,
          role: 'health_worker',
          preferred_language: user.preferred_language || 'en',
        }
      : null;
  } catch {
    localStorage.removeItem(OFFLINE_USER_KEY);
    return null;
  }
}

function persistOfflineUser(user) {
  if (user?.role === 'health_worker') {
    localStorage.setItem(
      OFFLINE_USER_KEY,
      JSON.stringify({
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        preferred_language: user.preferred_language,
      }),
    );
  } else {
    localStorage.removeItem(OFFLINE_USER_KEY);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await refreshSession();
    const account = data.data.user;
    const storedLanguage = localStorage.getItem('aarogya-language');
    const language = supportedLanguages.includes(storedLanguage)
      ? storedLanguage
      : supportedLanguages.includes(account.preferred_language) ? account.preferred_language : 'en';
    await i18n.changeLanguage(language);
    setAccessToken(data.data.accessToken);
    setUser(account);
    persistOfflineUser(account);
    return account;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (user) await api.post(user.role === 'patient' ? '/patient/logout' : '/auth/logout');
    } finally {
      clearAccessToken();
      localStorage.removeItem(OFFLINE_USER_KEY);
      setUser(null);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    const expireSession = () => {
      clearAccessToken();
      if (!navigator.onLine) {
        setUser(readOfflineUser());
      } else {
        localStorage.removeItem(OFFLINE_USER_KEY);
        setUser(null);
      }
    };
    const online = () => {
      refresh().catch(() => {
        if (active && !navigator.onLine) setUser(readOfflineUser());
      });
    };
    window.addEventListener('aarogya:auth-expired', expireSession);
    window.addEventListener('online', online);
    if (!navigator.onLine) {
      clearAccessToken();
      setUser(readOfflineUser());
      setLoading(false);
    } else {
      refresh()
        .catch(() => {
          clearAccessToken();
          if (active) setUser(navigator.onLine ? null : readOfflineUser());
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      window.removeEventListener('aarogya:auth-expired', expireSession);
      window.removeEventListener('online', online);
    };
  }, [refresh]);

  const acceptSession = useCallback(async (session) => {
    setAccessToken(session.accessToken);
    let signedInUser = session.user;
    const storedLanguage = localStorage.getItem('aarogya-language');
    const language = supportedLanguages.includes(storedLanguage)
      ? storedLanguage
      : supportedLanguages.includes(signedInUser.preferred_language) ? signedInUser.preferred_language : 'en';
    await i18n.changeLanguage(language);
    if (
      !signedInUser.must_change_password
      && storedLanguage
      && supportedLanguages.includes(storedLanguage)
      && signedInUser.preferred_language
      && storedLanguage !== signedInUser.preferred_language
    ) {
      try {
        await api.put('/languages/preference', { language_code: storedLanguage });
        signedInUser = { ...signedInUser, preferred_language: storedLanguage };
      } catch (error) {
        clearAccessToken();
        throw error;
      }
    }
    setUser(signedInUser);
    persistOfflineUser(signedInUser);
    return signedInUser;
  }, []);

  const login = useCallback(async (identifier, password, loginType) => {
    const { data } = await api.post('/auth/login', {
      identifier,
      password,
      ...(loginType ? { login_type: loginType } : {}),
    });
    return acceptSession(data.data);
  }, [acceptSession]);

  const loginPatient = useCallback(async (mobile, password) => {
    const { data } = await api.post('/patient/login', { mobile, password });
    return acceptSession(data.data);
  }, [acceptSession]);

  const loginWithOtp = useCallback(async (challengeId, code) => {
    const { data } = await api.post('/auth/verify-otp', {
      challenge_id: challengeId,
      code,
    });
    return acceptSession(data.data);
  }, [acceptSession]);

  const completeRegistration = useCallback(acceptSession, [acceptSession]);

  const register = useCallback(async (fields) => {
    const { data } = await api.post('/auth/register', fields);
    return data.data.user;
  }, []);

  const changePassword = useCallback(async (new_password, confirm) => {
    await api.put('/auth/change-password', { new_password, confirm });
    setUser((current) => current && { ...current, must_change_password: false });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      loginPatient,
      loginWithOtp,
      completeRegistration,
      register,
      logout,
      refresh,
      changePassword,
    }),
    [user, loading, login, loginPatient, loginWithOtp, completeRegistration, register, logout, refresh, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
