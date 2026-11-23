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
  return base || fallbackId;
}

function parseHighlights(row: RawRecord): string[] {
  const candidate = row.highlights ?? row.features ?? row.amenities;
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

function parseImagesList(row: RawRecord, primaryImage: string): string[] {
  const rawList = row.images ?? row.image_urls ?? row.gallery_images;
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
 * Adapts an arbitrary row from the existing Supabase `vehicles` table
 * to the UI `Vehicle` shape without requiring rigid column names.
 */
export function mapSupabaseVehicleRow(row: RawRecord, index: number): Vehicle {
  const rawId =
    toNonEmptyString(row.id) ??
    toNonEmptyString(row.vehicle_id) ??
    toNonEmptyString(row.uuid) ??
    String(index + 1);

  const brand = toNonEmptyString(row.brand) ?? toNonEmptyString(row.make) ?? '';
  const model = toNonEmptyString(row.model) ?? '';
  const combinedBrandModel = [brand, model].filter(Boolean).join(' ').trim();

  const name =
    toNonEmptyString(row.name) ??
    toNonEmptyString(row.vehicle_name) ??
    toNonEmptyString(row.title) ??
    (combinedBrandModel || `Vehicle #${rawId}`);

  const slug = toNonEmptyString(row.slug) ?? toSlug(name, rawId);

  const category =
    toNonEmptyString(row.category) ??
    toNonEmptyString(row.vehicle_type) ??
    toNonEmptyString(row.body_type) ??
    toNonEmptyString(row.type) ??
    'Self Drive Car';

  const fuelType =
    toNonEmptyString(row.fuel_type) ??
    toNonEmptyString(row.fuelType) ??
    toNonEmptyString(row.fuel) ??
    '';

  const transmission =
    toNonEmptyString(row.transmission) ??
    toNonEmptyString(row.gearbox) ??
    toNonEmptyString(row.gear_type) ??
    '';

  const seats =
    toNumber(row.seating_capacity) ??
    toNumber(row.seats) ??
    toNumber(row.seat_count) ??
    toNumber(row.capacity) ??
    null;

  const dailyPrice =
    toNumber(row.daily_price) ??
    toNumber(row.price_per_day) ??
    toNumber(row.daily_rate) ??
    toNumber(row.rate_per_day) ??
    toNumber(row.rent_per_day) ??
    toNumber(row.price) ??
    null;

  const hourlyPrice =
    toNumber(row.hourly_price) ??
    toNumber(row.price_per_hour) ??
    toNumber(row.hourly_rate) ??
    null;

  const securityDeposit =
    toNumber(row.security_deposit) ??
    toNumber(row.deposit_amount) ??
    toNumber(row.deposit) ??
    null;

  const mileage =
    toNonEmptyString(row.mileage) ??
    toNonEmptyString(row.fuel_efficiency) ??
    undefined;

  const luggageCapacity =
    toNonEmptyString(row.luggage_capacity) ??
    toNonEmptyString(row.boot_space) ??
    undefined;

  const year =
    toNumber(row.year) ??
    toNumber(row.model_year) ??
    undefined;

  const featured =
    toBoolean(row.featured) ??
    toBoolean(row.is_featured) ??
    false;

  const statusText = toNonEmptyString(row.status);
  const availableFlag = toBoolean(row.is_available) ?? toBoolean(row.available);
  const isAvailable =
    availableFlag !== null
      ? availableFlag
      : statusText
        ? statusText.toLowerCase() === 'available'
        : true;

  const activeFlag = toBoolean(row.is_active) ?? toBoolean(row.active);
  const isActive =
    activeFlag !== null
      ? activeFlag
      : statusText
        ? !['inactive', 'archived', 'disabled'].includes(statusText.toLowerCase())
        : true;

  const image = sanitizeImageUrl(
    row.image_url ?? row.image ?? row.photo_url ?? row.thumbnail_url ?? row.img_url
  );
  const images = parseImagesList(row, image);

  const description =
    toNonEmptyString(row.description) ??
    toNonEmptyString(row.details) ??
    toNonEmptyString(row.short_description) ??
    toNonEmptyString(row.summary) ??
    '';

  const shortSummary =
    toNonEmptyString(row.short_summary) ??
    toNonEmptyString(row.short_description) ??
    toNonEmptyString(row.summary) ??
    description;

  const highlights = parseHighlights(row);
  const pickupLocation =
    toNonEmptyString(row.pickup_location) ??
    toNonEmptyString(row.location) ??
    toNonEmptyString(row.city) ??
    undefined;

  const registrationNumber =
    toNonEmptyString(row.registration_number) ??
    toNonEmptyString(row.reg_no) ??
    toNonEmptyString(row.plate_number) ??
    undefined;

  return {
    id: rawId,
    slug,
    name,
    brand,
    model,
    category,
    fuelType,
    transmission,
    seats,
    dailyPrice,
    hourlyPrice,
    securityDeposit,
    mileage,
    luggageCapacity,
    year,
    featured,
    isAvailable,
    isActive,
    image,
    images,
    shortSummary,
    description,
    highlights,
    pickupLocation,
    registrationNumber,
    createdAt: toNonEmptyString(row.created_at) ?? undefined,
    updatedAt: toNonEmptyString(row.updated_at) ?? undefined,
    rawColumns: Object.keys(row),
  };
}

function getMissingConfigError(): string {
  const status = getSupabaseConfigStatus();
  return `Supabase environment variables are not configured (${status.missingVars.join(', ')}). Add them in your project Secrets or .env.local and restart the dev server.`;
}

/**
 * Inspects exact column names on the existing `vehicles` table via Supabase's
 * PostgREST OpenAPI specification (works even when the table has 0 rows).
 */
export async function inspectVehiclesTableColumns(): Promise<string[]> {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';
  if (!url || !key) return [];

  try {
    let bearer = key;
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        bearer = data.session.access_token;
      }
    }

    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/openapi+json',
      },
    });
    if (!res.ok) return [];
    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };
    const props = spec?.definitions?.vehicles?.properties;
    return props ? Object.keys(props) : [];
  } catch {
    return [];
  }
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

  const { data, error } = await supabase.from('vehicles').select('*');

  if (error) {
    return {
      vehicles: [],
      detectedColumns: [],
      error: error.message || 'Failed to load vehicles from Supabase.',
      isConfigMissing: false,
    };
  }

  const rows = Array.isArray(data) ? (data as RawRecord[]) : [];
  let detectedColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  if (detectedColumns.length === 0) {
    detectedColumns = await inspectVehiclesTableColumns();
  }

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

  const includeInactive = options?.includeInactive ?? false;
  const filteredVehicles = includeInactive
    ? allVehicles
    : allVehicles.filter((car) => car.isActive);

  return {
    vehicles: filteredVehicles,
    detectedColumns,
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
    (item) => item.slug === slugOrId || item.id === slugOrId
  );

  return {
    vehicle: match ?? null,
    error: null,
    isConfigMissing: false,
  };
}

function pickColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const name of candidates) {
    if (cols.has(name)) return name;
  }
  return null;
}

const COLUMN_TO_LABEL: Record<string, string> = {
  name: 'Vehicle Name',
  vehicle_name: 'Vehicle Name',
  title: 'Vehicle Name',
  slug: 'Slug',
  brand: 'Brand',
  make: 'Brand',
  model: 'Model',
  registration_number: 'Registration Number',
  reg_no: 'Registration Number',
  plate_number: 'Registration Number',
  category: 'Category',
  vehicle_type: 'Category',
  body_type: 'Category',
  type: 'Category',
  fuel_type: 'Fuel Type',
  fuelType: 'Fuel Type',
  fuel: 'Fuel Type',
  transmission: 'Transmission',
  gearbox: 'Transmission',
  gear_type: 'Transmission',
  seating_capacity: 'Seating Capacity',
  seats: 'Seating Capacity',
  seat_count: 'Seating Capacity',
  capacity: 'Seating Capacity',
  year: 'Model Year',
  model_year: 'Model Year',
  daily_price: 'Daily Price',
  price_per_day: 'Daily Price',
  daily_rate: 'Daily Price',
  rate_per_day: 'Daily Price',
  rent_per_day: 'Daily Price',
  price: 'Daily Price',
  hourly_price: 'Hourly Price',
  price_per_hour: 'Hourly Price',
  hourly_rate: 'Hourly Price',
  security_deposit: 'Security Deposit',
  deposit_amount: 'Security Deposit',
  deposit: 'Security Deposit',
  description: 'Description',
  details: 'Description',
  short_description: 'Description',
  summary: 'Description',
  is_available: 'Availability Status',
  available: 'Availability Status',
  status: 'Status',
  is_active: 'Active Status',
  active: 'Active Status',
  featured: 'Featured',
  is_featured: 'Featured',
  image_url: 'Primary Image',
  image: 'Primary Image',
  photo_url: 'Primary Image',
  thumbnail_url: 'Primary Image',
  img_url: 'Primary Image',
  images: 'Vehicle Images',
  image_urls: 'Vehicle Images',
  gallery_images: 'Vehicle Images',
  updated_at: 'Updated Timestamp',
};

