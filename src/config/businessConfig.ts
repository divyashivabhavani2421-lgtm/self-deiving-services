export const BUSINESS_CONFIG = {
  name: 'Siddipet Self Drive Cars',
  shortName: 'Siddipet Self Drive',
  city: 'Siddipet',
  state: 'Telangana',
  country: 'India',
  serviceArea: 'Siddipet, Telangana, India',
  timezone: 'Asia/Kolkata',
  hubPickupLabel: 'Siddipet Self Drive Hub, Siddipet, TS',
  doorstepDeliveryFee: 250,
  whatsappDisplayNumber: '6302543640',
  /**
   * Uses VITE_WHATSAPP_NUMBER when configured, defaulting to the business
   * WhatsApp number 6302543640 (+91), always normalized with India's 91 prefix.
   */
  whatsappNumber: sanitizePhoneForWhatsApp(
    (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.trim() || '916302543640'
  ),
} as const;

export function sanitizePhoneForWhatsApp(rawNumber: string): string {
  const digits = rawNumber.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (/^[6-9][0-9]{9}$/.test(digits)) {
    return `91${digits}`;
  }
  if (/^0[6-9][0-9]{9}$/.test(digits)) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

export function buildWhatsAppUrl(message: string, customNumber?: string): string | null {
  const target = sanitizePhoneForWhatsApp(customNumber ?? BUSINESS_CONFIG.whatsappNumber);
  if (!target) {
    return null;
  }
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}
