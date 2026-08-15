export const CURRENT_HEALTH_ARCHIVE_VERSION = 7;

export type ArchiveMediaKind = 'energy-photo' | 'import-file' | 'report-source';

export interface HealthArchiveMediaFile {
  archivePath: string;
  sourceKind: ArchiveMediaKind;
  sourceId: string;
  fileName: string | null;
  mimeType: string | null;
  byteSize?: number;
  sha256?: string;
}

export function isSafeArchivePath(value: string) {
  if (!value || value.length > 512 || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
