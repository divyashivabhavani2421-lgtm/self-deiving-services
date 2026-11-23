import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmailOtpType } from '@supabase/supabase-js';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isRecoveryMode } = useAuth();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Completing your verification...');

  useEffect(() => {
    let active = true;

    async function processTokenHashIfPresent() {
      if (!isSupabaseConfigured || !supabase) {
        if (active) {
          setStatus('error');
          setMessage('Supabase is not configured.');
        }
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const urlError =
        searchParams.get('error_description') ||
        hashParams.get('error_description') ||
        searchParams.get('error') ||
        hashParams.get('error');

      if (urlError) {
        if (active) {
          setStatus('error');
          setMessage(decodeURIComponent(urlError.replace(/\+/g, ' ')));
        }
        return;
      }

      const tokenHash = searchParams.get('token_hash');
      const type = searchParams.get('type') as EmailOtpType | null;

      if (tokenHash && type) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });

        if (!active) return;

        if (otpError) {
          setStatus('error');
          setMessage(otpError.message || 'Verification link is invalid or has expired.');
          return;
        }

        if (type === 'recovery') {
          navigate('/reset-password', { replace: true });
          return;
        }

        setStatus('success');
        setMessage('Email verified successfully. Redirecting to your dashboard...');
        setTimeout(() => navigate('/dashboard', { replace: true }), 1000);
        return;
      }

      if (!authLoading) {
        if (isRecoveryMode) {
          navigate('/reset-password', { replace: true });
          return;
        }
        if (user) {
          setStatus('success');
          setMessage('Your email has been verified. Redirecting to your dashboard...');
          setTimeout(() => navigate('/dashboard', { replace: true }), 900);
        } else {
          setStatus('success');
          setMessage('Verification link processed. You can now sign in to your account.');
        }
      }
    }

    void processTokenHashIfPresent();

    return () => {
      active = false;
    };
  }, [authLoading, user, isRecoveryMode, navigate]);

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {status === 'verifying' ? (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1D4ED8]" aria-hidden="true" />
            <h1 className="mt-4 font-display text-xl font-bold text-[#0B1F3A]">Verifying Account</h1>
            <p className="mt-2 text-sm text-slate-600">{message}</p>
          </>
        ) : status === 'success' ? (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-[#15803D]">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-[#0B1F3A]">Verification Complete</h1>
            <p className="mt-2 text-sm text-slate-600">{message}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                to={user ? '/dashboard' : '/login'}
                className="rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                {user ? 'Go to Dashboard' : 'Proceed to Login'}
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-700">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-[#0B1F3A]">Verification Failed</h1>
            <p className="mt-2 text-sm text-slate-600">{message}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                to="/login"
                className="rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                Back to Login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
