export interface Vehicle {
  id: string;
  slug: string;
  make: string;
  model: string;
  name: string;
  year: number | null;
  fuelType: string;
  transmission: string;
  seats: number | null;
  registrationNumber: string;
  price12h: number | null;
  price24h: number | null;
  securityDeposit: number | null;
  mileage: string;
  image: string;
  images: string[];
  features: string[];
  description: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  rawColumns?: string[];
}

export interface VehicleWriteInput {
  id?: string;
  make: string;
  model: string;
  year: number | null;
  fuelType: string;
  transmission: string;
  seats: number | null;
  registrationNumber: string;
  price12h: number | null;
  price24h: number | null;
  securityDeposit: number | null;
  mileage: string;
  description: string;
  features: string[];
  isActive: boolean;
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
