import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isStaff, setIsStaff] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const resolveSession = async (session) => {
    const u = session?.user ?? null;
    setUser(formatUser(u));
    setIsAuthenticated(!!u);
    if (u) {
      // THE OWNER ONLY. An address here is granted staff in the browser with no
      // server check, so it must never hold an account that is meant to be
      // limited: the bypass returns before the staff_members lookup runs.
      const STAFF_EMAILS = ['xxdadon25@gmail.com'];
      if (STAFF_EMAILS.includes(u.email)) {
        setIsStaff(true);
        setIsLoadingAuth(false);
        return;
      }

      const { data } = await supabase
        .from('staff_members')
        .select('id')
        .eq('auth_user_id', u.id)
        .maybeSingle();
      setIsStaff(!!data);
    } else {
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
