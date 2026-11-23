import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Info, LogIn } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submittedNotice, setSubmittedNotice] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError('');
    setSubmittedNotice(true);
  };

  return (
    <div className="flex min-h-[calc(100vh-14rem)] items-center justify-center bg-slate-50/70 px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8]">{BUSINESS_CONFIG.name}</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A]">Customer Login</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Sign in to view your upcoming self-drive trips and license verification status.
          </p>
        </div>

        {submittedNotice && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-xs leading-relaxed text-[#0B1F3A]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
            <div>
              <p className="font-semibold">Phase 1 Frontend Preview</p>
              <p className="mt-0.5 text-slate-600">
                Your form input is valid. Live customer authentication will be connected to your Supabase project in the
                next phase.
              </p>
            </div>
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
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
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

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>Sign In</span>
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
