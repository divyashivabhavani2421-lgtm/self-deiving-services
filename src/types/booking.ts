export type RentalDurationType = '12h' | '24h' | 'custom';
export type PickupType = 'hub_pickup' | 'doorstep_delivery';
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export interface BookedSlot {
  startDate: string;
  endDate: string;
  status: BookingStatus;
}

export interface BookingPriceBreakdown {
  durationHours: number;
  fullDays: number;
  extraHours: number;
  baseAmount: number;
  deliveryFee: number;
  totalAmount: number;
}

export interface CreateBookingInput {
  vehicleId: string;
  startDateIso: string;
  endDateIso: string;
  rentalDuration: RentalDurationType;
  pickupType: PickupType;
  deliveryAddress?: string;
  notes?: string;
  whatsappOptIn?: boolean;
  contactPhone?: string;
}

export interface CreateGuestBookingInput extends CreateBookingInput {
  guestName: string;
  guestPhone: string;
}

export interface BookingRecord {
  id: string;
  bookingReference?: string;
  userId: string | null;
  isGuest?: boolean;
  guestName?: string;
  guestPhone?: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  rentalDuration: RentalDurationType;
  durationHours: number;
  pickupType: PickupType;
  deliveryAddress: string | null;
  baseAmount: number;
  deliveryFee: number;
  totalAmount: number;
  status: BookingStatus;
  notes: string | null;
  whatsappOptIn?: boolean;
  createdAt: string;
  vehicleName?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleSlug?: string;
  vehicleImageUrl?: string;
  vehicleFuelType?: string;
  vehicleTransmission?: string;
  vehicleRegistrationNumber?: string;
}

export interface AdminBookingRecord extends BookingRecord {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
}

export type WhatsAppNotificationEventType =
  | 'booking_created_admin'
  | 'booking_confirmed_customer';

export type WhatsAppNotificationStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'skipped';

export interface WhatsAppNotificationEvent {
  id: string;
  bookingId: string;
  bookingReference: string;
  eventType: WhatsAppNotificationEventType;
  recipientRole: 'admin' | 'customer';
  recipientPhone: string;
  templateKey: string;
  payload: Record<string, unknown>;
  status: WhatsAppNotificationStatus;
  skipReason: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
}
