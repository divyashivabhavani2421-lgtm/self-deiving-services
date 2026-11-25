import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import {
  fetchAllBookingsAdmin,
  triggerWhatsAppNotificationDispatch,
  updateBookingStatusAdmin,
} from '../../services/bookingsService';
import { AdminBookingRecord, BookingStatus } from '../../types/booking';
import { formatBookingDurationLabel, formatINR, formatISTDateTime } from '../../utils/rentalUtils';

type StatusFilter = 'all' | BookingStatus;

const STATUS_LABEL: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-amber-700' },
  confirmed: { label: 'Confirmed', className: 'text-[#15803D]' },
  completed: { label: 'Completed', className: 'text-[#1D4ED8]' },
  cancelled: { label: 'Cancelled', className: 'text-slate-500' },
};

export function AdminBookingsManager() {
  const [bookings, setBookings] = useState<AdminBookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAllBookingsAdmin();
      if (res.error) {
        setError(res.error);
      } else {
        setBookings(res.bookings);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const counts = useMemo(() => {
    return {
      all: bookings.length,
      pending: bookings.filter((b) => b.status === 'pending').length,
      confirmed: bookings.filter((b) => b.status === 'confirmed').length,
      completed: bookings.filter((b) => b.status === 'completed').length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    };
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (q) {
        const matches =
          b.id.toLowerCase().includes(q) ||
          (b.bookingReference || '').toLowerCase().includes(q) ||
          b.customerName.toLowerCase().includes(q) ||
          b.customerPhone.toLowerCase().includes(q) ||
          b.customerEmail.toLowerCase().includes(q) ||
          (b.vehicleName || '').toLowerCase().includes(q) ||
          (b.vehicleRegistrationNumber || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [bookings, statusFilter, searchQuery]);

  const handleTransition = async (
    booking: AdminBookingRecord,
    nextStatus: 'confirmed' | 'completed' | 'cancelled'
  ) => {
    // Client-side validation mirroring server transition rules
    const allowedMap: Record<BookingStatus, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };
    if (!allowedMap[booking.status].includes(nextStatus)) {
      setError(`Transition from "${booking.status}" to "${nextStatus}" is not permitted.`);
      return;
    }

    setBusyBookingId(booking.id);
    setError('');
    setNotice('');
    try {
      const res = await updateBookingStatusAdmin(booking.id, nextStatus);
      if (res.error) {
        setError(res.error);
        return;
      }
      const refLabel = booking.bookingReference || `#${booking.id.slice(0, 8).toUpperCase()}`;
      let whatsappNote = '';

      if (booking.status === 'pending' && nextStatus === 'confirmed') {
        const dispatch = await triggerWhatsAppNotificationDispatch({
          bookingId: booking.id,
          eventType: 'booking_confirmed_customer',
        });
        if (dispatch.sent > 0) {
          whatsappNote = ' Customer confirmation sent on WhatsApp.';
        } else if (dispatch.queuedOnly) {
          whatsappNote = ' WhatsApp confirmation event logged in queue.';
        }
      }

      setNotice(
        `Booking ${refLabel} (${booking.vehicleName || 'Vehicle'}) updated to ${nextStatus}.${whatsappNote}`
      );
      await loadBookings();
    } finally {
      setBusyBookingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total Bookings</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-[#0B1F3A] tabular-nums">
            {loading ? '—' : counts.all}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Pending Review</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {loading ? '—' : counts.pending}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Confirmed</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-[#15803D] tabular-nums">
            {loading ? '—' : counts.confirmed}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Completed</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-[#1D4ED8] tabular-nums">
            {loading ? '—' : counts.completed}
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search booking ID, customer, or car..."
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Booking status filter">
            {(
              [
                { id: 'all', label: `All (${counts.all})` },
                { id: 'pending', label: `Pending (${counts.pending})` },
                { id: 'confirmed', label: `Confirmed (${counts.confirmed})` },
                { id: 'completed', label: `Completed (${counts.completed})` },
                { id: 'cancelled', label: `Cancelled (${counts.cancelled})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap tabular-nums ${
                  statusFilter === tab.id
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
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-[#166534]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Bookings Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading bookings from Supabase...</div>
        ) : filteredBookings.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-600">
            No booking records match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3.5">Booking &amp; Customer</th>
                  <th className="px-4 py-3.5">Vehicle &amp; Pickup</th>
                  <th className="px-4 py-3.5">Schedule (IST)</th>
                  <th className="px-4 py-3.5 text-right">Amount</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBookings.map((booking) => {
                  const statusMeta = STATUS_LABEL[booking.status];
                  const isBusy = busyBookingId === booking.id;
                  const refCode =
                    booking.bookingReference || `#${booking.id.slice(0, 8).toUpperCase()}`;

                  return (
                    <tr key={booking.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-[#1D4ED8]">
                            {refCode}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500">
                            · {booking.isGuest ? 'Guest' : 'Registered'}
                          </span>
                        </div>
                        <div className="mt-0.5 font-semibold text-[#0B1F3A]">{booking.customerName}</div>
                        <div className="text-xs text-slate-600 tabular-nums">{booking.customerPhone}</div>
                        {booking.customerEmail && (
                          <div className="text-[11px] text-slate-500">{booking.customerEmail}</div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[#0B1F3A]">
                          {booking.vehicleName || booking.vehicleId.slice(0, 8)}
                        </div>
                        {booking.vehicleRegistrationNumber && (
                          <div className="text-xs text-slate-500 tabular-nums">
                            {booking.vehicleRegistrationNumber}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-slate-600">
                          {booking.pickupType === 'doorstep_delivery' ? 'Doorstep Delivery' : 'Hub Pickup'}
                        </div>
                        {booking.deliveryAddress && (
                          <div className="mt-0.5 max-w-xs text-[11px] text-slate-500">
                            {booking.deliveryAddress}
                          </div>
                        )}
                        {booking.notes && (
                          <div className="mt-1 max-w-xs text-[11px] text-slate-500">
                            Note: {booking.notes}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-xs text-slate-700 tabular-nums">
                        <div className="font-medium text-[#0B1F3A]">{formatISTDateTime(booking.startDate)}</div>
                        <div className="mt-0.5 text-slate-500">to {formatISTDateTime(booking.endDate)}</div>
                        <div className="mt-1 font-medium text-slate-600">
                          {formatBookingDurationLabel(booking.durationHours, booking.rentalDuration)}
                          {booking.rentalDuration === 'custom' &&
                          booking.durationHours >= 24 &&
                          booking.durationHours % 24 === 0
                            ? ` · ${booking.durationHours} hrs (Custom)`
                            : ''}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right tabular-nums">
                        <div className="font-semibold text-[#0B1F3A]">
                          {formatINR(booking.totalAmount)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Base {formatINR(booking.baseAmount)}
                          {booking.deliveryFee > 0 ? ` + ${formatINR(booking.deliveryFee)}` : ''}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs font-semibold">
                        <span className={statusMeta.className}>{statusMeta.label}</span>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {booking.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleTransition(booking, 'confirmed')}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-[#166534] hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                <span>Confirm</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleTransition(booking, 'cancelled')}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            </>
                          )}

                          {booking.status === 'confirmed' && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleTransition(booking, 'completed')}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                <span>Complete</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleTransition(booking, 'cancelled')}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            </>
                          )}

                          {(booking.status === 'completed' || booking.status === 'cancelled') && (
                            <span className="text-xs text-slate-400">Finalized</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
