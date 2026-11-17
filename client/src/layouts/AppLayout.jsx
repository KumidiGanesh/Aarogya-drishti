import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, AudioLines, Bell, CalendarDays, ChartNoAxesCombined, ClipboardCheck, FileBarChart2, HeartPulse, LayoutDashboard, LogOut, Menu, Search, Settings, Share2, Stethoscope, UserRound, UserRoundSearch, Users, Video, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';
import Select from '../components/ui/Select.jsx';
import { sidebarMenu } from './sidebarMenu.js';
import useOfflineSync from '../offline/useOfflineSync.js';
import { useToast } from '../components/ui/Toast.jsx';
import api from '../services/api.js';
import VoiceGuidanceToggle from '../components/VoiceGuidanceToggle.jsx';

const doctorNavigation = [
  { key: 'dashboard', to: '/doctor', Icon: LayoutDashboard, end: true },
  { key: 'profile', to: '/settings', Icon: UserRound },
  { key: 'patients', to: '/patients', Icon: UserRoundSearch },
  { key: 'appointments', to: '/appointments', Icon: CalendarDays },
  { key: 'reports', to: '/screenings', Icon: ClipboardCheck },
  { key: 'consultations', to: '/consultations', Icon: Video },
  { key: 'referrals', to: '/referrals', Icon: Share2 },
  { key: 'notifications', to: '/notifications', Icon: Bell },
  { key: 'analytics', to: '/analytics', Icon: Activity },
  { key: 'settings', to: '/settings', Icon: Settings },
];

