import { describe, expect, it } from 'vitest';
import { InvalidWorkoutInputError, parseWorkoutInput } from './workouts';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const exercise = {
  name: 'Barbell squat',
  category: 'strength',
  equipment: 'barbell',
  restSeconds: 180,
  sets: [
    {
      setType: 'normal',
      status: 'completed',
      weightValue: 80.1254567,
      weightUnit: 'kg',
      repetitions: 5,
      rpe: 8.5,
    },
  ],
};

const session = {
  kind: 'session',
  title: '  Lower body  ',
  status: 'completed',
  startedLocal: '2026-08-15T18:30',
  endedLocal: '2026-08-15T19:45',
  timezone: 'Asia/Tokyo',
  timezoneOffsetMinutes: '540',
  endedTimezoneOffsetMinutes: '540',
  structure: JSON.stringify([exercise]),
};

describe('parseWorkoutInput', () => {
  it('normalizes a workout while retaining local-time context and set detail', () => {
    const input = parseWorkoutInput(form(session));

    expect(input).toMatchObject({
      kind: 'session',
      title: 'Lower body',
      status: 'completed',
      startedAt: '2026-08-15T09:30:00.000Z',
      endedAt: '2026-08-15T10:45:00.000Z',
      localDate: '2026-08-15',
      timezone: 'Asia/Tokyo',
      timezoneOffsetMinutes: 540,
      endedTimezoneOffsetMinutes: 540,
    });
    expect(input.exercises[0]).toMatchObject({
      name: 'Barbell squat',
      equipment: 'barbell',
      restSeconds: 180,
    });
    expect(input.exercises[0].sets[0]).toMatchObject({
      setType: 'normal',
      status: 'completed',
      weightValue: 80.125457,
      weightUnit: 'kg',
      repetitions: 5,
      rpe: 8.5,
    });
  });

  it('keeps a reusable plan free of occurrence timestamps', () => {
    const input = parseWorkoutInput(
      form({
        ...session,
        kind: 'plan',
        status: 'active',
        basedOnWorkoutId: 'ignored-template',
        structure: JSON.stringify([
          { ...exercise, sets: [{ repetitions: 8, weightValue: 60, weightUnit: 'kg' }] },
        ]),
      }),
    );

    expect(input).toMatchObject({
      kind: 'plan',
      status: 'active',
      basedOnWorkoutId: null,
      startedAt: null,
      endedAt: null,
      localDate: null,
      timezone: null,
      timezoneOffsetMinutes: null,
      endedTimezoneOffsetMinutes: null,
    });
    expect(input.exercises[0].sets[0].status).toBe('planned');
  });

  it('rejects a time-zone offset that does not represent the supplied local time', () => {
    expect(() =>
      parseWorkoutInput(form({ ...session, timezoneOffsetMinutes: '0' })),
    ).toThrowError(new InvalidWorkoutInputError('invalid_timezone'));
  });

  it('rejects an end time before the start', () => {
    expect(() =>
      parseWorkoutInput(form({ ...session, endedLocal: '2026-08-15T17:30' })),
    ).toThrowError(new InvalidWorkoutInputError('invalid_end_time'));
  });

  it('rejects out-of-range set effort', () => {
    const invalid = { ...exercise, sets: [{ repetitions: 5, rpe: 11 }] };
    expect(() =>
      parseWorkoutInput(form({ ...session, structure: JSON.stringify([invalid]) })),
    ).toThrowError(new InvalidWorkoutInputError('invalid_number'));
  });

  it('rejects oversized exercise collections', () => {
    const exercises = Array.from({ length: 101 }, (_, index) => ({
      name: `Exercise ${index + 1}`,
      sets: [],
    }));
    expect(() =>
      parseWorkoutInput(form({ ...session, structure: JSON.stringify(exercises) })),
    ).toThrowError(new InvalidWorkoutInputError('invalid_structure'));
  });
});
