import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { BUSINESS_CONFIG } from '../../config/businessConfig';
import { useAuth } from '../../context/AuthContext';
import {
  getRememberSessionPreference,
  isSupabaseConfigured,
  setRememberSessionPreference,
  supabase,
} from '../../lib/supabase';
import { verifyAdminRole, verifyCurrentSessionAdminRole } from '../../services/profileService';

interface AdminLoginLocationState {
  from?: string;
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as AdminLoginLocationState | null) ?? null;

  const { user, loading: authLoading, refreshProfile } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState<boolean>(getRememberSessionPreference);
  const [submitting, setSubmitting] = useState(false);
  const [checkingExistingSession, setCheckingExistingSession] = useState(false);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const targetAdminPath =
    state?.from && state.from.startsWith('/admin') && state.from !== '/admin/login'
      ? state.from
      : '/admin';

  useEffect(() => {
    let active = true;

    const handleExistingSession = async () => {
      if (authLoading || submitting) return;
      if (!user) {
        setCheckedUserId(null);
        setCheckingExistingSession(false);
        return;
      }

      setCheckingExistingSession(true);
      try {
        const check = await verifyCurrentSessionAdminRole();
        if (!active) return;

        if (!check.authenticated || !check.user) {
          setCheckedUserId(user.id);
          return;
        }

        if (check.isAdmin) {
          await refreshProfile(check.user);
          if (active) {
            navigate(targetAdminPath, { replace: true });
          }
          return;
        }

        if (!check.error) {
          // Authenticated non-admin customers are redirected back to the customer website
          navigate('/', { replace: true });
        } else {
          setCheckedUserId(user.id);
          setError(check.error);
        }
      } finally {
        if (active) {
          setCheckingExistingSession(false);
        }
      }
    };

    void handleExistingSession();

    return () => {
      active = false;
    };
  }, [authLoading, submitting, user, refreshProfile, navigate, targetAdminPath]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedEmail = email.trim().toLowerCase();

    if (!emailPattern.test(trimmedEmail)) {
      setError('Please enter a valid administrator email address.');
      return;
    }
    if (!password) {
      setError('Please enter your administrator password.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setError(
        'Supabase is not configured yet. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
      );
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      setRememberSessionPreference(rememberSession);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      const signedInUser = data.user;
      if (!signedInUser) {
        setError('Authentication did not return a user session. Please try again.');
        return;
      }

      const roleCheck = await verifyAdminRole(signedInUser.id);

      if (roleCheck.error) {
        await supabase.auth.signOut();
        setError(roleCheck.error);
        return;
      }

      if (!roleCheck.isAdmin) {
        await supabase.auth.signOut();
        setError(
          'Access denied. This account does not have administrator privileges. Customers can browse and book directly on the customer website without logging in.'
        );
        return;
      }

      await refreshProfile(signedInUser);
      navigate(targetAdminPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingExistingSessionCheck = Boolean(user && !submitting && checkedUserId !== user.id);

  if (authLoading || checkingExistingSession || pendingExistingSessionCheck) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center bg-slate-50/70 px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#1D4ED8]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-600">Checking administrator session...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B1F3A] text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
            <h1 className="mt-0.5 font-display text-2xl font-bold text-[#0B1F3A]">Administrator Login</h1>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Authorized fleet and booking administrators only. Public admin registration is disabled.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs leading-relaxed text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label htmlFor="admin-login-email" className="block text-xs font-semibold text-slate-700">
              Administrator Email
            </label>
            <input
              id="admin-login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="admin@example.com"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="admin-login-password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-xs font-semibold text-[#1D4ED8] transition-colors hover:text-[#0B1F3A]"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative mt-1.5">
              <input
                id="admin-login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="Enter your password"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:text-[#0B1F3A]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              id="admin-remember-session"
              type="checkbox"
              checked={rememberSession}
              onChange={(e) => setRememberSession(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <label htmlFor="admin-remember-session" className="text-xs font-medium text-slate-700">
              Remember session on this browser
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{submitting ? 'Verifying Administrator...' : 'Sign In to Admin Portal'}</span>
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-[#1D4ED8]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Return to Customer Website</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
