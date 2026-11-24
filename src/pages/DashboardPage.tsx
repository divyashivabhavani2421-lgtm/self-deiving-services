import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  CarFront,
  CheckCircle2,
  Clock,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  Truck,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cancelOwnBooking, fetchMyBookings } from '../services/bookingsService';
import { updateOwnProfile } from '../services/profileService';
import { BookingRecord, BookingStatus } from '../types/booking';
import { formatBookingDurationLabel, formatINR, formatISTDateTime } from '../utils/rentalUtils';
import { VehicleImage } from '../components/VehicleImage';

type BookingTab = 'upcoming' | 'past' | 'all';

const STATUS_DISPLAY: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: 'Pending Confirmation', className: 'text-amber-700' },
  confirmed: { label: 'Confirmed', className: 'text-[#15803D]' },
  completed: { label: 'Completed', className: 'text-[#1D4ED8]' },
  cancelled: { label: 'Cancelled', className: 'text-slate-500' },
};

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

  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [bookingsError, setBookingsError] = useState('');
  const [bookingNotice, setBookingNotice] = useState('');
  const [bookingTab, setBookingTab] = useState<BookingTab>('upcoming');
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName || '');
      setPhone(profile.phone || '');
      setAddress(profile.address || '');
      setCity(profile.city || '');
      setDrivingLicenseNumber(profile.drivingLicenseNumber || '');
    }
  }, [profile]);

  const loadBookings = useCallback(async () => {
    if (!user) return;
    setBookingsLoading(true);
    setBookingsError('');
    try {
      const res = await fetchMyBookings(user.id);
      if (res.error) {
        setBookingsError(res.error);
      } else {
        setBookings(res.bookings);
      }
    } finally {
      setBookingsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const { upcomingBookings, pastBookings } = useMemo(() => {
    const nowMs = Date.now();
    const upcoming: BookingRecord[] = [];
    const past: BookingRecord[] = [];

    for (const item of bookings) {
      const endMs = new Date(item.endDate).getTime();
      const isActiveWindow =
        (item.status === 'pending' || item.status === 'confirmed') &&
        (Number.isNaN(endMs) || endMs >= nowMs);

      if (isActiveWindow) {
        upcoming.push(item);
      } else {
        past.push(item);
      }
    }

    return { upcomingBookings: upcoming, pastBookings: past };
  }, [bookings]);

  const displayedBookings = useMemo(() => {
    if (bookingTab === 'upcoming') return upcomingBookings;
    if (bookingTab === 'past') return pastBookings;
    return bookings;
  }, [bookingTab, upcomingBookings, pastBookings, bookings]);

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

  const handleConfirmCancel = async (booking: BookingRecord) => {
    setCancellingId(booking.id);
    setBookingsError('');
    setBookingNotice('');
    try {
      const res = await cancelOwnBooking(booking.id);
      if (res.error) {
        setBookingsError(res.error);
        return;
      }
      setConfirmCancelId(null);
      setBookingNotice(
        `Booking ${booking.id.slice(0, 8).toUpperCase()} has been cancelled.`
      );
      await loadBookings();
    } finally {
      setCancellingId(null);
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

  const displayName =
    profile?.fullName ||
    profile?.phone ||
    user?.phone ||
    user?.email?.split('@')[0] ||
    'Customer';
  const displayEmail = profile?.email || user?.email || '';
  const displayPhone = profile?.phone || user?.phone || 'Not added yet';
  const verificationLabel = user?.phone_confirmed_at
    ? 'Mobile Verified (SMS OTP)'
    : user?.email_confirmed_at
      ? 'Email Confirmed'
      : displayEmail
        ? 'Pending email confirmation'
        : 'Pending mobile verification';
  const verificationHeading = user?.phone_confirmed_at || !displayEmail
    ? 'Account Verification'
    : 'Email Verification';

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
              Manage your self-drive reservations in IST (Asia/Kolkata) and personal contact details.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            {isAdmin && (
              <Link
                to="/admin"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] whitespace-nowrap"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Open Admin Dashboard</span>
              </Link>
            )}

            <button
              type="button"
              disabled={loggingOut}
              onClick={handleLogout}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60 whitespace-nowrap"
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

        {/* My Bookings Section */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                <h2 className="font-display text-xl font-bold text-[#0B1F3A]">My Bookings</h2>
              </div>
              <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                Upcoming and past self-drive trips in Siddipet. Pending bookings may be cancelled before confirmation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div
                className="flex items-center gap-1 rounded-lg bg-slate-100 p-1"
                role="group"
                aria-label="Filter bookings by schedule"
              >
                {(
                  [
                    { id: 'upcoming', label: `Upcoming (${upcomingBookings.length})` },
                    { id: 'past', label: `Past (${pastBookings.length})` },
                    { id: 'all', label: `All (${bookings.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setBookingTab(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap tabular-nums ${
                      bookingTab === tab.id
                        ? 'bg-white text-[#0B1F3A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0B1F3A]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => void loadBookings()}
                aria-label="Refresh bookings"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${bookingsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {bookingNotice && (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#166534]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{bookingNotice}</span>
            </div>
          )}

          {bookingsError && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{bookingsError}</span>
            </div>
          )}

          <div className="mt-6">
            {bookingsLoading ? (
              <div className="space-y-4" aria-busy="true">
                {[1, 2].map((n) => (
                  <div key={n} className="h-28 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : displayedBookings.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-6 py-10 text-center">
                <p className="font-display text-base font-bold text-[#0B1F3A]">
                  {bookingTab === 'upcoming'
                    ? 'No upcoming bookings yet'
                    : bookingTab === 'past'
                      ? 'No past or cancelled bookings'
                      : 'You have not booked a vehicle yet'}
                </p>
                <p className="mt-1.5 text-sm text-slate-600">
                  Choose pickup and return dates in Siddipet to reserve your self-drive car.
                </p>
                <Link
                  to="/cars"
                  className="mt-5 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                >
                  <CarFront className="h-4 w-4" aria-hidden="true" />
                  <span>Browse Available Cars</span>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
                {displayedBookings.map((booking) => {
                  const statusMeta = STATUS_DISPLAY[booking.status];
                  const isBusy = cancellingId === booking.id;
                  const isConfirming = confirmCancelId === booking.id;
                  const shortRef = booking.id.slice(0, 8).toUpperCase();

                  return (
                    <article
                      key={booking.id}
                      className="flex flex-col justify-between gap-5 p-4 sm:p-5 lg:flex-row lg:items-center"
                    >
                      {/* Vehicle Thumbnail + Metadata */}
                      <div className="flex items-start gap-4">
                        <div className="w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          <VehicleImage
                            src={booking.vehicleImageUrl || ''}
                            alt={booking.vehicleName || 'Booked car'}
                            aspectClassName="aspect-[4/3]"
                          />
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span className="font-mono font-semibold text-[#0B1F3A]">#{shortRef}</span>
                            <span aria-hidden="true">·</span>
                            <span className={`font-semibold ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </div>

                          <h3 className="font-display text-base font-bold text-[#0B1F3A]">
                            {booking.vehicleSlug || booking.vehicleId ? (
                              <Link
                                to={`/cars/${encodeURIComponent(booking.vehicleSlug || booking.vehicleId)}`}
                                className="hover:text-[#1D4ED8]"
                              >
                                {booking.vehicleName || 'Siddipet Self-Drive Vehicle'}
                              </Link>
                            ) : (
                              booking.vehicleName || 'Siddipet Self-Drive Vehicle'
                            )}
                          </h3>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                              {formatISTDateTime(booking.startDate)} → {formatISTDateTime(booking.endDate)}
                            </span>
                            <span>
                              {formatBookingDurationLabel(booking.durationHours, booking.rentalDuration)}
                              {booking.rentalDuration === 'custom' &&
                              booking.durationHours >= 24 &&
                              booking.durationHours % 24 === 0
                                ? ` · ${booking.durationHours} hrs`
                                : ''}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              {booking.pickupType === 'doorstep_delivery' ? (
                                <Truck className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                              ) : (
                                <MapPin className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
                              )}
                              {booking.pickupType === 'doorstep_delivery'
                                ? `Doorstep Delivery${booking.deliveryAddress ? `: ${booking.deliveryAddress}` : ''}`
                                : 'Siddipet Hub Pickup'}
                            </span>
                            {booking.notes && (
                              <span className="truncate max-w-md">Note: {booking.notes}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Price & Pending Cancel Control */}
                      <div className="flex flex-row items-center justify-between gap-4 border-t border-slate-100 pt-3 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
                        <div className="lg:text-right">
                          <div className="font-display text-lg font-bold text-[#0B1F3A] tabular-nums">
                            {formatINR(booking.totalAmount)}
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            Base {formatINR(booking.baseAmount)}
                            {booking.deliveryFee > 0 ? ` + Delivery ${formatINR(booking.deliveryFee)}` : ''}
                          </div>
                        </div>

                        {booking.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            {isConfirming ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleConfirmCancel(booking)}
                                  className="inline-flex h-9 items-center gap-1 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60 whitespace-nowrap"
                                >
                                  {isBusy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                  <span>{isBusy ? 'Cancelling...' : 'Confirm Cancel'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setConfirmCancelId(null)}
                                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmCancelId(booking.id)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
                              >
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Cancel Booking</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Bottom Grid: Account Summary + Profile Editor */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
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
                    <dd className="truncate font-medium text-[#0B1F3A]">
                      {displayEmail || 'Not linked (Signed in via Mobile OTP)'}
                    </dd>
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
                    <dt className="text-xs text-slate-500">{verificationHeading}</dt>
                    <dd className="font-medium text-[#0B1F3A]">{verificationLabel}</dd>
                  </div>
                </div>
              </dl>
            </section>
          </div>

          <div className="lg:col-span-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Profile Information</h2>
              <p className="mt-1 text-sm text-slate-600">
                Update your personal contact details. Verified sign-in details and account permissions are read-only for your security.
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
                      placeholder="Not linked (Signed in via Mobile OTP)"
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
