// The failure this guards against: a glucose drawn after breakfast was judged
// against the fasting interval printed beside it and reported as High, and a
// run of such readings mixed with fasting ones looked like a rising trend.
import { buildSummary, buildSeries, statusForPoint, drawsAreComparable } from '../src/lib/health/summary';

const reports = [
  { id: 'r1', kind: 'lab', testDate: '2026-08-05T10:13:00.000Z' },
  { id: 'r2', kind: 'lab', testDate: '2026-01-26T23:58:00.000Z' },
];

const summary = buildSummary({
  reports,
  records: [
    {
      id: 'a',
      reportId: 'r1',
      metricName: 'Blood Glucose',
      value: '114',
      unit: 'mg/dL',
      refRange: '73-109',
      status: null,
      extraData: JSON.stringify({ collectionContext: 'post-meal', hoursSinceMeal: 2 }),
    },
    {
      id: 'b',
      reportId: 'r2',
      metricName: 'Blood Glucose',
      value: '88',
      unit: 'mg/dL',
      refRange: '73-109',
      status: null,
      extraData: JSON.stringify({ collectionContext: 'fasting' }),
    },
  ],
  patient: { agab: 'Other', birthday: '1999-07-25' },
  now: Date.parse('2026-08-08T00:00:00.000Z'),
});

const glucose = summary.find((entry) => entry.metricKey === 'blood-glucose')!;
let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

check('post-meal glucose is not called High', glucose.status === null, `status=${glucose.status}`);
check('no fasting range attached to it', glucose.refRange === null, `ref_range=${glucose.refRange}`);
check('the reason is stated', Boolean(glucose.rangeNotes), glucose.rangeNotes ?? '');
check('the draw condition is carried', glucose.collectionContext === 'post-meal', `collected=${glucose.collectionContext}`);
check('post-meal is not subtracted from fasting', glucose.delta === null, `delta=${glucose.delta}`);

// A fasting reading still gets judged normally.
const fasting = buildSummary({
  reports: [reports[0]],
  records: [
    {
      id: 'c',
      reportId: 'r1',
      metricName: 'Blood Glucose',
      value: '114',
      unit: 'mg/dL',
      refRange: '73-109',
      status: null,
      extraData: JSON.stringify({ collectionContext: 'fasting' }),
    },
  ],
  patient: {},
  now: Date.parse('2026-08-08T00:00:00.000Z'),
}).find((entry) => entry.metricKey === 'blood-glucose')!;

check('a fasting reading is still judged', fasting.status === 'High', `status=${fasting.status}`);

// A metric that does not depend on eating is unaffected.
const hb = buildSummary({
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
  now: Date.parse('2026-08-08T00:00:00.000Z'),
}).find((entry) => entry.metricKey === 'hemoglobin')!;

check('meal state does not suppress unrelated metrics', hb.status === 'Normal', `status=${hb.status}`);


// History-level rules: a stored verdict computed against the wrong interval is
// withdrawn, and a window mixing draw conditions yields no trend.

const mixedSeries = buildSeries({
  reports,
  records: [
    { id: 'e', reportId: 'r1', metricName: 'Blood Glucose', value: '114', unit: 'mg/dL', refRange: '73-109', status: 'High', extraData: JSON.stringify({ collectionContext: 'post-meal' }) },
    { id: 'f', reportId: 'r2', metricName: 'Blood Glucose', value: '88', unit: 'mg/dL', refRange: '73-109', status: 'Normal', extraData: JSON.stringify({ collectionContext: 'fasting' }) },
  ],
  patient: {},
  now: Date.parse('2026-08-08T00:00:00.000Z'),
}).get('blood-glucose')!;

const postMeal = mixedSeries.points.find((p) => p.collectionContext === 'post-meal')!;
const fastingPoint = mixedSeries.points.find((p) => p.collectionContext === 'fasting')!;

check('parse-time High on a post-meal draw is withdrawn', statusForPoint('blood-glucose', postMeal) === null, `status=${statusForPoint('blood-glucose', postMeal)}`);
check('a fasting draw keeps its verdict', statusForPoint('blood-glucose', fastingPoint) === 'Normal', `status=${statusForPoint('blood-glucose', fastingPoint)}`);
check('mixed draws are not one series', drawsAreComparable('blood-glucose', mixedSeries.points) === false, '');
check('uniform draws are one series', drawsAreComparable('blood-glucose', [postMeal]) === true, '');
check('meal state does not split unrelated metrics', drawsAreComparable('hemoglobin', mixedSeries.points) === true, '');

console.log(failures === 0 ? 'history checks passed' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
