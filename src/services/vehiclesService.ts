import { getSupabaseConfigStatus, supabase } from '../lib/supabase';
import { Vehicle, VehicleWriteInput } from '../types/vehicle';

export interface VehicleQueryResult {
  vehicles: Vehicle[];
  detectedColumns: string[];
  error: string | null;
  isConfigMissing: boolean;
}

export interface SingleVehicleQueryResult {
  vehicle: Vehicle | null;
  error: string | null;
  isConfigMissing: boolean;
}

export interface VehicleMutationResult {
  vehicle: Vehicle | null;
  skippedFields: string[];
  error: string | null;
}

export interface VehicleDeleteResult {
  success: boolean;
  hasLinkedBookings?: boolean;
  error: string | null;
}

type RawRecord = Record<string, unknown>;

export const VEHICLES_SELECT_COLUMNS =
  'id, make, model, year, fuel_type, transmission, seats, registration_number, price_12h, price_24h, security_deposit, mileage, image_url, gallery_urls, features, description, is_active, created_at, updated_at';

const ACTUAL_VEHICLE_COLUMNS = [
  'id',
  'make',
  'model',
  'year',
  'fuel_type',
  'transmission',
  'seats',
  'registration_number',
  'price_12h',
  'price_24h',
  'security_deposit',
  'mileage',
  'image_url',
  'gallery_urls',
  'features',
  'description',
  'is_active',
  'created_at',
  'updated_at',
];

function toNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return null;
}

export function sanitizeImageUrl(value: unknown): string {
  const raw = toNonEmptyString(value);
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function toSlug(input: string, fallbackId: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return fallbackId;
  return `${base}-${fallbackId.slice(0, 8)}`;
}

function parseFeatures(row: RawRecord): string[] {
  const candidate = row.features;
  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => toNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }
  if (typeof candidate === 'string') {
    return candidate
      .split(/[,|\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseGalleryUrls(row: RawRecord, primaryImage: string): string[] {
  const rawList = row.gallery_urls;
  const collected: string[] = [];

  if (primaryImage) {
    collected.push(primaryImage);
  }

  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      const sanitized = sanitizeImageUrl(item);
      if (sanitized && !collected.includes(sanitized)) {
        collected.push(sanitized);
      }
    }
  } else if (typeof rawList === 'string' && rawList.trim()) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const sanitized = sanitizeImageUrl(item);
          if (sanitized && !collected.includes(sanitized)) {
            collected.push(sanitized);
          }
        }
      }
    } catch {
      for (const part of rawList.split(',')) {
        const sanitized = sanitizeImageUrl(part);
        if (sanitized && !collected.includes(sanitized)) {
          collected.push(sanitized);
        }
      }
    }
  }

  return collected;
}

/**
 * Maps a row from `public.vehicles` using only its actual columns.
 */
export function mapSupabaseVehicleRow(row: RawRecord, index: number): Vehicle {
  const id = toNonEmptyString(row.id) ?? String(index + 1);
  const make = toNonEmptyString(row.make) ?? '';
  const model = toNonEmptyString(row.model) ?? '';
  const name = [make, model].filter(Boolean).join(' ').trim() || `Vehicle #${id.slice(0, 8)}`;
  const slug = toSlug(name, id);

  const year = toNumber(row.year);
  const fuelType = toNonEmptyString(row.fuel_type) ?? '';
  const transmission = toNonEmptyString(row.transmission) ?? '';
  const seats = toNumber(row.seats);
  const registrationNumber = toNonEmptyString(row.registration_number) ?? '';

  const price12h = toNumber(row.price_12h);
  const price24h = toNumber(row.price_24h);
  const securityDeposit = toNumber(row.security_deposit);
  const mileage = toNonEmptyString(row.mileage) ?? '';

  const image = sanitizeImageUrl(row.image_url);
  const images = parseGalleryUrls(row, image);
  const features = parseFeatures(row);
  const description = toNonEmptyString(row.description) ?? '';

  const activeFlag = toBoolean(row.is_active);
  const isActive = activeFlag !== null ? activeFlag : true;

  return {
    id,
    slug,
    make,
    model,
    name,
    year,
    fuelType,
    transmission,
    seats,
    registrationNumber,
    price12h,
    price24h,
    securityDeposit,
    mileage,
    image,
    images,
    features,
    description,
    isActive,
    createdAt: toNonEmptyString(row.created_at) ?? undefined,
    updatedAt: toNonEmptyString(row.updated_at) ?? undefined,
    rawColumns: Object.keys(row),
  };
}

