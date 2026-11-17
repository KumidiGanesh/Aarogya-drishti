import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { roleDashboardPath } from '../auth/roles.js';

export default function RoleRoute({ roles, permissions }) {
  const { user } = useAuth();
  if (!user) return <Navigate replace to="/login" />;
  if (!roles.includes(user.role)) {
    return <Navigate replace to={roleDashboardPath[user.role] || '/login'} />;
  }
  if (
    permissions?.length
    && !permissions.some((permission) => user.permissions?.includes(permission))
  ) {
    return <Navigate replace to={roleDashboardPath[user.role] || '/login'} />;
  }
  return <Outlet />;
}
