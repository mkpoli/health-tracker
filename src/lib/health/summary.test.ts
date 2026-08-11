import { describe, expect, it } from 'vitest';
import { getRefRangesForMetric } from '$lib/metrics/ref-ranges';
import {
  buildSeries,
  buildSummary,
  describeTrend,
  downsample,
  pickCatalogRange,
  type SeriesPoint,
  type SummarySource,
} from './summary';

// One current value per metric, with the interval it was judged against and how
// old it is. A page render and an agent read the same output, so what this
// produces is what both of them will say.

const NOW = Date.parse('2026-08-08T00:00:00.000Z');

const reports = [
  { id: 'recent', kind: 'lab', testDate: '2026-08-01T00:00:00.000Z' },
  { id: 'older', kind: 'lab', testDate: '2026-01-10T00:00:00.000Z' },
];

function summarise(records: SummarySource['records'], patient: SummarySource['patient'] = {}) {
  return buildSummary({ reports, records, patient, now: NOW });
}

function record(over: Partial<SummarySource['records'][number]> & { id: string; reportId: string; metricName: string; value: string }) {
  return { unit: null, refRange: null, status: null, extraData: null, ...over };
}

describe('pickCatalogRange', () => {
  it('uses an interval whose conditions are all satisfied', () => {
    const entry = pickCatalogRange('testosterone', 'ng/dL', { agab: 'Male', birthday: '1990-01-01' });

    expect(entry?.label).toBe('Adult male');
  });

  it('refuses to judge against a sexed interval when the sex is unknown', () => {
    expect(pickCatalogRange('testosterone', 'ng/dL', {})).toBeNull();
  });

  it('refuses when the recorded sex matches no interval', () => {
    expect(pickCatalogRange('testosterone', 'ng/dL', { agab: 'Other', birthday: '1990-01-01' })).toBeNull();
  });

  it('refuses when the age an interval requires is unknown', () => {
    expect(pickCatalogRange('testosterone', 'ng/dL', { agab: 'Male' })).toBeNull();
  });

  it('never returns a hormone-therapy interval as the one to judge against', () => {
    const entry = pickCatalogRange('testosterone', 'ng/dL', { agab: 'Male', birthday: '1990-01-01' });

    expect(entry?.context).toBeUndefined();
  });

  it('answers nothing where the only interval that fits describes someone on therapy', () => {
    // Every physiological FSH interval states a sex, so with none known the
    // on-therapy entry is the only survivor — and it must not be the answer.
    const surviving = getRefRangesForMetric('fsh').filter((entry) => entry.sex === undefined);

    expect(surviving.every((entry) => entry.context === 'on-therapy')).toBe(true);
    expect(pickCatalogRange('fsh', 'mIU/mL', {})).toBeNull();
  });

  it('refuses an interval written in another unit', () => {
    expect(pickCatalogRange('testosterone', 'nmol/L', { agab: 'Male', birthday: '1990-01-01' })).toBeNull();
  });

  it('accepts an interval published in a scaled unit against a reading held in the base one', () => {
    const entry = pickCatalogRange('rbc', '/uL', { agab: 'Male', birthday: '1990-01-01' });

    expect(entry?.unit).toBe('10^6/uL');
  });
});

describe('an interval published in a scaled unit', () => {
  const redCells = (value: string) =>
    summarise([record({ id: 'a', reportId: 'recent', metricName: 'RBC', value, unit: '×10^6/μL' })], {
      agab: 'Male',
      birthday: '1990-01-01',
    })[0];

  it('judges a red-cell count instead of leaving it unjudged', () => {
    const entry = redCells('4.7');

    expect(entry.value).toBe(4_700_000);
    expect(entry.status).toBe('Normal');
    expect(entry.statusSource).toBe('catalog');
  });

  it('states the interval in the unit the reading is held in', () => {
    expect(redCells('4.7').refRange).toBe('4700000-6100000');
  });

  it('calls a count below the interval Low', () => {
    expect(redCells('3.1').status).toBe('Low');
  });
});

describe('where a verdict comes from', () => {
  it('prefers the range printed on the report', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Testosterone', value: '72', unit: 'ng/dL', refRange: '264-916' }),
    ], { agab: 'Male', birthday: '1990-01-01' });

    expect(entry.statusSource).toBe('report');
    expect(entry.refRange).toBe('264-916');
    expect(entry.status).toBe('Low');
  });

  it('falls back to a catalog interval when the report printed none', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Testosterone', value: '72', unit: 'ng/dL' }),
    ], { agab: 'Male', birthday: '1990-01-01' });

    expect(entry.statusSource).toBe('catalog');
    expect(entry.rangeLabel).toBe('Adult male');
    expect(entry.status).toBe('Low');
  });

  it('reports the number without a verdict when no interval fits', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Testosterone', value: '72', unit: 'ng/dL' }),
    ]);

    expect(entry.statusSource).toBeNull();
    expect(entry.status).toBeNull();
    expect(entry.refRange).toBeNull();
    expect(entry.value).toBe(72);
  });

  it('keeps a stored status when nothing better is available', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Occult Blood', value: '1', status: 'Review Required' }),
    ]);

    expect(entry.status).toBe('Review Required');
    expect(entry.statusSource).toBeNull();
  });
});

describe('age of a reading', () => {
  it('calls a reading past its horizon stale', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'older', metricName: 'Body Weight', value: '60', unit: 'kg' }),
    ]);

    expect(entry.ageDays).toBe(210);
    expect(entry.horizonDays).toBe(90);
    expect(entry.stale).toBe(true);
  });

  it('calls a recent reading current', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
    ]);

    expect(entry.stale).toBe(false);
  });

  it('ages a calculated value by its oldest input', () => {
    const entries = summarise([
      record({ id: 'h', reportId: 'older', metricName: 'Height', value: '170', unit: 'cm' }),
      record({ id: 'w', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
    ]);

    const bmi = entries.find((entry) => entry.metricKey === 'bmi')!;

    expect(bmi.calculated).toBe(true);
    expect(bmi.basisDate).toBe('2026-01-10T00:00:00.000Z');
    expect(bmi.ageDays).toBe(210);
  });
});

