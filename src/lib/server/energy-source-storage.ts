import type { EnergySourceRecord } from '$lib/energy';

export const MAX_ENERGY_PHOTO_BYTES = 50 * 1024 * 1024;

const mimeExtensions = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
]);

export type StoredEnergyPhoto = {
  id: string;
  patientId: string;
  energyClaimId: string;
  kind: 'photo';
  storageKey: string;
  mimeType: string;
  fileName: string | null;
  byteSize: number;
  objectEtag: string | null;
};

export type EnergyPhotoErrorCode = 'invalid_photo_type' | 'photo_too_large' | 'source_storage_unavailable';

export class EnergyPhotoError extends Error {
  constructor(public readonly code: EnergyPhotoErrorCode) {
    super(code);
  }
}

function mimeTypeFor(file: File) {
  const declared = file.type.trim().toLowerCase();
  if (mimeExtensions.has(declared)) return declared;

  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';

  throw new EnergyPhotoError('invalid_photo_type');
}

export function validateEnergyPhoto(file: File | null) {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_ENERGY_PHOTO_BYTES) throw new EnergyPhotoError('photo_too_large');

  return { file, mimeType: mimeTypeFor(file) };
}

export async function storeEnergyPhoto({
  bucket,
  patientId,
  energyClaimId,
  file,
  mimeType,
}: {
  bucket?: R2Bucket | null;
  patientId: string;
  energyClaimId: string;
  file: File;
  mimeType: string;
}): Promise<StoredEnergyPhoto> {
  if (!bucket) throw new EnergyPhotoError('source_storage_unavailable');

  const id = crypto.randomUUID();
  const extension = mimeExtensions.get(mimeType) || 'image';
  const storageKey = `energy-sources/${patientId}/${energyClaimId}/${id}.${extension}`;
  const object = await bucket.put(storageKey, file.stream(), {
    httpMetadata: { contentType: mimeType },
  });

  return {
    id,
    patientId,
    energyClaimId,
    kind: 'photo',
    storageKey,
    mimeType,
    fileName: file.name || null,
    byteSize: file.size,
    objectEtag: object.httpEtag || null,
  };
}

export function toEnergySourceRecord(source: {
  id: string;
  energyClaimId: string;
  kind: string;
  mimeType: string;
  fileName: string | null;
  byteSize: number;
  createdAt: string;
}): EnergySourceRecord {
  return {
    id: source.id,
    energyClaimId: source.energyClaimId,
    kind: 'photo',
    mimeType: source.mimeType,
    fileName: source.fileName,
    byteSize: source.byteSize,
    sourceUrl: `/api/energy-source?id=${encodeURIComponent(source.id)}`,
    createdAt: source.createdAt,
  };
}
