import { and, eq } from 'drizzle-orm';
import { isSafeArchivePath, type ArchiveMediaKind } from '$lib/archive-format';
import { db } from '$lib/server/db';
import { energyClaim, energySource, report } from '$lib/server/db/schema';
import {
  storeEnergyPhoto,
  validateEnergyPhoto,
} from '$lib/server/energy-source-storage';
import { resolveArchiveEnergyClaimId, resolveArchiveEntityId } from '$lib/server/archive-import';
import { MAX_UPLOAD_BYTES } from '$lib/upload-limits';

export interface ArchiveMediaImportMetadata {
  archivePath: string;
  sourceKind: ArchiveMediaKind;
  sourceId: string;
  energyClaimId?: string;
  originProvider?: string;
  originExternalId?: string;
  fileName: string | null;
  mimeType: string | null;
}

export type ArchiveMediaErrorCode =
  | 'file_too_large'
  | 'invalid_file'
  | 'invalid_metadata'
  | 'missing_claim'
  | 'missing_report'
  | 'storage_unavailable';

export class ArchiveMediaError extends Error {
  constructor(public readonly code: ArchiveMediaErrorCode) {
    super(code);
    this.name = 'ArchiveMediaError';
  }
}

function optionalMetadataText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ArchiveMediaError('invalid_metadata');
  }
  return value;
}

export function parseArchiveMediaMetadata(value: unknown): ArchiveMediaImportMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveMediaError('invalid_metadata');
  }

  const row = value as Record<string, unknown>;
  const archivePath = typeof row.archivePath === 'string' ? row.archivePath : '';
  const sourceKind = row.sourceKind;
  const sourceId = typeof row.sourceId === 'string' ? row.sourceId : '';

  if (!isSafeArchivePath(archivePath) || !sourceId || sourceId.length > 512) {
    throw new ArchiveMediaError('invalid_metadata');
  }
  if (sourceKind !== 'energy-photo' && sourceKind !== 'report-source') {
    throw new ArchiveMediaError('invalid_metadata');
  }

  const energyClaimId = optionalMetadataText(row.energyClaimId, 512);
  const originProvider = optionalMetadataText(row.originProvider, 300);
  const originExternalId = optionalMetadataText(row.originExternalId, 1000);
  if (sourceKind === 'energy-photo' && !energyClaimId) {
    throw new ArchiveMediaError('invalid_metadata');
  }

  return {
    archivePath,
    sourceKind,
    sourceId,
    ...(energyClaimId ? { energyClaimId } : {}),
    ...(originProvider ? { originProvider } : {}),
    ...(originExternalId ? { originExternalId } : {}),
    fileName: optionalMetadataText(row.fileName, 300),
    mimeType: optionalMetadataText(row.mimeType, 200),
  };
}

function reportSourceUrl(key: string) {
  return `/api/report-source?key=${encodeURIComponent(key)}`;
}

function ownedReportSourceKey(value: string | null, patientId: string) {
  if (!value) return null;

  try {
    const descriptor = JSON.parse(value) as Record<string, unknown>;
    const key = typeof descriptor.key === 'string' ? descriptor.key : '';
    const prefix = `report-sources/${patientId}/`;
    const remainder = key.startsWith(prefix) ? key.slice(prefix.length) : '';
    return descriptor.kind === 'r2-file' && remainder && !remainder.includes('/') ? key : null;
  } catch {
    return null;
  }
}

export async function restoreArchiveMedia(input: {
  patientId: string;
  sourcePatientId: string;
  metadata: ArchiveMediaImportMetadata;
  file: File;
  bucket?: R2Bucket | null;
}) {
  if (!input.sourcePatientId || input.sourcePatientId.length > 512) {
    throw new ArchiveMediaError('invalid_metadata');
  }
  if (!input.bucket) throw new ArchiveMediaError('storage_unavailable');
  if (input.file.size === 0) throw new ArchiveMediaError('invalid_file');
  if (input.file.size > MAX_UPLOAD_BYTES) throw new ArchiveMediaError('file_too_large');

  if (input.metadata.sourceKind === 'report-source') {
    const reportId = await resolveArchiveEntityId(
      input.patientId,
      input.sourcePatientId,
      'report',
      input.metadata.sourceId,
    );
    const target = await db
      .select({ id: report.id, rawData: report.rawData })
      .from(report)
      .where(and(eq(report.id, reportId), eq(report.patientId, input.patientId)))
      .limit(1);
    if (!target[0]) throw new ArchiveMediaError('missing_report');

    const currentStorageKey = ownedReportSourceKey(target[0].rawData, input.patientId);
    if (currentStorageKey && (await input.bucket.head(currentStorageKey))) {
      return { sourceKind: input.metadata.sourceKind, id: reportId };
    }

    const storageKey = currentStorageKey || `report-sources/${input.patientId}/archive-${reportId}`;
    const mimeType = input.metadata.mimeType || input.file.type || 'application/octet-stream';
    await input.bucket.put(storageKey, input.file.stream(), {
      httpMetadata: { contentType: mimeType },
    });

    await db
      .update(report)
      .set({
        rawData: JSON.stringify({
          kind: 'r2-file',
          key: storageKey,
          sourceUrl: reportSourceUrl(storageKey),
          mimeType,
          fileName: input.metadata.fileName || input.file.name || null,
        }),
      })
      .where(and(eq(report.id, reportId), eq(report.patientId, input.patientId)));

    return { sourceKind: input.metadata.sourceKind, id: reportId };
  }

  const energyClaimId = await resolveArchiveEnergyClaimId({
    patientId: input.patientId,
    sourcePatientId: input.sourcePatientId,
    sourceId: input.metadata.energyClaimId!,
    originProvider: input.metadata.originProvider,
    originExternalId: input.metadata.originExternalId,
  });
  const target = await db
    .select({ id: energyClaim.id })
    .from(energyClaim)
    .where(and(eq(energyClaim.id, energyClaimId), eq(energyClaim.patientId, input.patientId)))
    .limit(1);
  if (!target[0]) throw new ArchiveMediaError('missing_claim');

  const photo = validateEnergyPhoto(input.file);
  if (!photo) throw new ArchiveMediaError('invalid_file');
  const id = await resolveArchiveEntityId(
    input.patientId,
    input.sourcePatientId,
    'energy-source',
    input.metadata.sourceId,
  );
  const existingSource = await db
    .select({
      patientId: energySource.patientId,
      energyClaimId: energySource.energyClaimId,
      storageKey: energySource.storageKey,
    })
    .from(energySource)
    .where(eq(energySource.id, id))
    .limit(1);
  if (
    existingSource[0] &&
    (existingSource[0].patientId !== input.patientId || existingSource[0].energyClaimId !== energyClaimId)
  ) {
    throw new ArchiveMediaError('invalid_metadata');
  }
  if (existingSource[0] && (await input.bucket.head(existingSource[0].storageKey))) {
    return { sourceKind: input.metadata.sourceKind, id };
  }
  const stored = await storeEnergyPhoto({
    bucket: input.bucket,
    patientId: input.patientId,
    energyClaimId,
    id,
    storageKey: existingSource[0]?.storageKey,
    ...photo,
  });

  await db
    .insert(energySource)
    .values(stored)
    .onConflictDoUpdate({
      target: energySource.id,
      set: {
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        fileName: stored.fileName,
        byteSize: stored.byteSize,
        objectEtag: stored.objectEtag,
      },
    });

  return { sourceKind: input.metadata.sourceKind, id };
}
