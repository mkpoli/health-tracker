// The failure this guards against: a laboratory prints the interval for someone
// not on hormone therapy, so testosterone 72 ng/dL on feminizing HRT came back
// "Low" against 264-916 and read as hypogonadism. The alternative intervals now
// travel with the value.
import { buildSummary } from '../src/lib/health/summary';

const reports = [{ id: 'r1', kind: 'lab', testDate: '2026-05-21T02:00:00.000Z' }];

const summary = buildSummary({
  reports,
  records: [
    { id: 't', reportId: 'r1', metricName: 'Testosterone', value: '72', unit: 'ng/dL', refRange: '264-916', status: 'Low', extraData: null },
    { id: 'e', reportId: 'r1', metricName: 'Estradiol', value: '92', unit: 'pg/mL', refRange: '110-410', status: 'Low', extraData: null },
    { id: 'h', reportId: 'r1', metricName: 'Hemoglobin', value: '14', unit: 'g/dL', refRange: '13.7-16.8', status: 'Normal', extraData: null },
    { id: 'a', reportId: 'r1', metricName: 'ALT', value: '25', unit: 'U/L', refRange: '10-42', status: 'Normal', extraData: null },
  ],
  patient: { agab: 'Other', birthday: '1999-07-25' },
  now: Date.parse('2026-08-08T00:00:00.000Z'),
});

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const testosterone = summary.find((entry) => entry.metricKey === 'testosterone')!;
const estradiol = summary.find((entry) => entry.metricKey === 'estradiol')!;
const hemoglobin = summary.find((entry) => entry.metricKey === 'hemoglobin')!;
const alt = summary.find((entry) => entry.metricKey === 'alt')!;

check(
  'testosterone carries its therapy intervals',
  testosterone.therapyRanges.length === 2,
  testosterone.therapyRanges.map((r) => `${r.label}=${r.position}`).join(', '),
);
check(
  'suppression target is reported as not yet reached',
  testosterone.therapyRanges.find((r) => r.label.includes('Transfeminine'))?.position === 'above',
);
check(
  'the therapy intervals keep their attribution',
  testosterone.therapyRanges.every((r) => Boolean(r.source)),
  testosterone.therapyRanges[0]?.source ?? '',
);
check(
  'estradiol below the feminizing target is reported as below',
  estradiol.therapyRanges.find((r) => r.label === 'Transfeminine HRT target')?.position === 'below',
  estradiol.therapyRanges.map((r) => `${r.label}=${r.position}`).join(', '),
);
check('the laboratory verdict is still reported', testosterone.status === 'Low' && testosterone.refRange === '264-916');
// Hemoglobin does carry one — testosterone therapy raises it, and that is the
// interval to read a value against for someone on it.
check(
  'hemoglobin carries the masculinizing-therapy interval',
  hemoglobin.therapyRanges.length === 1,
  hemoglobin.therapyRanges.map((r) => `${r.label}=${r.position}`).join(', '),
);
check('a metric with no therapy interval carries none', alt.therapyRanges.length === 0);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
