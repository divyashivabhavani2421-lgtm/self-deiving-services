import { supabase } from '../lib/supabase';
import { VehicleStorageFile } from '../types/vehicle';

export const VEHICLE_IMAGES_BUCKET = 'vehicle-images';
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface StorageListResult {
  files: VehicleStorageFile[];
  bucketMissing: boolean;
  error: string | null;
}

export interface StorageUploadResult {
  uploaded: VehicleStorageFile[];
  errors: string[];
  bucketMissing: boolean;
}

export interface UploadProgressInfo {
  completed: number;
  total: number;
  percent: number;
  currentFile: string;
}

const EXTENSION_TO_MIME: Record<string, (typeof ALLOWED_IMAGE_MIME_TYPES)[number]> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function generateUniqueSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
}

function resolveNormalizedMime(file: File): (typeof ALLOWED_IMAGE_MIME_TYPES)[number] | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return null;
  }

  const rawType = file.type.trim().toLowerCase();
  if (rawType === 'image/jpg' || rawType === 'image/jpeg' || rawType === 'image/pjpeg') {
    return 'image/jpeg';
  }
  if (rawType === 'image/png') {
    return 'image/png';
  }
  if (rawType === 'image/webp') {
    return 'image/webp';
  }
  if (!rawType) {
    return EXTENSION_TO_MIME[ext] ?? null;
  }

  return null;
}

function sanitizeFileName(rawName: string): string {
  const parts = rawName.split('.');
  const ext = (parts.pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'vehicle'}.${ext || 'jpg'}`;
}

export function validateImageFile(file: File): string | null {
  const normalizedMime = resolveNormalizedMime(file);

  if (!normalizedMime) {
    return `"${file.name}" is not a supported image format. Allowed formats: JPG, PNG, WebP.`;
  }
  if (file.size <= 0) {
    return `"${file.name}" appears to be empty.`;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `"${file.name}" exceeds the 5 MB file size limit.`;
  }
  return null;
}

function isBucketNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('bucket not found') || lower.includes('not found');
}

export async function listVehicleImages(vehicleId: string): Promise<StorageListResult> {
  if (!supabase) {
    return { files: [], bucketMissing: false, error: 'Supabase is not configured.' };
  }

  const client = supabase;
  const safeFolder = vehicleId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeFolder) {
    return { files: [], bucketMissing: false, error: 'Invalid vehicle identifier.' };
  }

  const { data, error } = await client.storage
    .from(VEHICLE_IMAGES_BUCKET)
    .list(safeFolder, {
      limit: 50,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    return {
      files: [],
      bucketMissing: isBucketNotFoundError(error.message || ''),
      error: error.message,
    };
  }

  const items = (data || []).filter(
    (item) => Boolean(item.name) && !item.name.startsWith('.') && item.id !== null
  );
  const files: VehicleStorageFile[] = items.map((item) => {
    const path = `${safeFolder}/${item.name}`;
    const { data: urlData } = client.storage.from(VEHICLE_IMAGES_BUCKET).getPublicUrl(path);
    const meta = (item.metadata as Record<string, unknown> | null) || null;
    const sizeBytes = typeof meta?.size === 'number' ? meta.size : undefined;

    return {
      name: item.name,
      path,
      publicUrl: urlData.publicUrl,
      createdAt: item.created_at ?? undefined,
      sizeBytes,
    };
  });

  return { files, bucketMissing: false, error: null };
}

export async function uploadVehicleImages(
  folderOrVehicleId: string,
  files: File[],
  onProgress?: (progress: UploadProgressInfo) => void
): Promise<StorageUploadResult> {
  if (!supabase) {
    return {
      uploaded: [],
      errors: ['Supabase is not configured.'],
      bucketMissing: false,
    };
  }

  const client = supabase;
  const safeFolder = folderOrVehicleId.replace(/[^a-zA-Z0-9_/-]/g, '').replace(/^\/+|\/+$/g, '');
  if (!safeFolder) {
    return {
      uploaded: [],
      errors: ['Invalid storage folder path for image upload.'],
      bucketMissing: false,
    };
  }

  const uploaded: VehicleStorageFile[] = [];
  const errors: string[] = [];
  let bucketMissing = false;
  const total = files.length;

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    onProgress?.({
      completed: idx,
      total,
      percent: total > 0 ? Math.round((idx / total) * 100) : 0,
      currentFile: file.name,
    });

    const validationError = validateImageFile(file);
    if (validationError) {
      errors.push(validationError);
      continue;
    }

    const contentType = resolveNormalizedMime(file) || 'image/jpeg';
    const safeName = sanitizeFileName(file.name);
    const storagePath = `${safeFolder}/${Date.now()}-${generateUniqueSuffix()}-${safeName}`;

    const { error: uploadError } = await client.storage
      .from(VEHICLE_IMAGES_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

    if (uploadError) {
      if (isBucketNotFoundError(uploadError.message || '')) {
        bucketMissing = true;
      }
      errors.push(`${file.name}: ${uploadError.message}`);
      continue;
    }

    const { data: urlData } = client.storage.from(VEHICLE_IMAGES_BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl?.trim() || '';
    if (!publicUrl) {
      errors.push(`${file.name}: Uploaded file did not return a public image URL.`);
      continue;
    }

    uploaded.push({
      name: safeName,
      path: storagePath,
      publicUrl,
      sizeBytes: file.size,
    });

    onProgress?.({
      completed: idx + 1,
      total,
      percent: total > 0 ? Math.round(((idx + 1) / total) * 100) : 100,
      currentFile: file.name,
    });
  }

  return { uploaded, errors, bucketMissing };
}

export async function deleteUploadedFiles(paths: string[]): Promise<void> {
  if (!supabase || paths.length === 0) return;
  await supabase.storage.from(VEHICLE_IMAGES_BUCKET).remove(paths);
}

export async function deleteVehicleImageFromStorage(
  storagePath: string
): Promise<{ success: boolean; error: string | null }> {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  const { error } = await supabase.storage.from(VEHICLE_IMAGES_BUCKET).remove([storagePath]);
  if (error) {
    return {
      success: false,
      error: error.message || 'Unable to delete image. Only administrators can remove vehicle images.',
    };
  }
  return { success: true, error: null };
}