function getMissingConfigError(): string {
  const status = getSupabaseConfigStatus();
  return `Supabase environment variables are not configured (${status.missingVars.join(', ')}). Add them in your project Secrets or .env.local and restart the dev server.`;
}

export async function inspectVehiclesTableColumns(): Promise<string[]> {
  return [...ACTUAL_VEHICLE_COLUMNS];
}

export async function fetchVehicles(options?: {
  includeInactive?: boolean;
}): Promise<VehicleQueryResult> {
  if (!supabase) {
    return {
      vehicles: [],
      detectedColumns: [],
      error: getMissingConfigError(),
      isConfigMissing: true,
    };
  }

  let query = supabase.from('vehicles').select(VEHICLES_SELECT_COLUMNS);

  const includeInactive = options?.includeInactive ?? false;
  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    return {
      vehicles: [],
      detectedColumns: [...ACTUAL_VEHICLE_COLUMNS],
      error: error.message || 'Failed to load vehicles from Supabase.',
      isConfigMissing: false,
    };
  }

  const rows = Array.isArray(data) ? (data as RawRecord[]) : [];
  const allVehicles = rows
    .map((row, idx) => mapSupabaseVehicleRow(row, idx))
    .sort((a, b) => {
      if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
        return a.createdAt.localeCompare(b.createdAt);
      }
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return a.id.localeCompare(b.id);
    });

  const filteredVehicles = includeInactive
    ? allVehicles
    : allVehicles.filter((car) => car.isActive);

  return {
    vehicles: filteredVehicles,
    detectedColumns: [...ACTUAL_VEHICLE_COLUMNS],
    error: null,
    isConfigMissing: false,
  };
}

export async function fetchVehicleBySlugOrId(
  slugOrId: string,
  options?: { includeInactive?: boolean }
): Promise<SingleVehicleQueryResult> {
  const result = await fetchVehicles({ includeInactive: options?.includeInactive ?? false });
  if (result.error) {
    return {
      vehicle: null,
      error: result.error,
      isConfigMissing: result.isConfigMissing,
    };
  }

  const match = result.vehicles.find(
    (item) => item.id === slugOrId || item.slug === slugOrId
  );

  return {
    vehicle: match ?? null,
    error: null,
    isConfigMissing: false,
  };
}

function buildVehiclePayload(
  input: Partial<VehicleWriteInput>,
  mode: 'create' | 'edit'
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (mode === 'create' && input.id) {
    payload.id = input.id;
  }

  if (input.make !== undefined) payload.make = input.make.trim();
  if (input.model !== undefined) payload.model = input.model.trim();
  if (input.year !== undefined) payload.year = input.year;
  if (input.fuelType !== undefined) payload.fuel_type = input.fuelType.trim();
  if (input.transmission !== undefined) payload.transmission = input.transmission.trim();
  if (input.seats !== undefined) payload.seats = input.seats;
  if (input.registrationNumber !== undefined) {
    payload.registration_number = input.registrationNumber.trim().toUpperCase() || null;
  }
  if (input.price12h !== undefined) payload.price_12h = input.price12h;
  if (input.price24h !== undefined) payload.price_24h = input.price24h;
  if (input.securityDeposit !== undefined) payload.security_deposit = input.securityDeposit;
  if (input.mileage !== undefined) payload.mileage = input.mileage.trim() || null;
  if (input.description !== undefined) payload.description = input.description.trim();
  if (input.features !== undefined) payload.features = input.features;
  if (input.isActive !== undefined) payload.is_active = input.isActive;

  if (input.image !== undefined) {
    const trimmed = input.image.trim();
    payload.image_url = trimmed || (mode === 'create' ? '' : null);
  }
  if (input.images !== undefined) {
    payload.gallery_urls = input.images;
  }

  payload.updated_at = new Date().toISOString();
  return payload;
}

