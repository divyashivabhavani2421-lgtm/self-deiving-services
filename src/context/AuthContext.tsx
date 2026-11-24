import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  CustomerProfile,
  ensureCustomerProfile,
  isAdminRoleValue,
} from '../services/profileService';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: CustomerProfile | null;
  loading: boolean;
  profileLoading: boolean;
  profileError: string | null;
  isAdmin: boolean;
  isRecoveryMode: boolean;
  authNotice: string | null;
  authError: string | null;
  clearAuthNotices: () => void;
  clearRecoveryMode: () => void;
  refreshProfile: (overrideUser?: User | null) => Promise<CustomerProfile | null>;
  setProfileState: (next: CustomerProfile | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isRecoveryMode, setIsRecoveryMode] = useState<boolean>(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthNotices = useCallback(() => {
    setAuthNotice(null);
    setAuthError(null);
  }, []);

  const clearRecoveryMode = useCallback(() => {
    setIsRecoveryMode(false);
  }, []);

  const loadProfileForUser = useCallback(
    async (activeUser: User | null): Promise<CustomerProfile | null> => {
      if (!activeUser) {
        setProfile(null);
        setProfileError(null);
        return null;
      }
      setProfileLoading(true);
      setProfileError(null);
      try {
        const result = await ensureCustomerProfile(activeUser);
        setProfile(result.profile);
        setProfileError(result.error);
        return result.profile;
      } finally {
        setProfileLoading(false);
      }
    },
    []
  );

  const refreshProfile = useCallback(
    async (overrideUser?: User | null): Promise<CustomerProfile | null> => {
      if (overrideUser) {
        return loadProfileForUser(overrideUser);
      }
      if (user) {
        return loadProfileForUser(user);
      }
      if (!supabase) return null;
      const { data } = await supabase.auth.getUser();
      if (!data.user) return null;
      return loadProfileForUser(data.user);
    },
    [user, loadProfileForUser]
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const client = supabase;

    async function initializeAuth() {
      try {
        // Surface any OAuth / email link error returned in URL hash or query params
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const urlError =
          searchParams.get('error_description') ||
          hashParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error');

        if (urlError && mounted) {
          setAuthError(decodeURIComponent(urlError.replace(/\+/g, ' ')));
        }

        const linkType = searchParams.get('type') || hashParams.get('type');
        if (linkType === 'recovery' && mounted) {
          setIsRecoveryMode(true);
        }

        // Handle PKCE auth code if present in URL
        const code = searchParams.get('code');
        if (code) {
          const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
          if (exchangeError && mounted) {
            setAuthError(exchangeError.message || 'Verification or recovery link has expired.');
          } else if (mounted && linkType !== 'recovery') {
            setAuthNotice('Your email has been verified and your session is active.');
          }
          // Clean sensitive code params from URL bar without reload
          window.history.replaceState({}, document.title, window.location.pathname);
        }

        const {
          data: { session: currentSession },
          error: sessionError,
        } = await client.auth.getSession();

        if (sessionError && mounted) {
          setAuthError('Your session expired. Please sign in again.');
          setSession(null);
          setUser(null);
          setProfile(null);
          return;
        }

        if (currentSession) {
          // Verify session token is still valid server-side
          const { data: userData, error: userError } = await client.auth.getUser();
          if (userError || !userData.user) {
            await client.auth.signOut();
            if (mounted) {
              setSession(null);
              setUser(null);
              setProfile(null);
              setAuthError('Your session has expired. Please sign in again.');
            }
            return;
          }

          if (mounted) {
            setSession(currentSession);
            setUser(userData.user);
          }
          await loadProfileForUser(userData.user);
        } else if (mounted) {
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void initializeAuth();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;

      if (event === 'INITIAL_SESSION') {
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }

      if (event === 'SIGNED_OUT') {
        setIsRecoveryMode(false);
        setSession(null);
        setUser(null);
        setProfile(null);
        setProfileError(null);
        return;
      }

      setSession(nextSession);
      const nextUser = nextSession?.user ?? null;
      setUser(nextUser);

      if (nextUser) {
        void loadProfileForUser(nextUser);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfileForUser]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileError(null);
    setIsRecoveryMode(false);
  }, []);

  const isAdmin = Boolean(user && isAdminRoleValue(profile?.role));

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        profileLoading,
        profileError,
        isAdmin,
        isRecoveryMode,
        authNotice,
        authError,
        clearAuthNotices,
        clearRecoveryMode,
        refreshProfile,
        setProfileState: setProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
