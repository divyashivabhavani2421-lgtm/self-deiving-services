import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import {
  getRememberSessionPreference,
  isSupabaseConfigured,
  setRememberSessionPreference,
  supabase,
} from '../lib/supabase';

interface LocationState {
  from?: string;
  notice?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const { user, loading: authLoading, authNotice, authError, clearAuthNotices } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberSession, setRememberSession] = useState<boolean>(getRememberSessionPreference);
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(state?.notice ?? null);

  useEffect(() => {
    if (!authLoading && user) {
      const target = state?.from && state.from !== '/login' ? state.from : '/dashboard';
      navigate(target, { replace: true });
    }
  }, [authLoading, user, state, navigate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearAuthNotices();
    setInfoMessage(null);
    setNeedsEmailConfirmation(false);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedEmail = email.trim().toLowerCase();

    if (!emailPattern.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
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
      // Apply storage preference before signing in
      setRememberSessionPreference(rememberSession);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        const lowerMsg = signInError.message.toLowerCase();
        if (lowerMsg.includes('email not confirmed')) {
          setNeedsEmailConfirmation(true);
          setError('Your email address has not been verified yet. Please check your inbox or resend the link.');
        } else {
          setError(signInError.message);
        }
        return;
      }

      if (data.session) {
        const target = state?.from && state.from !== '/login' ? state.from : '/dashboard';
        navigate(target, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!supabase || !email.trim()) return;
    setResending(true);
    setError('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (resendError) {
        setError(resendError.message);
      } else {
        setInfoMessage('Verification email sent. Please open the link in your inbox before signing in.');
        setNeedsEmailConfirmation(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setResending(false);
    }
  };

  const displayedNotice = infoMessage || authNotice;
  const displayedGlobalError = authError;

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">Customer Login</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Sign in to view your customer profile and account dashboard.
          </p>
        </div>

        {displayedNotice && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs leading-relaxed text-[#166534]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{displayedNotice}</span>
          </div>
        )}

        {displayedGlobalError && !error && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs leading-relaxed text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{displayedGlobalError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700">
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="you@example.com"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
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
                id="login-password"
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
              id="remember-session"
              type="checkbox"
              checked={rememberSession}
              onChange={(e) => setRememberSession(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <label htmlFor="remember-session" className="text-xs font-medium text-slate-700">
              Remember session on this browser
            </label>
          </div>

          {error && (
            <div role="alert" className="space-y-2">
              <p className="text-xs font-medium text-red-700">{error}</p>
              {needsEmailConfirmation && (
                <button
                  type="button"
                  disabled={resending}
                  onClick={handleResendConfirmation}
                  className="text-xs font-semibold text-[#1D4ED8] underline underline-offset-2 hover:text-[#0B1F3A] disabled:opacity-60"
                >
                  {resending ? 'Sending verification link...' : 'Resend verification email'}
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
          </button>
        </form>

        <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-600">
          New to {BUSINESS_CONFIG.name}?{' '}
          <Link to="/register" className="font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
