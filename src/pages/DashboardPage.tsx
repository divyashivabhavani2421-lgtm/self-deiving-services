import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  CarFront,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { updateOwnProfile } from '../services/profileService';

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, profile, profileLoading, isAdmin, setProfileState, signOut } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [drivingLicenseNumber, setDrivingLicenseNumber] = useState('');

  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName || '');
      setPhone(profile.phone || '');
      setAddress(profile.address || '');
      setCity(profile.city || '');
      setDrivingLicenseNumber(profile.drivingLicenseNumber || '');
    }
  }, [profile]);

  const availableCols = new Set(profile?.availableColumns ?? []);
  const hasAddressCol = availableCols.has('address');
  const hasCityCol = availableCols.has('city');
  const hasLicenseCol =
    availableCols.has('driving_license_number') || availableCols.has('license_number');

  const handleSaveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    const cleanedPhone = phone.replace(/[^0-9]/g, '');

    if (trimmedName.length < 2) {
      setSaveError('Please enter your full name.');
      setSaveSuccess('');
      return;
    }
    if (cleanedPhone.length < 10 || cleanedPhone.length > 15) {
      setSaveError('Please enter a valid phone number (10 to 15 digits).');
      setSaveSuccess('');
      return;
    }

    setSaveError('');
    setSaveSuccess('');
    setSaving(true);

    try {
      const result = await updateOwnProfile(user, profile, {
        fullName: trimmedName,
        phone: phone.trim(),
        address: hasAddressCol ? address : undefined,
        city: hasCityCol ? city : undefined,
        drivingLicenseNumber: hasLicenseCol ? drivingLicenseNumber : undefined,
      });

      if (result.error) {
        setSaveError(result.error);
        return;
      }

      if (result.profile) {
        setProfileState(result.profile);
      }
      setSaveSuccess('Your personal profile has been updated.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const displayName = profile?.fullName || user?.email?.split('@')[0] || 'Customer';
  const displayEmail = profile?.email || user?.email || '';
  const displayPhone = profile?.phone || 'Not added yet';

  return (
    <div className="bg-slate-50/60">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
        {/* Top Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">Customer Dashboard</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#0B1F3A] sm:text-3xl">
              Welcome, {displayName}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage your personal contact information and prepare for upcoming self-drive rentals in Siddipet.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            {isAdmin && (
              <Link
                to="/admin"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF]"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Open Admin Dashboard</span>
              </Link>
            )}

            <button
              type="button"
              disabled={loggingOut}
              onClick={handleLogout}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
            >
              {loggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{loggingOut ? 'Signing Out...' : 'Logout'}</span>
            </button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Customer Summary + My Bookings Placeholder */}
          <div className="space-y-6 lg:col-span-5">
            {/* Customer Summary Card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B1F3A] text-white">
                  <UserIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold text-[#0B1F3A]">{displayName}</h2>
                  <p className="text-xs text-slate-500">
                    {profile?.role ? `Account Role: ${profile.role}` : 'Verified Customer Account'}
                  </p>
                </div>
              </div>

              <dl className="mt-5 space-y-3.5 border-t border-slate-100 pt-5 text-sm">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">Email Address</dt>
                    <dd className="truncate font-medium text-[#0B1F3A]">{displayEmail}</dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Phone Number</dt>
                    <dd className="font-medium text-[#0B1F3A] tabular-nums">{displayPhone}</dd>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#15803D]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Email Verification</dt>
                    <dd className="font-medium text-[#0B1F3A]">
                      {user?.email_confirmed_at ? 'Confirmed' : 'Pending confirmation'}
                    </dd>
                  </div>
                </div>
              </dl>
            </section>

            {/* My Bookings Placeholder Card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2.5">
                <CalendarClock className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                <h2 className="font-display text-lg font-bold text-[#0B1F3A]">My Bookings</h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Online booking history and reservation management will be enabled in the next phase. Meanwhile, browse
                available self-drive vehicles or inquire via WhatsApp.
              </p>
              <div className="mt-5">
                <Link
                  to="/cars"
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                >
                  <CarFront className="h-4 w-4" aria-hidden="true" />
                  <span>Browse Available Cars</span>
                </Link>
              </div>
            </section>
          </div>

          {/* Right Column: Personal Profile Editor */}
          <div className="lg:col-span-7">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Profile Information</h2>
              <p className="mt-1 text-sm text-slate-600">
                Update your personal contact details. Email and account permissions are read-only for your security.
              </p>

              {profileLoading && !profile ? (
                <div className="mt-6 space-y-4" aria-busy="true">
                  <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
                  <div className="h-11 animate-pulse rounded-lg bg-slate-100" />
                </div>
              ) : (
                <form onSubmit={handleSaveProfile} className="mt-6 space-y-5" noValidate>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="profile-name" className="block text-xs font-semibold text-slate-700">
                        Full Name
                      </label>
                      <input
                        id="profile-name"
                        type="text"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          setSaveError('');
                          setSaveSuccess('');
                        }}
                        placeholder="Enter your full name"
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="profile-phone" className="block text-xs font-semibold text-slate-700">
                        Phone Number
                      </label>
                      <input
                        id="profile-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setSaveError('');
                          setSaveSuccess('');
                        }}
                        placeholder="10-digit mobile number"
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="profile-email" className="block text-xs font-semibold text-slate-700">
                      Email Address (Read-Only)
                    </label>
                    <input
                      id="profile-email"
                      type="email"
                      value={displayEmail}
                      disabled
                      className="mt-1.5 h-11 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-500"
                    />
                  </div>

                  {hasLicenseCol && (
                    <div>
                      <label htmlFor="profile-license" className="block text-xs font-semibold text-slate-700">
                        Driving License Number
                      </label>
                      <input
                        id="profile-license"
                        type="text"
                        value={drivingLicenseNumber}
                        onChange={(e) => {
                          setDrivingLicenseNumber(e.target.value);
                          setSaveError('');
                          setSaveSuccess('');
                        }}
                        placeholder="Optional driving license reference"
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      />
                    </div>
                  )}

                  {(hasAddressCol || hasCityCol) && (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      {hasCityCol && (
                        <div>
                          <label htmlFor="profile-city" className="block text-xs font-semibold text-slate-700">
                            City
                          </label>
                          <input
                            id="profile-city"
                            type="text"
                            value={city}
                            onChange={(e) => {
                              setCity(e.target.value);
                              setSaveError('');
                              setSaveSuccess('');
                            }}
                            placeholder="e.g. Siddipet"
                            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                          />
                        </div>
                      )}

                      {hasAddressCol && (
                        <div>
                          <label htmlFor="profile-address" className="block text-xs font-semibold text-slate-700">
                            Address
                          </label>
                          <input
                            id="profile-address"
                            type="text"
                            value={address}
                            onChange={(e) => {
                              setAddress(e.target.value);
                              setSaveError('');
                              setSaveSuccess('');
                            }}
                            placeholder="Local address"
                            className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {saveError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {saveError}
                    </p>
                  )}

                  {saveSuccess && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-xs font-medium text-[#166534]">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{saveSuccess}</span>
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>{saving ? 'Saving Profile...' : 'Save Profile Changes'}</span>
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
