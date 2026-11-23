import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { verifyAdminRole } from '../services/profileService';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading, profileLoading, profileError, isAdmin, isRecoveryMode, refreshProfile } =
    useAuth();
  const location = useLocation();

  const [verifying, setVerifying] = useState(false);
  const [liveVerified, setLiveVerified] = useState<boolean | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const runLiveVerification = useCallback(async () => {
    if (!user) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const check = await verifyAdminRole(user.id);
      if (check.error) {
        setVerifyError(check.error);
        setLiveVerified(false);
        return;
      }
      setLiveVerified(check.isAdmin);
      if (check.isAdmin && !isAdmin) {
        await refreshProfile();
      }
    } finally {
      setVerifying(false);
    }
  }, [user, isAdmin, refreshProfile]);

  useEffect(() => {
    if (!loading && user) {
      void runLiveVerification();
    } else if (!user) {
      setLiveVerified(null);
      setVerifyError(null);
    }
  }, [loading, user?.id]); // verify once per authenticated session/user when entering /admin

  if (loading || (user && (profileLoading || verifying || liveVerified === null))) {
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

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  const resolvedError = verifyError || profileError;
  const authorized = Boolean(isAdmin && liveVerified);

  if (!authorized) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-bold text-[#0B1F3A]">
            {resolvedError ? 'Permission Check Failed' : 'Administrator Access Denied'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {resolvedError
              ? resolvedError
              : 'Your account does not hold administrator privileges. Only authorized administrators assigned in the database can access vehicle management tools.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {resolvedError && (
              <button
                type="button"
                onClick={() => void runLiveVerification()}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span>Retry Verification</span>
              </button>
            )}
            <Link
              to="/dashboard"
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Customer Dashboard</span>
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-[42px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
