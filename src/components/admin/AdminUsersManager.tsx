import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  AdminManagedAccount,
  listAdminAccounts,
  promoteRegisteredAccountToAdmin,
} from '../../services/profileService';

export function AdminUsersManager() {
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<AdminManagedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [emailInput, setEmailInput] = useState('');
  const [promotingEmail, setPromotingEmail] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listAdminAccounts();
      if (res.error) {
        setError(res.error);
        return;
      }
      setAccounts(res.accounts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const { adminAccounts, standardAccounts } = useMemo(() => {
    const admins: AdminManagedAccount[] = [];
    const others: AdminManagedAccount[] = [];
    for (const acc of accounts) {
      if (acc.isAdmin) {
        admins.push(acc);
      } else {
        others.push(acc);
      }
    }
    return { adminAccounts: admins, standardAccounts: others };
  }, [accounts]);

  const promoteAccount = async (targetEmail: string) => {
    const normalized = targetEmail.trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(normalized)) {
      setError('Please enter a valid registered email address.');
      return;
    }

    setPromotingEmail(normalized);
    setError('');
    setNotice('');

    try {
      const res = await promoteRegisteredAccountToAdmin(normalized);
      if (res.error || !res.account) {
        setError(res.error || 'Could not promote account to administrator.');
        return;
      }

      setNotice(
        `${res.account.email || res.account.fullName || 'Selected account'} now has administrator privileges.`
      );
      setEmailInput('');
      await loadAccounts();
    } finally {
      setPromotingEmail(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void promoteAccount(emailInput);
  };

  return (
    <div className="space-y-6">
      {/* Top Info + Promote Form */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B1F3A] text-white">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-[#0B1F3A]">
                Promote Existing Registered Account
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:text-sm">
                Grant administrator access to an account that already exists in Supabase Auth. Public administrator
                registration is disabled, and customer accounts cannot elevate their own privileges.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
            <div className="flex-1">
              <label htmlFor="promote-admin-email" className="block text-xs font-semibold text-slate-700">
                Registered Account Email
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="promote-admin-email"
                  type="email"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setError('');
                  }}
                  placeholder="existing-user@example.com"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={promotingEmail !== null}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
            >
              {promotingEmail !== null && promotingEmail === emailInput.trim().toLowerCase() ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Promote to Admin</span>
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <h3 className="font-display text-base font-bold text-[#0B1F3A]">Access Safeguards</h3>
          <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-600">
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" aria-hidden="true" />
              <span>
                Only existing users whose database <code className="font-mono font-semibold">profiles.role</code> is{' '}
                <code className="font-mono font-semibold">admin</code> can view this tab or run admin tools.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
              <span>
                Role promotions execute inside a database-enforced admin function and cannot be triggered by customers.
              </span>
            </li>
          </ul>
        </div>
      </div>

      {notice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-[#166534]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Active Administrators */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[#0B1F3A]">
              Active Administrators ({loading ? '—' : adminAccounts.length})
            </h2>
          </div>

          <button
            type="button"
            onClick={() => void loadAccounts()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading administrator accounts...</div>
        ) : adminAccounts.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">No administrator accounts listed.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3">Account</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-5 py-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adminAccounts.map((acc) => {
                  const isCurrentUser = user?.id === acc.id;
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3.5 font-semibold text-[#0B1F3A]">
                        {acc.fullName || 'Administrator'}
                        {isCurrentUser && (
                          <span className="ml-2 text-xs font-semibold text-[#1D4ED8]">(Signed In)</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-700">{acc.email || '—'}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums">{acc.phone || '—'}</td>
                      <td className="px-5 py-3.5 text-xs font-semibold text-[#15803D]">{acc.role}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Existing Registered Customer Accounts Eligible for Promotion */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Users className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
          <h2 className="font-display text-base font-bold text-[#0B1F3A]">
            Registered Accounts ({loading ? '—' : standardAccounts.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-500">Loading registered accounts...</div>
        ) : standardAccounts.length === 0 ? (
          <div className="p-6 text-sm text-slate-600">
            No non-admin registered accounts found. Registered email accounts appear here for optional promotion.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {standardAccounts.map((acc) => {
                  const hasEmail = Boolean(acc.email);
                  const isBusy = hasEmail && promotingEmail === acc.email.toLowerCase();
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3.5 font-semibold text-[#0B1F3A]">
                        {acc.fullName || 'Registered User'}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-700">{acc.email || 'Phone-only account'}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums">{acc.phone || '—'}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">{acc.role}</td>
                      <td className="px-5 py-3.5 text-right">
                        {hasEmail ? (
                          <button
                            type="button"
                            disabled={promotingEmail !== null}
                            onClick={() => void promoteAccount(acc.email)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#1D4ED8]/30 bg-blue-50 px-3 text-xs font-semibold text-[#1D4ED8] transition-colors hover:bg-[#1D4ED8] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{isBusy ? 'Promoting...' : 'Promote to Admin'}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Email required</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
