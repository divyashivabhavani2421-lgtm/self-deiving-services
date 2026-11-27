import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  FileCheck2,
  Fuel,
  Gauge,
  Loader2,
  MapPin,
  Phone,
  Settings2,
  ShieldCheck,
  Truck,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import {
  createBooking,
  createGuestBooking,
  fetchVehicleBookedSlots,
  triggerWhatsAppNotificationDispatch,
} from '../services/bookingsService';
import { fetchVehicleBySlugOrId } from '../services/vehiclesService';
import { BookedSlot, BookingRecord, PickupType, RentalDurationType } from '../types/booking';
import { Vehicle } from '../types/vehicle';
import { normalizeIndianMobileNumber } from '../utils/phoneUtils';
import {
  addHoursInIST,
  calculateBookingPricePreview,
  calculateDurationHours,
  calculateElapsedMs,
  formatBookingDurationLabel,
  formatINR,
  formatISTDateTime,
  getDefaultSearchParams,
  getTodayInputDate,
  hasBookingOverlap,
  HOURS_24_MS,
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  MIN_RENTAL_HOURS,
  MIN_RENTAL_MS,
  toISTTimestampIso,
} from '../utils/rentalUtils';
import { VehicleImage } from '../components/VehicleImage';
import { VehicleErrorState } from '../components/VehicleListStates';
import { WhatsAppButton } from '../components/WhatsAppButton';

