export interface IndianPhoneValidationResult {
  valid: boolean;
  e164: string;
  digits10: string;
  formatted: string;
  error: string | null;
}

export interface SupabaseAuthErrorLike {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

const INDIAN_MOBILE_10_REGEX = /^[6-9]\d{9}$/;
const OTP_6_DIGIT_REGEX = /^\d{6}$/;

/**
 * Validates and normalizes an Indian mobile number to E.164 (`+91XXXXXXXXXX`).
 * Accepts `9876543210`, `09876543210`, `919876543210`, or `+91 98765 43210`.
 */
export function normalizeIndianMobileNumber(rawInput: string): IndianPhoneValidationResult {
  const cleaned = rawInput.replace(/[\s\-()]/g, '').trim();

  if (!cleaned) {
    return {
      valid: false,
      e164: '',
      digits10: '',
      formatted: '',
      error: 'Please enter your 10-digit Indian mobile number.',
    };
  }

  let local = cleaned;

  if (cleaned.startsWith('+91')) {
    local = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    return {
      valid: false,
      e164: '',
      digits10: '',
      formatted: '',
      error: 'Only Indian mobile numbers (+91) are supported.',
    };
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    local = cleaned.slice(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    local = cleaned.slice(1);
  }

  if (!INDIAN_MOBILE_10_REGEX.test(local)) {
    return {
      valid: false,
      e164: '',
      digits10: '',
      formatted: '',
      error: 'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
    };
  }

  return {
    valid: true,
    e164: `+91${local}`,
    digits10: local,
    formatted: `+91 ${local.slice(0, 5)} ${local.slice(5)}`,
    error: null,
  };
}

export function validateSixDigitOtp(rawOtp: string): {
  valid: boolean;
  token: string;
  error: string | null;
} {
  const token = rawOtp.replace(/\s+/g, '').trim();
  if (!OTP_6_DIGIT_REGEX.test(token)) {
    return {
      valid: false,
      token,
      error: 'Please enter the valid 6-digit OTP sent to your mobile number.',
    };
  }
  return { valid: true, token, error: null };
}

/**
 * Formats Supabase Auth errors while always preserving the actual Supabase error
 * message (and error code when present) rather than hiding it behind a generic label.
 */
export function formatPhoneAuthError(
  errorInput: string | SupabaseAuthErrorLike | undefined | null
): string {
  const rawMessage =
    typeof errorInput === 'string'
      ? errorInput.trim()
      : (errorInput?.message || '').trim();
  const rawCode =
    typeof errorInput === 'object' && errorInput !== null
      ? (errorInput.code || '').trim()
      : '';

  if (!rawMessage) {
    return rawCode
      ? `Authentication failed (${rawCode}). Please try again.`
      : 'Authentication failed. Please try again.';
  }

  const lowerMsg = rawMessage.toLowerCase();
  const lowerCode = rawCode.toLowerCase();
  const prefix = rawCode ? `Supabase error (${rawCode}): ${rawMessage}` : `Supabase error: ${rawMessage}`;

  if (
    lowerMsg.includes('unsupported phone provider') ||
    lowerCode === 'unsupported_phone_provider'
  ) {
    return `${prefix}. In Supabase Authentication → Providers → Phone, ensure Phone sign-in is enabled and either select an SMS provider or enter this exact +91XXXXXXXXXX number in Test Phone Numbers and OTPs.`;
  }

  if (
    lowerMsg.includes('phone logins are disabled') ||
    lowerMsg.includes('phone signups are disabled') ||
    lowerCode === 'phone_provider_disabled'
  ) {
    return `${prefix}. Enable the Phone provider in Supabase Authentication → Providers → Phone.`;
  }

  return prefix;
}
