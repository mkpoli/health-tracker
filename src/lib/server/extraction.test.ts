import { describe, expect, it } from 'vitest';
import {
  ExtractionInputError,
  MAX_INLINE_IMAGE_BYTES,
  MAX_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  extractMedicalData,
  toBase64DataUrl,
} from './extraction';

// The scan calls a paid model and holds the document in memory while it does.
// What has to hold without a network call is that an input too large to carry
// is refused before either of those starts.

function fileOfSize(bytes: number, type = 'application/pdf') {
  const name = type === 'application/pdf' ? 'scan.pdf' : 'scan.jpg';
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('an upload larger than the limit', () => {
  it('is refused', async () => {
    await expect(extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(
      ExtractionInputError,
    );
  });

  it('says the size and the limit, so the person knows what to do', async () => {
    await expect(extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(/50 MB/);
  });

  it('is refused before the model is reached, so no key is needed to prove it', async () => {
    // A missing OPENAI_API_KEY throws a different error. Getting the input error
    // is what shows the cap runs first.
    const error = await extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1)).catch((e) => e);

    expect(error).toBeInstanceOf(ExtractionInputError);
  });
});

describe('an image too large to inline', () => {
  // A document is uploaded and referenced, so it is bounded by what the model
  // accepts. An image is still sent as a data URL, so it is bounded by the
  // worker's memory — a lower ceiling, and one the browser normally keeps a
  // photograph under by resizing it first.
  it('is refused above the inline ceiling even though it is under the upload one', async () => {
    const image = fileOfSize(MAX_INLINE_IMAGE_BYTES + 1, 'image/jpeg');

    expect(image.size).toBeLessThan(MAX_UPLOAD_BYTES);
    await expect(extractMedicalData(null, image)).rejects.toBeInstanceOf(ExtractionInputError);
  });

  it('names the format that cannot be resized in the browser', async () => {
    await expect(
      extractMedicalData(null, fileOfSize(MAX_INLINE_IMAGE_BYTES + 1, 'image/jpeg')),
    ).rejects.toThrow(/HEIC/);
  });

  it('lets a document of the same size through, because it is uploaded', async () => {
    const document = fileOfSize(MAX_INLINE_IMAGE_BYTES + 1, 'application/pdf');
    const error = await extractMedicalData(null, document).catch((e) => e);

    expect(error).not.toBeInstanceOf(ExtractionInputError);
  });
});

describe('text longer than the limit', () => {
  it('is refused', async () => {
    await expect(extractMedicalData('x'.repeat(MAX_TEXT_CHARS + 1), null)).rejects.toBeInstanceOf(
      ExtractionInputError,
    );
  });
});

describe('input within the limits', () => {
  it('gets past the caps', async () => {
    // It then fails on the missing key in this environment, which is the proof
    // that the caps let it through rather than the request succeeding.
    const error = await extractMedicalData('a short report', null).catch((e) => e);

    expect(error).not.toBeInstanceOf(ExtractionInputError);
  });

  it('refuses an empty request', async () => {
    const error = await extractMedicalData(null, null).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
  });
});

describe('encoding a document for the model', () => {
  const PREFIX = 'data:image/jpeg;base64,';

  function roundTrip(length: number) {
    const source = new Uint8Array(length);
    for (let i = 0; i < length; i++) source[i] = (i * 31 + 7) & 0xff;

    const url = toBase64DataUrl(source.buffer, PREFIX);
    const decoded = Uint8Array.from(atob(url.slice(PREFIX.length)), (c) => c.charCodeAt(0));

    return { source, decoded, url };
  }

  // Encoding runs chunk by chunk, and a chunk whose length is not a multiple of
  // three is padded — mid-stream padding corrupts everything after it. These
  // sizes straddle the chunk boundary, which is where that shows up.
  it.each([0, 1, 2, 3, 100, 32_759, 32_760, 32_761, 65_527, 1_000_003])(
    'returns the same bytes for a %i byte document',
    (length) => {
      const { source, decoded } = roundTrip(length);

      expect(decoded.length).toBe(length);
      expect(Array.from(decoded)).toEqual(Array.from(source));
    },
  );

  it('carries the prefix the caller asked for', () => {
    expect(roundTrip(10).url.startsWith(PREFIX)).toBe(true);
  });

  it('pads only at the end', () => {
    // 65,527 leaves one byte over, which encodes to two padding characters.
    // Any '=' before those would be a chunk padding itself mid-stream.
    const body = roundTrip(65_527).url.slice(PREFIX.length);

    expect(body.slice(0, -2)).not.toContain('=');
    expect(body.slice(-2)).toBe('==');
  });
});
