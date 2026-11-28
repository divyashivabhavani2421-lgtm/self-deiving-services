import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
} from 'lucide-react';
import {
  fetchWhatsAppNotificationsAdmin,
  retryWhatsAppNotificationAdmin,
  sendWhatsAppNotificationNowAdmin,
  triggerWhatsAppNotificationDispatch,
} from '../../services/bookingsService';
import { WhatsAppNotificationEvent, WhatsAppNotificationStatus } from '../../types/booking';
import { formatISTDateTime } from '../../utils/rentalUtils';

type StatusFilter = 'all' | WhatsAppNotificationStatus;

const STATUS_META: Record<WhatsAppNotificationStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-amber-700' },
  processing: { label: 'Processing', className: 'text-[#1D4ED8]' },
  sent: { label: 'Sent', className: 'text-[#15803D]' },
  failed: { label: 'Failed', className: 'text-red-700' },
  skipped: { label: 'Skipped', className: 'text-slate-500' },
};

export function AdminWhatsAppLogs() {
  const [events, setEvents] = useState<WhatsAppNotificationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dispatchingQueue, setDispatchingQueue] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchWhatsAppNotificationsAdmin();
      if (res.error) {
        setError(res.error);
      }
      setEvents(res.events);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const counts = useMemo(() => {
    return {
      all: events.length,
      pending: events.filter((e) => e.status === 'pending' || e.status === 'processing').length,
      sent: events.filter((e) => e.status === 'sent').length,
      failed: events.filter((e) => e.status === 'failed').length,
      skipped: events.filter((e) => e.status === 'skipped').length,
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (statusFilter === 'all') return events;
    return events.filter((e) => e.status === statusFilter);
  }, [events, statusFilter]);

  const handleDispatchQueue = async () => {
    setDispatchingQueue(true);
    setError('');
    setNotice('');
    try {
      const res = await triggerWhatsAppNotificationDispatch();
      if (!res.invoked) {
        setNotice(
          res.message ||
            'WhatsApp Edge Function is not deployed or activated yet. Queued events remain saved safely in the outbox.'
        );
      } else if (res.queuedOnly) {
        setNotice(
          res.message ||
            'WhatsApp delivery is paused (`WHATSAPP_ENABLED=false`). Pending notifications stay safely queued.'
        );
      } else {
        setNotice(
          `Processed queue: ${res.sent} sent, ${res.failed} awaiting reply or retryable.`
        );
      }
      await loadLogs();
    } finally {
      setDispatchingQueue(false);
    }
  };

  const handleRetryEvent = async (eventItem: WhatsAppNotificationEvent) => {
    setBusyId(eventItem.id);
    setError('');
    setNotice('');
    try {
      const res = await retryWhatsAppNotificationAdmin(eventItem.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.dispatch.sent > 0) {
        setNotice(`Retried notification for ${eventItem.bookingReference}: delivered successfully.`);
      } else if (res.dispatch.queuedOnly) {
        setNotice(
          `Re-queued notification for ${eventItem.bookingReference}. Delivery will run once WHATSAPP_ENABLED is active.`
        );
      } else if (res.dispatch.failed > 0) {
        setNotice(
          `Notification for ${eventItem.bookingReference} could not send yet (check Details / Errors for sandbox_start or 24-hour window instructions).`
        );
      } else {
        setNotice(`Re-queued notification for ${eventItem.bookingReference}.`);
      }
      await loadLogs();
    } finally {
      setBusyId(null);
    }
  };

  const handleSendNowEvent = async (eventItem: WhatsAppNotificationEvent) => {
    if (eventItem.status !== 'pending') return;

    setBusyId(eventItem.id);
    setError('');
    setNotice('');
    try {
      const res = await sendWhatsAppNotificationNowAdmin(
        eventItem.bookingId,
        eventItem.eventType
      );

      if (!res.invoked || res.error) {
        setError(
          res.error ||
            res.message ||
            `Could not invoke WhatsApp dispatch for ${eventItem.bookingReference}.`
        );
        return;
      }

      const itemResult =
        res.results.find((r) => r.eventId === eventItem.id) ?? res.results[0];

      await loadLogs();

      if (res.queuedOnly) {
        setNotice(
          `${eventItem.bookingReference} status: pending. ${
            res.message ||
            'WhatsApp delivery is paused (`WHATSAPP_ENABLED=false`); event remains queued.'
          }`
        );
      } else if (itemResult?.status === 'sent' || res.sent > 0) {
        setNotice(
          `${eventItem.bookingReference} status: sent.${
            itemResult?.messageId ? ` (Message ID: ${itemResult.messageId})` : ''
          }`
        );
      } else if (itemResult?.awaitingReply || res.awaitingReply > 0) {
        setNotice(
          `${eventItem.bookingReference} status: awaiting reply. ${
            itemResult?.error ||
            'Reply to the sandbox_start message on +91 6302543640, then click Retry.'
          }`
        );
      } else if (itemResult?.status === 'failed' || res.failed > 0) {
        setError(
          `${eventItem.bookingReference} status: failed. ${
            itemResult?.error || 'Check Details / Errors for failure details.'
          }`
        );
      } else {
        setNotice(
          `Refreshed WhatsApp logs for ${eventItem.bookingReference} (no pending event was processed).`
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Queued / Pending</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {loading ? '—' : counts.pending}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Delivered (Sent)</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-[#15803D] tabular-nums">
            {loading ? '—' : counts.sent}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Failed</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-red-700 tabular-nums">
            {loading ? '—' : counts.failed}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Skipped (No Opt-In)</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-slate-600 tabular-nums">
            {loading ? '—' : counts.skipped}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Notification status filter">
          {(
            [
              { id: 'all', label: `All (${counts.all})` },
              { id: 'pending', label: `Pending (${counts.pending})` },
              { id: 'sent', label: `Sent (${counts.sent})` },
              { id: 'failed', label: `Failed (${counts.failed})` },
              { id: 'skipped', label: `Skipped (${counts.skipped})` },
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={dispatchingQueue || loading || busyId !== null}
            onClick={() => void handleDispatchQueue()}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {dispatchingQueue ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Process Queue</span>
          </button>

          <button
            type="button"
            onClick={() => void loadLogs()}
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

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Loading WhatsApp notification outbox...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-600">
            <MessageSquare className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden="true" />
            No WhatsApp notification events found for the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3.5">Booking &amp; Event</th>
                  <th className="px-4 py-3.5">Recipient</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Details / Errors</th>
                  <th className="px-4 py-3.5">Timestamps (IST)</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEvents.map((ev) => {
                  const meta = STATUS_META[ev.status];
                  const isBusy = busyId === ev.id;
                  const vehicleLabel =
                    typeof ev.payload.vehicle_make_model === 'string'
                      ? ev.payload.vehicle_make_model
                      : '';
                  const customerLabel =
                    typeof ev.payload.customer_name === 'string' ? ev.payload.customer_name : '';

                  return (
                    <tr key={ev.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-5 py-3.5">
                        <div className="font-mono text-xs font-semibold text-[#1D4ED8]">
                          {ev.bookingReference}
                        </div>
                        <div className="mt-0.5 text-xs font-semibold text-[#0B1F3A]">
                          {ev.eventType === 'booking_created_admin'
                            ? 'Admin New Booking Alert'
                            : 'Customer Booking Confirmation'}
                        </div>
                        {(customerLabel || vehicleLabel) && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {[customerLabel, vehicleLabel].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-semibold text-[#0B1F3A]">
                          {ev.recipientRole === 'admin' ? 'Admin (Business)' : 'Customer'}
                        </div>
                        <div className="text-slate-600 tabular-nums">{ev.recipientPhone}</div>
                      </td>

                      <td className="px-4 py-3.5 text-xs font-semibold">
                        <span className={meta.className}>{meta.label}</span>
                        <div className="mt-0.5 font-normal text-[11px] text-slate-500 tabular-nums">
                          Attempts: {ev.attemptCount}/{ev.maxAttempts}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        {ev.skipReason ? (
                          <span className="text-slate-600">{ev.skipReason}</span>
                        ) : ev.lastError ? (
                          <span
                            className={
                              ev.lastError.includes('sandbox_start') ||
                              ev.lastError.includes('24-hour')
                                ? 'text-amber-700'
                                : 'text-red-700'
                            }
                          >
                            {ev.lastError}
                          </span>
                        ) : ev.providerMessageId ? (
                          <span className="font-mono text-[11px] text-slate-500">
                            Msg ID: {ev.providerMessageId}
                          </span>
                        ) : (
                          <span className="text-slate-500">Waiting for delivery</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums">
                        <div>Queued: {formatISTDateTime(ev.createdAt)}</div>
                        {ev.sentAt && (
                          <div className="mt-0.5 text-[#15803D]">
                            Sent: {formatISTDateTime(ev.sentAt)}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        {ev.status === 'pending' ? (
                          <button
                            type="button"
                            disabled={isBusy || dispatchingQueue}
                            onClick={() => void handleSendNowEvent(ev)}
                            className="inline-flex h-8 items-center gap-1 rounded-md bg-[#0B1F3A] px-2.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{isBusy ? 'Sending...' : 'Send Now'}</span>
                          </button>
                        ) : ev.status === 'failed' ? (
                          <button
                            type="button"
                            disabled={isBusy || dispatchingQueue}
                            onClick={() => void handleRetryEvent(ev)}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-[#0B1F3A] hover:bg-slate-50 disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>Retry</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
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
