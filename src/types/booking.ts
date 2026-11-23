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
}

export interface BookingRecord {
  id: string;
  userId: string;
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
