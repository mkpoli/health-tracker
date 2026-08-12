import { describe, expect, it } from 'vitest';
import { ExtractionInputError, MAX_TEXT_CHARS, MAX_UPLOAD_BYTES, extractMedicalData } from './extraction';

// The scan calls a paid model and holds the document in memory while it does.
// What has to hold without a network call is that an input too large to carry
// is refused before either of those starts.

function fileOfSize(bytes: number) {
  return new File([new Uint8Array(bytes)], 'scan.pdf', { type: 'application/pdf' });
}

describe('an upload larger than the limit', () => {
  it('is refused', async () => {
    await expect(extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(
      ExtractionInputError,
    );
  });

  it('says the size and the limit, so the person knows what to do', async () => {
    await expect(extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(/10 MB/);
  });

  it('is refused before the model is reached, so no key is needed to prove it', async () => {
    // A missing OPENAI_API_KEY throws a different error. Getting the input error
    // is what shows the cap runs first.
    const error = await extractMedicalData(null, fileOfSize(MAX_UPLOAD_BYTES + 1)).catch((e) => e);

    expect(error).toBeInstanceOf(ExtractionInputError);
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
