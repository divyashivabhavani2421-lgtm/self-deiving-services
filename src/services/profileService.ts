import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface CustomerProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  drivingLicenseNumber?: string;
  role?: string;
  createdAt?: string;
  updatedAt?: string;
  availableColumns: string[];
  idColumn: 'id' | 'user_id';
}

export interface ProfileUpdateInput {
  fullName: string;
  phone: string;
  address?: string;
  city?: string;
  drivingLicenseNumber?: string;
}

export interface ProfileResult {
  profile: CustomerProfile | null;
  error: string | null;
}

type RawProfileRow = Record<string, unknown>;

// Columns that a customer is NEVER allowed to write from the client
const FORBIDDEN_WRITE_COLUMNS = new Set([
  'id',
  'user_id',
  'role',
  'user_role',
  'is_admin',
  'admin',
  'permissions',
  'created_at',
  'email',
]);

function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function mapProfileRow(
  row: RawProfileRow,
  user: User,
  idColumn: 'id' | 'user_id'
): CustomerProfile {
  const columns = Object.keys(row);
  const metaFullName = readString(user.user_metadata?.full_name ?? user.user_metadata?.name);
  const metaPhone = readString(user.user_metadata?.phone ?? user.user_metadata?.phone_number);

  const fullName =
    readString(row.full_name) ||
    readString(row.name) ||
    metaFullName ||
    '';

  const phone =
    readString(row.phone) ||
    readString(row.phone_number) ||
    readString(row.mobile) ||
    metaPhone ||
    '';

  const email = readString(row.email) || user.email || '';

  const address = readString(row.address) || undefined;
  const city = readString(row.city) || undefined;
  const drivingLicenseNumber =
    readString(row.driving_license_number) ||
    readString(row.license_number) ||
    readString(row.dl_number) ||
    undefined;

  const roleFromText = readString(row.role) || readString(row.user_role);
  const role = roleFromText || (row.is_admin === true ? 'admin' : undefined);

  return {
    id: readString(row[idColumn]) || user.id,
    fullName,
    email,
    phone,
    address,
    city,
    drivingLicenseNumber,
    role,
    createdAt: readString(row.created_at) || undefined,
    updatedAt: readString(row.updated_at) || undefined,
    availableColumns: columns,
    idColumn,
  };
}

function buildFallbackProfileFromAuth(user: User): CustomerProfile {
  return {
    id: user.id,
    fullName: readString(user.user_metadata?.full_name ?? user.user_metadata?.name),
    email: user.email || '',
    phone: readString(user.user_metadata?.phone ?? user.user_metadata?.phone_number),
    availableColumns: [],
    idColumn: 'id',
  };
}

/**
 * Fetches ONLY the authenticated customer's own row from `profiles`
 * using Supabase RLS + explicit user ID filter.
 */
export async function fetchOwnProfile(user: User): Promise<ProfileResult> {
  if (!supabase) {
    return {
      profile: buildFallbackProfileFromAuth(user),
      error: 'Supabase is not configured.',
    };
  }

  // Try standard `id = auth.uid()` first
  const primaryQuery = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!primaryQuery.error) {
    if (!primaryQuery.data) {
      return {
        profile: buildFallbackProfileFromAuth(user),
        error: null,
      };
    }
    return {
      profile: mapProfileRow(primaryQuery.data as RawProfileRow, user, 'id'),
      error: null,
    };
  }

  // Only if schema uses `user_id` instead of `id`
  const message = primaryQuery.error.message || '';
  if (message.toLowerCase().includes('profiles.id') || message.toLowerCase().includes('column "id"')) {
    const secondaryQuery = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (secondaryQuery.error) {
      return {
        profile: buildFallbackProfileFromAuth(user),
        error: secondaryQuery.error.message,
      };
    }

    if (!secondaryQuery.data) {
      return {
        profile: buildFallbackProfileFromAuth(user),
        error: null,
      };
    }

    return {
      profile: mapProfileRow(secondaryQuery.data as RawProfileRow, user, 'user_id'),
      error: null,
    };
  }

  return {
    profile: buildFallbackProfileFromAuth(user),
    error: primaryQuery.error.message,
  };
}

