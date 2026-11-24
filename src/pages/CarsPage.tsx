import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck2, RotateCcw, Search } from 'lucide-react';
import { useVehicles } from '../hooks/useVehicles';
import { fetchUnavailableVehicleIds } from '../services/bookingsService';
import { RentalSearchParams } from '../types/vehicle';
import {
  buildSearchQueryString,
  calculateDurationHours,
  calculateElapsedMs,
  formatDurationLabel,
  formatISTDateTime,
  MIN_RENTAL_MS,
  toISTTimestampIso,
} from '../utils/rentalUtils';
import { VehicleCard } from '../components/VehicleCard';
import { VehicleSearchBar } from '../components/VehicleSearchBar';
import {
  VehicleEmptyState,
  VehicleErrorState,
  VehicleGridSkeleton,
} from '../components/VehicleListStates';

type SortOrder = 'featured' | 'price-asc' | 'price-desc';

export function CarsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { vehicles, loading, error, isConfigMissing, reload } = useVehicles();

  const initialSchedule: Partial<RentalSearchParams> = {
    pickupDate: searchParams.get('pickupDate') || undefined,
    pickupTime: searchParams.get('pickupTime') || undefined,
    returnDate: searchParams.get('returnDate') || undefined,
    returnTime: searchParams.get('returnTime') || undefined,
  };

  const hasExplicitSchedule = Boolean(initialSchedule.pickupDate && initialSchedule.returnDate);

  const [query, setQuery] = useState('');
  const [fuelFilter, setFuelFilter] = useState<string>('All');
  const [transmissionFilter, setTransmissionFilter] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<SortOrder>('featured');

  const [bookedVehicleIds, setBookedVehicleIds] = useState<Set<string>>(new Set());
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const scheduleIsoWindow = useMemo(() => {
    if (!hasExplicitSchedule || !initialSchedule.pickupDate || !initialSchedule.returnDate) {
      return null;
    }
    const startIso = toISTTimestampIso(
      initialSchedule.pickupDate,
      initialSchedule.pickupTime || '09:00'
    );
    const endIso = toISTTimestampIso(
      initialSchedule.returnDate,
      initialSchedule.returnTime || '09:00'
    );
    const durationHours = calculateDurationHours(initialSchedule);
    const elapsedMs = calculateElapsedMs(initialSchedule);
    if (!startIso || !endIso || durationHours === null || elapsedMs === null || elapsedMs < MIN_RENTAL_MS) {
      return null;
    }
    return { startIso, endIso, durationHours };
  }, [
    hasExplicitSchedule,
    initialSchedule.pickupDate,
    initialSchedule.pickupTime,
    initialSchedule.returnDate,
    initialSchedule.returnTime,
  ]);

  useEffect(() => {
    let active = true;
    async function loadOverlapConflicts() {
      if (!scheduleIsoWindow) {
        setBookedVehicleIds(new Set());
        return;
      }
      setCheckingAvailability(true);
      try {
        const res = await fetchUnavailableVehicleIds(
          scheduleIsoWindow.startIso,
          scheduleIsoWindow.endIso
        );
        if (active) {
          setBookedVehicleIds(res.vehicleIds);
        }
      } finally {
        if (active) {
          setCheckingAvailability(false);
        }
      }
    }

    void loadOverlapConflicts();
    return () => {
      active = false;
    };
  }, [scheduleIsoWindow]);

  const currentSearchQuery = buildSearchQueryString(initialSchedule);

  const fuelOptions = useMemo(() => {
    const distinct = Array.from(
      new Set(vehicles.map((v) => v.fuelType.trim()).filter(Boolean))
    );
    return ['All', ...distinct];
  }, [vehicles]);

  const transmissionOptions = useMemo(() => {
    const distinct = Array.from(
      new Set(vehicles.map((v) => v.transmission.trim()).filter(Boolean))
    );
    return ['All', ...distinct];
  }, [vehicles]);

  const handleScheduleSearch = (nextParams: RentalSearchParams) => {
    setSearchParams({
      pickupDate: nextParams.pickupDate,
      pickupTime: nextParams.pickupTime,
      returnDate: nextParams.returnDate,
      returnTime: nextParams.returnTime,
    });
  };

  const clearScheduleFilter = () => {
    setSearchParams({});
  };

  const availableForPeriodVehicles = useMemo(() => {
    if (!scheduleIsoWindow) {
      return vehicles;
    }
    return vehicles.filter(
      (car) => car.isActive && !bookedVehicleIds.has(car.id)
    );
  }, [vehicles, scheduleIsoWindow, bookedVehicleIds]);

  const unavailableCountForPeriod = useMemo(() => {
    if (!scheduleIsoWindow) return 0;
    return vehicles.length - availableForPeriodVehicles.length;
  }, [vehicles.length, availableForPeriodVehicles.length, scheduleIsoWindow]);

  const filteredVehicles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const list = availableForPeriodVehicles.filter((car) => {
      if (fuelFilter !== 'All' && car.fuelType.toLowerCase() !== fuelFilter.toLowerCase()) {
        return false;
      }
      if (
        transmissionFilter !== 'All' &&
        car.transmission.toLowerCase() !== transmissionFilter.toLowerCase()
      ) {
        return false;
      }
      if (
        normalizedQuery &&
        !car.name.toLowerCase().includes(normalizedQuery) &&
        !car.make.toLowerCase().includes(normalizedQuery) &&
        !car.model.toLowerCase().includes(normalizedQuery) &&
        !car.registrationNumber.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });

    if (sortOrder === 'price-asc') {
      return [...list].sort(
        (a, b) =>
          (a.price24h ?? a.price12h ?? Number.MAX_SAFE_INTEGER) -
          (b.price24h ?? b.price12h ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (sortOrder === 'price-desc') {
      return [...list].sort(
        (a, b) => (b.price24h ?? b.price12h ?? -1) - (a.price24h ?? a.price12h ?? -1)
      );
    }
    return list;
  }, [availableForPeriodVehicles, query, fuelFilter, transmissionFilter, sortOrder]);

  const resetFilters = () => {
    setQuery('');
    setFuelFilter('All');
    setTransmissionFilter('All');
    setSortOrder('featured');
  };

  return (
    <div className="bg-slate-50/50">
      {/* Header & Schedule Search */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">Siddipet Self-Drive Fleet</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[#0B1F3A] sm:text-4xl">
              Available Cars
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
              Browse inspected hatchbacks and compact SUVs ready for self-drive pickup in Siddipet, Telangana.
            </p>
          </div>

          <div className="mt-6">
            <VehicleSearchBar
              initialValues={initialSchedule}
              onSearch={handleScheduleSearch}
              submitLabel="Check Availability"
            />
          </div>
        </div>
      </section>

      {/* Filter Bar & Vehicle Grid */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Model Search */}
          <div className="relative flex-1 lg:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by make, model, or reg no..."
              aria-label="Search cars by model name"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-[#0B1F3A] placeholder:text-slate-400 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          {/* Interactive Filters derived from actual DB rows */}
          <div className="flex flex-wrap items-center gap-3">
            {fuelOptions.length > 1 && (
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Fuel type filter">
                {fuelOptions.map((fuel) => (
                  <button
                    key={fuel}
                    type="button"
                    onClick={() => setFuelFilter(fuel)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      fuelFilter === fuel
                        ? 'bg-white text-[#0B1F3A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0B1F3A]'
                    }`}
                  >
                    {fuel === 'All' ? 'All Fuel' : fuel}
                  </button>
                ))}
              </div>
            )}

            {transmissionOptions.length > 1 && (
              <div
                className="flex items-center gap-1 rounded-lg bg-slate-100 p-1"
                role="group"
                aria-label="Transmission filter"
              >
                {transmissionOptions.map((tx) => (
                  <button
                    key={tx}
                    type="button"
                    onClick={() => setTransmissionFilter(tx)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      transmissionFilter === tx
                        ? 'bg-white text-[#0B1F3A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0B1F3A]'
                    }`}
                  >
                    {tx === 'All' ? 'All Gear' : tx}
                  </button>
                ))}
              </div>
            )}

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              aria-label="Sort vehicles by price"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              <option value="featured">Sort: Featured</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
          </div>
        </div>

        {/* Selected Period Availability Banner */}
        {scheduleIsoWindow && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-[#0B1F3A]">
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
              <span>
                Showing cars available from{' '}
                <strong className="font-semibold">{formatISTDateTime(scheduleIsoWindow.startIso)}</strong> to{' '}
                <strong className="font-semibold">{formatISTDateTime(scheduleIsoWindow.endIso)}</strong>{' '}
                <span className="text-slate-600 tabular-nums">
                  ({formatDurationLabel(scheduleIsoWindow.durationHours)})
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={clearScheduleFilter}
              className="font-semibold text-[#1D4ED8] hover:text-[#0B1F3A] whitespace-nowrap"
            >
              Show All Fleet
            </button>
          </div>
        )}

        {/* Results Meta */}
        {!loading && !error && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <p className="tabular-nums">
              {checkingAvailability ? (
                'Checking vehicle availability for your selected dates...'
              ) : (
                <>
                  Showing <span className="font-semibold text-[#0B1F3A]">{filteredVehicles.length}</span>{' '}
                  {filteredVehicles.length === 1 ? 'available vehicle' : 'available vehicles'}
                  {scheduleIsoWindow && unavailableCountForPeriod > 0 ? (
                    <span className="text-slate-500">
                      {' '}
                      · {unavailableCountForPeriod}{' '}
                      {unavailableCountForPeriod === 1 ? 'car' : 'cars'} reserved or unavailable for this period
                    </span>
                  ) : null}
                </>
              )}
            </p>
          </div>
        )}

        {/* Loading, Error, Empty, or Grid */}
        <div className="mt-6">
          {loading || checkingAvailability ? (
            <VehicleGridSkeleton count={3} />
          ) : error ? (
            <VehicleErrorState error={error} isConfigMissing={isConfigMissing} onRetry={reload} />
          ) : vehicles.length === 0 ? (
            <VehicleEmptyState
              title="No vehicles found in the database"
              description="Your Supabase vehicles table returned 0 accessible rows. Confirm records exist and a public read RLS policy is active."
              actionLabel="Refresh Vehicles"
              onAction={reload}
            />
          ) : availableForPeriodVehicles.length === 0 && scheduleIsoWindow ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
              <h2 className="font-display text-lg font-bold text-[#0B1F3A]">
                All vehicles are reserved for this window
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Try adjusting your pickup or return date/time above, or view the full fleet schedule.
              </p>
              <button
                type="button"
                onClick={clearScheduleFilter}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Show All Fleet</span>
              </button>
            </div>
          ) : filteredVehicles.length > 0 ? (
            <div className="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">
              {filteredVehicles.map((vehicle) => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} searchQuery={currentSearchQuery} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
              <h2 className="font-display text-lg font-bold text-[#0B1F3A]">No matching vehicles found</h2>
              <p className="mt-2 text-sm text-slate-600">
                Try clearing your search or adjusting the fuel type and transmission filters.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Reset All Filters</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
