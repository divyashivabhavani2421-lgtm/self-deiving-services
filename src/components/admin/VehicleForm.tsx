import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Info,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import {
  deleteUploadedFiles,
  uploadVehicleImages,
  UploadProgressInfo,
  validateImageFile,
} from '../../services/storageService';
import { createVehicle, updateVehicle } from '../../services/vehiclesService';
import { Vehicle, VehicleWriteInput } from '../../types/vehicle';

import { VehicleImage } from '../VehicleImage';

interface VehicleFormProps {
  mode: 'create' | 'edit';
  initialVehicle?: Vehicle | null;
  detectedColumns: string[];
  onCancel: () => void;
  onSaved: (savedVehicle: Vehicle, notice: string) => void;
  onManagePhotos?: () => void;
}

interface StagedImage {
  file: File;
  previewUrl: string;
  validationError: string | null;
}

const CATEGORIES = ['Hatchback', 'Premium Hatchback', 'Sedan', 'Compact SUV', 'SUV', 'MPV'];
const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'];
const TRANSMISSIONS = ['Manual', 'Automatic', 'AMT', 'CVT'];

export function VehicleForm({
  mode,
  initialVehicle,
  detectedColumns,
  onCancel,
  onSaved,
  onManagePhotos,
}: VehicleFormProps) {
  const [name, setName] = useState(initialVehicle?.name ?? '');
  const [brand, setBrand] = useState(initialVehicle?.brand ?? '');
  const [model, setModel] = useState(initialVehicle?.model ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(
    initialVehicle?.registrationNumber ?? ''
  );
  const [category, setCategory] = useState(initialVehicle?.category || 'Hatchback');
  const [fuelType, setFuelType] = useState(initialVehicle?.fuelType || 'Petrol');
  const [transmission, setTransmission] = useState(initialVehicle?.transmission || 'Manual');
  const [seats, setSeats] = useState(
    initialVehicle?.seats !== null && initialVehicle?.seats !== undefined
      ? String(initialVehicle.seats)
      : '5'
  );
  const [year, setYear] = useState(
    initialVehicle?.year !== undefined ? String(initialVehicle.year) : String(new Date().getFullYear())
  );
  const [dailyPrice, setDailyPrice] = useState(
    initialVehicle?.dailyPrice !== null && initialVehicle?.dailyPrice !== undefined
      ? String(initialVehicle.dailyPrice)
      : ''
  );
  const [hourlyPrice, setHourlyPrice] = useState(
    initialVehicle?.hourlyPrice !== null && initialVehicle?.hourlyPrice !== undefined
      ? String(initialVehicle.hourlyPrice)
      : ''
  );
  const [securityDeposit, setSecurityDeposit] = useState(
    initialVehicle?.securityDeposit !== null && initialVehicle?.securityDeposit !== undefined
      ? String(initialVehicle.securityDeposit)
      : ''
  );
  const [description, setDescription] = useState(initialVehicle?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(initialVehicle?.isAvailable ?? true);
  const [isActive, setIsActive] = useState(initialVehicle?.isActive ?? true);
  const [featured, setFeatured] = useState(initialVehicle?.featured ?? false);

  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [setUploadedAsPrimary, setSetUploadedAsPrimary] = useState(!initialVehicle?.image);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'uploading' | 'saving'>('idle');
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const categoryOptions = useMemo(() => {
    const val = initialVehicle?.category?.trim();
    return val && !CATEGORIES.includes(val) ? [val, ...CATEGORIES] : CATEGORIES;
  }, [initialVehicle?.category]);

  const fuelOptions = useMemo(() => {
    const val = initialVehicle?.fuelType?.trim();
    return val && !FUEL_TYPES.includes(val) ? [val, ...FUEL_TYPES] : FUEL_TYPES;
  }, [initialVehicle?.fuelType]);

  const transmissionOptions = useMemo(() => {
    const val = initialVehicle?.transmission?.trim();
    return val && !TRANSMISSIONS.includes(val) ? [val, ...TRANSMISSIONS] : TRANSMISSIONS;
  }, [initialVehicle?.transmission]);

  const missingOptionalCols = useMemo(() => {
    if (detectedColumns.length === 0) return [];
    const cols = new Set(detectedColumns);
    const missing: string[] = [];
    if (!cols.has('hourly_price') && !cols.has('price_per_hour') && !cols.has('hourly_rate')) {
      missing.push('hourly_price');
    }
    if (!cols.has('security_deposit') && !cols.has('deposit_amount') && !cols.has('deposit')) {
      missing.push('security_deposit');
    }
    if (!cols.has('registration_number') && !cols.has('reg_no') && !cols.has('plate_number')) {
      missing.push('registration_number');
    }
    if (!cols.has('is_active') && !cols.has('active')) {
      missing.push('is_active');
    }
    return missing;
  }, [detectedColumns]);

  const handleSelectPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const added: StagedImage[] = Array.from(files).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      blobUrlsRef.current.add(previewUrl);
      return {
        file,
        previewUrl,
        validationError: validateImageFile(file),
      };
    });

    setStagedImages((prev) => [...prev, ...added]);
    setError('');
    event.target.value = '';
  };

  const removeStagedPhoto = (index: number) => {
    setStagedImages((prev) => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        blobUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!name.trim()) {
      setError('Vehicle name is required.');
      return;
    }

    const parsedSeats = Number(seats);
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > 15) {
      setError('Seating capacity must be between 1 and 15.');
      return;
    }

    const parsedYear = year.trim() ? Number(year) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1995 || parsedYear > 2035)) {
      setError('Please enter a valid model year.');
      return;
    }

    const parsedDaily = dailyPrice.trim() ? Number(dailyPrice) : null;
    if (parsedDaily === null || !Number.isFinite(parsedDaily) || parsedDaily < 0) {
      setError('Please enter a valid daily rental price in INR.');
      return;
    }

    const parsedHourly = hourlyPrice.trim() ? Number(hourlyPrice) : null;
    if (parsedHourly !== null && (!Number.isFinite(parsedHourly) || parsedHourly < 0)) {
      setError('Hourly rental price must be a positive number.');
      return;
    }

    const parsedDeposit = securityDeposit.trim() ? Number(securityDeposit) : null;
    if (parsedDeposit !== null && (!Number.isFinite(parsedDeposit) || parsedDeposit < 0)) {
      setError('Security deposit must be zero or a positive number.');
      return;
    }

    const invalidStaged = stagedImages.find((item) => item.validationError);
    if (invalidStaged) {
      setError(invalidStaged.validationError || 'Please remove invalid image files before saving.');
      return;
    }

    if (mode === 'create' && stagedImages.length === 0) {
      setError('Please select at least one vehicle photograph (JPG, PNG, or WebP) before adding the vehicle.');
      return;
    }

    setError('');
    setSubmitting(true);
    setUploadProgress(null);

    const payload: VehicleWriteInput = {
      name: name.trim(),
      brand: brand.trim(),
      model: model.trim(),
      registrationNumber: registrationNumber.trim().toUpperCase(),
      category,
      fuelType,
      transmission,
      seats: parsedSeats,
      year: parsedYear,
      dailyPrice: parsedDaily,
      hourlyPrice: parsedHourly,
      securityDeposit: parsedDeposit,
      description: description.trim(),
      isAvailable,
      isActive,
      featured,
    };

    try {
      const filesToUpload = stagedImages.map((s) => s.file);
      let newlyUploadedUrls: string[] = [];
      let newlyUploadedPaths: string[] = [];

      // Upload images to `vehicle-images` FIRST so image_url is guaranteed non-null on insert
      if (filesToUpload.length > 0) {
        setSubmitPhase('uploading');
        const folderPrefix =
          mode === 'edit' && initialVehicle?.id
            ? initialVehicle.id
            : `vehicles/${name
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 24) || 'car'}`;

        const uploadRes = await uploadVehicleImages(folderPrefix, filesToUpload, (progress) => {
          setUploadProgress(progress);
        });

        newlyUploadedPaths = uploadRes.uploaded.map((u) => u.path);
        newlyUploadedUrls = uploadRes.uploaded.map((u) => u.publicUrl).filter(Boolean);

        if (uploadRes.errors.length > 0 || newlyUploadedUrls.length === 0) {
          // Clean up any partial uploads from this failed batch so no orphan files remain
          await deleteUploadedFiles(newlyUploadedPaths);
          setError(
            uploadRes.errors.length > 0
              ? `Image upload failed: ${uploadRes.errors.join(' ')}`
              : 'Image upload failed before a valid image URL could be generated. Vehicle was not saved.'
          );
          return;
        }
      }

      setSubmitPhase('saving');

      let result;
      if (mode === 'create') {
        result = await createVehicle(
          {
            ...payload,
            image: newlyUploadedUrls[0],
            images: newlyUploadedUrls,
          },
          detectedColumns
        );
      } else {
        const existingPrimary = initialVehicle?.image || '';
        const mergedGallery =
          newlyUploadedUrls.length > 0
            ? Array.from(
                new Set([
                  ...(existingPrimary ? [existingPrimary] : []),
                  ...(initialVehicle?.images || []),
                  ...newlyUploadedUrls,
                ])
              )
            : undefined;
        const nextPrimary =
          newlyUploadedUrls.length > 0
            ? setUploadedAsPrimary || !existingPrimary
              ? newlyUploadedUrls[0]
              : existingPrimary
            : undefined;

        result = await updateVehicle(
          initialVehicle!.id,
          {
            ...payload,
            ...(nextPrimary !== undefined ? { image: nextPrimary } : {}),
            ...(mergedGallery !== undefined ? { images: mergedGallery } : {}),
          },
          detectedColumns
        );
      }

      if (result.error || !result.vehicle) {
        if (newlyUploadedPaths.length > 0) {
          await deleteUploadedFiles(newlyUploadedPaths);
        }
        setError(result.error || 'Could not save vehicle record.');
        return;
      }

      stagedImages.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        blobUrlsRef.current.delete(item.previewUrl);
      });
      setStagedImages([]);

      const skippedNote =
        result.skippedFields.length > 0
          ? ` (Skipped fields not yet in your vehicles table: ${result.skippedFields.join(', ')})`
          : '';
      const photoNote =
        newlyUploadedUrls.length > 0
          ? ` Uploaded ${newlyUploadedUrls.length} photograph(s) to vehicle-images.`
          : '';

      const notice =
        mode === 'create'
          ? `Added "${result.vehicle.name}" to the fleet.${photoNote}${skippedNote}`
          : `Updated "${result.vehicle.name}".${photoNote}${skippedNote}`;

      onSaved(result.vehicle, notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error saving vehicle.');
    } finally {
      setSubmitting(false);
      setSubmitPhase('idle');
      setUploadProgress(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0B1F3A]">
            {mode === 'create' ? 'Add New Vehicle' : `Edit Vehicle: ${initialVehicle?.name}`}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {mode === 'create'
              ? 'Create a new vehicle record in your Supabase vehicles table.'
              : 'Update specifications, pricing, availability, or active status.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Fleet</span>
        </button>
      </div>

      {missingOptionalCols.length > 0 && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-[#0B1F3A]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
          <div>
            Your current <code className="font-mono font-semibold">vehicles</code> table does not yet include{' '}
            <code className="font-mono font-semibold">{missingOptionalCols.join(', ')}</code>. Existing columns will
            save normally; run the Phase 4 SQL migration if you want to store those additional fields.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        {/* Basic Info */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="vf-name" className="block text-xs font-semibold text-slate-700">
              Vehicle Name *
            </label>
            <input
              id="vf-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Maruti Suzuki Swift"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="vf-brand" className="block text-xs font-semibold text-slate-700">
              Brand
            </label>
            <input
              id="vf-brand"
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. Maruti Suzuki"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div>
            <label htmlFor="vf-model" className="block text-xs font-semibold text-slate-700">
              Model
            </label>
            <input
              id="vf-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. Swift VXI"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div>
            <label htmlFor="vf-reg" className="block text-xs font-semibold text-slate-700">
              Registration Number
            </label>
            <input
              id="vf-reg"
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="e.g. TS36AB1234"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm uppercase text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div>
            <label htmlFor="vf-category" className="block text-xs font-semibold text-slate-700">
              Category
            </label>
            <select
              id="vf-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="vf-year" className="block text-xs font-semibold text-slate-700">
              Model Year
            </label>
            <input
              id="vf-year"
              type="number"
              min={1995}
              max={2035}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>
        </div>

        {/* Specs & Pricing */}
        <div className="grid grid-cols-1 gap-5 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="vf-fuel" className="block text-xs font-semibold text-slate-700">
              Fuel Type
            </label>
            <select
              id="vf-fuel"
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              {fuelOptions.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="vf-tx" className="block text-xs font-semibold text-slate-700">
              Transmission
            </label>
            <select
              id="vf-tx"
              value={transmission}
              onChange={(e) => setTransmission(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              {transmissionOptions.map((tx) => (
                <option key={tx} value={tx}>
                  {tx}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="vf-seats" className="block text-xs font-semibold text-slate-700">
              Seating Capacity *
            </label>
            <input
              id="vf-seats"
              type="number"
              min={1}
              max={15}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="vf-daily" className="block text-xs font-semibold text-slate-700">
              Daily Rental Price (₹) *
            </label>
            <input
              id="vf-daily"
              type="number"
              min={0}
              step="50"
              value={dailyPrice}
              onChange={(e) => setDailyPrice(e.target.value)}
              placeholder="e.g. 1400"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              required
            />
          </div>

          <div>
            <label htmlFor="vf-hourly" className="block text-xs font-semibold text-slate-700">
              Hourly Rental Price (₹)
            </label>
            <input
              id="vf-hourly"
              type="number"
              min={0}
              step="10"
              value={hourlyPrice}
              onChange={(e) => setHourlyPrice(e.target.value)}
              placeholder="Optional, e.g. 150"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div>
            <label htmlFor="vf-deposit" className="block text-xs font-semibold text-slate-700">
              Security Deposit (₹)
            </label>
            <input
              id="vf-deposit"
              type="number"
              min={0}
              step="500"
              value={securityDeposit}
              onChange={(e) => setSecurityDeposit(e.target.value)}
              placeholder="Optional, e.g. 5000"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>
        </div>

        {/* Description */}
        <div className="border-t border-slate-100 pt-5">
          <label htmlFor="vf-desc" className="block text-xs font-semibold text-slate-700">
            Description
          </label>
          <textarea
            id="vf-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe cabin condition, luggage capacity, and highway comfort..."
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
        </div>

        {/* Photographs Upload (Required when adding a vehicle) */}
        <div className="border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-700">
                Vehicle Photographs {mode === 'create' ? <span className="text-red-700">*</span> : null}{' '}
                <span className="font-normal text-slate-500">
                  ({mode === 'create' ? 'Required · ' : 'Optional · '}Uploads to vehicle-images bucket)
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {mode === 'create'
                  ? 'Select at least one JPG, PNG, or WebP photograph (max 5 MB each). The first photo becomes the primary listing image.'
                  : 'Optional JPG, PNG, or WebP files up to 5 MB each. You can also manage or reorder photos in the Vehicle Images tab.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'edit' && onManagePhotos && (
                <button
                  type="button"
                  onClick={onManagePhotos}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
                >
                  <span>Manage All Photos</span>
                </button>
              )}
              <label
                htmlFor="vf-photos"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8]"
              >
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{stagedImages.length > 0 ? 'Add More Photos' : 'Select Photos'}</span>
                <input
                  id="vf-photos"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleSelectPhotos}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {mode === 'edit' && (initialVehicle?.image || (initialVehicle?.images?.length ?? 0) > 0) && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
              <div className="w-20 shrink-0 overflow-hidden rounded-md border border-slate-200">
                <VehicleImage
                  src={initialVehicle?.image || initialVehicle?.images[0] || ''}
                  alt={`${initialVehicle?.name || 'Vehicle'} current`}
                  aspectClassName="aspect-[4/3]"
                />
              </div>
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-[#0B1F3A]">Current Listing Photo</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {initialVehicle?.images.length || 1} linked photo(s). Select new photos on the right or click Manage All Photos.
                </p>
              </div>
            </div>
          )}

          {mode === 'create' && stagedImages.length === 0 && (
            <label
              htmlFor="vf-photos"
              className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-6 py-6 text-center transition-colors hover:border-[#1D4ED8] hover:bg-blue-50/30"
            >
              <ImagePlus className="h-7 w-7 text-[#1D4ED8]" aria-hidden="true" />
              <span className="mt-2 text-xs font-semibold text-[#0B1F3A]">
                Click to select required vehicle photograph(s)
              </span>
              <span className="mt-0.5 text-[11px] text-slate-500">
                JPG, PNG, or WebP · Max 5 MB per file
              </span>
            </label>
          )}

          {stagedImages.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stagedImages.map((item, idx) => (
                  <div
                    key={`${item.file.name}-${idx}`}
                    className={`relative overflow-hidden rounded-lg border bg-white ${
                      item.validationError ? 'border-red-300' : 'border-slate-200'
                    }`}
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    {mode === 'create' && idx === 0 && !item.validationError && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-[#0B1F3A]/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Primary Image
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => removeStagedPhoto(idx)}
                      aria-label={`Remove ${item.file.name}`}
                      className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm hover:text-red-700 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="p-2">
                      <p className="truncate text-[11px] font-medium text-[#0B1F3A]">{item.file.name}</p>
                      <p className="text-[10px] text-slate-500 tabular-nums">
                        {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                      {item.validationError && (
                        <p className="mt-0.5 text-[10px] font-medium text-red-700">{item.validationError}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {mode === 'edit' && initialVehicle?.image && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={setUploadedAsPrimary}
                    onChange={(e) => setSetUploadedAsPrimary(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
                  />
                  <span>Set first uploaded photo as primary card image</span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Status Switches */}
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={isAvailable}
              onChange={(e) => setIsAvailable(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <div>
              <p className="text-xs font-semibold text-[#0B1F3A]">Available for Pickup</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Marks vehicle ready for new inquiries.</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <div>
              <p className="text-xs font-semibold text-[#0B1F3A]">Active on Website</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Uncheck to hide from customers safely.</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3.5 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <div>
              <p className="text-xs font-semibold text-[#0B1F3A]">Featured on Home</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Highlights vehicle in homepage showcase.</p>
            </div>
          </label>
        </div>

        {submitting && (submitPhase === 'uploading' || submitPhase === 'saving') && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-xs text-[#0B1F3A]"
          >
            <div className="flex items-center justify-between gap-2 font-semibold">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" aria-hidden="true" />
                {submitPhase === 'uploading'
                  ? `Uploading photograph${uploadProgress && uploadProgress.total > 1 ? ` (${uploadProgress.completed}/${uploadProgress.total})` : ''} to vehicle-images...`
                  : 'Saving vehicle record to database...'}
              </span>
              {submitPhase === 'uploading' && uploadProgress ? (
                <span className="tabular-nums text-[#1D4ED8]">{uploadProgress.percent}%</span>
              ) : null}
            </div>
            {submitPhase === 'uploading' && uploadProgress && (
              <>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-[#1D4ED8] transition-all duration-200"
                    style={{ width: `${Math.max(uploadProgress.percent, 8)}%` }}
                  />
                </div>
                <p className="mt-1.5 truncate text-[11px] text-slate-600">
                  File: {uploadProgress.currentFile}
                </p>
              </>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : mode === 'create' ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            <span>
              {submitting
                ? submitPhase === 'uploading'
                  ? 'Uploading Image...'
                  : 'Saving Vehicle...'
                : mode === 'create'
                  ? 'Add Vehicle'
                  : 'Save Changes'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
