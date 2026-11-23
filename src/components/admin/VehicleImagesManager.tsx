import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  deleteVehicleImageFromStorage,
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
  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0] || null;

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
        new Set([imageUrl, ...(selectedVehicle.images || []), ...storageFiles.map((f) => f.publicUrl)])
      );
      const res = await updateVehicle(
        selectedVehicle.id,
        { image: imageUrl, images: mergedGallery },
        detectedColumns
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.skippedFields.includes('Primary Image')) {
        setError('Your vehicles table does not have a primary image column (e.g. image_url).');
        return;
      }
      setNotice(`Primary photograph updated for ${selectedVehicle.name}.`);
      onRefreshVehicles();
    } finally {
      setBusyPath(null);
    }
  };

  const handleDeleteImage = async (file: VehicleStorageFile) => {
    if (!selectedVehicle) return;
    setError('');
    setNotice('');

    const remainingStorage = storageFiles.filter((item) => item.path !== file.path);
    const remainingGallery = (selectedVehicle.images || []).filter(
      (url) => url !== file.publicUrl
    );
    const nextPrimary =
      selectedVehicle.image === file.publicUrl
        ? remainingStorage[0]?.publicUrl || remainingGallery[0] || ''
        : selectedVehicle.image;

    if (!nextPrimary) {
      setError(
        'A primary vehicle image is required. Upload a replacement photograph before deleting the last remaining image.'
      );
      return;
    }

    setBusyPath(file.path);

    try {
      const delRes = await deleteVehicleImageFromStorage(file.path);
      if (!delRes.success) {
        setError(delRes.error || 'Could not delete image.');
        return;
      }

      const updateRes = await updateVehicle(
        selectedVehicle.id,
        {
          image: nextPrimary,
          images: remainingGallery,
        },
        detectedColumns
      );

      setStorageFiles(remainingStorage);
      if (updateRes.error) {
        setError(
          `Image deleted from storage, but failed to update vehicle record: ${updateRes.error}`
        );
      } else {
        setNotice('Image removed from storage and vehicle record updated.');
      }
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

      {/* Stored Images Gallery */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-bold text-[#0B1F3A]">
          Current Photographs for {selectedVehicle?.name}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Choose which image appears as the primary card photo on customer listings.
        </p>

        {loadingImages ? (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="aspect-[4/3] animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* Existing DB primary image if not from storageFiles */}
            {selectedVehicle?.image &&
              !storageFiles.some((f) => f.publicUrl === selectedVehicle.image) && (
                <div className="overflow-hidden rounded-xl border border-[#1D4ED8] bg-white">
                  <VehicleImage src={selectedVehicle.image} alt={`${selectedVehicle.name} primary`} />
                  <div className="p-3.5">
                    <p className="text-xs font-semibold text-[#1D4ED8]">Current Primary Listing Image</p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">{selectedVehicle.image}</p>
                  </div>
                </div>
              )}

            {/* Additional DB gallery URLs if not returned by storage.list() */}
            {(selectedVehicle?.images || [])
              .filter(
                (url) =>
                  url !== selectedVehicle?.image &&
                  !storageFiles.some((f) => f.publicUrl === url)
              )
              .map((galleryUrl, idx) => (
                <div
                  key={`${galleryUrl}-${idx}`}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <VehicleImage src={galleryUrl} alt={`${selectedVehicle?.name} gallery ${idx + 1}`} />
                  <div className="p-3.5">
                    <p className="truncate text-xs font-medium text-[#0B1F3A]">Linked Gallery Image</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{galleryUrl}</p>
                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={busyPath === galleryUrl}
                        onClick={() => void handleSetPrimary(galleryUrl)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1F3A] transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8] disabled:opacity-50"
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Set Primary</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}

            {storageFiles.map((file) => {
              const isPrimary = selectedVehicle?.image === file.publicUrl;
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
                    {isPrimary && (
                      <p className="mt-0.5 text-[11px] font-semibold text-[#1D4ED8]">Primary Listing Image</p>
                    )}

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
                        onClick={() => void handleDeleteImage(file)}
                        aria-label={`Delete ${file.name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!selectedVehicle?.image &&
              (selectedVehicle?.images || []).length === 0 &&
              storageFiles.length === 0 && (
              <div className="col-span-full rounded-xl border border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-600">
                No photographs uploaded for this vehicle yet. Use the picker above to upload images to the{' '}
                <code className="font-mono font-semibold">vehicle-images</code> bucket.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
