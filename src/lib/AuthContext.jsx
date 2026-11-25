import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';
import { resolveCrmRole } from '@/lib/agentPermissions';
import { AGENT_FEATURES_ENABLED } from '@/lib/agentFeatureFlags';

// Disabled by default until trusted DB migrations and regression tests pass.
const AGENT_ACCESS_ENABLED = AGENT_FEATURES_ENABLED;

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isStaff, setIsStaff] = useState(null);
  const [crmRole, setCrmRole] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  // Supabase can emit SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT while an
  // earlier profile lookup is unresolved. Ignore every obsolete result.
  const authRevision = useRef(0);

  const resolveSession = async (session) => {
    const revision = ++authRevision.current;
    const u = session?.user ?? null;
    // Never render old manager/agent pages while a new session is resolving.
    setIsLoadingAuth(true);
    setIsStaff(null);
    setCrmRole(null);
    setUser(formatUser(u));
    setIsAuthenticated(!!u);

    const applyRole = (role) => {
      if (revision !== authRevision.current) return;
      setCrmRole(role);
      setIsStaff(!!role);
      setIsLoadingAuth(false);
    };
    if (!u) {
      applyRole(null);
      return;
    }
    try {
      const STAFF_EMAILS = ['xxdadon25@gmail.com'];
      if (STAFF_EMAILS.includes(u.email)) {
        applyRole('manager');
        return;
      }

      const { data: staffRecord, error: staffError } = await supabase
        .from('staff_members')
        .select('id')
        .eq('auth_user_id', u.id)
        .maybeSingle();
      if (revision !== authRevision.current) return;
      let role = resolveCrmRole({ verifiedManager: !staffError && !!staffRecord });
      // Preview-only, fail-closed onboarding: the invited user can open the
      // empty CRM shell, never legacy manager pages or agent data screens.
      // This is NOT an authorization grant. Server-side RLS remains mandatory.
      if (!role && u.email?.toLowerCase() === 'a.d.shivuk555@gmail.com') {
        applyRole('agent_pending');
        return;
      }
      if (!role && AGENT_ACCESS_ENABLED) {
        const { data: agentProfile, error: agentError } = await supabase
          .from('sales_agent_profiles')
          .select('auth_user_id')
          .eq('auth_user_id', u.id)
          .eq('is_active', true)
          .maybeSingle();
        if (revision !== authRevision.current) return;
        role = resolveCrmRole({ activeAgent: !agentError && !!agentProfile });
      }
      applyRole(role);
    } catch {
      // Database/network failures must never preserve prior privileges.
      applyRole(null);
    }
  };

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on mount — no separate getSession() needed
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveSession(session);
    });

    return () => { authRevision.current += 1; subscription.unsubscribe(); };
  }, []);

  const logout = async (shouldRedirect = true) => {
    authRevision.current += 1;
    setIsLoadingAuth(true);
    setIsStaff(null);
    setCrmRole(null);
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setIsStaff(false);
    setCrmRole(null);
    setIsLoadingAuth(false);
    if (shouldRedirect) window.location.href = '/login';
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isStaff,
      crmRole,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: {},
      authChecked: !isLoadingAuth,
      logout,
      navigateToLogin,
      checkUserAuth: () => {},
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

function formatUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
    role: user.user_metadata?.role || 'user',
  };
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
