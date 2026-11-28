import { getSupabaseConfigStatus, supabase } from '../lib/supabase';
import {
  AdminBookingRecord,
  BookedSlot,
  BookingRecord,
  BookingStatus,
  CreateBookingInput,
  CreateGuestBookingInput,
  PickupType,
  RentalDurationType,
  WhatsAppNotificationEvent,
  WhatsAppNotificationEventType,
  WhatsAppNotificationStatus,
} from '../types/booking';

type RawRow = Record<string, unknown>;

function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}

function normalizeStatus(value: unknown): BookingStatus {
  const s = readString(value).toLowerCase();
  if (s === 'confirmed' || s === 'completed' || s === 'cancelled') return s;
  return 'pending';
}

function normalizeDurationType(value: unknown): RentalDurationType {
  const s = readString(value).toLowerCase();
  if (s === '12h' || s === '24h') return s;
  return 'custom';
}

function normalizePickupType(value: unknown): PickupType {
  const s = readString(value).toLowerCase();
  return s === 'doorstep_delivery' ? 'doorstep_delivery' : 'hub_pickup';
}

function formatFallbackReference(id: string): string {
  return id ? `SSDC-${id.slice(0, 8).toUpperCase()}` : '';
}

function mapBookingRow(row: RawRow): BookingRecord {
  const vehicleObj = (row.vehicles as RawRow | null | undefined) ?? null;
  const make = readString(row.vehicle_brand ?? vehicleObj?.make);
  const model = readString(row.vehicle_model ?? vehicleObj?.model);
  const combinedMakeModel = [make, model].filter(Boolean).join(' ').trim();
  const id = readString(row.id ?? row.booking_id);

  return {
    id,
    bookingReference: readString(row.booking_reference) || formatFallbackReference(id) || undefined,
    userId: readString(row.user_id) || null,
    isGuest: readBoolean(row.is_guest, false),
    guestName: readString(row.guest_name) || undefined,
    guestPhone: readString(row.guest_phone) || undefined,
    vehicleId: readString(row.vehicle_id),
    startDate: readString(row.start_date),
    endDate: readString(row.end_date),
    rentalDuration: normalizeDurationType(row.rental_duration),
    durationHours: readNumber(row.duration_hours, 12),
    pickupType: normalizePickupType(row.pickup_type),
    deliveryAddress: readString(row.delivery_address) || null,
    baseAmount: readNumber(row.base_amount, 0),
    deliveryFee: readNumber(row.delivery_fee, 0),
    totalAmount: readNumber(row.total_amount, 0),
    status: normalizeStatus(row.status),
    notes: readString(row.notes) || null,
    whatsappOptIn: readBoolean(row.whatsapp_opt_in, false),
    createdAt: readString(row.created_at),
    vehicleName: readString(row.vehicle_name) || combinedMakeModel || undefined,
    vehicleBrand: make || undefined,
    vehicleModel: model || undefined,
    vehicleSlug: readString(row.vehicle_slug) || undefined,
    vehicleImageUrl: readString(row.vehicle_image_url ?? vehicleObj?.image_url) || undefined,
    vehicleFuelType: readString(row.vehicle_fuel_type ?? vehicleObj?.fuel_type) || undefined,
    vehicleTransmission:
      readString(row.vehicle_transmission ?? vehicleObj?.transmission) || undefined,
    vehicleRegistrationNumber:
      readString(row.vehicle_registration_number ?? vehicleObj?.registration_number) || undefined,
  };
}

function mapAdminBookingRow(row: RawRow): AdminBookingRecord {
  const base = mapBookingRow(row);
  const profileObj = (row.profiles as RawRow | null | undefined) ?? null;
  const isGuest = base.isGuest || Boolean(base.guestName || base.guestPhone);

  return {
    ...base,
    isGuest,
    customerName: isGuest
      ? readString(row.customer_name ?? row.guest_name) || 'Guest Customer'
      : readString(row.customer_name ?? profileObj?.full_name) || 'Registered Customer',
    customerPhone: isGuest
      ? readString(row.customer_phone ?? row.guest_phone) || '—'
      : readString(row.customer_phone ?? profileObj?.phone) || '—',
    customerEmail: isGuest ? '' : readString(row.customer_email) || '',
  };
}

function isRpcMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

