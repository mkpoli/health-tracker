import { describe, expect, it } from 'vitest';
import { EnergyPhotoError, MAX_ENERGY_PHOTO_BYTES, validateEnergyPhoto } from './energy-source-storage';

describe('validateEnergyPhoto', () => {
  it('accepts a common browser image type', () => {
    const file = new File(['photo'], 'meal.jpg', { type: 'image/jpeg' });
    expect(validateEnergyPhoto(file)?.mimeType).toBe('image/jpeg');
  });

  it('recognizes an iPhone HEIC file when the browser omits its MIME type', () => {
    const file = new File(['photo'], 'meal.HEIC');
    expect(validateEnergyPhoto(file)?.mimeType).toBe('image/heic');
  });

  it('rejects SVG input', () => {
    const file = new File(['<svg/>'], 'meal.svg', { type: 'image/svg+xml' });
    expect(() => validateEnergyPhoto(file)).toThrowError(new EnergyPhotoError('invalid_photo_type'));
  });

  it('rejects a file over the upload ceiling', () => {
    const file = new File(['photo'], 'meal.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: MAX_ENERGY_PHOTO_BYTES + 1 });
    expect(() => validateEnergyPhoto(file)).toThrowError(new EnergyPhotoError('photo_too_large'));
  });
});
