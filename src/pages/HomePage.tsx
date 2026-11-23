import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, ShieldCheck } from 'lucide-react';
import { HERO_IMAGE } from '../data/vehicles';
import { useVehicles } from '../hooks/useVehicles';
import { VehicleCard } from '../components/VehicleCard';
import { VehicleImage } from '../components/VehicleImage';
import { VehicleSearchBar } from '../components/VehicleSearchBar';
import {
  VehicleEmptyState,
  VehicleErrorState,
  VehicleGridSkeleton,
} from '../components/VehicleListStates';

const STEPS = [
  {
    number: '01.',
    title: 'Choose Your Car & Dates',
    description:
      'Pick your pickup and return schedule and compare clean hatchbacks and SUVs available in Siddipet.',
  },
  {
    number: '02.',
    title: 'Quick License & ID Verification',
    description:
      'Share your valid Indian Driving License and Government Photo ID for fast verification before pickup.',
  },
  {
    number: '03.',
    title: 'Drive Around Siddipet & Beyond',
    description:
      'Collect your inspected, sanitized vehicle in Siddipet and travel on your own schedule without driver wait times.',
  },
];

export function HomePage() {
  const { vehicles, loading, error, isConfigMissing, reload } = useVehicles();

  const featuredVehicles = useMemo(() => {
    const explicitlyFeatured = vehicles.filter((car) => car.featured);
    if (explicitlyFeatured.length > 0) {
      return explicitlyFeatured.slice(0, 3);
    }
    return vehicles.slice(0, 3);
  }, [vehicles]);

  return (
    <div>
      {/* Hero Split Section */}
      <section className="border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12 lg:gap-12">
            {/* Left Copy Column */}
            <div className="flex flex-col justify-center lg:col-span-6">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Siddipet, Telangana, India</span>
              </div>

              <h1 className="mt-3 font-display text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold leading-[1.08] tracking-tight text-[#0B1F3A] text-balance">
                Your Journey, Your Freedom
              </h1>

              <p className="mt-4 font-display text-lg font-semibold text-[#1D4ED8] sm:text-xl">
                Affordable Self Drive Cars in Siddipet
              </p>

              <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
                Well-maintained, sanitized self-drive hatchbacks and compact SUVs ready for local errands, family
                gatherings, and highway drives from Siddipet to Hyderabad and across Telangana.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/cars"
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-6 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] whitespace-nowrap"
                >
                  <span>Browse Available Cars</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/about"
                  className="inline-flex min-h-[46px] items-center px-3 py-2 text-sm font-semibold text-[#0B1F3A] transition-colors hover:text-[#1D4ED8] whitespace-nowrap"
                >
                  How Self Drive Works
                </Link>
              </div>
            </div>

            {/* Right Visual Column */}
            <div className="lg:col-span-6">
              <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
                <VehicleImage
                  src={HERO_IMAGE}
                  alt="Self drive car parked along a scenic lakeside road in Telangana"
                  aspectClassName="aspect-[16/9] lg:h-full lg:aspect-auto"
                  className="lg:h-full"
                />
              </div>
            </div>
          </div>

          {/* Full-width Vehicle Search Bar */}
          <div className="mt-8 lg:mt-10">
            <VehicleSearchBar />
          </div>
        </div>
      </section>

      {/* Featured Vehicles Section (Live from Supabase) */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">Popular Self-Drive Fleet</p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#0B1F3A] sm:text-3xl text-balance">
              Featured Cars in Siddipet
            </h2>
          </div>
          <Link
            to="/cars"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8] transition-colors hover:text-[#0B1F3A] whitespace-nowrap self-start sm:self-auto"
          >
            <span>View All Available Cars</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-8">
          {loading ? (
            <VehicleGridSkeleton count={3} />
          ) : error ? (
            <VehicleErrorState error={error} isConfigMissing={isConfigMissing} onRetry={reload} />
          ) : featuredVehicles.length === 0 ? (
            <VehicleEmptyState
              title="No vehicles listed yet"
              description="No vehicle records were found in the Supabase vehicles table. Add rows or enable public SELECT access via RLS to display your fleet here."
              actionLabel="Refresh Fleet"
              onAction={reload}
            />
          ) : (
            <div className="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">
              {featuredVehicles.map((vehicle) => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* How Self Drive Works + Local Assurance */}
      <section className="border-t border-slate-200 bg-slate-50/70">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">Simple Handover Process</p>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#0B1F3A] sm:text-3xl text-balance">
                Drive Without Waiting for a Chauffeur
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                Whether you are visiting Komati Cheruvu, heading to Kondapochamma Sagar, attending a family function, or
                traveling toward Hyderabad, our self-drive cars give you complete privacy and schedule control.
              </p>

              <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                <div className="text-sm leading-relaxed text-slate-700">
                  <span className="font-semibold text-[#0B1F3A]">Inspected Before Every Trip:</span> All vehicles
                  undergo regular mechanical checks, tyre inspections, and cabin sanitization prior to pickup.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 lg:col-span-7">
              {STEPS.map((step) => (
                <div key={step.number} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="font-display text-sm font-bold text-[#1D4ED8] tabular-nums">{step.number}</div>
                  <h3 className="mt-2 font-display text-base font-bold text-[#0B1F3A]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
