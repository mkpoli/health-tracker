// The failure this guards against: five waist measurements spread over nine
// years were charted as a line, and a reader — human or model — took a slope
// off them. A series states a direction only once it can carry one.
import { assessEvidence, DIRECTION_MIN_POINTS, DIRECTION_MIN_SPAN_DAYS } from '../src/lib/health/summary';

const now = Date.parse('2026-08-08T00:00:00.000Z');

function points(dates: string[]) {
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

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// The real shape of the waist series: sparse, spread over years.
const sparse = assessEvidence(
  'waist-circumference',
  points(['2017-06-01', '2019-03-01', '2022-08-01', '2026-02-12', '2026-08-01']),
  now,
);
check('nine years of five readings is not enough', sparse.sufficient === false);
check('the shortfall names how many more are needed', /1 more/.test(sparse.shortfall ?? ''), sparse.shortfall ?? '');
check('the rule is stated for the reader', sparse.rule.includes(String(DIRECTION_MIN_POINTS)));

// Weekly for six weeks: what the owner would actually build.
const weekly = assessEvidence(
  'waist-circumference',
  points(['2026-06-27', '2026-07-04', '2026-07-11', '2026-07-18', '2026-07-25', '2026-08-01']),
  now,
);
check('six weekly readings carry a direction', weekly.sufficient === true, `span=${weekly.spanDays}d`);
check('the median gap is reported', weekly.medianGapDays === 7, `median=${weekly.medianGapDays}`);

// Enough points, but crammed into a few days — a direction there is noise.
const crammed = assessEvidence(
  'body-weight',
  points(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']),
  now,
);
check('six readings over six days do not carry a direction', crammed.sufficient === false, `span=${crammed.spanDays}d`);
check(
  'the shortfall names the span',
  (crammed.shortfall ?? '').includes(String(DIRECTION_MIN_SPAN_DAYS)),
  crammed.shortfall ?? '',
);

const empty = assessEvidence('waist-circumference', [], now);
check('an empty series is handled', empty.sufficient === false && empty.readingCount === 0);

const single = assessEvidence('waist-circumference', points(['2026-08-01']), now);
check('a single reading reports no span', single.spanDays === 0 && single.sufficient === false);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