function formatBookingError(
  error: { code?: string; message?: string } | null,
  fallback: string
): string {
  if (!error) return fallback;
  const msg = error.message || fallback;
  const lower = msg.toLowerCase();

  if (isRpcMissingError(error)) {
    if (lower.includes('create_guest_booking')) {
      return 'Guest booking database function is not deployed yet. Please run supabase/migrations/step4_guest_bookings.sql in your Supabase SQL Editor.';
    }
    return 'Booking database functions are not deployed yet. Please run the latest SQL migration in your Supabase SQL Editor.';
  }
  if (error.code === '23P01' || lower.includes('overlapping') || lower.includes('already reserved')) {
    return msg;
  }
  if (error.code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return msg;
  }
  return msg;
}

function getMissingConfigError(): string {
  const status = getSupabaseConfigStatus();
  return `Supabase is not configured (${status.missingVars.join(', ')}).`;
}

/**
 * Fetches vehicle IDs that have an overlapping `pending` or `confirmed` booking
 * for the requested IST window without exposing any customer PII.
 */
export async function fetchUnavailableVehicleIds(
  startDateIso: string,
  endDateIso: string
): Promise<{ vehicleIds: Set<string>; error: string | null }> {
  if (!supabase) {
    return { vehicleIds: new Set(), error: getMissingConfigError() };
  }

  const { data, error } = await supabase.rpc('get_unavailable_vehicle_ids', {
    p_start_date: startDateIso,
    p_end_date: endDateIso,
  });

  if (error) {
    if (isRpcMissingError(error)) {
      return { vehicleIds: new Set(), error: null };
    }
    return { vehicleIds: new Set(), error: error.message };
  }

  const ids = new Set<string>();
  if (Array.isArray(data)) {
    for (const row of data as RawRow[]) {
      const id = readString(row.vehicle_id);
      if (id) ids.add(id);
    }
  }
  return { vehicleIds: ids, error: null };
}

/**
 * Fetches upcoming reserved slots (pending/confirmed) for a single vehicle
 * without returning any customer details.
 */
export async function fetchVehicleBookedSlots(
  vehicleId: string
): Promise<{ slots: BookedSlot[]; error: string | null }> {
  if (!supabase) {
    return { slots: [], error: getMissingConfigError() };
  }

  const { data, error } = await supabase.rpc('get_vehicle_booked_slots', {
    p_vehicle_id: vehicleId,
  });

  if (error) {
    if (isRpcMissingError(error)) {
      return { slots: [], error: null };
    }
    return { slots: [], error: error.message };
  }

  const slots: BookedSlot[] = Array.isArray(data)
    ? (data as RawRow[]).map((row) => ({
        startDate: readString(row.start_date),
        endDate: readString(row.end_date),
        status: normalizeStatus(row.status),
      }))
    : [];

  return { slots, error: null };
}

/**
 * Creates a pending guest booking atomically on the database side without requiring login.
 * Duration, pricing, delivery fee, active vehicle, overlap lock, and `pending` status
 * are strictly validated and computed inside PostgreSQL.
 */
export async function createGuestBooking(
  input: CreateGuestBookingInput
): Promise<{ booking: BookingRecord | null; error: string | null }> {
  if (!supabase) {
    return { booking: null, error: getMissingConfigError() };
  }

  const baseParams = {
    p_vehicle_id: input.vehicleId,
    p_guest_name: input.guestName.trim(),
    p_guest_phone: input.guestPhone.trim(),
    p_start_date: input.startDateIso,
    p_end_date: input.endDateIso,
    p_rental_duration: input.rentalDuration,
    p_pickup_type: input.pickupType,
    p_delivery_address:
      input.pickupType === 'doorstep_delivery' ? (input.deliveryAddress?.trim() || null) : null,
    p_notes: input.notes?.trim() || null,
  };

  let { data, error } = await supabase.rpc('create_guest_booking', {
    ...baseParams,
    p_whatsapp_opt_in: Boolean(input.whatsappOptIn),
  });

  // Preserve live compatibility before Step 6 SQL is run when opt-in is unchecked
  if (error && isRpcMissingError(error) && !input.whatsappOptIn) {
    const legacyRes = await supabase.rpc('create_guest_booking', baseParams);
    data = legacyRes.data;
    error = legacyRes.error;
  } else if (error && isRpcMissingError(error) && input.whatsappOptIn) {
    return {
      booking: null,
      error:
        'WhatsApp opt-in database support is not deployed yet. Please run supabase/migrations/step6_whatsapp_notifications.sql in Supabase SQL Editor.',
    };
  }

  if (error) {
    return {
      booking: null,
      error: formatBookingError(error, 'Could not submit your booking request. Please try again.'),
    };
  }

  const row = Array.isArray(data) ? (data[0] as RawRow | undefined) : (data as RawRow | null);
  if (!row) {
    return {
      booking: null,
      error: 'Booking request did not return a confirmation record.',
    };
  }

  return { booking: mapBookingRow(row), error: null };
}

