import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, Search } from 'lucide-react';
import { VEHICLES } from '../data/vehicles';
import { FuelType, RentalSearchParams, TransmissionType } from '../types/vehicle';
import { buildSearchQueryString, calculateRentalDays } from '../utils/rentalUtils';
import { VehicleCard } from '../components/VehicleCard';
import { VehicleSearchBar } from '../components/VehicleSearchBar';

type FuelFilter = 'All' | FuelType;
type TransmissionFilter = 'All' | TransmissionType;
type SortOrder = 'featured' | 'price-asc' | 'price-desc';

export function CarsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSchedule: Partial<RentalSearchParams> = {
    pickupDate: searchParams.get('pickupDate') || undefined,
    pickupTime: searchParams.get('pickupTime') || undefined,
    returnDate: searchParams.get('returnDate') || undefined,
    returnTime: searchParams.get('returnTime') || undefined,
  };

  const [query, setQuery] = useState('');
  const [fuelFilter, setFuelFilter] = useState<FuelFilter>('All');
  const [transmissionFilter, setTransmissionFilter] = useState<TransmissionFilter>('All');
  const [sortOrder, setSortOrder] = useState<SortOrder>('featured');

  const currentSearchQuery = buildSearchQueryString(initialSchedule);
  const rentalDays = calculateRentalDays(initialSchedule);

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

    const list = VEHICLES.filter((car) => {
      if (fuelFilter !== 'All' && car.fuelType !== fuelFilter) return false;
      if (transmissionFilter !== 'All' && car.transmission !== transmissionFilter) return false;
      if (
        normalizedQuery &&
        !car.name.toLowerCase().includes(normalizedQuery) &&
        !car.category.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });

    if (sortOrder === 'price-asc') {
      return [...list].sort((a, b) => a.dailyPrice - b.dailyPrice);
    }
    if (sortOrder === 'price-desc') {
      return [...list].sort((a, b) => b.dailyPrice - a.dailyPrice);
    }
    return list;
  }, [query, fuelFilter, transmissionFilter, sortOrder]);

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
              placeholder="Search Swift, Baleno, i20..."
              aria-label="Search cars by model name"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-[#0B1F3A] placeholder:text-slate-400 focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          {/* Interactive Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Fuel Filter */}
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Fuel type filter">
              {(['All', 'Petrol', 'Diesel'] as FuelFilter[]).map((fuel) => (
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

            {/* Transmission Filter */}
            <div
              className="flex items-center gap-1 rounded-lg bg-slate-100 p-1"
              role="group"
              aria-label="Transmission filter"
            >
              {(['All', 'Manual', 'Automatic'] as TransmissionFilter[]).map((tx) => (
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

            {/* Sort */}
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

        {/* Grid or Empty State */}
        {filteredVehicles.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">
            {filteredVehicles.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} searchQuery={currentSearchQuery} />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
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
      </section>
    </div>
  );
}
