export const dataImportStatuses = ['pending', 'completed', 'failed'] as const;

export type DataImportStatus = (typeof dataImportStatuses)[number];

export interface DataImportRecord {
  id: string;
  provider: string;
  format: string;
  status: DataImportStatus;
  fileName: string | null;
  mimeType: string;
  byteSize: number;
  contentSha256: string;
  interpretationKey: string;
  timezone: string | null;
  summaryData: unknown;
  errorCode: string | null;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export function isDataImportStatus(value: string): value is DataImportStatus {
  return dataImportStatuses.includes(value as DataImportStatus);
}