/**
 * Creates a pending booking for an authenticated user atomically on the database side.
 * user_id, duration_hours, base_amount, delivery_fee, total_amount, and status
 * are enforced & computed in PostgreSQL — never trusted from the browser.
 */
export async function createBooking(
  input: CreateBookingInput
): Promise<{ booking: BookingRecord | null; error: string | null }> {
  if (!supabase) {
    return { booking: null, error: getMissingConfigError() };
  }

  // Re-verify active session before invoking booking RPC
  const { data: userData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !userData.user) {
    return {
      booking: null,
      error: 'Please sign in to your customer account before creating a booking.',
    };
  }

  const baseParams = {
    p_vehicle_id: input.vehicleId,
    p_start_date: input.startDateIso,
    p_end_date: input.endDateIso,
    p_rental_duration: input.rentalDuration,
    p_pickup_type: input.pickupType,
    p_delivery_address:
      input.pickupType === 'doorstep_delivery' ? (input.deliveryAddress?.trim() || null) : null,
    p_notes: input.notes?.trim() || null,
  };

  let { data, error } = await supabase.rpc('create_booking', {
    ...baseParams,
    p_whatsapp_opt_in: Boolean(input.whatsappOptIn),
    p_contact_phone: input.contactPhone?.trim() || null,
  });

  if (error && isRpcMissingError(error) && !input.whatsappOptIn) {
    const legacyRes = await supabase.rpc('create_booking', baseParams);
    data = legacyRes.data;
    error = legacyRes.error;
  } else if (error && isRpcMissingError(error) && input.whatsappOptIn) {
    return {
      booking: null,
      error:
        'WhatsApp opt-in database support is not deployed yet. Please run supabase/migrations/step6_whatsapp_notifications.sql in Supabase SQL Editor.',
    };
  }

  if (error) {
    return {
      booking: null,
      error: formatBookingError(error, 'Could not submit your booking request. Please try again.'),
    };
  }

  const row = Array.isArray(data) ? (data[0] as RawRow | undefined) : (data as RawRow | null);
  if (!row) {
    return {
      booking: null,
      error: 'Booking request did not return a confirmation record.',
    };
  }

  return { booking: mapBookingRow(row), error: null };
}

/**
 * Fetches ONLY the signed-in customer's own non-guest bookings.
 */
export async function fetchMyBookings(
  userId: string
): Promise<{ bookings: BookingRecord[]; error: string | null }> {
  if (!supabase) {
    return { bookings: [], error: getMissingConfigError() };
  }

  const rpcRes = await supabase.rpc('get_my_bookings');
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return {
      bookings: (rpcRes.data as RawRow[]).map(mapBookingRow),
      error: null,
    };
  }

  if (rpcRes.error && !isRpcMissingError(rpcRes.error)) {
    return { bookings: [], error: rpcRes.error.message };
  }

  // Graceful fallback to direct RLS-protected table select if RPC is not run yet
  const fallbackRes = await supabase
    .from('bookings')
    .select('*, vehicles(id, make, model, image_url, fuel_type, transmission, registration_number)')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });

  if (fallbackRes.error) {
    return { bookings: [], error: fallbackRes.error.message };
  }

  const rows = Array.isArray(fallbackRes.data) ? (fallbackRes.data as RawRow[]) : [];
  return {
    bookings: rows.filter((r) => !readBoolean(r.is_guest, false)).map(mapBookingRow),
    error: null,
  };
}

/**
 * Allows an authenticated customer to cancel ONLY their own `pending` booking.
 */
