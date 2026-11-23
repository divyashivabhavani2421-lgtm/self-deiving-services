import { createClient, SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const rawSupabasePublishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';

const REMEMBER_SESSION_PREF_KEY = 'ssdc_remember_session';

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getRememberSessionPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(REMEMBER_SESSION_PREF_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setRememberSessionPreference(remember: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_SESSION_PREF_KEY, remember ? 'true' : 'false');
  } catch {
    // Ignore storage access errors in restricted environments
  }
}

/**
 * Storage adapter that persists sessions in localStorage when "Remember session"
 * is enabled, or sessionStorage when disabled, and cleans up across both on sign-out.
 */
const adaptiveAuthStorage: SupportedStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      if (getRememberSessionPreference()) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage access errors
    }
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage access errors
    }
  },
};

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  hasUrl: boolean;
  hasValidUrl: boolean;
  hasPublishableKey: boolean;
  missingVars: string[];
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const hasUrl = Boolean(rawSupabaseUrl);
  const hasValidUrl = isValidHttpUrl(rawSupabaseUrl);
  const hasPublishableKey = Boolean(rawSupabasePublishableKey);

  const missingVars: string[] = [];
  if (!hasUrl || !hasValidUrl) {
    missingVars.push('VITE_SUPABASE_URL');
  }
  if (!hasPublishableKey) {
    missingVars.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  return {
    isConfigured: hasValidUrl && hasPublishableKey,
    hasUrl,
    hasValidUrl,
    hasPublishableKey,
    missingVars,
  };
}

export const supabaseConfigStatus = getSupabaseConfigStatus();
export const isSupabaseConfigured = supabaseConfigStatus.isConfigured;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawSupabaseUrl, rawSupabasePublishableKey, {
      auth: {
        storage: adaptiveAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
