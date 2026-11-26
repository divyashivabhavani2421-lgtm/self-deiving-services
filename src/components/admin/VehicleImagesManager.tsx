import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  listVehicleImages,
  uploadVehicleImages,
  UploadProgressInfo,
  validateImageFile,
} from '../../services/storageService';
import { updateVehicle } from '../../services/vehiclesService';
import { Vehicle, VehicleStorageFile } from '../../types/vehicle';
import { VehicleImage } from '../VehicleImage';

interface VehicleImagesManagerProps {
  vehicles: Vehicle[];
  selectedVehicleId: string;
  onSelectVehicleId: (id: string) => void;
  detectedColumns: string[];
  onRefreshVehicles: () => void;
}

interface PendingPreview {
  file: File;
  previewUrl: string;
  validationError: string | null;
}

export function VehicleImagesManager({
  vehicles,
  selectedVehicleId,
  onSelectVehicleId,
  detectedColumns,
  onRefreshVehicles,
}: VehicleImagesManagerProps) {
  const baseVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0] || null;
  const [vehicleOverride, setVehicleOverride] = useState<Vehicle | null>(null);

  useEffect(() => {
    setVehicleOverride(null);
  }, [baseVehicle]);

  const selectedVehicle =
    vehicleOverride && baseVehicle && vehicleOverride.id === baseVehicle.id
      ? vehicleOverride
      : baseVehicle;

  const [storageFiles, setStorageFiles] = useState<VehicleStorageFile[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [bucketMissing, setBucketMissing] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<PendingPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  const loadImages = useCallback(async (vehicleId: string) => {
    setLoadingImages(true);
    setError('');
    try {
      const res = await listVehicleImages(vehicleId);
      setStorageFiles(res.files);
      setBucketMissing(res.bucketMissing);
      if (res.error && !res.bucketMissing) {
        setError(res.error);
      }
    } finally {
      setLoadingImages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedVehicle) {
      void loadImages(selectedVehicle.id);
    }
  }, [selectedVehicle?.id, loadImages]);

  useEffect(() => {
    const tracked = activeBlobUrlsRef.current;
    return () => {
      tracked.forEach((url) => URL.revokeObjectURL(url));
      tracked.clear();
    };
  }, []);

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const previews: PendingPreview[] = Array.from(fileList).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      activeBlobUrlsRef.current.add(previewUrl);
      return {
        file,
        previewUrl,
        validationError: validateImageFile(file),
      };
    });

    setPendingPreviews((prev) => [...prev, ...previews]);
    setError('');
    setNotice('');
    event.target.value = '';
  };

  const clearPendingPreview = (index: number) => {
    setPendingPreviews((prev) => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        activeBlobUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleUploadAll = async () => {
    if (!selectedVehicle) return;
    const validFiles = pendingPreviews.filter((p) => !p.validationError).map((p) => p.file);

    if (validFiles.length === 0) {
      setError('Select at least one valid JPG, PNG, or WebP image under 5 MB.');
      return;
    }

    setUploading(true);
    setUploadProgress({
      completed: 0,
      total: validFiles.length,
      percent: 0,
      currentFile: validFiles[0]?.name || '',
    });
    setError('');
    setNotice('');

    try {
      const result = await uploadVehicleImages(selectedVehicle.id, validFiles, (progress) => {
        setUploadProgress(progress);
      });
      if (result.bucketMissing) {
        setBucketMissing(true);
      }

      const errorMessages = [...result.errors];

      if (result.uploaded.length > 0) {
        const uploadedUrls = result.uploaded.map((u) => u.publicUrl);
        const mergedGallery = Array.from(
          new Set([
            ...(selectedVehicle.image ? [selectedVehicle.image] : []),
            ...(selectedVehicle.images || []),
            ...uploadedUrls,
          ])
        );
        const nextPrimary = selectedVehicle.image || uploadedUrls[0];

        const updateRes = await updateVehicle(
          selectedVehicle.id,
          {
            image: nextPrimary,
            images: mergedGallery,
          },
          detectedColumns
        );

        pendingPreviews.forEach((p) => {
          URL.revokeObjectURL(p.previewUrl);
          activeBlobUrlsRef.current.delete(p.previewUrl);
        });
        setPendingPreviews([]);

        if (updateRes.error) {
          errorMessages.push(
            `Uploaded ${result.uploaded.length} file(s) to storage, but could not save URL(s) to the vehicles table: ${updateRes.error}`
          );
        } else {
          if (updateRes.vehicle) {
            setVehicleOverride(updateRes.vehicle);
          }
          const primarySkipped = updateRes.skippedFields.includes('Primary Image');
          const gallerySkipped = updateRes.skippedFields.includes('Vehicle Images');
          if (primarySkipped && gallerySkipped) {
            errorMessages.push(
              `Uploaded ${result.uploaded.length} file(s) to storage, but your vehicles table has no image_url or images column to store the URL.`
            );
          } else {
            const galleryNote = gallerySkipped
              ? ' (Primary image URL saved; add an `images` column to save multi-photo gallery URLs in the row.)'
              : '';
            setNotice(
              `Uploaded ${result.uploaded.length} image(s) and linked URLs for ${selectedVehicle.name}.${galleryNote}`
            );
          }
        }

        await loadImages(selectedVehicle.id);
        onRefreshVehicles();
      }

      if (errorMessages.length > 0) {
        setError(errorMessages.join(' '));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleSetPrimary = async (imageUrl: string) => {
    if (!selectedVehicle) return;
    setBusyPath(imageUrl);
    setError('');
    setNotice('');

    try {
      const mergedGallery = Array.from(
        new Set(
          [
            imageUrl,
            ...(selectedVehicle.image ? [selectedVehicle.image] : []),
            ...(selectedVehicle.images || []),
          ].filter(Boolean)
        )
      );
      const res = await updateVehicle(
        selectedVehicle.id,
        { image: imageUrl, images: mergedGallery },
        detectedColumns
      );
      if (res.error || !res.vehicle) {
        setError(res.error || 'Could not update primary image.');
        return;
      }
      if (res.skippedFields.includes('Primary Image')) {
        setError('Your vehicles table does not have a primary image column (e.g. image_url).');
        return;
      }
      setVehicleOverride(res.vehicle);
      setNotice(`Primary photograph updated for ${selectedVehicle.name}.`);
      onRefreshVehicles();
    } finally {
      setBusyPath(null);
    }
  };

  const handleLinkStorageFile = async (imageUrl: string) => {
    if (!selectedVehicle) return;
    setBusyPath(imageUrl);
    setError('');
    setNotice('');

    try {
      const mergedGallery = Array.from(
        new Set(
          [
            ...(selectedVehicle.image ? [selectedVehicle.image] : []),
            ...(selectedVehicle.images || []),
            imageUrl,
          ].filter(Boolean)
        )
      );
      const nextPrimary = selectedVehicle.image || imageUrl;
      const res = await updateVehicle(
        selectedVehicle.id,
        { image: nextPrimary, images: mergedGallery },
        detectedColumns
      );
      if (res.error || !res.vehicle) {
        setError(res.error || 'Could not link storage image to vehicle.');
        return;
      }
      setVehicleOverride(res.vehicle);
      setNotice(`Linked storage image to ${selectedVehicle.name}.`);
      onRefreshVehicles();
    } finally {
      setBusyPath(null);
    }
  };

  const handleRemoveImage = async (targetUrl: string) => {
    if (!selectedVehicle) return;
    setError('');
    setNotice('');
    setBusyPath(targetUrl);

    try {
      const currentLinked = Array.from(
        new Set(
          [
            ...(selectedVehicle.image ? [selectedVehicle.image] : []),
            ...(selectedVehicle.images || []),
          ].filter(Boolean)
        )
      );

      const remainingGallery = currentLinked.filter((url) => url !== targetUrl);
      const isRemovingPrimary = selectedVehicle.image === targetUrl;
      const nextPrimary = isRemovingPrimary
        ? remainingGallery[0] || ''
        : selectedVehicle.image && selectedVehicle.image !== targetUrl
          ? selectedVehicle.image
          : remainingGallery[0] || '';

      const updateRes = await updateVehicle(
        selectedVehicle.id,
        {
          image: nextPrimary,
          images: remainingGallery,
        },
        detectedColumns
      );

      if (updateRes.error || !updateRes.vehicle) {
        setError(updateRes.error || 'Could not remove image from vehicle.');
        return;
      }

      setVehicleOverride(updateRes.vehicle);
      setNotice(
        remainingGallery.length === 0
          ? `Removed the last linked image from ${selectedVehicle.name}. Placeholder is now shown (Storage files were preserved).`
          : isRemovingPrimary
            ? `Primary image removed from ${selectedVehicle.name}. Selected the next available image as primary.`
            : `Image removed from ${selectedVehicle.name} (Storage file preserved).`
      );
      onRefreshVehicles();
    } finally {
      setBusyPath(null);
    }
  };

  if (vehicles.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">Add a vehicle first before uploading photographs.</p>
      </div>
    );
  }

  const primaryUrl = selectedVehicle?.image || '';
  const linkedUrls = Array.from(
    new Set(
      [...(primaryUrl ? [primaryUrl] : []), ...(selectedVehicle?.images || [])].filter(Boolean)
    )
  );
  const storageUrlSet = new Set(storageFiles.map((f) => f.publicUrl));
  const nonStoragePrimary = Boolean(primaryUrl && !storageUrlSet.has(primaryUrl));
  const nonStorageGalleryUrls = (selectedVehicle?.images || []).filter(
    (url) => url && url !== primaryUrl && !storageUrlSet.has(url)
  );
  const linkedStorageFiles = storageFiles.filter((file) => linkedUrls.includes(file.publicUrl));
  const unlinkedStorageFiles = storageFiles.filter((file) => !linkedUrls.includes(file.publicUrl));

  return (
    <div className="space-y-6">
      {/* Selector & Upload Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-end">
          <div className="max-w-sm flex-1">
            <label htmlFor="img-vehicle-select" className="block text-xs font-semibold text-slate-700">
              Select Vehicle
            </label>
            <select
              id="img-vehicle-select"
              value={selectedVehicle?.id || ''}
              onChange={(e) => {
                onSelectVehicleId(e.target.value);
                setError('');
                setNotice('');
              }}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} {v.registrationNumber ? `(${v.registrationNumber})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-500">
            Bucket: <code className="font-mono font-semibold text-[#0B1F3A]">vehicle-images</code> · Max 5 MB · JPG, PNG,
            WebP
          </div>
        </div>

        {bucketMissing && (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Storage bucket "vehicle-images" not found</p>
              <p className="mt-1">
                Create a public bucket named <code className="font-mono font-semibold">vehicle-images</code> in
                Supabase Storage or run the provided Phase 4 SQL migration in Supabase SQL Editor.
              </p>
            </div>
          </div>
        )}

        {/* File Picker */}
        <div className="mt-5">
          <label
            htmlFor="vehicle-image-input"
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center transition-colors hover:border-[#1D4ED8] hover:bg-blue-50/30"
          >
            <ImagePlus className="h-8 w-8 text-[#1D4ED8]" aria-hidden="true" />
            <span className="mt-2 font-display text-sm font-bold text-[#0B1F3A]">
              Choose Vehicle Photographs
            </span>
            <span className="mt-1 text-xs text-slate-500">
              Select multiple JPG, PNG, or WebP files (up to 5 MB each)
            </span>
            <input
              id="vehicle-image-input"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFilePick}
              className="sr-only"
            />
          </label>
        </div>

        {/* Staged Local Previews */}
        {pendingPreviews.length > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[#0B1F3A]">
                Ready to Upload ({pendingPreviews.filter((p) => !p.validationError).length} valid)
              </h3>
              <button
                type="button"
                disabled={uploading}
                onClick={handleUploadAll}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1E40AF] disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{uploading ? 'Uploading...' : 'Upload Selected Images'}</span>
              </button>
            </div>

            {uploading && uploadProgress && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 rounded-lg border border-blue-200 bg-blue-50/70 p-3.5"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-[#0B1F3A]">
                  <span>
                    Uploading to <code className="font-mono">vehicle-images</code> ({uploadProgress.completed}/
                    {uploadProgress.total})
                    {uploadProgress.currentFile ? ` — ${uploadProgress.currentFile}` : ''}
                  </span>
                  <span className="tabular-nums text-[#1D4ED8]">{uploadProgress.percent}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-[#1D4ED8] transition-all duration-300"
                    style={{ width: `${Math.max(uploadProgress.percent, 8)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {pendingPreviews.map((item, idx) => (
                <div
                  key={`${item.file.name}-${idx}`}
                  className={`overflow-hidden rounded-lg border bg-white ${
                    item.validationError ? 'border-red-300' : 'border-slate-200'
                  }`}
                >
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <div className="p-2.5">
                    <p className="truncate text-xs font-medium text-[#0B1F3A]">{item.file.name}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {(item.file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                    {item.validationError && (
                      <p className="mt-1 text-[11px] font-medium text-red-700">{item.validationError}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => clearPendingPreview(idx)}
                      className="mt-2 text-[11px] font-semibold text-slate-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        {notice && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-[#166534]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {/* Linked Vehicle Photographs (Customer-Facing Source of Truth) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-bold text-[#0B1F3A]">
          Current Photographs for {selectedVehicle?.name}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Choose which image appears as the primary card photo on customer listings, or remove unwanted images from this
          vehicle. Removing an image unlinks it from the vehicle without deleting files from Supabase Storage.
        </p>

        {loadingImages ? (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="aspect-[4/3] animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : linkedUrls.length === 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <VehicleImage src="" alt={`${selectedVehicle?.name || 'Vehicle'} placeholder`} />
              <div className="p-3.5">
                <p className="text-xs font-semibold text-[#0B1F3A]">Default Placeholder Active</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  No images are linked to this vehicle (<code className="font-mono">image_url = null</code>). Upload
                  photographs above to display real vehicle photos to customers.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* 1. Current Primary Listing Image (if not already in linkedStorageFiles) */}
            {nonStoragePrimary && (
              <div className="overflow-hidden rounded-xl border border-[#1D4ED8] bg-white ring-1 ring-[#1D4ED8]/30">
                <VehicleImage src={primaryUrl} alt={`${selectedVehicle?.name} primary`} />
                <div className="p-3.5">
                  <p className="text-xs font-semibold text-[#1D4ED8]">Current Primary Listing Image</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">{primaryUrl}</p>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Primary</span>
                    </span>

                    <button
                      type="button"
                      disabled={busyPath === primaryUrl}
                      onClick={() => void handleRemoveImage(primaryUrl)}
                      aria-label="Remove current primary listing image"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      {busyPath === primaryUrl ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Linked Gallery Images (outside vehicle-images/<id>/ storage listing) */}
            {nonStorageGalleryUrls.map((galleryUrl, idx) => {
              const isBusy = busyPath === galleryUrl;
              return (
                <div
                  key={`${galleryUrl}-${idx}`}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <VehicleImage src={galleryUrl} alt={`${selectedVehicle?.name} gallery ${idx + 1}`} />
                  <div className="p-3.5">
                    <p className="truncate text-xs font-medium text-[#0B1F3A]">Linked Gallery Image</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{galleryUrl}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSetPrimary(galleryUrl)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Set Primary</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRemoveImage(galleryUrl)}
                        aria-label={`Remove linked gallery image ${idx + 1}`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 3. Linked Supabase Storage Images */}
            {linkedStorageFiles.map((file) => {
              const isPrimary = primaryUrl === file.publicUrl;
              const isBusy = busyPath === file.publicUrl || busyPath === file.path;

              return (
                <div
                  key={file.path}
                  className={`overflow-hidden rounded-xl border bg-white ${
                    isPrimary ? 'border-[#1D4ED8] ring-1 ring-[#1D4ED8]/30' : 'border-slate-200'
                  }`}
                >
                  <VehicleImage src={file.publicUrl} alt={`${selectedVehicle?.name} uploaded`} />
                  <div className="p-3.5">
                    <p className="truncate text-xs font-medium text-[#0B1F3A]">{file.name}</p>
                    <p
                      className={`mt-0.5 text-[11px] ${
                        isPrimary ? 'font-semibold text-[#1D4ED8]' : 'text-slate-500'
                      }`}
                    >
                      {isPrimary ? 'Primary Listing Image · Supabase Storage' : 'Supabase Storage Image'}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      {!isPrimary ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSetPrimary(file.publicUrl)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
                        >
                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Set Primary</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Primary</span>
                        </span>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRemoveImage(file.publicUrl)}
                        aria-label={`Remove ${file.name} from vehicle`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unlinked Storage Files (preserved in Supabase Storage, hidden from customers) */}
      {!loadingImages && unlinkedStorageFiles.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6">
          <h3 className="font-display text-sm font-bold text-[#0B1F3A]">
            Unlinked Files in Supabase Storage ({unlinkedStorageFiles.length})
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            These files exist in <code className="font-mono">vehicle-images/{selectedVehicle?.id}/</code> but are not
            linked to this vehicle and are hidden from customer pages. Re-link one below if needed, or leave them for
            manual Storage cleanup.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {unlinkedStorageFiles.map((file) => {
              const isBusy = busyPath === file.publicUrl || busyPath === file.path;
              return (
                <div key={file.path} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <VehicleImage src={file.publicUrl} alt={`${selectedVehicle?.name} unlinked storage`} />
                  <div className="p-3.5">
                    <p className="truncate text-xs font-medium text-[#0B1F3A]">{file.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Unlinked Storage File · Hidden from customers</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleLinkStorageFile(file.publicUrl)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add to Gallery</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSetPrimary(file.publicUrl)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Set Primary</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