export async function cancelOwnBooking(
  bookingId: string
): Promise<{ booking: BookingRecord | null; error: string | null }> {
  if (!supabase) {
    return { booking: null, error: getMissingConfigError() };
  }

  const rpcRes = await supabase.rpc('cancel_own_booking', {
    p_booking_id: bookingId,
  });

  if (!rpcRes.error) {
    const row = Array.isArray(rpcRes.data)
      ? (rpcRes.data[0] as RawRow | undefined)
      : (rpcRes.data as RawRow | null);
    return {
      booking: row ? mapBookingRow(row) : null,
      error: null,
    };
  }

  if (!isRpcMissingError(rpcRes.error)) {
    return {
      booking: null,
      error: formatBookingError(rpcRes.error, 'Could not cancel booking.'),
    };
  }

  // Fallback under existing customer pending-cancel RLS policy
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { booking: null, error: 'Authentication required.' };
  }

  const directRes = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('user_id', userData.user.id)
    .eq('status', 'pending')
    .select('*')
    .single();

  if (directRes.error) {
    return { booking: null, error: directRes.error.message };
  }

  return { booking: mapBookingRow(directRes.data as RawRow), error: null };
}

/**
 * Fetches all bookings (both authenticated customer & guest bookings) for authorized administrators.
 */
export async function fetchAllBookingsAdmin(): Promise<{
  bookings: AdminBookingRecord[];
  error: string | null;
}> {
  if (!supabase) {
    return { bookings: [], error: getMissingConfigError() };
  }

  const rpcRes = await supabase.rpc('admin_list_bookings');
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return {
      bookings: (rpcRes.data as RawRow[]).map(mapAdminBookingRow),
      error: null,
    };
  }

  if (rpcRes.error && !isRpcMissingError(rpcRes.error)) {
    return {
      bookings: [],
      error: formatBookingError(rpcRes.error, 'Could not load bookings.'),
    };
  }

  // Fallback query under admin SELECT policy
  const fallbackRes = await supabase
    .from('bookings')
    .select('*, vehicles(id, make, model, image_url, registration_number), profiles(full_name, phone)')
    .order('created_at', { ascending: false });

  if (fallbackRes.error) {
    return { bookings: [], error: fallbackRes.error.message };
  }

  const rows = Array.isArray(fallbackRes.data) ? (fallbackRes.data as RawRow[]) : [];
  return {
    bookings: rows.map(mapAdminBookingRow),
    error: null,
  };
}

/**
 * Updates booking status (`confirmed`, `completed`, `cancelled`) via verified admin RPC.
 */
export async function updateBookingStatusAdmin(
  bookingId: string,
  nextStatus: 'confirmed' | 'completed' | 'cancelled'
): Promise<{ booking: BookingRecord | null; error: string | null }> {
  if (!supabase) {
    return { booking: null, error: getMissingConfigError() };
  }

  const rpcRes = await supabase.rpc('admin_update_booking_status', {
    p_booking_id: bookingId,
    p_next_status: nextStatus,
  });

  if (!rpcRes.error) {
    const row = Array.isArray(rpcRes.data)
      ? (rpcRes.data[0] as RawRow | undefined)
      : (rpcRes.data as RawRow | null);
    return {
      booking: row ? mapBookingRow(row) : null,
      error: null,
    };
  }

  return {
    booking: null,
    error: formatBookingError(rpcRes.error, 'Could not update booking status.'),
  };
}

function normalizeWhatsAppStatus(value: unknown): WhatsAppNotificationStatus {
  const s = readString(value).toLowerCase();
  if (s === 'processing' || s === 'sent' || s === 'failed' || s === 'skipped') {
    return s;
  }
  return 'pending';
}

function normalizeWhatsAppEventType(value: unknown): WhatsAppNotificationEventType {
  return readString(value).toLowerCase() === 'booking_confirmed_customer'
    ? 'booking_confirmed_customer'
    : 'booking_created_admin';
}

function mapWhatsAppNotificationRow(row: RawRow): WhatsAppNotificationEvent {
  const bookingId = readString(row.booking_id);
  return {
    id: readString(row.id),
    bookingId,
    bookingReference: readString(row.booking_reference) || formatFallbackReference(bookingId),
    eventType: normalizeWhatsAppEventType(row.event_type),
    recipientRole: readString(row.recipient_role).toLowerCase() === 'customer' ? 'customer' : 'admin',
    recipientPhone: readString(row.recipient_phone),
    templateKey: readString(row.template_key),
    payload:
      row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {},
    status: normalizeWhatsAppStatus(row.status),
    skipReason: readString(row.skip_reason) || null,
    attemptCount: readNumber(row.attempt_count, 0),
    maxAttempts: readNumber(row.max_attempts, 5),
    lastAttemptAt: readString(row.last_attempt_at) || null,
    nextRetryAt: readString(row.next_retry_at) || null,
    sentAt: readString(row.sent_at) || null,
    providerMessageId: readString(row.provider_message_id) || null,
    lastError: readString(row.last_error) || null,
    createdAt: readString(row.created_at),
  };
}

