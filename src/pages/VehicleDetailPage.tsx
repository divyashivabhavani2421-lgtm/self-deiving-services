import { useState } from 'react';
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
  Users,
} from 'lucide-react';
import { VEHICLES } from '../data/vehicles';
import { calculateRentalDays, formatINR, getDefaultSearchParams } from '../utils/rentalUtils';
import { VehicleImage } from '../components/VehicleImage';
import { WhatsAppButton } from '../components/WhatsAppButton';

export function VehicleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  const vehicle = VEHICLES.find((item) => item.slug === slug);
  const defaults = getDefaultSearchParams();

  const [pickupDate, setPickupDate] = useState(searchParams.get('pickupDate') || defaults.pickupDate);
  const [pickupTime, setPickupTime] = useState(searchParams.get('pickupTime') || defaults.pickupTime);
  const [returnDate, setReturnDate] = useState(searchParams.get('returnDate') || defaults.returnDate);
  const [returnTime, setReturnTime] = useState(searchParams.get('returnTime') || defaults.returnTime);

  if (!vehicle) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold text-[#0B1F3A]">Vehicle Not Found</h1>
        <p className="mt-3 text-sm text-slate-600">
          The requested car could not be located in our Siddipet fleet.
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
  const estimatedTotal = estimatedDays ? estimatedDays * vehicle.dailyPrice : null;

  const whatsappMessage = `Hello Siddipet Self Drive Cars, I am interested in renting the ${vehicle.name} (${vehicle.fuelType}, ${vehicle.transmission}) at ${formatINR(vehicle.dailyPrice)}/day from ${pickupDate} (${pickupTime}) to ${returnDate} (${returnTime}). Please share availability.`;

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
          {/* Left Column: Image & Details */}
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <VehicleImage src={vehicle.image} alt={`${vehicle.name} studio photo`} />
            </div>

            <div className="mt-8">
              <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Vehicle Overview</h2>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{vehicle.description}</p>
            </div>

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

            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start gap-3">
                <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-[#0B1F3A]" aria-hidden="true" />
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B1F3A]">Handover Requirements</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    Original valid Indian Driving License and Government Photo ID (Aadhaar / Passport) are verified at
                    pickup in Siddipet. {vehicle.pickupNotes}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Contiguous Specs & Inquiry Module */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold text-slate-500">
                {vehicle.category} <span aria-hidden="true">·</span> {vehicle.year} Model
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl">{vehicle.name}</h1>

              <div className="mt-4 flex items-baseline gap-2 border-b border-slate-100 pb-5">
                <span className="font-display text-3xl font-extrabold text-[#0B1F3A] tabular-nums">
                  {formatINR(vehicle.dailyPrice)}
                </span>
                <span className="text-sm font-medium text-slate-500">per day (24 hrs)</span>
              </div>

              {/* Specifications Grid */}
              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2.5">
                  <Fuel className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Fuel Type</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.fuelType}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Settings2 className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Transmission</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.transmission}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Users className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Seating</dt>
                    <dd className="font-semibold text-[#0B1F3A] tabular-nums">{vehicle.seats} Seats</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Gauge className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Fuel Economy</dt>
                    <dd className="font-semibold text-[#0B1F3A] tabular-nums">{vehicle.mileage}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Briefcase className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Boot Space</dt>
                    <dd className="font-semibold text-[#0B1F3A]">{vehicle.luggageCapacity}</dd>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <MapPin className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-slate-500">Pickup City</dt>
                    <dd className="font-semibold text-[#0B1F3A]">Siddipet, TS</dd>
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

                {estimatedDays !== null && estimatedTotal !== null ? (
                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-sm">
                    <span className="text-slate-600 tabular-nums">
                      Estimated ({estimatedDays} {estimatedDays === 1 ? 'Day' : 'Days'})
                    </span>
                    <span className="font-display text-lg font-bold text-[#0B1F3A] tabular-nums">
                      {formatINR(estimatedTotal)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-red-700">Return date & time must be after pickup date & time.</p>
                )}
              </div>

              {/* Action CTAs (WhatsApp Inquiry & Contact — no fake payment/booking) */}
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
