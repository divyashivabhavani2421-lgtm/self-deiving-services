export interface Vehicle {
  id: string;
  slug: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  fuelType: string;
  transmission: string;
  seats: number | null;
  dailyPrice: number | null;
  hourlyPrice: number | null;
  securityDeposit: number | null;
  mileage?: string;
  luggageCapacity?: string;
  year?: number;
  featured: boolean;
  isAvailable: boolean;
  isActive: boolean;
  image: string;
  images: string[];
  shortSummary: string;
  description: string;
  highlights: string[];
  pickupLocation?: string;
  registrationNumber?: string;
  createdAt?: string;
  updatedAt?: string;
  rawColumns?: string[];
}

export interface VehicleWriteInput {
  name: string;
  brand: string;
  model: string;
  registrationNumber: string;
  category: string;
  fuelType: string;
  transmission: string;
  seats: number | null;
  year: number | null;
  dailyPrice: number | null;
  hourlyPrice: number | null;
  securityDeposit: number | null;
  description: string;
  isAvailable: boolean;
  isActive: boolean;
  featured?: boolean;
  image?: string;
  images?: string[];
}

export interface VehicleStorageFile {
  name: string;
  path: string;
  publicUrl: string;
  createdAt?: string;
  sizeBytes?: number;
}

export interface RentalSearchParams {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
}