export interface WhatsAppDispatchItemResult {
  eventId?: string;
  bookingId?: string;
  eventType?: WhatsAppNotificationEventType;
  status?: 'sent' | 'failed';
  awaitingReply?: boolean;
  messageId?: string | null;
  error?: string | null;
}

export interface WhatsAppDispatchResponse {
  invoked: boolean;
  queuedOnly: boolean;
  processed: number;
  sent: number;
  failed: number;
  awaitingReply: number;
  results: WhatsAppDispatchItemResult[];
  message?: string;
  error?: string;
}

async function extractFunctionsErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') {
    return 'Could not reach the WhatsApp notification Edge Function.';
  }

  const errObj = error as { message?: unknown; context?: unknown };
  const context = errObj.context;

  if (context && typeof (context as Response).clone === 'function') {
    try {
      const resClone = (context as Response).clone();
      const parsed = (await resClone.json()) as Record<string, unknown> | null;
      const bodyErr = readString(parsed?.error || parsed?.message);
      if (bodyErr) return bodyErr;
    } catch {
      // Ignore JSON parse failures on non-JSON error responses
    }
  }

  return readString(errObj.message) || 'Could not reach the WhatsApp notification Edge Function.';
}

/**
 * Triggers the server-side `send-whatsapp-notifications` Supabase Edge Function.
 * Never throws or blocks booking UX if Edge Functions or provider credentials are not yet active.
 */
export async function triggerWhatsAppNotificationDispatch(params?: {
  bookingId?: string;
  eventId?: string;
  eventType?: WhatsAppNotificationEventType;
}): Promise<WhatsAppDispatchResponse> {
  if (!supabase) {
    return {
      invoked: false,
      queuedOnly: true,
      processed: 0,
      sent: 0,
      failed: 0,
      awaitingReply: 0,
      results: [],
      error: getMissingConfigError(),
    };
  }

  try {
    const body: Record<string, string> = {};
    if (params?.bookingId) body.bookingId = params.bookingId;
    if (params?.eventId) body.eventId = params.eventId;
    if (params?.eventType) body.eventType = params.eventType;

    const { data, error } = await supabase.functions.invoke('send-whatsapp-notifications', {
      body,
    });

    if (error) {
      const errMessage = await extractFunctionsErrorMessage(error);
      return {
        invoked: false,
        queuedOnly: true,
        processed: 0,
        sent: 0,
        failed: 0,
        awaitingReply: 0,
        results: [],
        message: errMessage,
        error: errMessage,
      };
    }

    if (!data || typeof data !== 'object') {
      const errMessage = 'Unexpected empty response from send-whatsapp-notifications.';
      return {
        invoked: false,
        queuedOnly: true,
        processed: 0,
        sent: 0,
        failed: 0,
        awaitingReply: 0,
        results: [],
        message: errMessage,
        error: errMessage,
      };
    }

    const resObj = data as Record<string, unknown>;
    if (resObj.ok === false) {
      const errMessage = readString(resObj.error || resObj.message, 'Notification dispatch failed.');
      return {
        invoked: false,
        queuedOnly: false,
        processed: readNumber(resObj.processed, 0),
        sent: readNumber(resObj.sent, 0),
        failed: readNumber(resObj.failed, 0),
        awaitingReply: readNumber(resObj.awaitingReply, 0),
        results: [],
        message: errMessage,
        error: errMessage,
      };
    }

    const rawResults = Array.isArray(resObj.results) ? (resObj.results as RawRow[]) : [];
    const results: WhatsAppDispatchItemResult[] = rawResults.map((item) => ({
      eventId: readString(item.eventId) || undefined,
      bookingId: readString(item.bookingId) || undefined,
      eventType: item.eventType ? normalizeWhatsAppEventType(item.eventType) : undefined,
      status: item.status === 'sent' ? 'sent' : item.status === 'failed' ? 'failed' : undefined,
      awaitingReply: readBoolean(item.awaitingReply, false),
      messageId: readString(item.messageId) || null,
      error: readString(item.error) || null,
    }));

    const awaitingReply =
      readNumber(resObj.awaitingReply, 0) ||
      results.filter((r) => Boolean(r.awaitingReply)).length;

    return {
      invoked: true,
      queuedOnly: Boolean(resObj.queuedOnly),
      processed: readNumber(resObj.processed, results.length),
      sent: readNumber(resObj.sent, 0),
      failed: readNumber(resObj.failed, 0),
      awaitingReply,
      results,
      message: readString(resObj.message) || undefined,
    };
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : 'Unexpected error invoking WhatsApp notification dispatch.';
    return {
      invoked: false,
      queuedOnly: true,
      processed: 0,
      sent: 0,
      failed: 0,
      awaitingReply: 0,
      results: [],
      message: errMessage,
      error: errMessage,
    };
  }
}

