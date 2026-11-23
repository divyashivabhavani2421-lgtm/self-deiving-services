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
  /**
   * Configure your WhatsApp business number via VITE_WHATSAPP_NUMBER in .env
   * (include country code without '+', e.g. '9198XXXXXXXX')
   * or update the fallback string below when deploying.
   */
  whatsappNumber: (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.trim() || '',
} as const;

export function sanitizePhoneForWhatsApp(rawNumber: string): string {
  return rawNumber.replace(/[^0-9]/g, '');
}

export function buildWhatsAppUrl(message: string, customNumber?: string): string | null {
  const target = sanitizePhoneForWhatsApp(customNumber ?? BUSINESS_CONFIG.whatsappNumber);
  if (!target) {
    return null;
  }
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}
