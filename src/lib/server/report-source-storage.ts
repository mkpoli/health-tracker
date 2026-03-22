type ReportSourceDescriptor =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'file';
      dataUrl: string;
      mimeType: string | null;
      fileName: string | null;
    }
  | {
      kind: 'r2-file';
      key: string;
      sourceUrl: string;
      mimeType: string | null;
      fileName: string | null;
    };

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document';
}

function buildSourceUrl(key: string) {
  return `/api/report-source?key=${encodeURIComponent(key)}`;
}

export async function buildRawReportSource(
  textContext: string | null,
  file: File | null,
  options?: { patientId?: string; bucket?: R2Bucket | null },
) {
  if (file && file.size > 0) {
    if (options?.bucket) {
      const key = `report-sources/${options.patientId || 'unknown'}/${crypto.randomUUID()}-${sanitizeFileName(file.name || 'document')}`;
      await options.bucket.put(key, file, {
        httpMetadata: {
          contentType: file.type || 'application/octet-stream',
        },
      });

      return JSON.stringify({
        kind: 'r2-file',
        key,
        sourceUrl: buildSourceUrl(key),
        mimeType: file.type || null,
        fileName: file.name || null,
      } satisfies ReportSourceDescriptor);
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64String = arrayBufferToBase64(arrayBuffer);

    return JSON.stringify({
      kind: 'file',
      dataUrl: `data:${file.type || 'application/octet-stream'};base64,${base64String}`,
      mimeType: file.type || null,
      fileName: file.name || null,
    } satisfies ReportSourceDescriptor);
  }

  if (textContext?.trim()) {
    return JSON.stringify({
      kind: 'text',
      text: textContext,
    } satisfies ReportSourceDescriptor);
  }

  return '';
}

export function resolveStoredReportSource(rawSource?: string | null) {
  if (!rawSource) return '';

  try {
    const parsed = JSON.parse(rawSource) as Partial<ReportSourceDescriptor> & { sourceUrl?: string; key?: string };
    if (parsed.kind === 'r2-file' && parsed.key && !parsed.sourceUrl) {
      return JSON.stringify({
        ...parsed,
        sourceUrl: buildSourceUrl(parsed.key),
      });
    }
  } catch {
    return rawSource;
  }

  return rawSource;
}