const ADMIN_ROLE_VALUES = new Set(['admin', 'super_admin', 'administrator']);

export function isAdminRoleValue(role: string | undefined | null): boolean {
  return Boolean(role && ADMIN_ROLE_VALUES.has(role.trim().toLowerCase()));
}

/**
 * Queries Supabase `public.profiles` directly for the authenticated user's
 * current `role` so admin route checks always reflect live database state.
 */
export async function verifyAdminRole(userId: string): Promise<{
  isAdmin: boolean;
  role: string | null;
  error: string | null;
}> {
  if (!supabase) {
    return { isAdmin: false, role: null, error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return {
      isAdmin: false,
      role: null,
      error: error.message || 'Could not verify administrator permissions from profiles.',
    };
  }

  const role = readString((data as RawProfileRow | null)?.role) || null;
  return {
    isAdmin: isAdminRoleValue(role),
    role,
    error: null,
  };
}

/**
 * Updates ONLY permitted personal profile fields that actually exist
 * on the customer's `profiles` row. Never writes `role`, `is_admin`, or `id`.
 */
export async function updateOwnProfile(
  user: User,
  currentProfile: CustomerProfile,
  input: ProfileUpdateInput
): Promise<ProfileResult> {
  if (!supabase) {
    return {
      profile: currentProfile,
      error: 'Supabase is not configured.',
    };
  }

  const cols = new Set(currentProfile.availableColumns);
  const payload: Record<string, unknown> = {};

  // Map full name to whichever column exists in the existing schema
  if (cols.has('full_name')) {
    payload.full_name = input.fullName.trim();
  } else if (cols.has('name')) {
    payload.name = input.fullName.trim();
  }

  // Map phone to whichever column exists in the existing schema
  if (cols.has('phone')) {
    payload.phone = input.phone.trim();
  } else if (cols.has('phone_number')) {
    payload.phone_number = input.phone.trim();
  } else if (cols.has('mobile')) {
    payload.mobile = input.phone.trim();
  }

  // Optional personal fields only if those columns exist in `profiles`
  if (cols.has('address') && input.address !== undefined) {
    payload.address = input.address.trim();
  }
  if (cols.has('city') && input.city !== undefined) {
    payload.city = input.city.trim();
  }
  if (cols.has('driving_license_number') && input.drivingLicenseNumber !== undefined) {
    payload.driving_license_number = input.drivingLicenseNumber.trim();
  } else if (cols.has('license_number') && input.drivingLicenseNumber !== undefined) {
    payload.license_number = input.drivingLicenseNumber.trim();
  }
  if (cols.has('updated_at')) {
    payload.updated_at = new Date().toISOString();
  }

  // Defense-in-depth: strip any forbidden keys before sending
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_WRITE_COLUMNS.has(key)) {
      delete payload[key];
    }
  }

  // Also keep Auth user_metadata personal display fields synchronized (never role!)
  const authUpdate = await supabase.auth.updateUser({
    data: {
      full_name: input.fullName.trim(),
      phone: input.phone.trim(),
      phone_number: input.phone.trim(),
    },
  });

  if (authUpdate.error) {
    return {
      profile: currentProfile,
      error: authUpdate.error.message,
    };
  }

  // If the customer's profile row exists in `profiles`, update only permitted personal columns
  if (currentProfile.availableColumns.length > 0 && Object.keys(payload).length > 0) {
    const idCol = currentProfile.idColumn;
    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq(idCol, user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      return {
        profile: currentProfile,
        error: error.message,
      };
    }

    if (data) {
      return {
        profile: mapProfileRow(data as RawProfileRow, authUpdate.data.user ?? user, idCol),
        error: null,
      };
    }
  }

  // Re-fetch to reflect latest state
  return fetchOwnProfile(authUpdate.data.user ?? user);
}
