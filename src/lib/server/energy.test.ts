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
    const parsed = parseEnergyInput(
      form({
        ...base,
        label: '  Dinner  ',
        category: 'dinner',
        energyKcal: '642.1254',
        notes: '  Homemade  ',
      }),
    );

    expect(parsed).toEqual({
      claim: {
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
      },
      foodItems: null,
    });
  });

  it.each([
    ['2026-08-19T00:04', 'snack', '2026-08-18'],
    ['2026-08-19T04:59', 'dinner', '2026-08-18'],
    ['2026-08-19T00:04', 'breakfast', '2026-08-19'],
    ['2026-01-01T02:30', 'meal', '2026-01-01'],
  ])('suggests diary day %s for a %s entry', (occurredLocal, category, localDate) => {
    const parsed = parseEnergyInput(
      form({ ...base, occurredLocal, category, energyKcal: '100' }),
    );

    expect(parsed.claim.localDate).toBe(localDate);
  });

  it('accepts an explicit diary date on either side of the calendar date', () => {
    const previous = parseEnergyInput(
      form({ ...base, occurredLocal: '2026-08-19T12:00', diaryDate: '2026-08-18', energyKcal: '100' }),
    );
    const next = parseEnergyInput(
      form({ ...base, occurredLocal: '2026-08-19T23:30', diaryDate: '2026-08-20', energyKcal: '100' }),
    );

    expect(previous.claim.localDate).toBe('2026-08-18');
    expect(next.claim.localDate).toBe('2026-08-20');
  });

  it('rejects a diary date more than one day from the timestamp', () => {
    expect(() =>
      parseEnergyInput(
        form({ ...base, occurredLocal: '2026-08-19T12:00', diaryDate: '2026-08-17', energyKcal: '100' }),
      ),
    ).toThrowError(new InvalidEnergyInputError('invalid_diary_date'));
  });

  it('keeps a photo-first entry pending when energy is unknown', () => {
    const input = parseEnergyInput(form(base));

    expect(input.claim.energyKcal).toBeNull();
    expect(input.claim.status).toBe('draft');
    expect(() => validateEnergyEntry(input.claim, true, input.foodItems)).not.toThrow();
  });

  it('keeps an exercise duration on expenditure entries', () => {
    const input = parseEnergyInput(
      form({ ...base, direction: 'expenditure', energyKcal: '315', durationMinutes: '48' }),
    );

    expect(input.claim.direction).toBe('expenditure');
    expect(input.claim.durationMinutes).toBe(48);
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
    expect(() => validateEnergyEntry(input.claim, false, input.foodItems)).toThrowError(new InvalidEnergyInputError('empty_entry'));
  });

  it('derives a meal total from structured foods', () => {
    const data = form({ ...base, label: 'Lunch' });
    data.set('foodItems', JSON.stringify([
      { name: 'Rice', quantityValue: 180, quantityUnit: 'g', energyKcal: 281, dataSource: 'database' },
      { name: 'Tofu', quantityValue: 150, quantityUnit: 'g', energyKcal: 108, proteinG: 9.9, dataSource: 'label' },
    ]));

    const parsed = parseEnergyInput(data);

    expect(parsed.claim.energyKcal).toBe(389);
    expect(parsed.claim.status).toBe('recorded');
    expect(parsed.foodItems).toHaveLength(2);
    expect(parsed.foodItems?.[1]).toMatchObject({ name: 'Tofu', proteinG: 9.9, dataSource: 'label' });
  });

  it('keeps a meal pending when one food has unknown energy', () => {
    const data = form({ ...base, label: 'Breakfast' });
    data.set('foodItems', JSON.stringify([
      { name: 'Drink', energyKcal: null, dataSource: 'unknown' },
    ]));

    const parsed = parseEnergyInput(data);

    expect(parsed.claim.energyKcal).toBeNull();
    expect(parsed.claim.status).toBe('draft');
  });
});
