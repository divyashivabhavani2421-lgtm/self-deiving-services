import { AlertTriangle, CarFront, RefreshCw } from 'lucide-react';

export function VehicleGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading vehicles"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <div className="aspect-[4/3] animate-pulse bg-slate-200/70" />
          <div className="space-y-3 p-5 sm:p-6">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-5 w-44 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="grid grid-cols-3 gap-2 border-y border-slate-100 py-3">
              <div className="h-4 animate-pulse rounded bg-slate-100" />
              <div className="h-4 animate-pulse rounded bg-slate-100" />
              <div className="h-4 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="h-6 w-24 animate-pulse rounded bg-slate-200" />
              <div className="h-10 w-28 animate-pulse rounded-lg bg-slate-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface VehicleErrorStateProps {
  error: string;
  isConfigMissing?: boolean;
  onRetry?: () => void;
}

export function VehicleErrorState({ error, isConfigMissing = false, onRetry }: VehicleErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-white p-6 sm:p-8"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-lg font-bold text-[#0B1F3A]">
            {isConfigMissing ? 'Supabase Configuration Required' : 'Unable to Load Vehicles'}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{error}</p>

          {isConfigMissing && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
              Add <code className="font-mono font-semibold text-[#1D4ED8]">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono font-semibold text-[#1D4ED8]">VITE_SUPABASE_PUBLISHABLE_KEY</code> in AI
              Studio Secrets (or <code className="font-mono">.env.local</code> for local development), then reload the
              preview.
            </div>
          )}

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Retry Connection</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface VehicleEmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function VehicleEmptyState({
  title = 'No vehicles available right now',
  description = 'No vehicle records were returned from the database. Check back soon or verify public read access in Supabase.',
  actionLabel,
  onAction,
}: VehicleEmptyStateProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-[#0B1F3A]">
        <CarFront className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-display text-lg font-bold text-[#0B1F3A]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}
