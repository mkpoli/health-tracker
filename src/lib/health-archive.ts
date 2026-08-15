import { strFromU8, Unzip, UnzipInflate } from 'fflate';
import {
  CURRENT_HEALTH_ARCHIVE_VERSION,
  isSafeArchivePath,
  sha256Hex,
  type ArchiveMediaKind,
  type HealthArchiveMediaFile,
} from '$lib/archive-format';

export const MAX_HEALTH_DATA_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_MEDIA_BYTES = 50 * 1024 * 1024;

export { CURRENT_HEALTH_ARCHIVE_VERSION, isSafeArchivePath, sha256Hex } from '$lib/archive-format';
export type { ArchiveMediaKind, HealthArchiveMediaFile } from '$lib/archive-format';

export interface HealthTrackerExport {
  format: 'health-tracker-export';
  version: number;
  exportedAt: string | null;
  patient: Record<string, unknown>;
  reports: unknown[];
  records: unknown[];
  medicines: unknown[];
  energyEntries: unknown[];
  energySources: unknown[];
  claimRevisions: unknown[];
  mediaFiles: HealthArchiveMediaFile[];
}

export interface ReadHealthArchiveResult {
  data: HealthTrackerExport;
  kind: 'json' | 'zip';
  availableMediaPaths: Set<string>;
  missingMediaPaths: string[];
}

export type HealthArchiveErrorCode =
  | 'archive_corrupt'
  | 'checksum_mismatch'
  | 'invalid_format'
  | 'manifest_missing'
  | 'manifest_too_large'
  | 'media_too_large'
  | 'unsafe_media_path'
  | 'unsupported_version';