function buildColumnSafePayload(
  input: Partial<VehicleWriteInput>,
  existingColumns: string[],
  mode: 'create' | 'edit'
): { payload: Record<string, unknown>; skippedFields: string[] } {
  const cols = new Set(existingColumns);
  const payload: Record<string, unknown> = {};
  const skippedFields: string[] = [];

  const assignIfColumnExists = (
    fieldLabel: string,
    candidates: string[],
    value: unknown
  ) => {
    if (value === undefined) return;
    if (cols.size === 0) {
      payload[candidates[0]] = value;
      return;
    }
    const target = pickColumn(cols, candidates);
    if (target) {
      payload[target] = value;
    } else {
      skippedFields.push(fieldLabel);
    }
  };

  if (input.name !== undefined) {
    assignIfColumnExists('Vehicle Name', ['name', 'vehicle_name', 'title'], input.name.trim());
    if (mode === 'create' && (cols.size === 0 || cols.has('slug'))) {
      const slugSeed = [input.name.trim(), input.registrationNumber?.trim()]
        .filter(Boolean)
        .join(' ');
      payload.slug = toSlug(slugSeed || input.name.trim(), String(Date.now()));
    }
  }
  if (input.brand !== undefined) {
    assignIfColumnExists('Brand', ['brand', 'make'], input.brand.trim());
  }
  if (input.model !== undefined) {
    assignIfColumnExists('Model', ['model'], input.model.trim());
  }
  if (input.registrationNumber !== undefined) {
    assignIfColumnExists(
      'Registration Number',
      ['registration_number', 'reg_no', 'plate_number'],
      input.registrationNumber.trim() || null
    );
  }
  if (input.category !== undefined) {
    assignIfColumnExists('Category', ['category', 'vehicle_type', 'body_type', 'type'], input.category.trim());
  }
  if (input.fuelType !== undefined) {
    assignIfColumnExists('Fuel Type', ['fuel_type', 'fuelType', 'fuel'], input.fuelType.trim());
  }
  if (input.transmission !== undefined) {
    assignIfColumnExists('Transmission', ['transmission', 'gearbox', 'gear_type'], input.transmission.trim());
  }
  if (input.seats !== undefined) {
    assignIfColumnExists(
      'Seating Capacity',
      ['seating_capacity', 'seats', 'seat_count', 'capacity'],
      input.seats
    );
  }
  if (input.year !== undefined) {
    assignIfColumnExists('Model Year', ['year', 'model_year'], input.year);
  }
  if (input.dailyPrice !== undefined) {
    assignIfColumnExists(
      'Daily Price',
      ['daily_price', 'price_per_day', 'daily_rate', 'rate_per_day', 'rent_per_day', 'price'],
      input.dailyPrice
    );
  }
  if (input.hourlyPrice !== undefined) {
    assignIfColumnExists(
      'Hourly Price',
      ['hourly_price', 'price_per_hour', 'hourly_rate'],
      input.hourlyPrice
    );
  }
  if (input.securityDeposit !== undefined) {
    assignIfColumnExists(
      'Security Deposit',
      ['security_deposit', 'deposit_amount', 'deposit'],
      input.securityDeposit
    );
  }
  if (input.description !== undefined) {
    assignIfColumnExists(
      'Description',
      ['description', 'details', 'short_description', 'summary'],
      input.description.trim()
    );
  }
  if (input.isAvailable !== undefined) {
    assignIfColumnExists('Availability Status', ['is_available', 'available'], input.isAvailable);
    if (!cols.has('is_available') && !cols.has('available') && cols.has('status')) {
      payload.status = input.isAvailable ? 'available' : 'unavailable';
    }
  }
  if (input.isActive !== undefined) {
    const hasActiveCol = cols.size === 0 || cols.has('is_active') || cols.has('active');
    if (hasActiveCol) {
      assignIfColumnExists('Active Status', ['is_active', 'active'], input.isActive);
    } else if (cols.has('status')) {
      if (!input.isActive) {
        payload.status = 'inactive';
      } else if (input.isAvailable === undefined) {
        payload.status = 'available';
      }
    } else {
      skippedFields.push('Active Status');
    }
  }
  if (input.featured !== undefined) {
    assignIfColumnExists('Featured', ['featured', 'is_featured'], input.featured);
  }
  if (input.image !== undefined) {
    const trimmedImage = input.image.trim();
    assignIfColumnExists(
      'Primary Image',
      ['image_url', 'image', 'photo_url', 'thumbnail_url', 'img_url'],
      trimmedImage || (mode === 'create' ? '' : null)
    );
  }
  if (input.images !== undefined) {
    assignIfColumnExists(
      'Vehicle Images',
      ['images', 'image_urls', 'gallery_images'],
      input.images
    );
  }

  if (cols.has('updated_at')) {
    payload.updated_at = new Date().toISOString();
  }

  return { payload, skippedFields };
}

