import { describe, expect, it } from 'vitest';
import { InvalidMedicineInputError, parseMedicineInput } from './medicines';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('parseMedicineInput', () => {
  it('normalizes an editable medicine claim', () => {
    const input = parseMedicineInput(
      form({
        name: '  Amoxicillin  ',
        genericName: ' amoxicillin ',
        form: 'capsule',
        strength: '500 mg',
        route: 'oral',
        schedule: 'Three times daily',
        status: 'active',
        startDate: '2026-08-15',
        endDate: '',
        purpose: '',
        prescriber: 'Clinic',
        notes: 'With food',
      }),
    );

    expect(input).toEqual({
      name: 'Amoxicillin',
      genericName: 'amoxicillin',
      form: 'capsule',
      strength: '500 mg',
      route: 'oral',
      schedule: 'Three times daily',
      status: 'active',
      startDate: '2026-08-15',
      endDate: null,
      purpose: null,
      prescriber: 'Clinic',
      notes: 'With food',
    });
  });

  it('rejects a missing name', () => {
    expect(() => parseMedicineInput(form({ name: ' ', status: 'active' }))).toThrowError(
      new InvalidMedicineInputError('missing_name'),
    );
  });

  it('rejects an unknown state', () => {
    expect(() => parseMedicineInput(form({ name: 'Medicine', status: 'sometimes' }))).toThrowError(
      new InvalidMedicineInputError('invalid_status'),
    );
  });

  it('rejects impossible calendar dates', () => {
    expect(() =>
      parseMedicineInput(form({ name: 'Medicine', status: 'planned', startDate: '2026-02-30' })),
    ).toThrowError(new InvalidMedicineInputError('invalid_date'));
  });
});
