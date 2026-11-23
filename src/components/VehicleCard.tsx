import { Link } from 'react-router-dom';
import { ArrowRight, Fuel, Settings2, Users } from 'lucide-react';
import { Vehicle } from '../types/vehicle';
import { formatINR } from '../utils/rentalUtils';
import { VehicleImage } from './VehicleImage';

interface VehicleCardProps {
  vehicle: Vehicle;
  searchQuery?: string;
}

export function VehicleCard({ vehicle, searchQuery = '' }: VehicleCardProps) {
  const detailUrl = `/cars/${vehicle.slug}${searchQuery}`;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <Link to={detailUrl} className="block overflow-hidden bg-slate-100">
        <VehicleImage
          src={vehicle.image}
          alt={`${vehicle.name} self drive car in Siddipet`}
          className="transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="text-xs font-medium text-slate-500">
          {vehicle.category} <span aria-hidden="true">·</span> {vehicle.year}
        </div>

        <h3 className="mt-1 font-display text-lg font-bold text-[#0B1F3A]">
          <Link to={detailUrl} className="transition-colors hover:text-[#1D4ED8]">
            {vehicle.name}
          </Link>
        </h3>

        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">{vehicle.shortSummary}</p>

        {/* Clean Specs Row */}
        <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3 text-xs text-slate-700">
          <div className="flex items-center gap-1.5">
            <Fuel className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
            <dd className="truncate font-medium">{vehicle.fuelType}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
            <dd className="truncate font-medium">{vehicle.transmission}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
            <dd className="truncate font-medium tabular-nums">{vehicle.seats} Seats</dd>
          </div>
        </dl>

        {/* Price + View Details */}
        <div className="mt-auto flex items-center justify-between gap-4 pt-5">
          <div>
            <span className="font-display text-xl font-bold text-[#0B1F3A] tabular-nums">
              {formatINR(vehicle.dailyPrice)}
            </span>
            <span className="text-xs font-medium text-slate-500"> / day</span>
          </div>

          <Link
            to={detailUrl}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] whitespace-nowrap shrink-0"
          >
            <span>View Details</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