function extractMissingColumnFromError(message: string): string | null {
  // PostgREST PGRST204: "Could not find the 'hourly_price' column of 'vehicles' in the schema cache"
  const pgrstMatch = message.match(/Could not find the '([^']+)' column/i);
  if (pgrstMatch?.[1]) return pgrstMatch[1];

  // Postgres 42703: column "hourly_price" of relation "vehicles" does not exist
  const pgMatch = message.match(/column "([^"]+)" of relation "vehicles" does not exist/i);
  if (pgMatch?.[1]) return pgMatch[1];

  return null;
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
  detectedColumns: string[]
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

  const normalizedImages = Array.from(
    new Set([
      cleanPrimaryImage,
      ...(input.images || []).map((url) => sanitizeImageUrl(url)).filter(Boolean),
    ])
  );

  let schemaCols = detectedColumns;
  if (schemaCols.length === 0) {
    schemaCols = await inspectVehiclesTableColumns();
  }

  const { payload, skippedFields } = buildColumnSafePayload(
    { ...input, image: cleanPrimaryImage, images: normalizedImages },
    schemaCols,
    'create'
  );
  const workingPayload: Record<string, unknown> = { ...payload };
  const skipped = [...skippedFields];
  let slugRetried = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    if (Object.keys(workingPayload).length === 0) {
      return {
        vehicle: null,
        skippedFields: skipped,
        error: 'No compatible columns remained to create a vehicle in your vehicles table.',
      };
    }

    const { data, error } = await supabase
      .from('vehicles')
      .insert(workingPayload)
      .select('*')
      .single();

    if (!error && data) {
      return {
        vehicle: mapSupabaseVehicleRow(data as RawRecord, 0),
        skippedFields: skipped,
        error: null,
      };
    }

    const message = error?.message || '';
    const missingCol = extractMissingColumnFromError(message);
    if (missingCol && missingCol in workingPayload) {
      delete workingPayload[missingCol];
      const label = COLUMN_TO_LABEL[missingCol] || missingCol;
      if (!skipped.includes(label)) {
        skipped.push(label);
      }
      continue;
    }

    if (
      !slugRetried &&
      error?.code === '23505' &&
      message.toLowerCase().includes('slug') &&
      typeof workingPayload.slug === 'string'
    ) {
      slugRetried = true;
      workingPayload.slug = `${workingPayload.slug}-${Date.now().toString(36).slice(-4)}`;
      continue;
    }

    return {
      vehicle: null,
      skippedFields: skipped,
      error: formatWriteError(error, 'Failed to add vehicle. Check administrator permissions.'),
    };
  }

  return {
    vehicle: null,
    skippedFields: skipped,
    error: 'Could not match vehicle columns cleanly. Please check your vehicles table schema.',
  };
}

