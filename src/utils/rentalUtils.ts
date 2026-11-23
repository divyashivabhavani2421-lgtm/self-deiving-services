import { RentalSearchParams } from '../types/vehicle';

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getTodayInputDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDefaultSearchParams(): RentalSearchParams {
  return {
    pickupDate: getTodayInputDate(1),
    pickupTime: '09:00',
    returnDate: getTodayInputDate(2),
    returnTime: '09:00',
  };
}

export function calculateRentalDays(params: Partial<RentalSearchParams>): number | null {
  if (!params.pickupDate || !params.returnDate) {
    return null;
  }
  const pickupTime = params.pickupTime || '09:00';
  const returnTime = params.returnTime || '09:00';
  const start = new Date(`${params.pickupDate}T${pickupTime}`);
  const end = new Date(`${params.returnDate}T${returnTime}`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }

  const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(1, Math.ceil(diffHours / 24));
}

export function buildSearchQueryString(params: Partial<RentalSearchParams>): string {
  const sp = new URLSearchParams();
  if (params.pickupDate) sp.set('pickupDate', params.pickupDate);
  if (params.pickupTime) sp.set('pickupTime', params.pickupTime);
  if (params.returnDate) sp.set('returnDate', params.returnDate);
  if (params.returnTime) sp.set('returnTime', params.returnTime);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}
