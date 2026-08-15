// A patient archive contains the structured snapshot and the source files that
// can be read through the signed-in app.

import { CURRENT_HEALTH_ARCHIVE_VERSION, sha256Hex } from '$lib/archive-format';

export interface PatientExportInput {
  patient: unknown;
  reports: unknown[];
  records: unknown[];
  medicines: unknown[];
  energyEntries: unknown[];
  energySources: unknown[];
  exerciseDefinitions: unknown[];
  workouts: unknown[];
  claimRevisions: unknown[];
}

export interface PatientArchiveMedia {
  archivePath: string;
  sourceUrl: string;
  sourceKind: 'energy-photo' | 'report-source';
  sourceId: string;
  fileName: string | null;
  mimeType: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseJsonRecord(value: unknown) {
  if (typeof value !== 'string') return asRecord(value);

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeArchiveName(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;

  const cleaned = value
    .normalize('NFKC')
    .replace(/[\\/\0-\x1f\x7f]+/g, '-')
    .replace(/^[.\s_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return cleaned || fallback;
}

function archiveSourceId(value: unknown, fallback: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`Invalid archive source ID for ${fallback}`);
  }
  return value;
}

export function listPatientArchiveMedia(input: PatientExportInput): PatientArchiveMedia[] {
  const media: PatientArchiveMedia[] = [];

  input.energySources.forEach((value, index) => {
    const source = asRecord(value);
    if (!source || typeof source.sourceUrl !== 'string') return;

    const sourceId = archiveSourceId(source.id, `energy-source-${index + 1}`);
    const pathId = safeArchiveName(sourceId, `energy-source-${index + 1}`);
    const fileName = typeof source.fileName === 'string' ? source.fileName : null;
    media.push({
      archivePath: `media/calories/${index + 1}-${pathId}-${safeArchiveName(fileName, 'meal-photo')}`,
      sourceUrl: source.sourceUrl,
      sourceKind: 'energy-photo',
      sourceId,
      fileName,
      mimeType: typeof source.mimeType === 'string' ? source.mimeType : null,
    });
  });

  input.reports.forEach((value, index) => {
    const report = asRecord(value);
    const descriptor = parseJsonRecord(report?.rawData);
    if (!report || !descriptor || descriptor.kind !== 'r2-file') {
      return;
    }

    const sourceUrl =
      typeof descriptor.sourceUrl === 'string'
        ? descriptor.sourceUrl
        : typeof descriptor.key === 'string'
          ? `/api/report-source?key=${encodeURIComponent(descriptor.key)}`
          : null;
    if (!sourceUrl) return;

    const sourceId = archiveSourceId(report.id, `report-${index + 1}`);
    const pathId = safeArchiveName(sourceId, `report-${index + 1}`);
    const fileName = typeof descriptor.fileName === 'string' ? descriptor.fileName : null;
    media.push({
      archivePath: `media/reports/${index + 1}-${pathId}-${safeArchiveName(fileName, 'report-source')}`,
      sourceUrl,
      sourceKind: 'report-source',
      sourceId,
      fileName,
      mimeType: typeof descriptor.mimeType === 'string' ? descriptor.mimeType : null,
    });
  });

  return media;
}

export function buildPatientExport({
  patient,
  reports,
  records,
  medicines,
  energyEntries,
  energySources,
  exerciseDefinitions,
  workouts,
  claimRevisions,
}: PatientExportInput) {
  const input = {
    patient,
    reports,
    records,
    medicines,
    energyEntries,
    energySources,
    exerciseDefinitions,
    workouts,
    claimRevisions,
  };

  return {
    format: 'health-tracker-export',
    version: CURRENT_HEALTH_ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    patient,
    reports,
    records,
    medicines,
    energyEntries,
    energySources,
    exerciseDefinitions,
    workouts,
    claimRevisions,
    mediaFiles: listPatientArchiveMedia(input).map(({ sourceUrl: _sourceUrl, ...media }) => media),
  };
}

export function downloadPatientExport(input: PatientExportInput, patientName?: string | null) {
  const payload = buildPatientExport(input);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = patientName?.trim().replace(/\s+/g, '_') || 'patient';

  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}_health-data_${datePart}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function buildPatientArchiveBytes(
  input: PatientExportInput,
  origin: string,
  fetchSource: typeof fetch = fetch,
) {
  const { strToU8, zipSync } = await import('fflate');
  const appOrigin = new URL(origin).origin;
  const payload = buildPatientExport(input);
  const mediaFiles = [];
  const sourceFiles: Record<string, Uint8Array> = {};

  for (const media of listPatientArchiveMedia(input)) {
    const sourceUrl = new URL(media.sourceUrl, appOrigin);
    if (sourceUrl.origin !== appOrigin) {
      throw new Error('Archive source must be served by this app');
    }

    const response = await fetchSource(sourceUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Could not read ${media.archivePath}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    sourceFiles[media.archivePath] = bytes;
    mediaFiles.push({
      archivePath: media.archivePath,
      sourceKind: media.sourceKind,
      sourceId: media.sourceId,
      fileName: media.fileName,
      mimeType: media.mimeType,
      byteSize: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
  }

  const files: Record<string, Uint8Array> = {
    'health-data.json': strToU8(JSON.stringify({ ...payload, mediaFiles }, null, 2)),
    ...sourceFiles,
  };

  return zipSync(files, { level: 0 });
}

export async function downloadPatientArchive(input: PatientExportInput, patientName?: string | null) {
  const archiveBytes = await buildPatientArchiveBytes(input, window.location.origin);
  const archiveBuffer = new Uint8Array(archiveBytes).buffer;
  const blob = new Blob([archiveBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = safeArchiveName(patientName, 'patient').replace(/\s+/g, '_');
  const link = document.createElement('a');

  link.href = url;
  link.download = `${safeName}_health-archive_${datePart}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
