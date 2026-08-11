import { describe, expect, it } from 'vitest';
import { buildSummary, therapyRangesForValue, type SummarySource } from './summary';

// The failure this guards against: a laboratory prints the interval for someone
// not on hormone therapy, so testosterone 72 ng/dL on feminizing HRT came back
// "Low" against 264-916 and read as hypogonadism. The alternative intervals now
// travel with the value.

const NOW = Date.parse('2026-08-08T00:00:00.000Z');
const reports = [{ id: 'r1', kind: 'lab', testDate: '2026-05-21T02:00:00.000Z' }];

function summaryFor(records: SummarySource['records'], patient: SummarySource['patient'] = {}) {
  const entries = buildSummary({ reports, records, patient, now: NOW });
  return (key: string) => entries.find((entry) => entry.metricKey === key)!;
}

const panel = summaryFor(
  [
    { id: 't', reportId: 'r1', metricName: 'Testosterone', value: '72', unit: 'ng/dL', refRange: '264-916', status: 'Low', extraData: null },
    { id: 'e', reportId: 'r1', metricName: 'Estradiol', value: '92', unit: 'pg/mL', refRange: '110-410', status: 'Low', extraData: null },
    { id: 'h', reportId: 'r1', metricName: 'Hemoglobin', value: '14', unit: 'g/dL', refRange: '13.7-16.8', status: 'Normal', extraData: null },
    { id: 'a', reportId: 'r1', metricName: 'ALT', value: '25', unit: 'U/L', refRange: '10-42', status: 'Normal', extraData: null },
  ],
  { agab: 'Other', birthday: '1999-07-25' },
);

describe('hormone-therapy intervals alongside the laboratory verdict', () => {
  it('carries both therapy intervals for testosterone', () => {
    expect(panel('testosterone').therapyRanges).toHaveLength(2);
  });

  it('reports a suppression target that has not been reached', () => {
    const suppression = panel('testosterone').therapyRanges.find((range) =>
      range.label.includes('Transfeminine'),
    );

    expect(suppression?.position).toBe('above');
  });

  it('keeps the attribution on every therapy interval', () => {
    for (const range of panel('testosterone').therapyRanges) {
      expect(range.source).toBeTruthy();
    }
  });

  it('places estradiol below the feminizing target', () => {
    const target = panel('estradiol').therapyRanges.find(
      (range) => range.label === 'Transfeminine HRT target',
    );

    expect(target?.position).toBe('below');
  });

  it('still reports what the laboratory said', () => {
    expect(panel('testosterone').status).toBe('Low');
    expect(panel('testosterone').refRange).toBe('264-916');
    expect(panel('testosterone').statusSource).toBe('report');
  });

  it('carries the masculinizing interval for hemoglobin, which testosterone raises', () => {
    expect(panel('hemoglobin').therapyRanges).toHaveLength(1);
  });

  it('attaches nothing to a metric no therapy interval describes', () => {
    expect(panel('alt').therapyRanges).toHaveLength(0);
  });
});

describe('therapyRangesForValue', () => {
  it('places 72 ng/dL above the suppression target and below the masculinizing one', () => {
    const direct = therapyRangesForValue('testosterone', 72, 'ng/dL', {
      agab: 'Other',
      birthday: '1999-07-25',
    });

    expect(direct.map((range) => `${range.label}=${range.position}`)).toEqual([
      'Transfeminine HRT target (suppressed)=above',
      'Transmasculine HRT target=below',
    ]);
  });

  it('withholds an interval whose unit does not match the reading', () => {
    expect(therapyRangesForValue('testosterone', 2.5, 'nmol/L')).toHaveLength(0);
  });

  it('places a suppressed testosterone within the feminizing target', () => {
    const suppressed = therapyRangesForValue('testosterone', 20, 'ng/dL').find((range) =>
      range.label.includes('Transfeminine'),
    );

    expect(suppressed?.position).toBe('within');
  });
});
