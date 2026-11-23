export type FuelType = 'Petrol' | 'Diesel';
export type TransmissionType = 'Manual' | 'Automatic';
export type VehicleCategory = 'Hatchback' | 'Premium Hatchback' | 'Compact SUV';

export interface Vehicle {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: VehicleCategory;
  fuelType: FuelType;
  transmission: TransmissionType;
  seats: number;
  dailyPrice: number;
  mileage: string;
  luggageCapacity: string;
  year: number;
  featured: boolean;
  image: string;
  shortSummary: string;
  description: string;
  highlights: string[];
  pickupNotes: string;
}

export interface RentalSearchParams {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}