function formatWriteError(
  error: { code?: string; message?: string } | null,
  fallback: string
): string {
  if (!error) return fallback;
  const msg = error.message || fallback;
  const lower = msg.toLowerCase();

  if (
    error.code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied')
  ) {
    return 'Permission denied by Supabase RLS. Sign in with an administrator account whose role is set to "admin" in profiles and ensure admin write policies are active on vehicles.';
  }

  if (error.code === '23502' || lower.includes('not-null constraint')) {
    if (lower.includes('image_url')) {
      return 'A vehicle photograph must be uploaded to vehicle-images before saving (image_url cannot be empty).';
    }
    return `Required database field is missing: ${msg}`;
  }

  return msg;
}

export async function createVehicle(
  input: VehicleWriteInput,
  _detectedColumns?: string[]
): Promise<VehicleMutationResult> {
  if (!supabase) {
    return { vehicle: null, skippedFields: [], error: getMissingConfigError() };
  }

  const cleanPrimaryImage = sanitizeImageUrl(input.image);
  if (!cleanPrimaryImage) {
    return {
      vehicle: null,
      skippedFields: [],
      error: 'A valid uploaded vehicle image URL is required before saving the vehicle.',
    };
  }

  const normalizedGallery = Array.from(
    new Set([
      cleanPrimaryImage,
      ...(input.images || []).map((url) => sanitizeImageUrl(url)).filter(Boolean),
    ])
  );

  const payload = buildVehiclePayload(
    { ...input, image: cleanPrimaryImage, images: normalizedGallery },
    'create'
  );

  const { data, error } = await supabase
    .from('vehicles')
    .insert(payload)
    .select(VEHICLES_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return {
      vehicle: null,
      skippedFields: [],
      error: formatWriteError(error, 'Failed to add vehicle. Check administrator permissions.'),
    };
  }

  return {
    vehicle: mapSupabaseVehicleRow(data as RawRecord, 0),
    skippedFields: [],
    error: null,
  };
}

export async function updateVehicle(
  vehicleId: string,
  patch: Partial<VehicleWriteInput>,
  _detectedColumns?: string[]
): Promise<VehicleMutationResult> {
  if (!supabase) {
    return { vehicle: null, skippedFields: [], error: getMissingConfigError() };
  }

  const payload = buildVehiclePayload(patch, 'edit');

  const { data, error } = await supabase
    .from('vehicles')
    .update(payload)
    .eq('id', vehicleId)
    .select(VEHICLES_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return {
      vehicle: null,
      skippedFields: [],
      error: formatWriteError(error, 'Failed to update vehicle. Check administrator permissions.'),
    };
  }

  return {
    vehicle: mapSupabaseVehicleRow(data as RawRecord, 0),
    skippedFields: [],
    error: null,
  };
}

export async function deleteVehicle(
  vehicleId: string,
  _detectedColumns?: string[]
): Promise<VehicleDeleteResult> {
  if (!supabase) {
    return { success: false, error: getMissingConfigError() };
  }

  const { count, error: bookingCheckError } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);

  if (!bookingCheckError && typeof count === 'number' && count > 0) {
    return {
      success: false,
      hasLinkedBookings: true,
      error: `This vehicle has ${count} linked booking record(s). Deactivate it instead of deleting so booking history stays intact.`,
    };
  }

  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);

  if (error) {
    const lower = (error.message || '').toLowerCase();
    if (lower.includes('foreign key') || error.code === '23503') {
      return {
        success: false,
        hasLinkedBookings: true,
        error:
          'This vehicle is referenced by existing booking records and cannot be deleted. Please deactivate it instead.',
      };
    }
    return {
      success: false,
      error: formatWriteError(
        error,
        'Failed to delete vehicle. Only authorized administrators may delete vehicles.'
      ),
    };
  }

  return { success: true, error: null };
}
