import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, Loader2, MailCheck, UserPlus, X } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function RegisterPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [verificationEmailSentTo, setVerificationEmailSentTo] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user && !verificationEmailSentTo) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, user, verificationEmailSentTo, navigate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const cleanedPhone = phone.replace(/[^0-9]/g, '');

    if (trimmedName.length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!emailPattern.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (cleanedPhone.length < 10 || cleanedPhone.length > 15) {
      setError('Please enter a valid mobile number (10 to 15 digits).');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!acceptTerms) {
      setError('You must accept the Terms and Conditions to register.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setError(
        'Supabase is not configured yet. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
      );
      return;
    }

    setError('');
    setResendMessage(null);
    setSubmitting(true);

    try {
      const formattedPhone = phone.trim();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: trimmedName,
            phone: formattedPhone,
            phone_number: formattedPhone,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      // Supabase returns an empty identities array if the email already exists with confirmation enabled
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('An account with this email address already exists. Please sign in or reset your password.');
        return;
      }

      if (data.session) {
        navigate('/dashboard', { replace: true });
        return;
      }

      setVerificationEmailSentTo(trimmedEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!supabase || !verificationEmailSentTo) return;
    setResending(true);
    setResendMessage(null);
    setError('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: verificationEmailSentTo,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (resendError) {
        setError(resendError.message);
      } else {
        setResendMessage('A fresh verification link has been sent to your email.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setResending(false);
    }
  };

  if (verificationEmailSentTo) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-[#15803D]">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-[#0B1F3A]">Verify Your Email</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            We sent a confirmation link to{' '}
            <span className="font-semibold text-[#0B1F3A]">{verificationEmailSentTo}</span>. Open the link in your
            inbox to activate your {BUSINESS_CONFIG.name} account.
          </p>

          {resendMessage && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-[#166534]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{resendMessage}</span>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={resending}
              onClick={handleResendVerification}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              <span>{resending ? 'Sending Link...' : 'Resend Verification Email'}</span>
            </button>

            <Link
              to="/login"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">Create Customer Account</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Register to access your self-drive customer profile in Siddipet.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
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
            <label htmlFor="register-email" className="block text-xs font-semibold text-slate-700">
              Email Address
            </label>
            <input
              id="register-email"
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
            <label htmlFor="register-phone" className="block text-xs font-semibold text-slate-700">
              Phone Number
            </label>
            <input
              id="register-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError('');
              }}
              placeholder="10-digit mobile number"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="register-password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="At least 6 characters"
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

          <div>
            <label htmlFor="register-confirm" className="block text-xs font-semibold text-slate-700">
              Confirm Password
            </label>
            <input
              id="register-confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError('');
              }}
              placeholder="Re-enter your password"
              className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
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

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{submitting ? 'Creating Account...' : 'Register Account'}</span>
          </button>
        </form>

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
                Customer Terms & Conditions
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
                Accept & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
