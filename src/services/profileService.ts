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
  const metaPhone = readString(
    user.phone ?? user.user_metadata?.phone ?? user.user_metadata?.phone_number
  );

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
    phone: readString(user.phone ?? user.user_metadata?.phone ?? user.user_metadata?.phone_number),
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

/**
 * Ensures a row exists in `public.profiles` after OTP or session login.
 * - If a profile already exists, preserves its `full_name`, `phone`, and `role`
 *   (NEVER overwrites an existing `admin` role or existing profile fields).
 * - If no profile exists yet, creates a `'customer'` profile for `user.id` and
 *   verified phone number.
 */
export async function ensureCustomerProfile(
  user: User,
  options?: { fullName?: string; phone?: string }
): Promise<ProfileResult> {
  if (!supabase) {
    return {
      profile: buildFallbackProfileFromAuth(user),
      error: 'Supabase is not configured.',
    };
  }

  const existingQuery = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (existingQuery.error) {
    // Fallback check if `profiles` uses `user_id` instead of `id`
    const errMsg = existingQuery.error.message || '';
    if (errMsg.toLowerCase().includes('profiles.id') || errMsg.toLowerCase().includes('column "id"')) {
      return fetchOwnProfile(user);
    }
    return {
      profile: buildFallbackProfileFromAuth(user),
      error: existingQuery.error.message,
    };
  }

  // Existing profile found: preserve full_name, phone, and role untouched
  if (existingQuery.data) {
    const existingRow = existingQuery.data as RawProfileRow;
    const verifiedPhone = readString(user.phone) || readString(options?.phone);
    const existingPhone = readString(existingRow.phone);

    // Only fill phone if currently blank on the existing row; never modify role or full_name
    if (!existingPhone && verifiedPhone) {
      const { data: backfilled } = await supabase
        .from('profiles')
        .update({ phone: verifiedPhone })
        .eq('id', user.id)
        .select('*')
        .maybeSingle();

      if (backfilled) {
        return {
          profile: mapProfileRow(backfilled as RawProfileRow, user, 'id'),
          error: null,
        };
      }
    }

    return {
      profile: mapProfileRow(existingRow, user, 'id'),
      error: null,
    };
  }

  // No profile exists yet -> create a new 'customer' profile (never admin)
  const resolvedPhone =
    readString(user.phone) ||
    readString(options?.phone) ||
    readString(user.user_metadata?.phone ?? user.user_metadata?.phone_number);

  const resolvedFullName =
    readString(options?.fullName) ||
    readString(user.user_metadata?.full_name ?? user.user_metadata?.name) ||
    '';

  const insertPayload: Record<string, unknown> = {
    id: user.id,
    full_name: resolvedFullName,
    phone: resolvedPhone,
    role: 'customer',
  };

  const insertRes = await supabase
    .from('profiles')
    .insert(insertPayload)
    .select('*')
    .maybeSingle();

  if (!insertRes.error && insertRes.data) {
    return {
      profile: mapProfileRow(insertRes.data as RawProfileRow, user, 'id'),
      error: null,
    };
  }

  // Fallback to SECURITY DEFINER RPC if direct RLS insert is blocked on profiles
  const rpcRes = await supabase.rpc('ensure_customer_profile', {
    p_full_name: resolvedFullName || null,
  });

  if (!rpcRes.error && rpcRes.data) {
    const row = Array.isArray(rpcRes.data)
      ? (rpcRes.data[0] as RawProfileRow | undefined)
      : (rpcRes.data as RawProfileRow | null);
    if (row) {
      return {
        profile: mapProfileRow(row, user, 'id'),
        error: null,
      };
    }
  }

  const fallbackError =
    insertRes.error?.message ||
    rpcRes.error?.message ||
    'Could not create your customer profile automatically.';

  return {
    profile: buildFallbackProfileFromAuth(user),
    error: fallbackError,
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
 * Verifies both the live authenticated Supabase session user (`auth.getUser()`)
 * and their current `public.profiles.role` row in Supabase without relying on
 * cached frontend state.
 */
export async function verifyCurrentSessionAdminRole(): Promise<{
  authenticated: boolean;
  user: User | null;
  isAdmin: boolean;
  role: string | null;
  error: string | null;
}> {
  if (!supabase) {
    return {
      authenticated: false,
      user: null,
      isAdmin: false,
      role: null,
      error: 'Supabase is not configured.',
    };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return {
      authenticated: false,
      user: null,
      isAdmin: false,
      role: null,
      error: null,
    };
  }

  const roleCheck = await verifyAdminRole(userData.user.id);
  return {
    authenticated: true,
    user: userData.user,
    isAdmin: roleCheck.isAdmin,
    role: roleCheck.role,
    error: roleCheck.error,
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

export interface AdminManagedAccount {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  isAdmin: boolean;
  createdAt: string | null;
}

function mapAdminManagedAccount(row: RawProfileRow): AdminManagedAccount {
  const role = readString(row.role) || 'customer';
  return {
    id: readString(row.id),
    fullName: readString(row.full_name),
    email: readString(row.email),
    phone: readString(row.phone),
    role,
    isAdmin: isAdminRoleValue(role),
    createdAt: readString(row.created_at) || null,
  };
}

/**
 * Lists registered accounts and administrators via the verified admin-only RPC
 * `admin_list_profiles()`. Rejected at database level for non-admins.
 */
export async function listAdminAccounts(): Promise<{
  accounts: AdminManagedAccount[];
  error: string | null;
}> {
  if (!supabase) {
    return { accounts: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase.rpc('admin_list_profiles');

  if (error) {
    const msg = error.message || '';
    if (
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      msg.toLowerCase().includes('could not find the function') ||
      msg.toLowerCase().includes('admin_list_profiles')
    ) {
      return {
        accounts: [],
        error:
          'Administrator management functions are not active in Supabase yet. Run supabase/migrations/step5_admin_management.sql in Supabase SQL Editor.',
      };
    }
    return {
      accounts: [],
      error: msg || 'Could not load administrator and registered account records.',
    };
  }

  const rows = Array.isArray(data) ? (data as RawProfileRow[]) : [];
  return {
    accounts: rows.map(mapAdminManagedAccount),
    error: null,
  };
}

/**
 * Promotes an existing registered account to `'admin'` via the verified admin-only RPC
 * `admin_promote_user_to_admin(p_email)`. Never creates new users or allows customer self-promotion.
 */
export async function promoteRegisteredAccountToAdmin(email: string): Promise<{
  account: AdminManagedAccount | null;
  error: string | null;
}> {
  if (!supabase) {
    return { account: null, error: 'Supabase is not configured.' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalizedEmail)) {
    return { account: null, error: 'Please enter a valid registered email address.' };
  }

  const { data, error } = await supabase.rpc('admin_promote_user_to_admin', {
    p_email: normalizedEmail,
  });

  if (error) {
    const msg = error.message || '';
    if (
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      msg.toLowerCase().includes('could not find the function') ||
      msg.toLowerCase().includes('admin_promote_user_to_admin')
    ) {
      return {
        account: null,
        error:
          'Administrator management functions are not active in Supabase yet. Run supabase/migrations/step5_admin_management.sql in Supabase SQL Editor.',
      };
    }
    return {
      account: null,
      error: msg || 'Could not promote account to administrator.',
    };
  }

  const row = Array.isArray(data)
    ? (data[0] as RawProfileRow | undefined)
    : (data as RawProfileRow | null);

  if (!row) {
    return {
      account: null,
      error: 'Account promotion completed, but no updated account row was returned.',
    };
  }

  return {
    account: mapAdminManagedAccount(row),
    error: null,
  };
}

