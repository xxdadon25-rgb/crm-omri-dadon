import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { resolveCrmRole } from '@/lib/agentPermissions';

// Disabled until trusted RLS and order RPC guards are deployed and tested.
const AGENT_ACCESS_ENABLED = false;

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isStaff, setIsStaff] = useState(null);
  const [crmRole, setCrmRole] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const resolveSession = async (session) => {
    const u = session?.user ?? null;
    setUser(formatUser(u));
    setIsAuthenticated(!!u);
    setCrmRole(null);
    if (u) {
      const STAFF_EMAILS = ['xxdadon25@gmail.com', 'a.d.shivuk555@gmail.com'];
      if (STAFF_EMAILS.includes(u.email)) {
        setCrmRole('manager');
        setIsStaff(true);
        setIsLoadingAuth(false);
        return;
      }

      const { data: staffRecord, error: staffError } = await supabase
        .from('staff_members')
        .select('id')
        .eq('auth_user_id', u.id)
        .maybeSingle();
      let role = resolveCrmRole({ verifiedManager: !staffError && !!staffRecord });
      if (!role && AGENT_ACCESS_ENABLED) {
        const { data: agentProfile, error: agentError } = await supabase
          .from('sales_agent_profiles')
          .select('auth_user_id')
          .eq('auth_user_id', u.id)
          .eq('is_active', true)
          .maybeSingle();
        role = resolveCrmRole({ activeAgent: !agentError && !!agentProfile });
      }
      setCrmRole(role);
      setIsStaff(!!role);
    } else {
      setCrmRole(null);
      setIsStaff(false);
    }
    setIsLoadingAuth(false);
  };

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on mount — no separate getSession() needed
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    setIsStaff(null);
    setCrmRole(null);
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