const adminNavigation = [
  { key: 'dashboard', path: () => '/admin', icon: LayoutDashboard, end: true },
  { key: 'admin.navPatients', path: () => '/admin/patients', icon: UserRoundSearch, permission: 'patients:read' },
  { key: 'admin.navDoctors', path: () => '/admin/doctors', icon: Stethoscope, permission: 'users:read' },
  { key: 'admin.navReports', path: () => '/admin/reports', icon: FileBarChart2, permission: 'reports:read' },
  { key: 'admin.userManagement', path: () => '/admin/users', icon: Users, permission: 'users:read' },
  { key: 'phase11.analyticsTitle', path: () => '/analytics', icon: ChartNoAxesCombined, permission: 'reports:read' },
  { key: 'phase11.notificationsTitle', path: () => '/notifications', icon: Bell, permission: 'notifications:read' },
  { key: 'phase11.settingsTitle', path: () => '/settings', icon: Settings, permission: 'settings:read' },
  { key: 'admin.helpSupport', path: () => '/voice-support', icon: AudioLines, permission: 'voice:use' },
  { key: 'phase8.appointmentsTitle', path: () => '/appointments', icon: CalendarDays, permission: 'appointments:read' },
  { key: 'phase11.consultationsTitle', path: () => '/consultations', icon: Video, permission: 'consultations:read' },
  { key: 'phase8.referralsTitle', path: () => '/referrals', icon: Share2, permission: 'referrals:read' },
  { key: 'phase10.assistantTitle', path: () => '/language-assistant', icon: ClipboardCheck, permission: 'languages:use' },
  { key: 'admin.activityMonitor', path: () => '/admin/audit-logs', icon: Activity, permission: 'users:read' },
];

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const doctorMode = user.role === 'doctor';
  const adminMode = user.role === 'admin';
  const adminWorkspaceMode = ['admin', 'super_admin'].includes(user.role);
  const location = useLocation();
  const patientSidebarMode = user.role === 'patient';
  const patientDashboardMode = patientSidebarMode
    && ['/patient', '/patient/dashboard'].includes(location.pathname);
  const { notify } = useToast();
  useOfflineSync(user.role === 'health_worker');
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationLoadFailed, setNotificationLoadFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceSearchType, setWorkspaceSearchType] = useState('patients');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let active = true;
    const loadNotifications = async () => {
      try {
        const { data } = await api.get('/notifications', { params: { page: 1, limit: 1 } });
        if (active) {
          setUnreadNotifications(data.data.unread_count);
          setNotificationLoadFailed(false);
        }
      } catch {
        if (active) setNotificationLoadFailed(true);
      }
    };
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const changeLanguage = async (event) => {
    const language = event.target.value;
    await i18n.changeLanguage(language);
    try {
      await api.put('/languages/preference', { language_code: language });
    } catch {
      notify(t('phase10.languageSaveFailed'), 'error');
    }
  };
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={`app-shell${doctorMode ? ' app-shell--doctor' : ''}${adminWorkspaceMode ? ' app-shell--admin' : ''}${patientSidebarMode ? ' app-shell--patient-sidebar' : ''}${patientDashboardMode ? ' app-shell--patient-dashboard' : ''}`}>
      {sidebarOpen && (
        <button
          aria-label={t('close')}
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {doctorMode ? (
        <aside className={`doctor-sidebar${sidebarOpen ? ' doctor-sidebar--open' : ''}`}>
          <NavLink className="doctor-sidebar__brand" to="/doctor" onClick={() => setSidebarOpen(false)}>
            <span className="doctor-sidebar__mark"><HeartPulse size={25} /></span>
            <span><strong>Aarogya Drishti</strong><small>{t('brandTagline')}</small></span>
          </NavLink>
          <p className="doctor-sidebar__caption">{t('doctorNavigation.workspace')}</p>
          <nav aria-label={t('doctorNavigation.workspace')} className="doctor-sidebar__nav">
            {doctorNavigation.map(({ key, to, Icon, end }) => (
              <NavLink key={`${key}-${to}`} end={end} to={to} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `doctor-sidebar__link${isActive ? ' is-active' : ''}`}>
                <Icon aria-hidden="true" size={19} strokeWidth={2} /><span>{t(`doctorNavigation.${key}`)}</span>
              </NavLink>
            ))}
          </nav>
          <div className="doctor-sidebar__footer">
            <div className="doctor-sidebar__care"><HeartPulse size={22} /><span>{t('doctorNavigation.careTagline')}</span></div>
            <button className="doctor-sidebar__logout" onClick={handleLogout} type="button"><LogOut size={18} /><span>{t('doctorNavigation.logout')}</span></button>
          </div>
        </aside>
      ) : <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}${patientSidebarMode ? ' sidebar--patient' : ''}`}>
        <div className="brand">
          <span aria-hidden="true" className="brand__mark">
            <HeartPulse size={25} strokeWidth={2.2} />
          </span>
          <div>
            <strong>{t('brandName')}</strong>
            <span>{t('workspace')}</span>
            <span className="brand__tagline">{t('brandTagline')}</span>
          </div>
          <button
            aria-label={t('close')}
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label={t('workspace')} className={`sidebar__nav${adminMode ? ' admin-sidebar__nav' : ''}`}>
          <span className="sidebar__section">{t('overview')}</span>
          {(adminMode
            ? adminNavigation.filter((item) => !item.permission || user.permissions?.includes(item.permission))
            : sidebarMenu
              .filter((item) => (
                item.roles.includes(user.role)
                && item.key !== 'dashboard'
                && (!item.permissions || item.permissions.some((permission) => user.permissions?.includes(permission)))
              )))
            .map(({ key, path, icon: Icon, end }) => (
              <NavLink
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
                end={end}
                key={key}
                aria-label={patientSidebarMode ? t(key) : undefined}
                onClick={() => setSidebarOpen(false)}
                to={adminMode ? path() : path(roleDashboardPath[user.role])}
              >
                {patientSidebarMode
                  ? <span className="nav-link__icon"><Icon aria-hidden="true" size={19} /></span>
                  : <Icon aria-hidden="true" size={19} />}
                <span>{t(key)}</span>
                {patientSidebarMode && key === 'phase11.notificationsTitle' && unreadNotifications > 0 && (
                  <span aria-label={`${unreadNotifications} unread notifications`} className="nav-link__badge">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </NavLink>
            ))}
          {!adminMode && <NavLink
            className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
            end
            aria-label={patientSidebarMode ? t('dashboard') : undefined}
            onClick={() => setSidebarOpen(false)}
            to={roleDashboardPath[user.role]}
          >
            {patientSidebarMode
              ? <span className="nav-link__icon"><LayoutDashboard aria-hidden="true" size={19} /></span>
              : <LayoutDashboard aria-hidden="true" size={19} />}
            <span>{t('dashboard')}</span>
          </NavLink>}
        </nav>
        <div className="sidebar__priority">
          <HeartPulse aria-hidden="true" size={22} />
          <span>{t('workspaceCareTagline')}</span>
        </div>
        <div className="sidebar__account">
          {patientSidebarMode ? (
            <div className="sidebar__profile">
              <div>
                <span className="sidebar__section">{t('profile')}</span>
                <span className="sidebar__account-name">{user.full_name}</span>
                <span className="sidebar__account-role">{t(`roles.${user.role}`)}</span>
              </div>
              <span aria-hidden="true" className="sidebar__avatar">
                {user.full_name?.trim().charAt(0).toUpperCase() || 'P'}
              </span>
            </div>
          ) : (
            <>
              <span className="sidebar__section">{t('profile')}</span>
              <span className="sidebar__account-name">{user.full_name}</span>
              <span className="sidebar__account-role">{t(`roles.${user.role}`)}</span>
            </>
          )}
          <button className="logout-button" onClick={handleLogout} type="button">
            <LogOut aria-hidden="true" size={18} />
            {t(adminMode ? 'admin.sidebarLogout' : 'auth.logout')}
          </button>
        </div>
      </aside>}

      <div className="app-main">
        <header className="topbar">
          <button
            aria-label={t('menu')}
            className={`icon-button mobile-menu${doctorMode ? ' doctor-menu-button' : ''}`}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          {doctorMode ? <form className="topbar__search doctor-topbar-search" onSubmit={(event) => { event.preventDefault(); const query = workspaceSearch.trim(); const basePath = workspaceSearchType === 'reports' ? '/screenings' : '/patients'; navigate(query ? `${basePath}?search=${encodeURIComponent(query)}` : basePath); setSidebarOpen(false); }}>
            <Search aria-hidden="true" size={18} /><select aria-label={t('doctorDashboard.searchCategory')} onChange={(event) => setWorkspaceSearchType(event.target.value)} value={workspaceSearchType}><option value="patients">{t('doctorNavigation.patients')}</option><option value="reports">{t('doctorNavigation.reports')}</option></select><input aria-label={`${t('doctorNavigation.patients')} / ${t('doctorNavigation.reports')}`} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder={t(workspaceSearchType === 'reports' ? 'doctorDashboard.searchReports' : 'doctorDashboard.searchPatients')} value={workspaceSearch} /><button aria-label={t('doctorDashboard.searchButton')} type="submit"><ArrowRight size={16} /></button>
          </form> : adminWorkspaceMode ? <form className="topbar__search admin-topbar-search" onSubmit={(event) => { event.preventDefault(); const query = workspaceSearch.trim(); const usersPath = `${roleDashboardPath[user.role]}/users`; navigate(query ? `${usersPath}?search=${encodeURIComponent(query)}` : usersPath); setSidebarOpen(false); }}>
            <Search aria-hidden="true" size={18} /><input aria-label={t('admin.searchUsers')} onChange={(event) => setWorkspaceSearch(event.target.value)} placeholder={t('admin.searchUsers')} value={workspaceSearch} /><button aria-label={t('search')} type="submit"><ArrowRight aria-hidden="true" size={17} /></button>
          </form> : <div aria-hidden="true" className="topbar__search"><Search aria-hidden="true" size={18} /><span>{t('search')}</span></div>}
          <div className="topbar__brand">
            <span aria-hidden="true" className="topbar__brand-mark"><HeartPulse size={22} /></span>
            <span>
              <strong>{t('appName')}</strong>
              <small>{t('brandTagline')}</small>
            </span>
          </div>
          <div className="topbar__actions">
            <VoiceGuidanceToggle />
            {user.role === 'health_worker' && (
              <span className={`network-status ${online ? 'network-status--online' : ''}`}>
                <span aria-hidden="true" />
                {t(online ? 'patient.networkBadgeOnline' : 'patient.networkBadgeOffline')}
              </span>
            )}
            <label className="sr-only" htmlFor="language-select">
              {t('language')}
            </label>
            <select
              aria-label={t('language')}
              className="language-select"
              id="language-select"
              onChange={changeLanguage}
              value={i18n.language}
            >
              <option value="en">{t('languages.en')}</option>
              <option value="te">{t('languages.te')}</option>
              <option value="hi">{t('languages.hi')}</option>
              <option value="or">{t('languages.or')}</option>
            </select>
            <div className="notification-wrap">
              <button
                aria-label={`${t('notifications')}${notificationLoadFailed ? ` · ${t('phase11.settingsError')}` : ''}`}
                className="icon-button notification-button"
                onClick={() => navigate('/notifications')}
                type="button"
              >
                <Bell size={20} />
                {unreadNotifications > 0 && <span className="notification-badge">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
              </button>
            </div>
            <div className="profile-menu">
              <button
                aria-expanded={profileOpen}
                aria-label={t('profile')}
                className="profile-button"
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="profile-avatar">{user.full_name.slice(0, 1)}</span>
                <span className="profile-name">{user.full_name}</span>
              </button>
              {profileOpen && (
                <div className="profile-popover" role="menu">
                  <span>{t('profile')}</span>
                  <strong>{t(`roles.${user.role}`)}</strong>
                  <button
                    className="logout-button"
                    onClick={handleLogout}
                    role="menuitem"
                    type="button"
                  >
                    <LogOut aria-hidden="true" size={18} />
                    {t('auth.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
