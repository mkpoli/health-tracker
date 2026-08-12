import { describe, expect, it } from 'vitest';
import {
  buildSeries,
  buildSummary,
  contextsComparable,
  drawsAreComparable,
  statusForPoint,
  verdictApplies,
  type SummarySource,
} from './summary';

// The failure this guards against: a glucose drawn after breakfast was judged
// against the fasting interval printed beside it and reported as High, and a
// run of such readings mixed with fasting ones looked like a rising trend.

const NOW = Date.parse('2026-08-08T00:00:00.000Z');

const reports = [
  { id: 'r1', kind: 'lab', testDate: '2026-08-05T10:13:00.000Z' },
  { id: 'r2', kind: 'lab', testDate: '2026-01-26T23:58:00.000Z' },
];

function glucose(reportId: string, value: string, extra: Record<string, unknown>, status: string | null = null) {
  return {
    id: `${reportId}-glucose`,
    reportId,
    metricName: 'Blood Glucose',
    value,
    unit: 'mg/dL',
    refRange: '73-109',
    status,
    extraData: JSON.stringify(extra),
  };
}

function entryFor(source: Omit<SummarySource, 'now'>, key: string) {
  return buildSummary({ ...source, now: NOW }).find((entry) => entry.metricKey === key)!;
}

describe('a reading judged against the interval that describes it', () => {
  const postMeal = entryFor(
    {
      reports,
      records: [glucose('r1', '114', { collectionContext: 'post-meal', hoursSinceMeal: 2 })],
      patient: { agab: 'Other', birthday: '1999-07-25' },
    },
    'blood-glucose',
  );

  it('does not call a post-meal glucose High', () => {
    expect(postMeal.status).toBeNull();
  });

  it('attaches no fasting range to it', () => {
    expect(postMeal.refRange).toBeNull();
  });

  it('says why', () => {
    expect(postMeal.rangeNotes).toBeTruthy();
  });

  it('carries the draw condition through', () => {
    expect(postMeal.collectionContext).toBe('post-meal');
    expect(postMeal.hoursSinceMeal).toBe(2);
  });

  it('reports an unstated interval since eating as unstated', () => {
    const withNull = entryFor(
      {
        reports: [reports[0]],
        records: [glucose('r1', '114', { collectionContext: 'post-meal', hoursSinceMeal: null })],
        patient: {},
      },
      'blood-glucose',
    );
    const withoutKey = entryFor(
      {
        reports: [reports[0]],
        records: [glucose('r1', '114', { collectionContext: 'post-meal' })],
        patient: {},
      },
      'blood-glucose',
    );

    expect(withNull.hoursSinceMeal).toBeNull();
    expect(withoutKey.hoursSinceMeal).toBeNull();
  });

  it('reads a blank interval since eating as unstated', () => {
    for (const blank of ['', '   ']) {
      const entry = entryFor(
        {
          reports: [reports[0]],
          records: [glucose('r1', '114', { collectionContext: 'post-meal', hoursSinceMeal: blank })],
          patient: {},
        },
        'blood-glucose',
      );

      expect(entry.hoursSinceMeal).toBeNull();
    }
  });

  it('still reads an interval given as a string', () => {
    const entry = entryFor(
      {
        reports: [reports[0]],
        records: [glucose('r1', '114', { collectionContext: 'post-meal', hoursSinceMeal: '2' })],
        patient: {},
      },
      'blood-glucose',
    );

    expect(entry.hoursSinceMeal).toBe(2);
  });

  it('withholds a verdict on a draw taken at a casual time', () => {
    const random = entryFor(
      {
        reports: [reports[0]],
        records: [glucose('r1', '114', { collectionContext: 'random' })],
        patient: {},
      },
      'blood-glucose',
    );

    expect(random.collectionContext).toBe('random');
    expect(random.status).toBeNull();
    expect(random.rangeNotes).toContain('casual');
  });

  it('judges a fasting reading normally', () => {
    const fasting = entryFor(
      {
        reports: [reports[0]],
        records: [glucose('r1', '114', { collectionContext: 'fasting' })],
        patient: {},
      },
      'blood-glucose',
    );

    expect(fasting.status).toBe('High');
  });

  it('leaves a metric that does not depend on eating alone', () => {
    const hemoglobin = entryFor(
      {
        reports: [reports[0]],
        records: [
          {
            id: 'd',
            reportId: 'r1',
            metricName: 'Hemoglobin',
            value: '14',
            unit: 'g/dL',
            refRange: '13.7-16.8',
            status: null,
            extraData: JSON.stringify({ collectionContext: 'post-meal' }),
          },
        ],
        patient: {},
      },
      'hemoglobin',
    );

    expect(hemoglobin.status).toBe('Normal');
  });

  it('applies the same rule to triglycerides', () => {
    expect(verdictApplies('triglycerides', 'post-meal')).toBe(false);
    expect(verdictApplies('triglycerides', 'fasting')).toBe(true);
    expect(verdictApplies('hemoglobin', 'post-meal')).toBe(true);
  });

  it('treats an unstated draw condition as usable', () => {
    expect(verdictApplies('blood-glucose', null)).toBe(true);
  });
});

describe('differences and series across draw conditions', () => {
  const mixedRecords = [
    glucose('r1', '114', { collectionContext: 'post-meal' }, 'High'),
    glucose('r2', '88', { collectionContext: 'fasting' }, 'Normal'),
  ];

  it('does not subtract a post-meal reading from a fasting one', () => {
    const entry = entryFor({ reports, records: mixedRecords, patient: {} }, 'blood-glucose');

    expect(entry.delta).toBeNull();
  });

  it('does subtract two readings taken the same way', () => {
    const entry = entryFor(
      {
        reports,
        records: [
          glucose('r1', '114', { collectionContext: 'fasting' }),
          glucose('r2', '88', { collectionContext: 'fasting' }),
        ],
        patient: {},
      },
      'blood-glucose',
    );

    expect(entry.delta).toBe(26);
  });

  const series = buildSeries({ reports, records: mixedRecords, patient: {}, now: NOW }).get('blood-glucose')!;
  const postMealPoint = series.points.find((point) => point.collectionContext === 'post-meal')!;
  const fastingPoint = series.points.find((point) => point.collectionContext === 'fasting')!;

  it('withdraws a parse-time verdict computed against the wrong interval', () => {
    expect(statusForPoint('blood-glucose', postMealPoint)).toBeNull();
  });

  it('keeps the verdict on a fasting draw', () => {
    expect(statusForPoint('blood-glucose', fastingPoint)).toBe('Normal');
  });

  it('refuses to treat mixed draws as one series', () => {
    expect(drawsAreComparable('blood-glucose', series.points)).toBe(false);
  });

  it('accepts uniform draws as one series', () => {
    expect(drawsAreComparable('blood-glucose', [postMealPoint])).toBe(true);
  });

  it('does not split a metric eating does not move', () => {
    expect(drawsAreComparable('hemoglobin', series.points)).toBe(true);
  });

  it('agrees with contextsComparable pairwise', () => {
    expect(contextsComparable('blood-glucose', 'fasting', 'post-meal')).toBe(false);
    expect(contextsComparable('blood-glucose', 'fasting', 'fasting')).toBe(true);
    expect(contextsComparable('hemoglobin', 'fasting', 'post-meal')).toBe(true);
  });
});