/**
 * Dispatches a single scoped pending notification using the active authenticated admin session.
 * Processes only the specified `bookingId` + `eventType` (never an unscoped batch).
 */
export async function sendWhatsAppNotificationNowAdmin(
  bookingId: string,
  eventType: WhatsAppNotificationEventType
): Promise<WhatsAppDispatchResponse> {
  if (!supabase) {
    return {
      invoked: false,
      queuedOnly: true,
      processed: 0,
      sent: 0,
      failed: 0,
      awaitingReply: 0,
      results: [],
      error: getMissingConfigError(),
    };
  }

  const cleanBookingId = bookingId.trim();
  if (!cleanBookingId) {
    return {
      invoked: false,
      queuedOnly: false,
      processed: 0,
      sent: 0,
      failed: 0,
      awaitingReply: 0,
      results: [],
      error: 'Missing booking ID for this notification.',
    };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    return {
      invoked: false,
      queuedOnly: false,
      processed: 0,
      sent: 0,
      failed: 0,
      awaitingReply: 0,
      results: [],
      error: 'Admin session expired or missing. Please sign in again.',
    };
  }

  return triggerWhatsAppNotificationDispatch({
    bookingId: cleanBookingId,
    eventType,
  });
}

/**
 * Fetches WhatsApp outbox notification logs for verified administrators.
 */
export async function fetchWhatsAppNotificationsAdmin(bookingId?: string): Promise<{
  events: WhatsAppNotificationEvent[];
  missingSchema: boolean;
  error: string | null;
}> {
  if (!supabase) {
    return { events: [], missingSchema: false, error: getMissingConfigError() };
  }

  const { data, error } = await supabase.rpc('admin_list_whatsapp_notifications', {
    p_booking_id: bookingId ?? null,
  });

  if (error) {
    if (isRpcMissingError(error)) {
      return {
        events: [],
        missingSchema: true,
        error:
          'WhatsApp notification outbox tables are not deployed yet. Run supabase/migrations/step6_whatsapp_notifications.sql in Supabase SQL Editor.',
      };
    }
    return {
      events: [],
      missingSchema: false,
      error: formatBookingError(error, 'Could not load WhatsApp notification logs.'),
    };
  }

  const rows = Array.isArray(data) ? (data as RawRow[]) : [];
  return {
    events: rows.map(mapWhatsAppNotificationRow),
    missingSchema: false,
    error: null,
  };
}

/**
 * Safely re-queues a failed notification event (blocked on server for 'sent' or 'skipped' rows)
 * and attempts immediate dispatch via Edge Function.
 */
export async function retryWhatsAppNotificationAdmin(eventId: string): Promise<{
  queued: boolean;
  dispatch: Awaited<ReturnType<typeof triggerWhatsAppNotificationDispatch>>;
  error: string | null;
}> {
  if (!supabase) {
    return {
      queued: false,
      dispatch: {
        invoked: false,
        queuedOnly: true,
        processed: 0,
        sent: 0,
        failed: 0,
        awaitingReply: 0,
        results: [],
      },
      error: getMissingConfigError(),
    };
  }

  const { error } = await supabase.rpc('admin_retry_whatsapp_notification', {
    p_event_id: eventId,
  });

  if (error) {
    return {
      queued: false,
      dispatch: {
        invoked: false,
        queuedOnly: true,
        processed: 0,
        sent: 0,
        failed: 0,
        awaitingReply: 0,
        results: [],
      },
      error: formatBookingError(error, 'Could not re-queue WhatsApp notification.'),
    };
  }

  const dispatch = await triggerWhatsAppNotificationDispatch({ eventId });
  return { queued: true, dispatch, error: null };
}