export function VehicleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [bookedSlots, setBookedSlots] = useState<BookedSlot[]>([]);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigMissing, setIsConfigMissing] = useState(false);

  const defaults = getDefaultSearchParams();
  const minDate = getTodayInputDate(0);

  const initialPickupDate = searchParams.get('pickupDate') || defaults.pickupDate;
  const initialPickupTime = searchParams.get('pickupTime') || defaults.pickupTime;
  const initialReturnDateParam = searchParams.get('returnDate') || defaults.returnDate;
  const initialReturnTimeParam = searchParams.get('returnTime') || defaults.returnTime;

  const initialElapsedMs = calculateElapsedMs({
    pickupDate: initialPickupDate,
    pickupTime: initialPickupTime,
    returnDate: initialReturnDateParam,
    returnTime: initialReturnTimeParam,
  });

  const initialDurationMode: RentalDurationType =
    initialElapsedMs === MIN_RENTAL_MS
      ? '12h'
      : initialElapsedMs === HOURS_24_MS || initialElapsedMs === null
        ? '24h'
        : 'custom';

  const initialCustomDays =
    initialDurationMode === 'custom' && initialElapsedMs !== null
      ? Math.min(MAX_CUSTOM_DAYS, Math.max(MIN_CUSTOM_DAYS, Math.ceil(initialElapsedMs / HOURS_24_MS)))
      : MIN_CUSTOM_DAYS;

  const initialSyncedReturn =
    initialDurationMode === 'custom'
      ? addHoursInIST(initialPickupDate, initialPickupTime, initialCustomDays * 24)
      : null;

  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [pickupDate, setPickupDate] = useState(initialPickupDate);
  const [pickupTime, setPickupTime] = useState(initialPickupTime);
  const [returnDate, setReturnDate] = useState(
    initialSyncedReturn?.date || initialReturnDateParam
  );
  const [returnTime, setReturnTime] = useState(
    initialSyncedReturn?.time || initialReturnTimeParam
  );
  const [rentalDuration, setRentalDuration] = useState<RentalDurationType>(initialDurationMode);
  const [customDays, setCustomDays] = useState<number>(initialCustomDays);
  const [pickupType, setPickupType] = useState<PickupType>('hub_pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [confirmedBooking, setConfirmedBooking] = useState<BookingRecord | null>(null);

  useEffect(() => {
    if (profile) {
      if (profile.fullName && !guestName) setGuestName(profile.fullName);
      if (profile.phone && !guestPhone) setGuestPhone(profile.phone);
    }
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadVehicle = useCallback(async (targetSlug: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchVehicleBySlugOrId(decodeURIComponent(targetSlug), {
        includeInactive: false,
      });
      setVehicle(result.vehicle);
      setError(result.error);
      setIsConfigMissing(result.isConfigMissing);

      if (result.vehicle) {
        const slotsRes = await fetchVehicleBookedSlots(result.vehicle.id);
        setBookedSlots(slotsRes.slots);
      } else {
        setBookedSlots([]);
      }
    } catch (err) {
      setVehicle(null);
      setBookedSlots([]);
      setError(err instanceof Error ? err.message : 'Unable to load vehicle details.');
      setIsConfigMissing(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (slug) {
      void loadVehicle(slug);
    } else {
      setLoading(false);
      setVehicle(null);
    }
  }, [slug, loadVehicle]);

  const galleryImages = useMemo(() => {
    if (!vehicle) return [];
    const merged: string[] = [];
    const addUnique = (url: string) => {
      if (url && !merged.includes(url)) merged.push(url);
    };
    addUnique(vehicle.image);
    vehicle.images.forEach(addUnique);
    return merged;
  }, [vehicle]);

  useEffect(() => {
    setSelectedImage(galleryImages[0] || '');
  }, [galleryImages]);

  const getDurationTotalHours = (mode: RentalDurationType, daysCount: number): number => {
    if (mode === '12h') return 12;
    if (mode === '24h') return 24;
    return daysCount * 24;
  };

  const handleSelectDurationPreset = (preset: RentalDurationType) => {
    setRentalDuration(preset);
    setBookingError('');
    const hours = getDurationTotalHours(preset, customDays);
    const computed = addHoursInIST(pickupDate, pickupTime, hours);
    if (computed) {
      setReturnDate(computed.date);
      setReturnTime(computed.time);
    }
  };

  const handleCustomDaysChange = (nextDays: number) => {
    const clampedDays = Math.min(MAX_CUSTOM_DAYS, Math.max(MIN_CUSTOM_DAYS, nextDays));
    setCustomDays(clampedDays);
    setRentalDuration('custom');
    setBookingError('');
    const computed = addHoursInIST(pickupDate, pickupTime, clampedDays * 24);
    if (computed) {
      setReturnDate(computed.date);
      setReturnTime(computed.time);
    }
  };

  const handlePickupDateChange = (nextDate: string) => {
    setPickupDate(nextDate);
    setBookingError('');
    const hours = getDurationTotalHours(rentalDuration, customDays);
    const computed = addHoursInIST(nextDate, pickupTime, hours);
    if (computed) {
      setReturnDate(computed.date);
      setReturnTime(computed.time);
    }
  };

  const handlePickupTimeChange = (nextTime: string) => {
    setPickupTime(nextTime);
    setBookingError('');
    const hours = getDurationTotalHours(rentalDuration, customDays);
    const computed = addHoursInIST(pickupDate, nextTime, hours);
    if (computed) {
      setReturnDate(computed.date);
      setReturnTime(computed.time);
    }
  };

  const startIso = useMemo(
    () => toISTTimestampIso(pickupDate, pickupTime),
    [pickupDate, pickupTime]
  );
  const endIso = useMemo(
    () => toISTTimestampIso(returnDate, returnTime),
    [returnDate, returnTime]
  );

  const elapsedMs = useMemo(
    () => calculateElapsedMs({ pickupDate, pickupTime, returnDate, returnTime }),
    [pickupDate, pickupTime, returnDate, returnTime]
  );

  const durationHours = useMemo(
    () => calculateDurationHours({ pickupDate, pickupTime, returnDate, returnTime }),
    [pickupDate, pickupTime, returnDate, returnTime]
  );

  const hasValidMinDuration = elapsedMs !== null && elapsedMs >= MIN_RENTAL_MS;

  const isStartInPast = useMemo(() => {
    if (!startIso) return false;
    return new Date(startIso).getTime() < Date.now() - 5 * 60_000;
  }, [startIso]);

  const overlappingSlot = useMemo(() => {
    if (!startIso || !endIso) return null;
    return hasBookingOverlap(bookedSlots, startIso, endIso);
  }, [bookedSlots, startIso, endIso]);

  const priceBreakdown = useMemo(() => {
    if (!vehicle || durationHours === null || !hasValidMinDuration) {
      return null;
    }
    return calculateBookingPricePreview({
      price12h: vehicle.price12h,
      price24h: vehicle.price24h,
      durationHours,
      elapsedMs,
      rentalDuration,
      customDays: rentalDuration === 'custom' ? customDays : undefined,
      pickupType,
    });
  }, [vehicle, durationHours, hasValidMinDuration, elapsedMs, rentalDuration, customDays, pickupType]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading vehicle details">
        <div className="mb-6 h-4 w-48 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="aspect-[4/3] animate-pulse rounded-2xl bg-slate-200" />
            <div className="mt-6 h-6 w-48 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-20 w-full animate-pulse rounded bg-slate-100" />
          </div>
          <div className="lg:col-span-5">
            <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Link
          to="/cars"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[#1D4ED8] hover:text-[#0B1F3A]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Available Cars</span>
        </Link>
        <VehicleErrorState
          error={error}
          isConfigMissing={isConfigMissing}
          onRetry={() => slug && void loadVehicle(slug)}
        />
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">Vehicle Not Found</h1>
        <p className="mt-3 text-sm text-slate-600">
          The requested car is either inactive or not currently available in our Siddipet fleet.
        </p>
        <Link
          to="/cars"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Available Cars</span>
        </Link>
      </div>
    );
  }

  const displayName = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name;

  const handleBookingSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBookingError('');

    const trimmedName = guestName.trim();
    if (trimmedName.length < 2) {
      setBookingError('Please enter your full name (at least 2 characters).');
      return;
    }

    const parsedPhone = normalizeIndianMobileNumber(guestPhone);
    if (!parsedPhone.valid) {
      setBookingError(
        parsedPhone.error || 'Please enter a valid 10-digit Indian mobile number.'
      );
      return;
    }

    if (!vehicle.isActive) {
      setBookingError('This vehicle is currently inactive and cannot be booked online.');
      return;
    }

    if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
      setBookingError('Return date and time must be after pickup date and time.');
      return;
    }

    if (isStartInPast) {
      setBookingError('Pickup date and time cannot be in the past (IST).');
      return;
    }

    if (!hasValidMinDuration) {
      setBookingError(`Minimum rental duration is ${MIN_RENTAL_HOURS} full hours.`);
      return;
    }

    if (rentalDuration === 'custom') {
      if (
        customDays < MIN_CUSTOM_DAYS ||
        customDays > MAX_CUSTOM_DAYS ||
        elapsedMs !== customDays * HOURS_24_MS
      ) {
        setBookingError('Custom day-wise rental must be between 1 and 30 full days.');
        return;
      }
    }

    if (overlappingSlot) {
      setBookingError(
        `This vehicle is already reserved from ${formatISTDateTime(overlappingSlot.startDate)} to ${formatISTDateTime(overlappingSlot.endDate)}. Please adjust your dates.`
      );
      return;
    }

    if (pickupType === 'doorstep_delivery' && deliveryAddress.trim().length < 5) {
      setBookingError('Please enter your complete Siddipet delivery address for doorstep delivery.');
      return;
    }

    const effectiveDuration: RentalDurationType =
      rentalDuration === '12h' && elapsedMs === MIN_RENTAL_MS
        ? '12h'
        : rentalDuration === '24h' && elapsedMs === HOURS_24_MS
          ? '24h'
          : 'custom';

    setSubmitting(true);
    try {
      const res = user
        ? await createBooking({
            vehicleId: vehicle.id,
            startDateIso: startIso,
            endDateIso: endIso,
            rentalDuration: effectiveDuration,
            pickupType,
            deliveryAddress: pickupType === 'doorstep_delivery' ? deliveryAddress.trim() : undefined,
            notes: notes.trim() || undefined,
            whatsappOptIn,
            contactPhone: parsedPhone.e164,
          })
        : await createGuestBooking({
            vehicleId: vehicle.id,
            guestName: trimmedName,
            guestPhone: parsedPhone.e164,
            startDateIso: startIso,
            endDateIso: endIso,
            rentalDuration: effectiveDuration,
            pickupType,
            deliveryAddress: pickupType === 'doorstep_delivery' ? deliveryAddress.trim() : undefined,
            notes: notes.trim() || undefined,
            whatsappOptIn,
          });

      if (res.error || !res.booking) {
        setBookingError(res.error || 'Could not complete your booking. Please try again.');
        const slotsRes = await fetchVehicleBookedSlots(vehicle.id);
        setBookedSlots(slotsRes.slots);
        return;
      }

      void triggerWhatsAppNotificationDispatch({
        bookingId: res.booking.id,
        eventType: 'booking_created_admin',
      });

      setConfirmedBooking({
        ...res.booking,
        guestName: res.booking.guestName || trimmedName,
        guestPhone: res.booking.guestPhone || parsedPhone.formatted,
      });
      const slotsRes = await fetchVehicleBookedSlots(vehicle.id);
      setBookedSlots(slotsRes.slots);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Unexpected error while submitting booking.');
    } finally {
      setSubmitting(false);
    }
  };

  const rateText =
    vehicle.price24h !== null
      ? ` at ${formatINR(vehicle.price24h)}/24h`
      : vehicle.price12h !== null
        ? ` at ${formatINR(vehicle.price12h)}/12h`
        : '';
  const specsText = [vehicle.fuelType, vehicle.transmission].filter(Boolean).join(', ');
  const whatsappMessage = `Hello Siddipet Self Drive Cars, I am interested in renting the ${displayName}${specsText ? ` (${specsText})` : ''}${rateText} from ${pickupDate} (${pickupTime} IST) to ${returnDate} (${returnTime} IST). Please share availability.`;

  const isBookable =
    vehicle.isActive &&
    hasValidMinDuration &&
    priceBreakdown !== null;

  return (
    <div className="bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Link to="/" className="transition-colors hover:text-[#0B1F3A]">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link to="/cars" className="transition-colors hover:text-[#0B1F3A]">
            Available Cars
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-[#0B1F3A]">{displayName}</span>
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* Left Column: Image Gallery, Specs, Overview & Reserved Slots */}
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <VehicleImage src={selectedImage} alt={`${displayName} photo`} />
            </div>

            {galleryImages.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">
                {galleryImages.map((imgUrl, idx) => (
                  <button
                    key={imgUrl}
                    type="button"
                    onClick={() => setSelectedImage(imgUrl)}
                    aria-label={`View photo ${idx + 1} of ${displayName}`}
                    className={`overflow-hidden rounded-lg border transition-all ${
                      selectedImage === imgUrl
                        ? 'border-[#1D4ED8] ring-2 ring-[#1D4ED8]/30'
                        : 'border-slate-200 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <VehicleImage
                      src={imgUrl}
                      alt={`${displayName} thumbnail ${idx + 1}`}
                      aspectClassName="aspect-[4/3]"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Specifications Grid */}
            <div className="mt-8 border-t border-slate-200 pt-8">
              <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Vehicle Specifications</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div className="flex items-center gap-2.5">
                  <Fuel className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Fuel Type</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.fuelType || '—'}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Settings2 className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Transmission</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.transmission || '—'}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Users className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Seating</dt>
                    <dd className="font-semibold text-[#0B1F3A] tabular-nums">
                      {vehicle.seats !== null ? `${vehicle.seats} Seats` : '—'}
                    </dd>
                  </div>
                </div>

                {vehicle.mileage && (
                  <div className="flex items-center gap-2.5">
                    <Gauge className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                    <div>
                      <dt className="text-xs text-slate-500">Mileage</dt>
                      <dd className="font-semibold text-[#0B1F3A] tabular-nums">{vehicle.mileage}</dd>
                    </div>
                  </div>
                )}

                {vehicle.registrationNumber && (
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                    <div>
                      <dt className="text-xs text-slate-500">Registration</dt>
                      <dd className="font-semibold text-[#0B1F3A] tabular-nums">{vehicle.registrationNumber}</dd>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2.5">
                  <MapPin className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Pickup Hub</dt>
                    <dd className="font-semibold text-[#0B1F3A]">Siddipet, TS</dd>
                  </div>
                </div>
              </dl>
            </div>

            {vehicle.description ? (
              <div className="mt-8 border-t border-slate-200 pt-8">
                <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Vehicle Overview</h2>
                <p className="mt-3 text-base leading-relaxed text-slate-600">{vehicle.description}</p>
              </div>
            ) : null}

            {vehicle.features.length > 0 && (
              <div className="mt-8 border-t border-slate-200 pt-8">
                <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Features &amp; Comfort</h2>
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {vehicle.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Upcoming Reserved Windows (No PII exposed) */}
            {bookedSlots.length > 0 && (
              <div className="mt-8 border-t border-slate-200 pt-8">
                <div className="flex items-center gap-2">
                  <CalendarCheck2 className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
                  <h2 className="font-display text-lg font-bold text-[#0B1F3A]">
                    Upcoming Reserved Windows (IST)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Existing pending and confirmed reservations for this vehicle. Select dates outside these ranges.
                </p>
                <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/70 text-xs">
                  {bookedSlots.slice(0, 6).map((slot, idx) => (
                    <li key={`${slot.startDate}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 tabular-nums">
                      <span className="font-medium text-[#0B1F3A]">
                        {formatISTDateTime(slot.startDate)} → {formatISTDateTime(slot.endDate)}
                      </span>
                      <span className="font-semibold text-amber-800">
                        {slot.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start gap-3">
                <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0B1F3A]" aria-hidden="true" />
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B1F3A]">Handover Requirements</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Original valid Indian Driving License and Government Photo ID (Aadhaar / Passport) are verified at
                    pickup in Siddipet.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Booking & Pricing Module */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>
                  {vehicle.make}
                  {vehicle.year ? ` · ${vehicle.year} Model` : ''}
                </span>
                <span className={vehicle.isActive ? 'text-[#15803D]' : 'text-amber-700'}>
                  {vehicle.isActive ? 'Active in Fleet' : 'Currently Inactive'}
                </span>
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl">{displayName}</h1>

              <div className="mt-4 border-b border-slate-100 pb-4">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                  {vehicle.price24h !== null ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-extrabold text-[#0B1F3A] tabular-nums">
                        {formatINR(vehicle.price24h)}
                      </span>
                      <span className="text-sm font-medium text-slate-500">/ 24 hrs</span>
                    </div>
                  ) : null}

                  {vehicle.price12h !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="font-display text-xl font-bold text-[#1D4ED8] tabular-nums">
                        {formatINR(vehicle.price12h)}
                      </span>
                      <span className="text-xs font-medium text-slate-500">/ 12 hrs</span>
                    </div>
                  ) : null}

                  {vehicle.price24h === null && vehicle.price12h === null && (
                    <span className="text-base font-semibold text-slate-700">Rate on inquiry</span>
                  )}
                </div>

                {vehicle.securityDeposit !== null && (
                  <p className="mt-2 text-xs text-slate-600 tabular-nums">
                    Refundable Security Deposit at Pickup: <strong>{formatINR(vehicle.securityDeposit)}</strong> (not included in online booking total)
                  </p>
                )}
              </div>

              {confirmedBooking ? (
                <div className="mt-5 space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-[#166534]">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-display font-bold text-[#0B1F3A]">
                          Booking Request Submitted
                        </p>
                        <p className="mt-1 text-xs leading-relaxed">
                          Your request has been received and is currently{' '}
                          <strong>Pending Admin Confirmation</strong>. This booking is not confirmed
                          until our team reviews and confirms it.
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 space-y-2 border-t border-emerald-200/70 pt-3 text-xs text-[#0B1F3A]">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Booking Reference</dt>
                        <dd className="font-mono font-bold text-[#1D4ED8]">
                          {confirmedBooking.bookingReference ||
                            `SSDC-${confirmedBooking.id.slice(0, 8).toUpperCase()}`}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Vehicle</dt>
                        <dd className="font-semibold text-right">
                          {confirmedBooking.vehicleName || displayName}
                        </dd>
                      </div>
                      {confirmedBooking.guestName && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Customer Name</dt>
                          <dd className="font-medium text-right">{confirmedBooking.guestName}</dd>
                        </div>
                      )}
                      {confirmedBooking.guestPhone && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-600">Mobile Number</dt>
                          <dd className="font-medium tabular-nums text-right">
                            {confirmedBooking.guestPhone}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Duration</dt>
                        <dd className="font-semibold tabular-nums">
                          {formatBookingDurationLabel(
                            confirmedBooking.durationHours,
                            confirmedBooking.rentalDuration
                          )}
                          {confirmedBooking.rentalDuration === 'custom'
                            ? ` (${confirmedBooking.durationHours} hrs)`
                            : ''}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Pickup (IST)</dt>
                        <dd className="font-medium tabular-nums text-right">
                          {formatISTDateTime(confirmedBooking.startDate)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Return (IST)</dt>
                        <dd className="font-medium tabular-nums text-right">
                          {formatISTDateTime(confirmedBooking.endDate)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-600">Pickup Option</dt>
                        <dd className="font-medium text-right">
                          {confirmedBooking.pickupType === 'doorstep_delivery'
                            ? 'Doorstep Delivery'
                            : 'Hub Pickup (Siddipet)'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 border-t border-emerald-200/70 pt-2">
                        <dt className="font-semibold text-slate-700">Estimated Total</dt>
                        <dd className="font-bold tabular-nums">
                          {formatINR(confirmedBooking.totalAmount)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <WhatsAppButton
                      label={`Contact on WhatsApp (${BUSINESS_CONFIG.whatsappDisplayNumber})`}
                      message={`Hello Siddipet Self Drive Cars, I submitted a booking request (Ref: ${confirmedBooking.bookingReference || `SSDC-${confirmedBooking.id.slice(0, 8).toUpperCase()}`}) for ${confirmedBooking.vehicleName || displayName} from ${formatISTDateTime(confirmedBooking.startDate)} to ${formatISTDateTime(confirmedBooking.endDate)}. Amount: ${formatINR(confirmedBooking.totalAmount)}. Name: ${confirmedBooking.guestName || guestName}, Mobile: ${confirmedBooking.guestPhone || guestPhone}. Please confirm availability.`}
                      variant="primary"
                      className="w-full justify-center py-2.5"
                    />
                    {user && (
                      <Link
                        to="/dashboard"
                        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                      >
                        View My Bookings
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmedBooking(null)}
                      className="inline-flex min-h-[42px] w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
                    >
                      Book Another Schedule
                    </button>
                  </div>
                </div>
              ) : (
                <form id="booking-form" onSubmit={handleBookingSubmit} className="mt-5 space-y-4" noValidate>
                  {/* Customer Details (No Account Required) */}
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                    <p className="text-xs font-bold text-[#0B1F3A]">
                      Book Now — No Account Required
                    </p>
                    <div>
                      <label htmlFor="guest-name" className="block text-[11px] font-semibold text-slate-700">
                        Full Name *
                      </label>
                      <div className="relative mt-1">
                        <UserIcon
                          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="guest-name"
                          type="text"
                          autoComplete="name"
                          value={guestName}
                          onChange={(e) => {
                            setGuestName(e.target.value);
                            setBookingError('');
                          }}
                          placeholder="Your full name"
                          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-xs text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="guest-phone" className="block text-[11px] font-semibold text-slate-700">
                          Mobile Number *
                        </label>
                        <span className="text-[10px] font-medium text-slate-500">10-digit Indian (+91)</span>
                      </div>
                      <div className="mt-1 flex">
                        <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-slate-300 bg-white px-2.5 text-xs font-semibold text-[#0B1F3A]">
                          +91
                        </span>
                        <div className="relative flex-1">
                          <Phone
                            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                            aria-hidden="true"
                          />
                          <input
                            id="guest-phone"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel-national"
                            maxLength={18}
                            value={guestPhone}
                            onChange={(e) => {
                              setGuestPhone(e.target.value);
                              setBookingError('');
                            }}
                            placeholder="98765 43210"
                            className="h-10 w-full rounded-r-lg border border-slate-300 bg-white pl-8 pr-3 text-xs text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Rental Duration Segmented Control */}
                  <div>
                    <span className="block text-xs font-semibold text-slate-700">
                      Rental Duration (Min {MIN_RENTAL_HOURS} hrs · IST)
                    </span>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Rental duration">
                      {(
                        [
                          { id: '12h', label: '12 Hours' },
                          { id: '24h', label: '24 Hours' },
                          { id: 'custom', label: 'Custom (Day-wise)' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSelectDurationPreset(opt.id)}
                          className={`rounded-md px-2 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                            rentalDuration === opt.id
                              ? 'bg-white text-[#0B1F3A] shadow-sm'
                              : 'text-slate-600 hover:text-[#0B1F3A]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom (Day-wise) 1 to 30 Days Dropdown */}
                  {rentalDuration === 'custom' && (
                    <div>
                      <label htmlFor="custom-days-select" className="block text-xs font-semibold text-slate-700">
                        Select Number of Days (1 to 30 Days)
                      </label>
                      <select
                        id="custom-days-select"
                        value={customDays}
                        onChange={(e) => handleCustomDaysChange(Number(e.target.value))}
                        className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      >
                        {Array.from({ length: MAX_CUSTOM_DAYS }, (_, idx) => idx + 1).map((dayNum) => (
                          <option key={dayNum} value={dayNum}>
                            {dayNum} {dayNum === 1 ? 'Day' : 'Days'} ({dayNum * 24} Hours)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Pickup Date/Time (Editable) + Return Date/Time (Auto-calculated in IST) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="detail-pickup" className="block text-[11px] font-semibold text-slate-700">
                        Pickup Date
                      </label>
                      <input
                        id="detail-pickup"
                        type="date"
                        min={minDate}
                        value={pickupDate}
                        onChange={(e) => handlePickupDateChange(e.target.value)}
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="detail-pickup-time" className="block text-[11px] font-semibold text-slate-700">
                        Pickup Time (IST)
                      </label>
                      <input
                        id="detail-pickup-time"
                        type="time"
                        value={pickupTime}
                        onChange={(e) => handlePickupTimeChange(e.target.value)}
                        className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="detail-return" className="block text-[11px] font-semibold text-slate-700">
                        Return Date (Auto)
                      </label>
                      <input
                        id="detail-return"
                        type="date"
                        value={returnDate}
                        readOnly
                        className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-[#0B1F3A] tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="detail-return-time" className="block text-[11px] font-semibold text-slate-700">
                        Return Time (IST · Auto)
                      </label>
                      <input
                        id="detail-return-time"
                        type="time"
                        value={returnTime}
                        readOnly
                        className="mt-1 h-10 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-[#0B1F3A] tabular-nums"
                      />
                    </div>
                  </div>

                  {/* Clear IST Pickup & Return Schedule Confirmation */}
                  {startIso && endIso && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-[11px] text-slate-600 tabular-nums">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-slate-500">Pickup (IST):</span>
                        <span className="font-semibold text-[#0B1F3A]">{formatISTDateTime(startIso)}</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-2">
                        <span className="font-medium text-slate-500">Return (IST):</span>
                        <span className="font-semibold text-[#0B1F3A]">{formatISTDateTime(endIso)}</span>
                      </div>
                    </div>
                  )}

                  {/* Pickup Option */}
                  <div>
                    <span className="block text-xs font-semibold text-slate-700">Pickup Option</span>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPickupType('hub_pickup');
                          setBookingError('');
                        }}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                          pickupType === 'hub_pickup'
                            ? 'border-[#1D4ED8] bg-blue-50/60 text-[#0B1F3A]'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                        <div>
                          <div className="font-semibold">Hub Pickup</div>
                          <div className="text-[11px] text-slate-500">Free · Siddipet</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setPickupType('doorstep_delivery');
                          setBookingError('');
                        }}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                          pickupType === 'doorstep_delivery'
                            ? 'border-[#1D4ED8] bg-blue-50/60 text-[#0B1F3A]'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Truck className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                        <div>
                          <div className="font-semibold">Doorstep</div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            +{formatINR(BUSINESS_CONFIG.doorstepDeliveryFee)}
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {pickupType === 'doorstep_delivery' && (
                    <div>
                      <label htmlFor="delivery-address" className="block text-xs font-semibold text-slate-700">
                        Siddipet Delivery Address *
                      </label>
                      <textarea
                        id="delivery-address"
                        rows={2}
                        value={deliveryAddress}
                        onChange={(e) => {
                          setDeliveryAddress(e.target.value);
                          setBookingError('');
                        }}
                        placeholder="House/Flat No, Colony, Landmark in Siddipet..."
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="booking-notes" className="block text-xs font-semibold text-slate-700">
                      Booking Notes <span className="font-normal text-slate-500">(Optional)</span>
                    </label>
                    <textarea
                      id="booking-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any pickup instructions or travel plans..."
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none"
                    />
                  </div>

                  {/* Explicit Optional WhatsApp Opt-In Consent */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <label htmlFor="whatsapp-opt-in" className="flex cursor-pointer items-start gap-2.5">
                      <input
                        id="whatsapp-opt-in"
                        type="checkbox"
                        checked={whatsappOptIn}
                        onChange={(e) => setWhatsappOptIn(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
                      />
                      <span className="text-xs leading-relaxed text-[#0B1F3A]">
                        <span className="font-semibold">
                          Receive booking confirmation updates on WhatsApp
                        </span>{' '}
                        <span className="text-slate-500">(Optional)</span>
                        <span className="mt-0.5 block text-[11px] text-slate-600">
                          When checked, Siddipet Self Drive Cars will send a WhatsApp confirmation
                          to your mobile number once an admin approves your booking.
                        </span>
                      </span>
                    </label>
                  </div>

                  {/* Validation / Overlap Banner */}
                  {!vehicle.isActive ? (
                    <p className="text-xs font-medium text-amber-800">
                      This vehicle is currently inactive and unavailable for online booking.
                    </p>
                  ) : (vehicle.price12h ?? 0) <= 0 && (vehicle.price24h ?? 0) <= 0 ? (
                    <p className="text-xs font-medium text-amber-800">
                      Rental pricing is not configured for this vehicle yet. Please inquire on WhatsApp.
                    </p>
                  ) : elapsedMs === null ? (
                    <p className="text-xs font-medium text-red-700">
                      Return date &amp; time must be after pickup date &amp; time.
                    </p>
                  ) : !hasValidMinDuration ? (
                    <p className="text-xs font-medium text-red-700">
                      Minimum rental duration is {MIN_RENTAL_HOURS} full hours.
                    </p>
                  ) : isStartInPast ? (
                    <p className="text-xs font-medium text-red-700">
                      Pickup date and time cannot be in the past (IST).
                    </p>
                  ) : overlappingSlot ? (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Selected dates overlap an active reservation ({formatISTDateTime(overlappingSlot.startDate)} –{' '}
                        {formatISTDateTime(overlappingSlot.endDate)}).
                      </span>
                    </div>
                  ) : null}

                  {/* Clear INR Price Breakdown */}
                  {priceBreakdown && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                      <div className="space-y-2">
                        <div className="flex justify-between gap-2 text-slate-600">
                          <span>Duration</span>
                          <span className="font-semibold text-[#0B1F3A] tabular-nums">
                            {formatBookingDurationLabel(priceBreakdown.durationHours, rentalDuration)}
                            {rentalDuration === 'custom' ? ` (${priceBreakdown.durationHours} hrs)` : ''}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2 text-slate-600">
                          <span>
                            {rentalDuration === 'custom'
                              ? `Rate (${customDays} ${customDays === 1 ? 'Day' : 'Days'} × ${formatINR(vehicle.price24h ?? (vehicle.price12h ?? 0) * 2)}/day)`
                              : rentalDuration === '12h'
                                ? '12 Hours Tariff'
                                : '24 Hours Tariff'}
                          </span>
                          <span className="font-semibold text-[#0B1F3A] tabular-nums">
                            {formatINR(priceBreakdown.baseAmount)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2 text-slate-600">
                          <span>
                            {pickupType === 'doorstep_delivery' ? 'Doorstep Delivery Fee' : 'Hub Pickup Fee'}
                          </span>
                          <span className="font-semibold text-[#0B1F3A] tabular-nums">
                            {priceBreakdown.deliveryFee > 0 ? formatINR(priceBreakdown.deliveryFee) : '₹0'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-sm">
                          <span className="font-bold text-[#0B1F3A]">Estimated Total</span>
                          <span className="font-display text-xl font-extrabold text-[#0B1F3A] tabular-nums">
                            {formatINR(priceBreakdown.totalAmount)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Calculated from actual vehicle 12h &amp; 24h rates. Security deposit is collected separately at handover.
                      </p>
                    </div>
                  )}

                  {bookingError && (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{bookingError}</span>
                    </div>
                  )}

                  <div className="space-y-2.5 pt-1">
                    <button
                      type="submit"
                      disabled={submitting || !isBookable || isStartInPast || Boolean(overlappingSlot)}
                      className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {submitting
                          ? 'Submitting Request...'
                          : !vehicle.isActive
                            ? 'Currently Inactive'
                            : 'Book Now'}
                      </span>
                    </button>

                    <WhatsAppButton
                      label={`Inquire on WhatsApp (${BUSINESS_CONFIG.whatsappDisplayNumber})`}
                      message={whatsappMessage}
                      variant="outline"
                      className="w-full justify-center py-2.5"
                    />
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
