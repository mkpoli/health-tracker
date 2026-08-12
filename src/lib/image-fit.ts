// A photograph of a report comes off a phone at a resolution the reader does
// not need and the server cannot hold: a 200 MP camera writes 25 MB for a page
// of text. Rather than refuse it, the browser redraws it small enough to send.
//
// Only a file that would otherwise be rejected is touched. Anything within the
// limit is uploaded exactly as it came, because the upload is also what gets
// archived, and a document should be stored as it was given.

/** Longest edge kept, in pixels. Small print on a lab report stays legible here. */
const MAX_EDGE = 3000;

/** Quality steps tried in turn until the result fits. */
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6];

export type FitResult = {
  file: File;
  /** Null when the file was left alone. */
  resizedFrom: { bytes: number; width: number; height: number } | null;
};

function canDecode(file: File) {
  // HEIC is what an iPhone writes by default and what no browser decodes, so
  // the attempt would fail after the memory had already been spent.
  return file.type.startsWith('image/') && !/heic|heif/i.test(file.type);
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas produced no image'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Returns the file unchanged when it already fits, and a smaller JPEG when it
 * does not. A file that cannot be decoded here is returned as it was, so the
 * server refuses it with a message rather than the browser failing silently.
 */
export async function fitImageForUpload(file: File, limitBytes: number): Promise<FitResult> {
  if (file.size <= limitBytes || !canDecode(file)) return { file, resizedFrom: null };

  try {
    const bitmap = await createImageBitmap(file);
    // Held before the bitmap is closed, which zeroes its dimensions.
    const source = { bytes: file.size, width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });

    const context = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;

    if (!context) return { file, resizedFrom: null };

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    for (const quality of QUALITY_STEPS) {
      const blob = await encode(canvas, quality);

      if (blob.size <= limitBytes) {
        const renamed = file.name.replace(/\.[^.]+$/, '') || 'scan';

        return {
          file: new File([blob], `${renamed}.jpg`, { type: 'image/jpeg' }),
          resizedFrom: source,
        };
      }
    }

    return { file, resizedFrom: null };
  } catch {
    // A format this browser cannot decode, or a canvas it will not read back.
    return { file, resizedFrom: null };
  }
}
