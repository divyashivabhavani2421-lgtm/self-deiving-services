import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase, supabaseConfigStatus } from '../lib/supabase';
import { ensureCustomerProfile } from '../services/profileService';
import {
  formatPhoneAuthError,
  normalizeIndianMobileNumber,
  validateSixDigitOtp,
} from '../utils/phoneUtils';

const OTP_RESEND_SECONDS = 30;

export function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpSentToE164, setOtpSentToE164] = useState<string | null>(null);
  const [otpSentToFormatted, setOtpSentToFormatted] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user && !verifyingOtp) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, user, verifyingOtp, navigate]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  const sendRegistrationOtp = async (isResend = false) => {
    setError('');
    setInfoMessage(null);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setError('Please enter your full name as printed on your Driving License.');
      return;
    }

    const parsedPhone = normalizeIndianMobileNumber(phoneInput);
    if (!parsedPhone.valid) {
      setError(parsedPhone.error || 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (!acceptTerms) {
      setError('You must accept the Terms and Conditions to register.');
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
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: parsedPhone.e164,
        options: {
          channel: 'sms',
          shouldCreateUser: true,
          data: {
            full_name: trimmedName,
            phone: parsedPhone.e164,
            phone_number: parsedPhone.e164,
          },
        },
      });

      if (otpError) {
        setError(formatPhoneAuthError(otpError));
        return;
      }

      setOtpSentToE164(parsedPhone.e164);
      setOtpSentToFormatted(parsedPhone.formatted);
      setShowOtpStep(true);
      setResendCountdown(OTP_RESEND_SECONDS);
      setInfoMessage(
        isResend
          ? `A fresh 6-digit OTP has been sent to ${parsedPhone.formatted}.`
          : `We sent a 6-digit SMS OTP to ${parsedPhone.formatted}. Enter it below to complete registration.`
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
    await sendRegistrationOtp(false);
  };

  const handleVerifyOtpSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setInfoMessage(null);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setError('Please enter your full name.');
      return;
    }

    const parsedPhone = normalizeIndianMobileNumber(phoneInput);
    if (!parsedPhone.valid) {
      setError(parsedPhone.error || 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    const targetE164 = parsedPhone.e164;

    if (!acceptTerms) {
      setError('You must accept the Terms and Conditions to register.');
      return;
    }

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

      // Ensure customer profile exists (never overwrites existing profiles or admin roles)
      await ensureCustomerProfile(verifiedUser, {
        fullName: trimmedName,
        phone: targetE164,
      });
      await refreshProfile(verifiedUser);

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(
        formatPhoneAuthError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
      );
    } finally {
      setVerifyingOtp(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">Create Customer Account</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Register with your Indian mobile number and SMS OTP to book self-drive cars in Siddipet.
          </p>
        </div>

        {infoMessage && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs leading-relaxed text-[#166534]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{infoMessage}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs leading-relaxed text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 space-y-5">
          {/* Step 1: Name, Mobile (+91), Terms, Send OTP */}
          <form onSubmit={handleSendOtpSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="register-name" className="block text-xs font-semibold text-slate-700">
                Full Name
              </label>
              <input
                id="register-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setError('');
                }}
                placeholder="As printed on your Driving License"
                className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="register-phone" className="block text-xs font-semibold text-slate-700">
                  Mobile Number
                </label>
                <span className="text-[11px] font-medium text-slate-500">India (+91)</span>
              </div>
              <div className="mt-1.5 flex">
                <span className="inline-flex h-11 items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3.5 text-sm font-semibold text-[#0B1F3A]">
                  +91
                </span>
                <input
                  id="register-phone"
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

            <div className="flex items-start gap-2.5 pt-1">
              <input
                id="register-terms"
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => {
                  setAcceptTerms(e.target.checked);
                  setError('');
                }}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
              />
              <label htmlFor="register-terms" className="text-xs leading-relaxed text-slate-600">
                I accept the{' '}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="font-semibold text-[#1D4ED8] underline underline-offset-2 hover:text-[#0B1F3A]"
                >
                  Terms and Conditions
                </button>{' '}
                for self-drive rentals in Siddipet.
              </label>
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
              {otpSentToFormatted ? `OTP sent to ${otpSentToFormatted}` : 'Step 2: SMS Verification'}
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

          {/* Step 2: Enter OTP & Verify */}
          {showOtpStep && (
            <form
              onSubmit={handleVerifyOtpSubmit}
              className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
              noValidate
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="register-otp" className="block text-xs font-semibold text-slate-700">
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
                    id="register-otp"
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
                  onClick={() => void sendRegistrationOtp(true)}
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

        <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-600">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]">
            Sign in
          </Link>
        </p>
      </div>

      {/* Terms and Conditions Modal */}
      {showTermsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F3A]/50 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="terms-modal-title" className="font-display text-lg font-bold text-[#0B1F3A]">
                Customer Terms &amp; Conditions
              </h2>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                aria-label="Close terms dialog"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0B1F3A]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
              <p>
                1. Self-drive renters must hold a valid, original Indian Light Motor Vehicle (LMV) Driving License and
                present an original Government Photo ID at vehicle handover in Siddipet.
              </p>
              <p>
                2. Vehicles must be driven responsibly within speed limits and returned at the agreed time and fuel
                level.
              </p>
              <p>
                3. Account credentials and personal profile details are used solely to coordinate your vehicle pickups
                and verification with {BUSINESS_CONFIG.name}.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setAcceptTerms(true);
                  setShowTermsModal(false);
                }}
                className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                Accept &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
