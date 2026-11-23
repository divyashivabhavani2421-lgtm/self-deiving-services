import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, Search } from 'lucide-react';
import { RentalSearchParams } from '../types/vehicle';
import {
  buildSearchQueryString,
  calculateRentalDays,
  getDefaultSearchParams,
  getTodayInputDate,
} from '../utils/rentalUtils';

interface VehicleSearchBarProps {
  initialValues?: Partial<RentalSearchParams>;
  onSearch?: (params: RentalSearchParams) => void;
  submitLabel?: string;
}

const TIME_SLOTS = [
  '06:00',
  '07:00',
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
];

function formatTimeLabel(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

export function VehicleSearchBar({
  initialValues,
  onSearch,
  submitLabel = 'Search Available Cars',
}: VehicleSearchBarProps) {
  const navigate = useNavigate();
  const defaults = getDefaultSearchParams();
  const minDate = getTodayInputDate(0);

  const [pickupDate, setPickupDate] = useState(initialValues?.pickupDate || defaults.pickupDate);
  const [pickupTime, setPickupTime] = useState(initialValues?.pickupTime || defaults.pickupTime);
  const [returnDate, setReturnDate] = useState(initialValues?.returnDate || defaults.returnDate);
  const [returnTime, setReturnTime] = useState(initialValues?.returnTime || defaults.returnTime);
  const [error, setError] = useState('');

  const rentalDays = calculateRentalDays({ pickupDate, pickupTime, returnDate, returnTime });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!pickupDate || !returnDate) {
      setError('Please select both pickup and return dates.');
      return;
    }

    const start = new Date(`${pickupDate}T${pickupTime}`);
    const end = new Date(`${returnDate}T${returnTime}`);
    if (end <= start) {
      setError('Return date and time must be after pickup date and time.');
      return;
    }

    setError('');
    const nextParams: RentalSearchParams = { pickupDate, pickupTime, returnDate, returnTime };

    if (onSearch) {
      onSearch(nextParams);
    } else {
      navigate(`/cars${buildSearchQueryString(nextParams)}`);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      aria-label="Vehicle availability search"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold text-[#0B1F3A] sm:text-lg">
            Plan Your Self-Drive Schedule
          </h2>
          <p className="text-xs text-slate-500 sm:text-sm">
            Pickup & Return in Siddipet, Telangana
          </p>
        </div>
        {rentalDays !== null && (
          <div className="text-xs font-medium text-[#1D4ED8] tabular-nums sm:text-sm">
            Trip Duration: {rentalDays} {rentalDays === 1 ? 'Day' : 'Days'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        {/* Pickup Date */}
        <div>
          <label htmlFor="pickup-date" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
            <span>Pickup Date</span>
          </label>
          <input
            id="pickup-date"
            type="date"
            min={minDate}
            value={pickupDate}
            onChange={(e) => {
              const nextPickup = e.target.value;
              setPickupDate(nextPickup);
              if (returnDate && nextPickup > returnDate) {
                setReturnDate(nextPickup);
              }
              setError('');
            }}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums transition-colors focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            required
          />
        </div>

        {/* Pickup Time */}
        <div>
          <label htmlFor="pickup-time" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Clock className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
            <span>Pickup Time</span>
          </label>
          <select
            id="pickup-time"
            value={pickupTime}
            onChange={(e) => {
              setPickupTime(e.target.value);
              setError('');
            }}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums transition-colors focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          >
            {TIME_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {formatTimeLabel(slot)}
              </option>
            ))}
          </select>
        </div>

        {/* Return Date */}
        <div>
          <label htmlFor="return-date" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
            <span>Return Date</span>
          </label>
          <input
            id="return-date"
            type="date"
            min={pickupDate || minDate}
            value={returnDate}
            onChange={(e) => {
              setReturnDate(e.target.value);
              setError('');
            }}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums transition-colors focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            required
          />
        </div>

        {/* Return Time */}
        <div>
          <label htmlFor="return-time" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Clock className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
            <span>Return Time</span>
          </label>
          <select
            id="return-time"
            value={returnTime}
            onChange={(e) => {
              setReturnTime(e.target.value);
              setError('');
            }}
            className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums transition-colors focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          >
            {TIME_SLOTS.map((slot) => (
              <option key={slot} value={slot}>
                {formatTimeLabel(slot)}
              </option>
            ))}
          </select>
        </div>

        {/* Submit CTA */}
        <div>
          <button
            type="submit"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1D4ED8] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1E40AF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] whitespace-nowrap"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{submitLabel}</span>
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
