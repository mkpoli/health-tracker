import type { DataImportRecord } from '$lib/data-import';
import { isDataImportStatus } from '$lib/data-import';
import type { dataImport } from '$lib/server/db/schema';

export function normalizeDataImport(
  value: typeof dataImport.$inferSelect,
): DataImportRecord {
  return {
    id: value.id,
    provider: value.provider,
    format: value.format,
    status: isDataImportStatus(value.status) ? value.status : 'failed',
    fileName: value.fileName,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    contentSha256: value.contentSha256,
    interpretationKey: value.interpretationKey,
    timezone: value.timezone,
    summaryData: value.summaryData ?? null,
    errorCode: value.errorCode,
    sourceUrl: `/api/import-source?id=${encodeURIComponent(value.id)}`,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
