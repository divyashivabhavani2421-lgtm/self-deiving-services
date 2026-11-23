import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, isRecoveryMode } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-14rem)] flex-col items-center justify-center bg-slate-50/70 px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#1D4ED8]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-slate-600">Verifying your session...</p>
      </div>
    );
  }

  if (isRecoveryMode) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
