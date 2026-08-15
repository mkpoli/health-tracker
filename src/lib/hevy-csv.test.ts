import { describe, expect, it } from 'vitest';
import {
  HevyCsvError,
  MAX_HEVY_CSV_BYTES,
  parseHevyCsv,
  readHevyCsvFile,
} from './hevy-csv';

const header = [
  'title',
  'start_time',
  'end_time',
  'description',
  'exercise_title',
  'superset_id',
  'exercise_notes',
  'set_index',
  'set_type',
  'weight_kg',
  'reps',
  'distance_km',
  'duration_seconds',
  'rpe',
].join(',');

describe('parseHevyCsv', () => {
  it('parses quoted Hevy rows into native workout structure', () => {
    const result = parseHevyCsv(
      [
        header,
        '"Lower, strength","25 Aug 2025, 09:38","25 Aug 2025, 10:18","Good session",Squat,1,"Paused, controlled",0,warmup,20,8,,,5',
        '"Lower, strength","25 Aug 2025, 09:38","25 Aug 2025, 10:18","Good session",Squat,1,"Paused, controlled",1,normal,80,5,,,8.5',
        '"Lower, strength","25 Aug 2025, 09:38","25 Aug 2025, 10:18","Good session",Row,1,,0,normal,45,10,,,7',
      ].join('\r\n'),
      'Asia/Tokyo',
    );

    expect(result.canImport).toBe(true);
    expect(result.summary).toMatchObject({
      rowCount: 3,
      workoutCount: 1,
      exerciseCount: 2,
      setCount: 3,
      weightUnits: ['kg'],
    });
    expect(result.workouts[0]).toMatchObject({
      title: 'Lower, strength',
      startedAt: '2025-08-25T00:38:00.000Z',
      endedAt: '2025-08-25T01:18:00.000Z',
      localDate: '2025-08-25',
      timezoneOffsetMinutes: 540,
      description: 'Good session',
    });
    expect(result.workouts[0].exercises[0]).toMatchObject({
      name: 'Squat',
      notes: 'Paused, controlled',
      supersetGroup: '1',
    });
    expect(result.workouts[0].exercises[0].sets[1]).toMatchObject({
      sourceSetIndex: 1,
      setType: 'normal',
      weightValue: 80,
      weightUnit: 'kg',
      repetitions: 5,
      rpe: 8.5,
    });
  });

  it('supports imperial load and distance columns without conversion', () => {
    const csv = [
      'title,start_time,end_time,exercise_title,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
      'Run,"25 Aug 2025, 09:38","25 Aug 2025, 10:18",Treadmill,0,normal,0,,3.1,2400,7',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');
    const set = result.workouts[0].exercises[0].sets[0];

    expect(result.canImport).toBe(true);
    expect(set.weightUnit).toBe('lb');
    expect(set.distanceValue).toBe(3.1);
    expect(set.distanceUnit).toBe('mi');
  });

  it('keeps unknown columns in each raw source row', () => {
    const csv = [
      `${header},future_metric`,
      'Session,"25 Aug 2025, 09:38","25 Aug 2025, 10:18",,Squat,,,0,normal,80,5,,,8,source value',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');

    expect(result.summary.unknownHeaders).toEqual(['future_metric']);
    expect(result.workouts[0].exercises[0].sets[0].raw.future_metric).toBe('source value');
  });

  it('preserves embedded newlines and escaped quotes in quoted fields', () => {
    const csv = [
      header,
      'Session,"25 Aug 2025, 09:38","25 Aug 2025, 10:18","First line\nSecond ""line""",Squat,,,0,normal,80,5,,,8',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');

    expect(result.workouts[0].description).toBe('First line\nSecond "line"');
  });

  it('maps an unfamiliar set type to other and reports a warning', () => {
    const csv = [
      header,
      'Session,"25 Aug 2025, 09:38","25 Aug 2025, 10:18",,Squat,,,0,myo,80,5,,,8',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');

    expect(result.canImport).toBe(true);
    expect(result.workouts[0].exercises[0].sets[0].setType).toBe('other');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'unknown_set_type', row: 2 }),
    );
  });

  it('blocks files with missing required headers', () => {
    const result = parseHevyCsv('title,start_time\nSession,"25 Aug 2025, 09:38"', 'UTC');

    expect(result.canImport).toBe(false);
    expect(result.issues.filter((issue) => issue.code === 'missing_header')).toHaveLength(2);
  });

  it('blocks conflicting unit values and invalid numbers', () => {
    const csv = [
      'title,start_time,exercise_title,set_index,set_type,weight_kg,weight_lbs,reps',
      'Session,"25 Aug 2025, 09:38",Squat,0,normal,80,176,abc',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');

    expect(result.canImport).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['conflicting_units', 'invalid_number']),
    );
  });

  it('reports duplicate source set indexes in one exercise block', () => {
    const csv = [
      header,
      'Session,"25 Aug 2025, 09:38",,,Squat,,,0,normal,20,8,,,5',
      'Session,"25 Aug 2025, 09:38",,,Squat,,,0,normal,80,5,,,8',
    ].join('\n');
    const result = parseHevyCsv(csv, 'UTC');

    expect(result.canImport).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate_set_index', row: 3 }),
    );
  });

  it('uses the earlier instant for a repeated daylight-saving time', () => {
    const csv = [
      header,
      'Session,"2 Nov 2025, 01:30",,,Walk,,,0,normal,,,,600,4',
    ].join('\n');
    const result = parseHevyCsv(csv, 'America/New_York');

    expect(result.canImport).toBe(true);
    expect(result.workouts[0].startedAt).toBe('2025-11-02T05:30:00.000Z');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'ambiguous_time' }),
    );
  });

  it('rejects malformed CSV quoting', () => {
    expect(() => parseHevyCsv(`${header}\n"unfinished`, 'UTC')).toThrowError(
      expect.objectContaining({ code: 'invalid_csv' }),
    );
  });
});

describe('readHevyCsvFile', () => {
  it('rejects invalid UTF-8', async () => {
    const file = new File([new Uint8Array([0xc3, 0x28])], 'hevy.csv', { type: 'text/csv' });
    await expect(readHevyCsvFile(file)).rejects.toMatchObject({ code: 'invalid_encoding' });
  });

  it('rejects a file over the byte ceiling before reading it', async () => {
    const file = new File(['x'], 'hevy.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: MAX_HEVY_CSV_BYTES + 1 });
    await expect(readHevyCsvFile(file)).rejects.toBeInstanceOf(HevyCsvError);
    await expect(readHevyCsvFile(file)).rejects.toMatchObject({ code: 'file_too_large' });
  });
});
