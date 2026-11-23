import { BUSINESS_CONFIG } from '../config/businessConfig';
import { BookingPriceBreakdown, BookedSlot, PickupType } from '../types/booking';
import { RentalSearchParams } from '../types/vehicle';

export const IST_TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET = '+05:30';
export const MIN_RENTAL_HOURS = 12;

export function formatINR(amount: number): string {
  const hasDecimals = Math.abs(amount % 1) > 0.001;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Returns YYYY-MM-DD in Asia/Kolkata (IST) timezone with an optional day offset.
 */
export function getTodayInputDate(offsetDays = 0): string {
  const nowIstDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  if (offsetDays === 0) {
    return nowIstDateStr;
  }

  const instant = new Date(`${nowIstDateStr}T00:00:00${IST_OFFSET}`);
  instant.setUTCDate(instant.getUTCDate() + offsetDays);

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Returns current time rounded up to the next hour in Asia/Kolkata (HH:mm),
 * useful for validating same-day pickups in IST.
 */
export function getCurrentISTTimeParts(): { date: string; time: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  return { date, time };
}

/**
 * Converts a customer-entered IST date (YYYY-MM-DD) and time (HH:mm)
 * into an explicit ISO-8601 timestamp string with +05:30 offset.
 */
export function toISTTimestampIso(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const normalizedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const candidate = `${dateStr}T${normalizedTime}${IST_OFFSET}`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * Adds a number of hours to an IST date+time and returns the resulting IST YYYY-MM-DD and HH:mm.
 */
export function addHoursInIST(
  dateStr: string,
  timeStr: string,
  hoursToAdd: number
): { date: string; time: string } | null {
  const startIso = toISTTimestampIso(dateStr, timeStr);
  if (!startIso) return null;

  const endInstant = new Date(new Date(startIso).getTime() + hoursToAdd * 3_600_000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(endInstant);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(endInstant);

  return { date, time };
}

/**
 * Formats any stored timestamptz ISO string explicitly in Asia/Kolkata (IST).
 */
export function formatISTDateTime(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return isoString;

  const datePart = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);

  const timePart = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);

  return `${datePart}, ${timePart} IST`;
}

export function getDefaultSearchParams(): RentalSearchParams {
  return {
    pickupDate: getTodayInputDate(1),
    pickupTime: '09:00',
    returnDate: getTodayInputDate(2),
    returnTime: '09:00',
  };
}

export function calculateDurationHours(params: Partial<RentalSearchParams>): number | null {
  if (!params.pickupDate || !params.returnDate) {
    return null;
  }
  const pickupTime = params.pickupTime || '09:00';
  const returnTime = params.returnTime || '09:00';

  const startIso = toISTTimestampIso(params.pickupDate, pickupTime);
  const endIso = toISTTimestampIso(params.returnDate, returnTime);
  if (!startIso || !endIso) return null;

  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (diffMs <= 0) return null;

  return Math.ceil(diffMs / 3_600_000);
}

export function calculateRentalDays(params: Partial<RentalSearchParams>): number | null {
  const hours = calculateDurationHours(params);
  if (hours === null) return null;
  return Math.max(1, Math.ceil(hours / 24));
}

export function formatDurationLabel(durationHours: number): string {
  const fullDays = Math.floor(durationHours / 24);
  const extraHours = durationHours % 24;
  if (fullDays === 0) {
    return `${durationHours} hrs`;
  }
  if (extraHours === 0) {
    return `${durationHours} hrs (${fullDays} ${fullDays === 1 ? 'Day' : 'Days'})`;
  }
  return `${durationHours} hrs (${fullDays}d ${extraHours}h)`;
}

function roundINR(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Client-side preview matching the exact server PostgreSQL pricing formula
 * in `phase5_booking_system.sql` (rounded to 2 decimal places). Always recalculated server-side on submit.
 */
export function calculateBookingPricePreview(options: {
  dailyPrice: number | null;
  hourlyPrice: number | null;
  durationHours: number;
  pickupType: PickupType;
}): BookingPriceBreakdown | null {
  const daily = options.dailyPrice ?? 0;
  const hourly = options.hourlyPrice ?? 0;
  const { durationHours, pickupType } = options;

  if (durationHours < MIN_RENTAL_HOURS || (daily <= 0 && hourly <= 0)) {
    return null;
  }

  const fullDays = Math.floor(durationHours / 24);
  const extraHours = durationHours % 24;

  let baseAmount = 0;
  if (daily > 0) {
    const partial =
      hourly > 0
        ? Math.min(extraHours * hourly, daily)
        : Math.min((daily / 24) * extraHours, daily);
    baseAmount = roundINR(fullDays * daily + partial);
  } else {
    baseAmount = roundINR(durationHours * hourly);
  }

  const deliveryFee =
    pickupType === 'doorstep_delivery' ? roundINR(BUSINESS_CONFIG.doorstepDeliveryFee) : 0;

  return {
    durationHours,
    fullDays,
    extraHours,
    baseAmount,
    deliveryFee,
    totalAmount: roundINR(baseAmount + deliveryFee),
  };
}

/**
 * Interval overlap rule:
 * existing.start_date < requested.end_date AND existing.end_date > requested.start_date
 */
export function hasBookingOverlap(
  slots: BookedSlot[],
  requestedStartIso: string,
  requestedEndIso: string
): BookedSlot | null {
  const reqStart = new Date(requestedStartIso).getTime();
  const reqEnd = new Date(requestedEndIso).getTime();
  if (Number.isNaN(reqStart) || Number.isNaN(reqEnd)) return null;

  for (const slot of slots) {
    if (slot.status !== 'pending' && slot.status !== 'confirmed') continue;
    const existingStart = new Date(slot.startDate).getTime();
    const existingEnd = new Date(slot.endDate).getTime();
    if (existingStart < reqEnd && existingEnd > reqStart) {
      return slot;
    }
  }
  return null;
}

export function buildSearchQueryString(params: Partial<RentalSearchParams>): string {
  const sp = new URLSearchParams();
  if (params.pickupDate) sp.set('pickupDate', params.pickupDate);
  if (params.pickupTime) sp.set('pickupTime', params.pickupTime);
  if (params.returnDate) sp.set('returnDate', params.returnDate);
  if (params.returnTime) sp.set('returnTime', params.returnTime);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}
