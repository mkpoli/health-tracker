import { describe, expect, it } from 'vitest';
import { buildTrendMetrics, getStatusFromRange, parseReferenceRange } from './trends';

// Reading a printed range wrong is how a normal value gets a red badge. The
// parser has to handle the forms labs actually print, and say nothing when it
// meets one it cannot read.

describe('parseReferenceRange', () => {
  it('reads a two-sided range', () => {
    expect(parseReferenceRange('73-109')).toMatchObject({ low: 73, high: 109 });
  });

  it('reads a decimal range', () => {
    expect(parseReferenceRange('13.7-16.8')).toMatchObject({ low: 13.7, high: 16.8 });
  });

  it('orders the bounds however they were written', () => {
    expect(parseReferenceRange('109-73')).toMatchObject({ low: 73, high: 109 });
  });

  it('reads an upper bound only', () => {
    expect(parseReferenceRange('< 150')).toMatchObject({ low: null, high: 150 });
  });

  it('reads a lower bound only', () => {
    expect(parseReferenceRange('> 40')).toMatchObject({ low: 40, high: null });
  });

  it('keeps the printed text as the label', () => {
    expect(parseReferenceRange('73-109')?.label).toBe('73-109');
  });

  it('reads a two-sided range separated by a wave dash or an en dash', () => {
    expect(parseReferenceRange('73～109')).toMatchObject({ low: 73, high: 109 });
    expect(parseReferenceRange('73–109')).toMatchObject({ low: 73, high: 109 });
  });

  it('reads the upper bound a Japanese report prints', () => {
    expect(parseReferenceRange('≦150')).toMatchObject({ low: null, high: 150 });
    expect(parseReferenceRange('≤150')).toMatchObject({ low: null, high: 150 });
    expect(parseReferenceRange('150以下')).toMatchObject({ low: null, high: 150 });
    expect(parseReferenceRange('150未満')).toMatchObject({ low: null, high: 150 });
  });

  it('reads the lower bound a Japanese report prints', () => {
    expect(parseReferenceRange('≧40')).toMatchObject({ low: 40, high: null });
    expect(parseReferenceRange('≥40')).toMatchObject({ low: 40, high: null });
    expect(parseReferenceRange('40以上')).toMatchObject({ low: 40, high: null });
  });

  it('judges against a bound written the Japanese way', () => {
    expect(getStatusFromRange(200, parseReferenceRange('150以下'))).toBe('High');
    expect(getStatusFromRange(100, parseReferenceRange('≦150'))).toBe('Normal');
    expect(getStatusFromRange(20, parseReferenceRange('40以上'))).toBe('Low');
  });

  it('says nothing about a qualitative range', () => {
    expect(parseReferenceRange('Negative')).toBeNull();
    expect(parseReferenceRange('(-)')).toBeNull();
  });

  it('says nothing about a bare number with no relation', () => {
    expect(parseReferenceRange('150')).toBeNull();
  });

  it('says nothing when there is no range at all', () => {
    expect(parseReferenceRange(null)).toBeNull();
    expect(parseReferenceRange('')).toBeNull();
  });
});

describe('getStatusFromRange', () => {
  const range = parseReferenceRange('73-109');

  it('calls a value above the range High', () => {
    expect(getStatusFromRange(114, range)).toBe('High');
  });

  it('calls a value below the range Low', () => {
    expect(getStatusFromRange(60, range)).toBe('Low');
  });

  it('calls a value inside the range Normal', () => {
    expect(getStatusFromRange(88, range)).toBe('Normal');
  });

  it('treats both bounds as inside', () => {
    expect(getStatusFromRange(73, range)).toBe('Normal');
    expect(getStatusFromRange(109, range)).toBe('Normal');
  });

  it('judges against a one-sided range', () => {
    expect(getStatusFromRange(200, parseReferenceRange('< 150'))).toBe('High');
    expect(getStatusFromRange(100, parseReferenceRange('< 150'))).toBe('Normal');
    expect(getStatusFromRange(20, parseReferenceRange('> 40'))).toBe('Low');
  });

  it('falls back to the stored status when there is no range', () => {
    expect(getStatusFromRange(114, null, 'Review Required')).toBe('Review Required');
    expect(getStatusFromRange(114, null)).toBeNull();
  });
});

describe('buildTrendMetrics', () => {
  const reports = [
    { id: 'r1', testDate: '2026-01-10T00:00:00.000Z' },
    { id: 'r2', testDate: '2026-08-01T00:00:00.000Z' },
  ];

  const input = {
    reports,
    comparableValue: (record: { value: string }) => Number(record.value),
    comparableUnit: (record: { unit: string | null }) => record.unit,
    comparableRange: (record: { refRange: string | null }) => record.refRange,
    formatDate: (value: string | null) => value ?? '',
  };

  it('keeps one line for a metric recorded under two names', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      records: [
        { id: 'a', reportId: 'r1', metricName: 'Weight', value: '60', unit: 'kg', refRange: null, status: null, extraData: null },
        { id: 'b', reportId: 'r2', metricName: 'Body Weight', value: '65', unit: 'kg', refRange: null, status: null, extraData: null },
      ],
    });

    const weight = metrics.filter((metric) => metric.metricName === 'Body Weight');

    expect(weight).toHaveLength(1);
    expect(weight[0].points).toHaveLength(2);
  });

  it('orders a series oldest first', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      records: [
        { id: 'b', reportId: 'r2', metricName: 'Body Weight', value: '65', unit: 'kg', refRange: null, status: null, extraData: null },
        { id: 'a', reportId: 'r1', metricName: 'Body Weight', value: '60', unit: 'kg', refRange: null, status: null, extraData: null },
      ],
    });

    expect(metrics[0].points.map((point) => point.value)).toEqual([60, 65]);
  });

  it('reads the draw conditions off the record', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      records: [
        {
          id: 'a',
          reportId: 'r1',
          metricName: 'Blood Glucose',
          value: '114',
          unit: 'mg/dL',
          refRange: '73-109',
          status: null,
          extraData: JSON.stringify({ collectionContext: 'post-meal' }),
        },
      ],
    });

    expect(metrics[0].points[0].collectionContext).toBe('post-meal');
  });

  it('survives unparseable extra data', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      records: [
        { id: 'a', reportId: 'r1', metricName: 'Body Weight', value: '60', unit: 'kg', refRange: null, status: null, extraData: '{not json' },
      ],
    });

    expect(metrics[0].points[0].collectionContext).toBeNull();
  });

  it('drops a record whose value is not a number', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      comparableValue: (record: { value: string }) => (Number.isFinite(Number(record.value)) ? Number(record.value) : null),
      records: [
        { id: 'a', reportId: 'r1', metricName: 'Occult Blood', value: 'Negative', unit: null, refRange: null, status: null, extraData: null },
      ],
    });

    expect(metrics).toHaveLength(0);
  });

  it('folds a calculated metric in as a series of its own', () => {
    const { metrics } = buildTrendMetrics({
      ...input,
      records: [
        { id: 'a', reportId: 'r1', metricName: 'Body Weight', value: '60', unit: 'kg', refRange: null, status: null, extraData: null },
        { id: 'b', reportId: 'r1', metricName: 'Height', value: '170', unit: 'cm', refRange: null, status: null, extraData: null },
      ],
    });

    const bmi = metrics.find((metric) => metric.metricName === 'BMI');

    expect(bmi?.points[0].calculated).toBe(true);
    expect(bmi?.points[0].value).toBeCloseTo(20.8, 1);
  });
});
