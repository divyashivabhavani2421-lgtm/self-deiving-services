import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  FileCheck2,
  Fuel,
  Gauge,
  MapPin,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { fetchVehicleBySlugOrId } from '../services/vehiclesService';
import { listVehicleImages } from '../services/storageService';
import { Vehicle } from '../types/vehicle';
import { calculateRentalDays, formatINR, getDefaultSearchParams } from '../utils/rentalUtils';
import { VehicleImage } from '../components/VehicleImage';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { VehicleErrorState } from '../components/VehicleListStates';

export function VehicleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [storageImages, setStorageImages] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigMissing, setIsConfigMissing] = useState(false);

  const defaults = getDefaultSearchParams();

  const [pickupDate, setPickupDate] = useState(searchParams.get('pickupDate') || defaults.pickupDate);
  const [pickupTime, setPickupTime] = useState(searchParams.get('pickupTime') || defaults.pickupTime);
  const [returnDate, setReturnDate] = useState(searchParams.get('returnDate') || defaults.returnDate);
  const [returnTime, setReturnTime] = useState(searchParams.get('returnTime') || defaults.returnTime);

  const loadVehicle = async (targetSlug: string) => {
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
        const storageRes = await listVehicleImages(result.vehicle.id);
        setStorageImages(storageRes.files.map((f) => f.publicUrl));
      } else {
        setStorageImages([]);
      }
    } catch (err) {
      setVehicle(null);
      setStorageImages([]);
      setError(err instanceof Error ? err.message : 'Unable to load vehicle details.');
      setIsConfigMissing(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (slug) {
      void loadVehicle(slug);
    } else {
      setLoading(false);
      setVehicle(null);
    }
  }, [slug]);

  const galleryImages = useMemo(() => {
    if (!vehicle) return [];
    const merged: string[] = [];
    const addUnique = (url: string) => {
      if (url && !merged.includes(url)) merged.push(url);
    };
    addUnique(vehicle.image);
    vehicle.images.forEach(addUnique);
    storageImages.forEach(addUnique);
    return merged;
  }, [vehicle, storageImages]);

  useEffect(() => {
    setSelectedImage(galleryImages[0] || '');
  }, [galleryImages]);

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
          The requested car is either unavailable or not currently active in our Siddipet fleet.
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

  const estimatedDays = calculateRentalDays({ pickupDate, pickupTime, returnDate, returnTime });
  const estimatedTotal =
    estimatedDays !== null && vehicle.dailyPrice !== null ? estimatedDays * vehicle.dailyPrice : null;

  const rateText = vehicle.dailyPrice !== null ? ` at ${formatINR(vehicle.dailyPrice)}/day` : '';
  const specsText = [vehicle.fuelType, vehicle.transmission].filter(Boolean).join(', ');
  const whatsappMessage = `Hello Siddipet Self Drive Cars, I am interested in renting the ${vehicle.name}${specsText ? ` (${specsText})` : ''}${rateText} from ${pickupDate} (${pickupTime}) to ${returnDate} (${returnTime}). Please share availability.`;

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
          <span className="font-medium text-[#0B1F3A]">{vehicle.name}</span>
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* Left Column: Image Gallery & Details */}
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <VehicleImage src={selectedImage} alt={`${vehicle.name} photo`} />
            </div>

            {galleryImages.length > 1 && (
              <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">
                {galleryImages.map((imgUrl, idx) => (
                  <button
                    key={imgUrl}
                    type="button"
                    onClick={() => setSelectedImage(imgUrl)}
                    aria-label={`View photo ${idx + 1} of ${vehicle.name}`}
                    className={`overflow-hidden rounded-lg border transition-all ${
                      selectedImage === imgUrl
                        ? 'border-[#1D4ED8] ring-2 ring-[#1D4ED8]/30'
                        : 'border-slate-200 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <VehicleImage
                      src={imgUrl}
                      alt={`${vehicle.name} thumbnail ${idx + 1}`}
                      aspectClassName="aspect-[4/3]"
                    />
                  </button>
                ))}
              </div>
            )}

            {vehicle.description ? (
              <div className="mt-8">
                <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Vehicle Overview</h2>
                <p className="mt-3 text-base leading-relaxed text-slate-600">{vehicle.description}</p>
              </div>
            ) : null}

            {vehicle.highlights.length > 0 && (
              <div className="mt-8 border-t border-slate-200 pt-8">
                <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Features & Comfort</h2>
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {vehicle.highlights.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                      <span>{feature}</span>
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

          {/* Right Column: Contiguous Specs & Inquiry Module */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>
                  {vehicle.category}
                  {vehicle.year ? ` · ${vehicle.year} Model` : ''}
                </span>
                <span className={vehicle.isAvailable ? 'text-[#15803D]' : 'text-amber-700'}>
                  {vehicle.isAvailable ? 'Available for Pickup' : 'Currently Unavailable'}
                </span>
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl">{vehicle.name}</h1>

              <div className="mt-4 border-b border-slate-100 pb-5">
                <div className="flex items-baseline gap-2">
                  {vehicle.dailyPrice !== null ? (
                    <>
                      <span className="font-display text-3xl font-extrabold text-[#0B1F3A] tabular-nums">
                        {formatINR(vehicle.dailyPrice)}
                      </span>
                      <span className="text-sm font-medium text-slate-500">per day (24 hrs)</span>
                    </>
                  ) : (
                    <span className="text-base font-semibold text-slate-700">Contact for daily rate</span>
                  )}
                </div>

                {(vehicle.hourlyPrice !== null || vehicle.securityDeposit !== null) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                    {vehicle.hourlyPrice !== null && (
                      <span>Hourly Rate: {formatINR(vehicle.hourlyPrice)}/hr</span>
                    )}
                    {vehicle.securityDeposit !== null && (
                      <span>Refundable Deposit: {formatINR(vehicle.securityDeposit)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Specifications Grid */}
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
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
                      <dt className="text-xs text-slate-500">Fuel Economy</dt>
                      <dd className="font-semibold text-[#0B1F3A] tabular-nums">{vehicle.mileage}</dd>
                    </div>
                  </div>
                )}

                {vehicle.luggageCapacity && (
                  <div className="flex items-center gap-2.5">
                    <Briefcase className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                    <div>
                      <dt className="text-xs text-slate-500">Boot Space</dt>
                      <dd className="font-semibold text-[#0B1F3A]">{vehicle.luggageCapacity}</dd>
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
                    <dt className="text-xs text-slate-500">Pickup Location</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.pickupLocation || 'Siddipet, TS'}</dd>
                  </div>
                </div>
              </dl>

              {/* Trip Duration Estimator */}
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-[#0B1F3A]">Select Trip Dates to Estimate Duration</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="detail-pickup" className="block text-[11px] font-medium text-slate-600">
                      Pickup Date
                    </label>
                    <input
                      id="detail-pickup"
                      type="date"
                      value={pickupDate}
                      onChange={(e) => setPickupDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="detail-pickup-time" className="block text-[11px] font-medium text-slate-600">
                      Pickup Time
                    </label>
                    <input
                      id="detail-pickup-time"
                      type="time"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="detail-return" className="block text-[11px] font-medium text-slate-600">
                      Return Date
                    </label>
                    <input
                      id="detail-return"
                      type="date"
                      value={returnDate}
                      min={pickupDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="detail-return-time" className="block text-[11px] font-medium text-slate-600">
                      Return Time
                    </label>
                    <input
                      id="detail-return-time"
                      type="time"
                      value={returnTime}
                      onChange={(e) => setReturnTime(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-[#0B1F3A] tabular-nums"
                    />
                  </div>
                </div>

                {estimatedDays !== null ? (
                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm">
                    <span className="text-slate-600 tabular-nums">
                      Estimated ({estimatedDays} {estimatedDays === 1 ? 'Day' : 'Days'})
                    </span>
                    <span className="font-display text-lg font-bold text-[#0B1F3A] tabular-nums">
                      {estimatedTotal !== null ? formatINR(estimatedTotal) : 'Rate on inquiry'}
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-red-700">Return date & time must be after pickup date & time.</p>
                )}
              </div>

              {/* Action CTAs */}
              <div className="mt-6 flex flex-col gap-3">
                <WhatsAppButton
                  label="Inquire Availability on WhatsApp"
                  message={whatsappMessage}
                  variant="primary"
                  className="w-full justify-center py-3"
                />
                <Link
                  to="/contact"
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
                >
                  Send Inquiry via Contact Form
                </Link>
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">
                No online payment required on this page. Confirm vehicle availability directly before pickup.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
