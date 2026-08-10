import { describe, expect, it } from 'vitest';
import { computeDerivedMetrics } from './derived';

// Height is measured once and still applies at the next weigh-in; hips are not.
// Which dependencies may be carried forward decides whether a calculated value
// is a real measurement or a difference nobody ever took.

const reports = [
  { id: 'old', testDate: '2026-01-10T00:00:00.000Z' },
  { id: 'new', testDate: '2026-08-01T00:00:00.000Z' },
];

function values(entries: Record<string, Record<string, number>>) {
  return new Map(
    Object.entries(entries).map(([reportId, metrics]) => [reportId, new Map(Object.entries(metrics))]),
  );
}

function find(points: ReturnType<typeof computeDerivedMetrics>, key: string, reportId: string) {
  return points.find((point) => point.definition.key === key && point.reportId === reportId);
}

describe('a dependency that may be carried forward', () => {
  const derived = computeDerivedMetrics(
    reports,
    values({
      old: { 'body-weight': 60, height: 170 },
      new: { 'body-weight': 65 },
    }),
  );

  it('computes BMI at the later weigh-in from the earlier height', () => {
    expect(find(derived, 'bmi', 'new')?.value).toBe(22.5);
  });

  it('dates the value by the oldest reading behind it', () => {
    expect(find(derived, 'bmi', 'new')?.basisDate).toBe('2026-01-10T00:00:00.000Z');
  });

  it('dates a value measured in one session by that session', () => {
    expect(find(derived, 'bmi', 'old')?.basisDate).toBe('2026-01-10T00:00:00.000Z');
  });

  it('carries the unit of the calculation', () => {
    expect(find(derived, 'bmi', 'new')?.unit).toBe('kg/m^2');
  });
});

describe('a dependency that may not be carried forward', () => {
  it('does not build a waist-to-hip ratio out of two different sessions', () => {
    const derived = computeDerivedMetrics(
      reports,
      values({
        old: { 'hip-circumference': 95 },
        new: { 'waist-circumference': 80 },
      }),
    );

    expect(find(derived, 'waist-to-hip-ratio', 'new')).toBeUndefined();
  });

  it('builds one from a single session', () => {
    const derived = computeDerivedMetrics(
      reports,
      values({ new: { 'waist-circumference': 80, 'hip-circumference': 100 } }),
    );

    expect(find(derived, 'waist-to-hip-ratio', 'new')?.value).toBeCloseTo(0.8, 2);
  });
});

describe('a directly recorded value', () => {
  it('is not overwritten by the calculated one', () => {
    const derived = computeDerivedMetrics(
      reports,
      values({ new: { 'body-weight': 65, height: 170, bmi: 21 } }),
    );

    expect(find(derived, 'bmi', 'new')).toBeUndefined();
  });
});

describe('incomplete input', () => {
  it('produces nothing when a dependency was never measured', () => {
    const derived = computeDerivedMetrics(reports, values({ new: { 'body-weight': 65 } }));

    expect(find(derived, 'bmi', 'new')).toBeUndefined();
  });

  it('produces nothing rather than dividing by a zero height', () => {
    const derived = computeDerivedMetrics(
      reports,
      values({ new: { 'body-weight': 65, height: 0 } }),
    );

    expect(find(derived, 'bmi', 'new')).toBeUndefined();
  });

  it('walks reports oldest first regardless of the order given', () => {
    const derived = computeDerivedMetrics(
      [reports[1], reports[0]],
      values({ old: { 'body-weight': 60, height: 170 }, new: { 'body-weight': 65 } }),
    );

    expect(find(derived, 'bmi', 'new')?.value).toBe(22.5);
  });
});