describe('change against the previous reading', () => {
  it('subtracts two readings in the same unit', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
      record({ id: 'b', reportId: 'older', metricName: 'Body Weight', value: '60', unit: 'kg' }),
    ]);

    expect(entry.delta).toBe(5);
    expect(entry.readingCount).toBe(2);
  });

  it('reports no change for a first reading', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
    ]);

    expect(entry.delta).toBeNull();
  });

  it('subtracts across units once both are normalised', () => {
    const [entry] = summarise([
      record({ id: 'a', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
      record({ id: 'b', reportId: 'older', metricName: 'Body Weight', value: '154.324', unit: 'lbs' }),
    ]);

    expect(entry.delta).toBeCloseTo(-5, 2);
  });
});

describe('buildSeries', () => {
  it('sets aside a reading whose unit does not convert to the series unit', () => {
    const series = buildSeries({
      reports,
      records: [
        record({ id: 'a', reportId: 'recent', metricName: 'Estradiol', value: '92', unit: 'pg/mL' }),
        record({ id: 'b', reportId: 'older', metricName: 'Estradiol', value: '300', unit: 'pmol/L' }),
      ],
      patient: {},
      now: NOW,
    }).get('estradiol')!;

    expect(series.unit).toBe('pg/mL');
    expect(series.points).toHaveLength(1);
    expect(series.setAside).toBe(1);
  });

  it('orders a series newest first', () => {
    const series = buildSeries({
      reports,
      records: [
        record({ id: 'b', reportId: 'older', metricName: 'Body Weight', value: '60', unit: 'kg' }),
        record({ id: 'a', reportId: 'recent', metricName: 'Body Weight', value: '65', unit: 'kg' }),
      ],
      patient: {},
      now: NOW,
    }).get('body-weight')!;

    expect(series.points.map((point) => point.value)).toEqual([65, 60]);
  });

  it('drops a value that is not a number', () => {
    const series = buildSeries({
      reports,
      records: [record({ id: 'a', reportId: 'recent', metricName: 'Occult Blood', value: 'Negative' })],
      patient: {},
      now: NOW,
    });

    expect(series.get('occult-blood')).toBeUndefined();
  });
});

function point(date: string, value: number): SeriesPoint {
  return {
    date,
    value,
    rawValue: String(value),
    unit: 'kg',
    refRange: null,
    storedStatus: null,
    reportId: date,
    reportKind: 'body',
    calculated: false,
    basisDate: date,
    collectionContext: null,
    hoursSinceMeal: null,
  };
}

describe('downsample', () => {
  const daily = [
    point('2026-01-05', 60),
    point('2026-01-12', 75),
    point('2026-01-20', 58),
    point('2026-01-28', 62),
    point('2026-02-05', 61),
  ];

  it('returns everything when asked for everything', () => {
    expect(downsample(daily, 'all')).toHaveLength(5);
  });

  it('keeps the extremes of a bucket rather than averaging them away', () => {
    const monthly = downsample(daily, 'monthly').map((entry) => entry.value);

    expect(monthly).toContain(75);
    expect(monthly).toContain(58);
  });

  it('keeps the last reading of a bucket', () => {
    const monthly = downsample(daily, 'monthly').map((entry) => entry.value);

    expect(monthly).toContain(62);
  });

  it('buckets more coarsely by year', () => {
    expect(downsample(daily, 'yearly')).toHaveLength(3);
  });

  it('returns points newest first', () => {
    const monthly = downsample(daily, 'monthly');
    const dates = monthly.map((entry) => entry.date);

    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('describeTrend', () => {
  it('says nothing about a single point', () => {
    expect(describeTrend([point('2026-01-05', 60)])).toBeNull();
    expect(describeTrend([])).toBeNull();
  });

  it('reports direction and size across the window', () => {
    const trend = describeTrend([point('2026-01-05', 60), point('2026-08-01', 65)])!;

    expect(trend.direction).toBe('rising');
    expect(trend.change).toBe(5);
    expect(trend.from.value).toBe(60);
    expect(trend.to.value).toBe(65);
  });

  it('reports a fall as a fall', () => {
    expect(describeTrend([point('2026-01-05', 65), point('2026-08-01', 60)])?.direction).toBe('falling');
  });

  it('reports no movement as flat', () => {
    expect(describeTrend([point('2026-01-05', 60), point('2026-08-01', 60)])?.direction).toBe('flat');
  });

  it('withholds an annual rate from a window too short to carry one', () => {
    expect(describeTrend([point('2026-07-25', 60), point('2026-08-01', 65)])?.perYear).toBeNull();
  });

  it('gives an annual rate once the window is long enough', () => {
    const trend = describeTrend([point('2026-01-05', 60), point('2026-08-01', 65)])!;

    expect(trend.perYear).toBeGreaterThan(0);
    expect(trend.spanDays).toBe(208);
  });

  it('reports the extremes reached along the way', () => {
    const trend = describeTrend([
      point('2026-01-05', 60),
      point('2026-04-01', 71),
      point('2026-08-01', 65),
    ])!;

    expect(trend.min).toBe(60);
    expect(trend.max).toBe(71);
  });

  it('reads the window in date order however the points arrive', () => {
    const trend = describeTrend([point('2026-08-01', 65), point('2026-01-05', 60)])!;

    expect(trend.from.value).toBe(60);
    expect(trend.direction).toBe('rising');
  });
});
