import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import {
  getRememberSessionPreference,
  isSupabaseConfigured,
  setRememberSessionPreference,
  supabase,
  supabaseConfigStatus,
} from '../lib/supabase';
import { ensureCustomerProfile } from '../services/profileService';
import {
  formatPhoneAuthError,
  normalizeIndianMobileNumber,
  validateSixDigitOtp,
} from '../utils/phoneUtils';

interface LocationState {
  from?: string;
  notice?: string;
}

const OTP_RESEND_SECONDS = 30;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? null;

  const {
    user,
    loading: authLoading,
    authNotice,
    authError,
    clearAuthNotices,
    refreshProfile,
  } = useAuth();

  // Phone + SMS OTP state (Primary)
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpSentToE164, setOtpSentToE164] = useState<string | null>(null);
  const [otpSentToFormatted, setOtpSentToFormatted] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Primary Email & Password login (preserves admin & existing email accounts)
  const [showEmailLogin, setShowEmailLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  const [rememberSession, setRememberSession] = useState<boolean>(getRememberSessionPreference);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(state?.notice ?? null);

  useEffect(() => {
    if (!authLoading && user && !verifyingOtp && !submittingEmail) {
      const target = state?.from && state.from !== '/login' ? state.from : '/dashboard';
      navigate(target, { replace: true });
    }
  }, [authLoading, user, verifyingOtp, submittingEmail, state, navigate]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  const sendOtpToMobile = async (isResend = false) => {
    clearAuthNotices();
    setInfoMessage(null);
    setError('');

    const parsed = normalizeIndianMobileNumber(phoneInput);
    if (!parsed.valid) {
      setError(parsed.error || 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setError(
        `Supabase is not configured (${supabaseConfigStatus.missingVars.join(', ')} missing).`
      );
      return;
    }

    setSendingOtp(true);
    try {
      setRememberSessionPreference(rememberSession);

      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: parsed.e164,
        options: {
          channel: 'sms',
          shouldCreateUser: true,
        },
      });

      if (otpError) {
        setError(formatPhoneAuthError(otpError));
        return;
      }

      setOtpSentToE164(parsed.e164);
      setOtpSentToFormatted(parsed.formatted);
      setShowOtpStep(true);
      setResendCountdown(OTP_RESEND_SECONDS);
      setInfoMessage(
        isResend
          ? `A new 6-digit OTP has been sent to ${parsed.formatted}.`
          : `We sent a 6-digit SMS OTP to ${parsed.formatted}.`
      );
    } catch (err) {
      setError(
        formatPhoneAuthError(err instanceof Error ? err.message : 'Unable to send OTP right now.')
      );
    } finally {
      setSendingOtp(false);
    }
  };

  const handleSendOtpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await sendOtpToMobile(false);
  };

  const handleVerifyOtpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearAuthNotices();
    setError('');
    setInfoMessage(null);

    const parsedPhone = normalizeIndianMobileNumber(phoneInput);
    if (!parsedPhone.valid) {
      setError(parsedPhone.error || 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    const targetE164 = parsedPhone.e164;

    const otpCheck = validateSixDigitOtp(otpInput);
    if (!otpCheck.valid) {
      setError(otpCheck.error || 'Please enter the 6-digit OTP.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setError(
        `Supabase is not configured (${supabaseConfigStatus.missingVars.join(', ')} missing).`
      );
      return;
    }

    setVerifyingOtp(true);
    try {
      setRememberSessionPreference(rememberSession);

      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: targetE164,
        token: otpCheck.token,
        type: 'sms',
      });

      if (verifyError) {
        setError(formatPhoneAuthError(verifyError));
        return;
      }

      const verifiedUser = data.user ?? (await supabase.auth.getUser()).data.user;
      if (!verifiedUser) {
        setError('OTP verified, but no active user session was returned. Please try again.');
        return;
      }

      // Preserve existing profiles/roles (including admin), or create customer profile if missing
      await ensureCustomerProfile(verifiedUser, { phone: targetE164 });
      await refreshProfile(verifiedUser);

      const target = state?.from && state.from !== '/login' ? state.from : '/dashboard';
      navigate(target, { replace: true });
    } catch (err) {
      setError(
        formatPhoneAuthError(err instanceof Error ? err.message : 'Could not verify OTP.')
      );
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleEmailPasswordSubmit = async (event: FormEvent) => {
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
    setSubmittingEmail(true);

    try {
      setRememberSessionPreference(rememberSession);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        const lowerMsg = signInError.message.toLowerCase();
        if (lowerMsg.includes('email not confirmed')) {
          setNeedsEmailConfirmation(true);
          setError(
            'Your email address has not been verified yet. Please check your inbox or resend the link.'
          );
        } else {
          setError(signInError.message);
        }
        return;
      }

      if (data.user) {
        await refreshProfile(data.user);
      }

      if (data.session) {
        const target = state?.from && state.from !== '/login' ? state.from : '/dashboard';
        navigate(target, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmittingEmail(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!supabase || !email.trim()) return;
    setResendingEmail(true);
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
      setResendingEmail(false);
    }
  };

  const displayedNotice = infoMessage || authNotice;
  const displayedGlobalError = authError;

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">
            {showEmailLogin ? 'Email Sign In' : 'Customer Login'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            {showEmailLogin
              ? 'Sign in with your registered email address and password.'
              : 'Sign in quickly with your Indian mobile number and SMS OTP.'}
          </p>
        </div>

        {displayedNotice && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs leading-relaxed text-[#166534]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{displayedNotice}</span>
          </div>
        )}

        {(error || displayedGlobalError) && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs leading-relaxed text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-2">
              <p>{error || displayedGlobalError}</p>
              {needsEmailConfirmation && (
                <button
                  type="button"
                  disabled={resendingEmail}
                  onClick={handleResendConfirmation}
                  className="font-semibold text-[#1D4ED8] underline underline-offset-2 hover:text-[#0B1F3A] disabled:opacity-60"
                >
                  {resendingEmail ? 'Sending verification link...' : 'Resend verification email'}
                </button>
              )}
            </div>
          </div>
        )}

        {!showEmailLogin ? (
          <div className="mt-6 space-y-5">
            {/* Step 1: Enter Mobile Number & Send OTP */}
            <form onSubmit={handleSendOtpSubmit} className="space-y-4" noValidate>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="login-phone" className="block text-xs font-semibold text-slate-700">
                    Mobile Number
                  </label>
                  <span className="text-[11px] font-medium text-slate-500">India (+91)</span>
                </div>
                <div className="mt-1.5 flex">
                  <span className="inline-flex h-11 items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3.5 text-sm font-semibold text-[#0B1F3A]">
                    +91
                  </span>
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={18}
                    value={phoneInput}
                    onChange={(e) => {
                      setPhoneInput(e.target.value);
                      setError('');
                    }}
                    placeholder="98765 43210"
                    className="h-11 w-full rounded-r-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
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
              </div>

              <button
                type="submit"
                disabled={sendingOtp || verifyingOtp}
                className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingOtp ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Phone className="h-4 w-4" aria-hidden="true" />
                )}
                <span>
                  {sendingOtp
                    ? 'Sending OTP...'
                    : otpSentToE164
                      ? 'Send New OTP'
                      : 'Send OTP'}
                </span>
              </button>
            </form>

            {/* Show/Hide OTP Entry Step Toggle */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {otpSentToFormatted ? `OTP requested for ${otpSentToFormatted}` : 'Step 2: SMS Verification'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowOtpStep((prev) => !prev);
                  setError('');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]"
              >
                <span>{showOtpStep ? 'Hide OTP entry' : 'Show OTP entry'}</span>
                {showOtpStep ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* Step 2: Enter 6-Digit OTP & Verify */}
            {showOtpStep && (
              <form
                onSubmit={handleVerifyOtpSubmit}
                className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
                noValidate
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="login-otp" className="block text-xs font-semibold text-slate-700">
                      Enter 6-Digit SMS OTP
                    </label>
                    {otpSentToFormatted && (
                      <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                        {otpSentToFormatted}
                      </span>
                    )}
                  </div>
                  <div className="relative mt-1.5">
                    <KeyRound
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="login-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => {
                        setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                        setError('');
                      }}
                      placeholder="6-digit OTP"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 text-sm font-semibold tracking-[0.25em] text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={verifyingOtp || sendingOtp}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {verifyingOtp ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{verifyingOtp ? 'Verifying OTP...' : 'Verify OTP'}</span>
                </button>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    disabled={resendCountdown > 0 || sendingOtp || verifyingOtp}
                    onClick={() => void sendOtpToMobile(true)}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#1D4ED8] hover:text-[#0B1F3A] disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {resendCountdown > 0
                        ? `Resend OTP in ${resendCountdown}s`
                        : 'Resend OTP'}
                    </span>
                  </button>

                  {otpSentToE164 && (
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSentToE164(null);
                        setOtpSentToFormatted(null);
                        setOtpInput('');
                        setShowOtpStep(false);
                        setInfoMessage(null);
                        setError('');
                      }}
                      className="font-medium text-slate-600 hover:text-[#0B1F3A]"
                    >
                      Change number
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        ) : (
          /* Secondary Email & Password Login (Preserves Admin & Existing Email Accounts) */
          <form onSubmit={handleEmailPasswordSubmit} className="mt-6 space-y-5" noValidate>
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
                id="remember-session-email"
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
              />
              <label htmlFor="remember-session-email" className="text-xs font-medium text-slate-700">
                Remember session on this browser
              </label>
            </div>

            <button
              type="submit"
              disabled={submittingEmail}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submittingEmail ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{submittingEmail ? 'Signing In...' : 'Sign In with Email'}</span>
            </button>
          </form>
        )}

        {/* Optional Mobile OTP Toggle for Existing Phone Customers */}
        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setShowEmailLogin((prev) => !prev);
              setError('');
              setInfoMessage(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-[#1D4ED8]"
          >
            {showEmailLogin ? (
              <>
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign in with Mobile Number &amp; SMS OTP instead</span>
              </>
            ) : (
              <>
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Email &amp; Password Sign In</span>
              </>
            )}
          </button>
        </div>

        <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
          Booking a car?{' '}
          <Link to="/cars" className="font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]">
            Book directly without login
          </Link>
        </p>
      </div>
    </div>
  );
}
