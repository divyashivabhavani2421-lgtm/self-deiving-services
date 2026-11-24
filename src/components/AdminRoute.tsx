import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { verifyCurrentSessionAdminRole } from '../services/profileService';

type VerificationStatus = 'checking' | 'unauthenticated' | 'authorized' | 'non-admin' | 'error';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin, isRecoveryMode, refreshProfile } = useAuth();
  const location = useLocation();

  const [status, setStatus] = useState<VerificationStatus>('checking');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const runLiveVerification = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setStatus('checking');
    setVerifyError(null);

    try {
      const check = await verifyCurrentSessionAdminRole();
      if (reqId !== requestIdRef.current) return;

      if (!check.authenticated || !check.user) {
        if (check.error) {
          setVerifyError(check.error);
          setStatus('error');
          return;
        }
        setStatus('unauthenticated');
        return;
      }

      if (check.error) {
        setVerifyError(check.error);
        setStatus('error');
        return;
      }

      if (!check.isAdmin) {
        setStatus('non-admin');
        return;
      }

      if (!isAdmin) {
        await refreshProfile(check.user);
        if (reqId !== requestIdRef.current) return;
      }

      setStatus('authorized');
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setVerifyError(
        err instanceof Error ? err.message : 'Could not verify administrator permissions.'
      );
      setStatus('error');
    }
  }, [isAdmin, refreshProfile]);

  useEffect(() => {
    if (loading) {
      setStatus('checking');
      return;
    }

    if (!user) {
      requestIdRef.current += 1;
      setVerifyError(null);
      setStatus('unauthenticated');
      return;
    }

    void runLiveVerification();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loading, user?.id, location.pathname, runLiveVerification]);

  if (loading || status === 'checking') {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center bg-slate-50/70 px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#1D4ED8]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-600">Verifying administrator access...</p>
      </div>
    );
  }

  if (isRecoveryMode) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!user || status === 'unauthenticated') {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  if (status === 'non-admin') {
    return <Navigate to="/" replace />;
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-[#0B1F3A]">Permission Check Failed</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {verifyError || 'Could not verify administrator permissions from Supabase.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => void runLiveVerification()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Retry Verification</span>
            </button>
            <Link
              to="/"
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Customer Website</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center bg-slate-50/70 px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#1D4ED8]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-600">Preparing administrator workspace...</p>
      </div>
    );
  }

  return <>{children}</>;
}
