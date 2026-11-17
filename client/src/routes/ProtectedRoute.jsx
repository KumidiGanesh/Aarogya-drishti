import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Loading from '../components/ui/Loading.jsx';
import { roleDashboardPath } from '../auth/roles.js';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!user || !['doctor', 'admin', 'super_admin', 'patient'].includes(user.role)) {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate replace to="/change-password" />;
  }
  if (!user.must_change_password && location.pathname === '/change-password') {
    return <Navigate replace to={roleDashboardPath[user.role] || '/login'} />;
  }
  return <Outlet />;
}

export function AuthenticatedRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? (
    <Navigate
      replace
      to={user.must_change_password ? '/change-password' : roleDashboardPath[user.role] || '/login'}
    />
  ) : (
    <Navigate replace to="/login" />
  );
}