export class HealthArchiveError extends Error {
  constructor(public readonly code: HealthArchiveErrorCode, message: string) {
    super(message);
    this.name = 'HealthArchiveError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOrEmpty(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parseMediaFile(value: unknown): HealthArchiveMediaFile {
  const media = asRecord(value);
  if (!media) throw new HealthArchiveError('invalid_format', 'A media manifest entry is invalid');

  const archivePath = typeof media.archivePath === 'string' ? media.archivePath : '';
  const sourceKind = media.sourceKind;
  const sourceId = typeof media.sourceId === 'string' ? media.sourceId : '';

  if (!isSafeArchivePath(archivePath)) {
    throw new HealthArchiveError('unsafe_media_path', 'A media path in this archive is unsafe');
  }
  if (sourceKind !== 'energy-photo' && sourceKind !== 'report-source') {
    throw new HealthArchiveError('invalid_format', 'A media source type is invalid');
  }
  if (!sourceId || sourceId.length > 512) {
    throw new HealthArchiveError('invalid_format', 'A media source identifier is invalid');
  }

  const byteSize =
    typeof media.byteSize === 'number' &&
    Number.isSafeInteger(media.byteSize) &&
    media.byteSize >= 0 &&
    media.byteSize <= MAX_ARCHIVE_MEDIA_BYTES
    ? media.byteSize
    : undefined;
  const sha256 = typeof media.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(media.sha256)
    ? media.sha256.toLowerCase()
    : undefined;

  if (media.byteSize !== undefined && byteSize === undefined) {
    throw new HealthArchiveError('invalid_format', 'A media byte size is invalid');
  }
  if (media.sha256 !== undefined && sha256 === undefined) {
    throw new HealthArchiveError('invalid_format', 'A media checksum is invalid');
  }
  if (
    media.fileName !== null &&
    media.fileName !== undefined &&
    (typeof media.fileName !== 'string' || media.fileName.length > 300)
  ) {
    throw new HealthArchiveError('invalid_format', 'A media file name is invalid');
  }
  if (
    media.mimeType !== null &&
    media.mimeType !== undefined &&
    (typeof media.mimeType !== 'string' || media.mimeType.length > 200)
  ) {
    throw new HealthArchiveError('invalid_format', 'A media type is invalid');
  }

  return {
    archivePath,
    sourceKind,
    sourceId,
    fileName: typeof media.fileName === 'string' ? media.fileName : null,
    mimeType: typeof media.mimeType === 'string' ? media.mimeType : null,
    ...(byteSize === undefined ? {} : { byteSize }),
    ...(sha256 ? { sha256 } : {}),
  };
}

export function parseHealthTrackerExport(value: unknown): HealthTrackerExport {
  const data = asRecord(value);
  if (!data || data.format !== 'health-tracker-export') {
    throw new HealthArchiveError('invalid_format', 'This is not a Health Tracker export');
  }

  const version = data.version;
  if (!Number.isSafeInteger(version) || Number(version) < 1 || Number(version) > CURRENT_HEALTH_ARCHIVE_VERSION) {
    throw new HealthArchiveError('unsupported_version', 'This Health Tracker export version is not supported');
  }

  const patient = asRecord(data.patient);
  if (!patient) throw new HealthArchiveError('invalid_format', 'The patient profile is missing');
  if (typeof patient.id !== 'string' || !patient.id || patient.id.length > 512) {
    throw new HealthArchiveError('invalid_format', 'The patient profile identifier is missing');
  }
  if (!Array.isArray(data.reports) || !Array.isArray(data.records)) {
    throw new HealthArchiveError('invalid_format', 'The report data is incomplete');
  }

  const mediaValues = arrayOrEmpty(data.mediaFiles);
  if (mediaValues.length > 10_000) {
    throw new HealthArchiveError('invalid_format', 'The media manifest is too large');
  }

  const mediaFiles = mediaValues.map(parseMediaFile);
  if (new Set(mediaFiles.map((media) => media.archivePath)).size !== mediaFiles.length) {
    throw new HealthArchiveError('invalid_format', 'The media manifest contains duplicate paths');
  }

  return {
    format: 'health-tracker-export',
    version: Number(version),
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
    patient,
    reports: data.reports,
    records: data.records,
    medicines: arrayOrEmpty(data.medicines),
    energyEntries: arrayOrEmpty(data.energyEntries),
    energySources: arrayOrEmpty(data.energySources),
    claimRevisions: arrayOrEmpty(data.claimRevisions),
    mediaFiles,
  };
}

function joinChunks(chunks: Uint8Array[], size: number) {
  const joined = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

async function readZipManifest(file: File, onProgress?: (read: number, total: number) => void) {
  const names = new Set<string>();
  const manifestChunks: Uint8Array[] = [];
  let manifestSize = 0;
  let streamError: Error | null = null;

  const unzip = new Unzip((entry) => {
    names.add(entry.name);

    if (entry.name !== 'health-data.json') {
      entry.ondata = (error) => {
        if (error) streamError = error;
      };
      return;
    }

    if ((entry.originalSize || 0) > MAX_HEALTH_DATA_BYTES) {
      streamError = new HealthArchiveError('manifest_too_large', 'health-data.json is too large');
      return;
    }

    entry.ondata = (error, chunk) => {
      if (error) {
        streamError = error;
        return;
      }

      manifestSize += chunk.byteLength;
      if (manifestSize > MAX_HEALTH_DATA_BYTES) {
        streamError = new HealthArchiveError('manifest_too_large', 'health-data.json is too large');
        entry.terminate();
        return;
      }
      manifestChunks.push(chunk);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = file.stream().getReader();
  let read = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        unzip.push(new Uint8Array(), true);
        break;
      }

      read += next.value.byteLength;
      unzip.push(next.value, false);
      onProgress?.(read, file.size);
      if (streamError) throw streamError;
    }
  } catch (error) {
    throw error instanceof HealthArchiveError
      ? error
      : new HealthArchiveError('archive_corrupt', error instanceof Error ? error.message : 'The ZIP archive is corrupt');
  } finally {
    reader.releaseLock();
  }

  const finalStreamError = streamError as Error | null;
  if (finalStreamError) {
    throw finalStreamError instanceof HealthArchiveError
      ? finalStreamError
      : new HealthArchiveError('archive_corrupt', finalStreamError.message);
  }
  if (manifestChunks.length === 0) {
    throw new HealthArchiveError('manifest_missing', 'health-data.json is missing from this ZIP archive');
  }

  try {
    return { value: JSON.parse(strFromU8(joinChunks(manifestChunks, manifestSize))) as unknown, names };
  } catch {
    throw new HealthArchiveError('invalid_format', 'health-data.json is not valid JSON');
  }
}

export async function readHealthArchiveFile(
  file: File,
  onProgress?: (read: number, total: number) => void,
): Promise<ReadHealthArchiveResult> {
  if (file.name.toLowerCase().endsWith('.json')) {
    if (file.size > MAX_HEALTH_DATA_BYTES) {
      throw new HealthArchiveError('manifest_too_large', 'The JSON export is too large');
    }

    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      throw new HealthArchiveError('invalid_format', 'The export is not valid JSON');
    }

    onProgress?.(file.size, file.size);
    const data = parseHealthTrackerExport(value);
    return {
      data,
      kind: 'json',
      availableMediaPaths: new Set(),
      missingMediaPaths: data.mediaFiles.map((media) => media.archivePath),
    };
  }

  const { value, names } = await readZipManifest(file, onProgress);
  const data = parseHealthTrackerExport(value);
  if (
    data.version >= 5 &&
    data.mediaFiles.some((media) => media.byteSize === undefined || media.sha256 === undefined)
  ) {
    throw new HealthArchiveError('invalid_format', 'This ZIP lacks media integrity metadata');
  }
  const manifestPaths = new Set(data.mediaFiles.map((media) => media.archivePath));
  const availableMediaPaths = new Set([...names].filter((name) => manifestPaths.has(name)));

  return {
    data,
    kind: 'zip',
    availableMediaPaths,
    missingMediaPaths: [...manifestPaths].filter((path) => !availableMediaPaths.has(path)),
  };
}

export async function forEachArchiveMedia(
  file: File,
  mediaFiles: HealthArchiveMediaFile[],
  handle: (media: HealthArchiveMediaFile, bytes: Uint8Array) => Promise<void>,
  onProgress?: (read: number, total: number) => void,
) {
  const byPath = new Map(mediaFiles.map((media) => [media.archivePath, media]));
  const completed = new Set<string>();
  let pending = Promise.resolve();
  let streamError: Error | null = null;

  const unzip = new Unzip((entry) => {
    const media = byPath.get(entry.name);
    if (!media) {
      entry.ondata = (error) => {
        if (error) streamError = error;
      };
      return;
    }

    if ((entry.originalSize || 0) > MAX_ARCHIVE_MEDIA_BYTES) {
      streamError = new HealthArchiveError('media_too_large', `${entry.name} is larger than 50 MB`);
      return;
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, chunk, final) => {
      if (error) {
        streamError = error;
        return;
      }

      size += chunk.byteLength;
      if (size > MAX_ARCHIVE_MEDIA_BYTES) {
        streamError = new HealthArchiveError('media_too_large', `${entry.name} is larger than 50 MB`);
        entry.terminate();
        return;
      }
      chunks.push(chunk);

      if (final) {
        const bytes = joinChunks(chunks, size);
        pending = pending.then(async () => {
          if (media.byteSize !== undefined && media.byteSize !== bytes.byteLength) {
            throw new HealthArchiveError('checksum_mismatch', `${entry.name} has an unexpected size`);
          }
          if (media.sha256 && (await sha256Hex(bytes)) !== media.sha256) {
            throw new HealthArchiveError('checksum_mismatch', `${entry.name} failed its checksum`);
          }

          await handle(media, bytes);
          completed.add(entry.name);
        });
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = file.stream().getReader();
  let read = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        unzip.push(new Uint8Array(), true);
        await pending;
        break;
      }

      read += next.value.byteLength;
      unzip.push(next.value, false);
      await pending;
      onProgress?.(read, file.size);
      if (streamError) throw streamError;
    }
  } catch (error) {
    throw error instanceof HealthArchiveError
      ? error
      : new HealthArchiveError('archive_corrupt', error instanceof Error ? error.message : 'The ZIP archive is corrupt');
  } finally {
    reader.releaseLock();
  }

  const finalStreamError = streamError as Error | null;
  if (finalStreamError) {
    throw finalStreamError instanceof HealthArchiveError
      ? finalStreamError
      : new HealthArchiveError('archive_corrupt', finalStreamError.message);
  }

  return completed;
}

export function chunkArchiveItems<T>(items: T[], size = 100) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
