import { describe, expect, it } from 'vitest';
import {
  assessEvidence,
  DIRECTION_MIN_POINTS,
  DIRECTION_MIN_SPAN_DAYS,
  type SeriesPoint,
} from './summary';

// The failure this guards against: five waist measurements spread over nine
// years were charted as a line, and a reader — human or model — took a slope
// off them. A series states a direction only once it can carry one.

function points(dates: string[]): SeriesPoint[] {
  return dates.map((date, index) => ({
    date,
    value: 90 + index,
    rawValue: String(90 + index),
    unit: 'cm',
    refRange: null,
    storedStatus: null,
    reportId: `r${index}`,
    reportKind: 'body',
    calculated: false,
    basisDate: date,
    collectionContext: null,
    hoursSinceMeal: null,
  }));
}

describe('assessEvidence', () => {
  it('refuses a direction for nine years of five readings', () => {
    const sparse = assessEvidence(
      'waist-circumference',
      points(['2017-06-01', '2019-03-01', '2022-08-01', '2026-02-12', '2026-08-01']),
    );

    expect(sparse.sufficient).toBe(false);
    expect(sparse.readingCount).toBe(5);
  });

  it('names how many more readings would reach the threshold', () => {
    const sparse = assessEvidence(
      'waist-circumference',
      points(['2017-06-01', '2019-03-01', '2022-08-01', '2026-02-12', '2026-08-01']),
    );

    expect(sparse.shortfall).toMatch(/1 more/);
  });

  it('states the rule so a reader can disagree with it', () => {
    const sparse = assessEvidence('waist-circumference', points(['2026-08-01']));

    expect(sparse.rule).toBe(
      `A direction is stated once there are ${DIRECTION_MIN_POINTS} readings spanning ${DIRECTION_MIN_SPAN_DAYS} days or more.`,
    );
  });

  it('accepts six weekly readings', () => {
    const weekly = assessEvidence(
      'waist-circumference',
      points(['2026-06-27', '2026-07-04', '2026-07-11', '2026-07-18', '2026-07-25', '2026-08-01']),
    );

    expect(weekly.sufficient).toBe(true);
    expect(weekly.shortfall).toBeNull();
    expect(weekly.medianGapDays).toBe(7);
  });

  it('refuses six readings crammed into six days', () => {
    const crammed = assessEvidence(
      'body-weight',
      points(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']),
    );

    expect(crammed.sufficient).toBe(false);
    expect(crammed.spanDays).toBe(5);
    expect(crammed.shortfall).toContain(String(DIRECTION_MIN_SPAN_DAYS));
  });

  it('handles an empty series', () => {
    const empty = assessEvidence('waist-circumference', []);

    expect(empty.sufficient).toBe(false);
    expect(empty.readingCount).toBe(0);
    expect(empty.spanDays).toBeNull();
    expect(empty.medianGapDays).toBeNull();
  });

  it('reports no span for a single reading', () => {
    const single = assessEvidence('waist-circumference', points(['2026-08-01']));

    expect(single.spanDays).toBe(0);
    expect(single.sufficient).toBe(false);
  });

  it('ignores undated readings when counting toward the threshold', () => {
    const undated = points([
      '2026-06-27',
      '2026-07-04',
      '2026-07-11',
      '2026-07-18',
      '2026-07-25',
      '2026-08-01',
    ]).map((point, index) => (index < 2 ? { ...point, date: null } : point));

    const assessment = assessEvidence('waist-circumference', undated);

    expect(assessment.readingCount).toBe(4);
    expect(assessment.sufficient).toBe(false);
  });
});
