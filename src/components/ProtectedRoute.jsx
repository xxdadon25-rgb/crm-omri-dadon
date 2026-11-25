import { useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { canAccessCrmRoute } from '@/lib/agentPermissions';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { isAuthenticated, isStaff, crmRole, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked || isStaff === null) {
    return fallback;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  if (!isStaff) {
    return <Navigate to="/portal/login" replace />;
  }

  if (!canAccessCrmRoute(crmRole, location.pathname)) return <Navigate to={crmRole === "agent_pending" ? "/agent-setup" : crmRole === "agent" ? "/agent-dashboard" : "/"} replace />;
  return <Outlet />;
}
