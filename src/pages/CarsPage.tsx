import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, Search } from 'lucide-react';
import { useVehicles } from '../hooks/useVehicles';
import { RentalSearchParams } from '../types/vehicle';
import { buildSearchQueryString, calculateRentalDays } from '../utils/rentalUtils';
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

  const [query, setQuery] = useState('');
  const [fuelFilter, setFuelFilter] = useState<string>('All');
  const [transmissionFilter, setTransmissionFilter] = useState<string>('All');
  const [sortOrder, setSortOrder] = useState<SortOrder>('featured');

  const currentSearchQuery = buildSearchQueryString(initialSchedule);
  const rentalDays = calculateRentalDays(initialSchedule);

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

  const filteredVehicles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const list = vehicles.filter((car) => {
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
        !car.category.toLowerCase().includes(normalizedQuery) &&
        !car.brand.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });

    if (sortOrder === 'price-asc') {
      return [...list].sort(
        (a, b) => (a.dailyPrice ?? Number.MAX_SAFE_INTEGER) - (b.dailyPrice ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (sortOrder === 'price-desc') {
      return [...list].sort((a, b) => (b.dailyPrice ?? -1) - (a.dailyPrice ?? -1));
    }
    return list;
  }, [vehicles, query, fuelFilter, transmissionFilter, sortOrder]);

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
              submitLabel="Update Schedule"
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
              placeholder="Search by car name or category..."
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

        {/* Results Meta */}
        {!loading && !error && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <p className="tabular-nums">
              Showing <span className="font-semibold text-[#0B1F3A]">{filteredVehicles.length}</span>{' '}
              {filteredVehicles.length === 1 ? 'vehicle' : 'vehicles'}
              {rentalDays !== null && (
                <>
                  {' '}
                  <span aria-hidden="true">·</span> Selected duration:{' '}
                  <span className="font-semibold text-[#1D4ED8]">
                    {rentalDays} {rentalDays === 1 ? 'Day' : 'Days'}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {/* Loading, Error, Empty, or Grid */}
        <div className="mt-6">
          {loading ? (
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