export async function updateVehicle(
  vehicleId: string,
  patch: Partial<VehicleWriteInput>,
  detectedColumns: string[]
): Promise<VehicleMutationResult> {
  if (!supabase) {
    return { vehicle: null, skippedFields: [], error: getMissingConfigError() };
  }

  let schemaCols = detectedColumns;
  if (schemaCols.length === 0) {
    schemaCols = await inspectVehiclesTableColumns();
  }

  const idColumn = schemaCols.includes('vehicle_id') && !schemaCols.includes('id') ? 'vehicle_id' : 'id';
  const { payload, skippedFields } = buildColumnSafePayload(patch, schemaCols, 'edit');
  const workingPayload: Record<string, unknown> = { ...payload };
  const skipped = [...skippedFields];

  for (let attempt = 0; attempt < 15; attempt++) {
    if (Object.keys(workingPayload).length === 0) {
      return {
        vehicle: null,
        skippedFields: skipped,
        error:
          'None of the selected fields match columns in your current vehicles table. Run the schema migration to add those columns.',
      };
    }

    const { data, error } = await supabase
      .from('vehicles')
      .update(workingPayload)
      .eq(idColumn, vehicleId)
      .select('*')
      .single();

    if (!error && data) {
      return {
        vehicle: mapSupabaseVehicleRow(data as RawRecord, 0),
        skippedFields: skipped,
        error: null,
      };
    }

    const message = error?.message || '';
    const missingCol = extractMissingColumnFromError(message);
    if (missingCol && missingCol in workingPayload) {
      delete workingPayload[missingCol];
      const label = COLUMN_TO_LABEL[missingCol] || missingCol;
      if (!skipped.includes(label)) {
        skipped.push(label);
      }
      continue;
    }

    return {
      vehicle: null,
      skippedFields: skipped,
      error: formatWriteError(error, 'Failed to update vehicle. Check administrator permissions.'),
    };
  }

  return {
    vehicle: null,
    skippedFields: skipped,
    error: 'Could not update vehicle because matching columns were not found.',
  };
}

export async function deleteVehicle(
  vehicleId: string,
  detectedColumns: string[]
): Promise<VehicleDeleteResult> {
  if (!supabase) {
    return { success: false, error: getMissingConfigError() };
  }

  // Safety check: if a bookings table exists with vehicle_id references, inspect before deleting
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

  const idColumn =
    detectedColumns.includes('vehicle_id') && !detectedColumns.includes('id') ? 'vehicle_id' : 'id';

  const { error } = await supabase.from('vehicles').delete().eq(idColumn, vehicleId);

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
