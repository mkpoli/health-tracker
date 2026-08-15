import { describe, expect, it } from 'vitest';
import { InvalidEnergyInputError, parseEnergyInput, validateEnergyEntry } from './energy';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const base = {
  direction: 'intake',
  occurredLocal: '2026-08-15T18:30',
  timezoneOffsetMinutes: '540',
  timezone: 'Asia/Tokyo',
  status: 'auto',
};

describe('parseEnergyInput', () => {
  it('keeps original local time while normalizing the instant to UTC', () => {
    const input = parseEnergyInput(
      form({
        ...base,
        label: '  Dinner  ',
        category: 'dinner',
        energyKcal: '642.1254',
        notes: '  Homemade  ',
      }),
    );

    expect(input).toEqual({
      direction: 'intake',
      label: 'Dinner',
      category: 'dinner',
      energyKcal: 642.125,
      occurredAt: '2026-08-15T09:30:00.000Z',
      localDate: '2026-08-15',
      timezone: 'Asia/Tokyo',
      timezoneOffsetMinutes: 540,
      durationMinutes: null,
      status: 'recorded',
      notes: 'Homemade',
    });
  });

  it('keeps a photo-first entry pending when energy is unknown', () => {
    const input = parseEnergyInput(form(base));

    expect(input.energyKcal).toBeNull();
    expect(input.status).toBe('draft');
    expect(() => validateEnergyEntry(input, true)).not.toThrow();
  });

  it('keeps an exercise duration on expenditure entries', () => {
    const input = parseEnergyInput(
      form({ ...base, direction: 'expenditure', energyKcal: '315', durationMinutes: '48' }),
    );

    expect(input.direction).toBe('expenditure');
    expect(input.durationMinutes).toBe(48);
  });

  it('requires energy for an included entry', () => {
    expect(() => parseEnergyInput(form({ ...base, status: 'recorded' }))).toThrowError(
      new InvalidEnergyInputError('missing_energy'),
    );
  });

  it('rejects an impossible local date', () => {
    expect(() => parseEnergyInput(form({ ...base, occurredLocal: '2026-02-30T12:00' }))).toThrowError(
      new InvalidEnergyInputError('invalid_time'),
    );
  });

  it('rejects an empty entry without a retained photo', () => {
    const input = parseEnergyInput(form(base));
    expect(() => validateEnergyEntry(input, false)).toThrowError(new InvalidEnergyInputError('empty_entry'));
  });
});
