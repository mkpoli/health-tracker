import { getMetricDefinition, getMetricDefinitionByKey, type MetricDefinition } from '$lib/metrics/catalog';
import { computeDerivedMetrics } from '$lib/metrics/derived';
import { freshnessHorizon, measureFreshness } from '$lib/metrics/freshness';
import { normalizeComparableMeasurement } from '$lib/metrics/normalization';
import {
  ageInYearsAt,
  formatRefRangeForUnit,
  getRefRangesForMetric,
  type PatientContext,
  type RefRangeEntry,
} from '$lib/metrics/ref-ranges';
import { getStatusFromRange, parseReferenceRange } from '$lib/metrics/trends';

// The chart a reader would open first: one current value per metric, with the
// range it is judged against and how old it is. Values are comparable units and
// labels are canonical English, so the output carries no display locale and a
// page render and a machine consumer read the same numbers.

export type SummarySource = {
  reports: Array<{ id: string; kind: string; testDate: string | null }>;
  records: Array<{
    id: string;
    reportId: string;
    metricName: string;
    value: string;
    unit: string | null;
    refRange: string | null;
    status: string | null;
    extraData?: unknown;
  }>;
  patient: PatientContext;
  /** Reference instant for every age and staleness calculation. */
  now: number;
};

export type SeriesPoint = {
  date: string | null;
  value: number;
  rawValue: string;
  unit: string | null;
  /** Range as the report carried it, scaled to the comparable unit. */
  refRange: string | null;
  /** Status as stored, before any range is applied. */
  storedStatus: string | null;
  reportId: string;
  reportKind: string;
  calculated: boolean;
  /** For a calculated value, the date of the oldest reading behind it. */
  basisDate: string | null;
  /** Whether the draw was fasting, after a meal, or casual, when the report said. */
  collectionContext: CollectionContext;
  hoursSinceMeal: number | null;
};

export type CollectionContext = 'fasting' | 'post-meal' | 'random' | null;

function readContext(extraData: unknown): { context: CollectionContext; hoursSinceMeal: number | null } {
  const parsed =
    typeof extraData === 'string'
      ? (() => {
          try {
            return JSON.parse(extraData) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : ((extraData || {}) as Record<string, unknown>);

  const raw = typeof parsed.collectionContext === 'string' ? parsed.collectionContext : null;
  // Number(null) is 0, which would report a draw taken the moment after eating
  // where the record in fact says nothing about when the person last ate.
  const stated = parsed.hoursSinceMeal;
  const hours = typeof stated === 'number' || typeof stated === 'string' ? Number(stated) : Number.NaN;

  return {
    context: raw === 'fasting' || raw === 'post-meal' || raw === 'random' ? raw : null,
    hoursSinceMeal: Number.isFinite(hours) ? hours : null,
  };
}

export type MetricSeries = {
  metricKey: string;
  label: string;
  unit: string | null;
  points: SeriesPoint[];
  /** Readings held back because their unit does not convert to the series unit. */
  setAside?: number;
};

export type SummaryEntry = {
  metricKey: string;
  label: string;
  testType: string;
  value: number;
  rawValue: string;
  unit: string | null;
  date: string | null;
  basisDate: string | null;
  reportId: string;
  reportKind: string;
  status: string | null;
  /** Where the status came from: the report's own range, or a catalog interval. */
  statusSource: 'report' | 'catalog' | null;
  refRange: string | null;
  /** Which published interval was used, when the judgement came from the catalog. */
  rangeLabel: string | null;
  /** The caveat attached to that interval, when it carries one. */
  rangeNotes: string | null;
  ageDays: number | null;
  horizonDays: number | null;
  stale: boolean;
  calculated: boolean;
  /** Change against the previous reading, in the same comparable unit. */
  delta: number | null;
  /** Conditions of the draw, when the report stated them. */
  collectionContext: CollectionContext;
  hoursSinceMeal: number | null;
  /**
   * Intervals for this metric that describe someone on hormone therapy, with
   * where the value falls in each. A laboratory prints the interval for someone
   * who is not on therapy, so on these metrics its verdict can be exactly
   * backwards for a patient who is.
   */
  therapyRanges: TherapyRange[];
  readingCount: number;
};

export type TherapyRange = {
  label: string;
  range: string;
  unit: string | null;
  notes: string | null;
  source: string | null;
  /** Where the reading sits against this interval. */
  position: 'within' | 'above' | 'below' | 'unknown';
};

function assumesFasting(metricKey: string) {
  return Boolean(getMetricDefinitionByKey(metricKey)?.intervalAssumesFasting);
}

/**
 * Whether a printed interval says anything about a reading taken under these
 * conditions. A fasting interval describes a fasting draw; applying it to one
 * taken after a meal produces a verdict about the meal.
 *
 * Exported because every surface that renders a status has to answer this the
 * same way — the dashboard and the agent reading the same number must not
 * disagree about whether it is abnormal.
 */
export function verdictApplies(metricKey: string, context: CollectionContext) {
  return !(assumesFasting(metricKey) && context && context !== 'fasting');
}

/**
 * Intervals for a metric that describe someone on hormone therapy, with where
 * this value falls in each. Takes a bare value so a renderer holding a chart
 * point can ask the same question the read model asks.
 */
export function therapyRangesForValue(
  metricKey: string,
  value: number,
  unit: string | null,
  patient: PatientContext = {},
): TherapyRange[] {
  return getRefRangesForMetric(metricKey, patient)
    .filter((entry) => entry.context === 'on-therapy' && unitsAgree(entry.unit, unit))
    .map((entry) => {
      const range = rangeInUnit(entry, unit);
      const parsed = parseReferenceRange(range);
      let position: TherapyRange['position'] = 'unknown';

      if (parsed) {
        if (parsed.low !== null && value < parsed.low) position = 'below';
        else if (parsed.high !== null && value > parsed.high) position = 'above';
        else if (parsed.low !== null || parsed.high !== null) position = 'within';
      }

      return {
        label: entry.label,
        range,
        unit: unit ?? entry.unit ?? null,
        notes: entry.notes ?? null,
        source: entry.source ?? null,
        position,
      };
    });
}

/**
 * Whether two readings describe the same thing well enough to subtract or plot
 * as one line. Where eating moves the number, a fasting draw and a post-meal
 * draw are two different measurements, and their difference is a meal rather
 * than a change.
 *
 * Exported for the same reason the verdict rule is: a chart and an agent
 * looking at the same two numbers must agree on whether their difference means
 * anything.
 */
export function contextsComparable(metricKey: string, a: CollectionContext, b: CollectionContext) {
  return !assumesFasting(metricKey) || a === b;
}

function comparableDraw(metricKey: string, latest: SeriesPoint, previous?: SeriesPoint) {
  if (!previous) return false;

  return contextsComparable(metricKey, latest.collectionContext, previous.collectionContext);
}

function pointTime(date: string | null) {
  if (!date) return 0;
  const time = new Date(date).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * One series per metric, newest point first, keyed on the catalog key so a
 * value extracted as "Weight" and one logged as "Body Weight" stay one line.
 * Calculated metrics are folded in as points of their own.
 */
export function buildSeries(source: SummarySource): Map<string, MetricSeries> {
  const reportById = new Map(source.reports.map((report) => [report.id, report]));
  const byKey = new Map<string, MetricSeries>();
  const valuesByReport = new Map<string, Map<string, number>>();

  const push = (definition: MetricDefinition, point: SeriesPoint) => {
    const series = byKey.get(definition.key) || {
      metricKey: definition.key,
      label: definition.canonicalLabel,
      unit: point.unit,
      points: [],
    };
    series.points.push(point);
    byKey.set(definition.key, series);
  };

  for (const item of source.records) {
    const definition = getMetricDefinition(item.metricName);
    const { comparableValue, comparableUnit, comparableReferenceRange } = normalizeComparableMeasurement(
      item.value,
      item.unit,
      item.refRange,
    );
    if (comparableValue === null) continue;

    const values = valuesByReport.get(item.reportId) || new Map<string, number>();
    values.set(definition.key, comparableValue);
    valuesByReport.set(item.reportId, values);

    const report = reportById.get(item.reportId);
    const { context, hoursSinceMeal } = readContext(item.extraData);

    push(definition, {
      date: report?.testDate ?? null,
      value: comparableValue,
      rawValue: item.value,
      unit: comparableUnit,
      refRange: comparableReferenceRange,
      storedStatus: item.status,
      reportId: item.reportId,
      reportKind: report?.kind || 'lab',
      calculated: false,
      basisDate: report?.testDate ?? null,
      collectionContext: context,
      hoursSinceMeal,
    });
  }

  for (const point of computeDerivedMetrics(source.reports, valuesByReport)) {
    const report = reportById.get(point.reportId);

    push(point.definition, {
      date: report?.testDate ?? null,
      value: point.value,
      rawValue: point.value.toFixed(point.precision),
      unit: point.unit,
      refRange: null,
      storedStatus: null,
      reportId: point.reportId,
      reportKind: report?.kind || 'lab',
      calculated: true,
      basisDate: point.basisDate ?? report?.testDate ?? null,
      collectionContext: null,
      hoursSinceMeal: null,
    });
  }

  for (const series of byKey.values()) {
    series.points.sort((a, b) => pointTime(b.date) - pointTime(a.date));
    series.unit = series.points[0]?.unit ?? series.unit;

    // Normalization reconciles decimal prefixes, not every convention a report
    // may use — estradiol arrives as pg/mL from one lab and pmol/L from
    // another. Subtracting across those invents a fall where the value rose, so
    // points that are not in the series unit are set aside rather than mixed in.
    const comparable = series.points.filter((point) => unitsAgree(point.unit, series.unit));
    series.setAside = series.points.length - comparable.length;
    series.points = comparable;
  }

  return byKey;
}

/**
 * The catalog interval that actually fits this patient, or nothing.
 *
 * `getRefRangesForMetric` ranks by fit and never discards, so the first entry
 * for testosterone is "Adult male" whether or not anything is known about the
 * person. Judging against it turns an unknown into an assertion: a woman who
 * withheld her demographics, or anyone whose agab is recorded as Other, would
 * have every normal reading returned as Low with a male range attached. So an
 * entry is used only when its own sex and age conditions are satisfied by what
 * is known, and only when its unit matches the reading.
 *
 * Intervals describing someone on hormone therapy are excluded as well: they
 * say where a clinician aims, and a value outside one is a question for the
 * treatment. When they are the only entries that fit, there is no physiological
 * range to judge against and the answer is nothing.
 */
export function pickCatalogRange(
  metricKey: string,
  unit: string | null,
  patient: PatientContext,
): RefRangeEntry | null {
  const known = { sex: normalizeSex(patient.agab), age: ageInYearsAt(patient.birthday, patient.now) };

  const candidates = getRefRangesForMetric(metricKey, patient).filter(
    (entry) => entry.context !== 'on-therapy' && entryApplies(entry, known),
  );

  return candidates.find((entry) => unitsAgree(entry.unit, unit)) ?? null;
}

function normalizeSex(agab?: string | null) {
  const lower = agab?.trim().toLowerCase();
  if (lower === 'male' || lower === 'm') return 'Male' as const;
  if (lower === 'female' || lower === 'f') return 'Female' as const;
  return null;
}


/** An entry applies only when every condition it states is satisfied by something known. */
function entryApplies(entry: RefRangeEntry, known: { sex: 'Male' | 'Female' | null; age: number | null }) {
  if (entry.sex && entry.sex !== 'Any') {
    if (!known.sex) return false;
    const accepted = Array.isArray(entry.sex) ? entry.sex : [entry.sex];
    if (!accepted.includes(known.sex) && !accepted.includes('Any')) return false;
  }

  if (entry.ageMin !== undefined || entry.ageMax !== undefined) {
    if (known.age === null) return false;
    if (entry.ageMin !== undefined && known.age < entry.ageMin) return false;
    if (entry.ageMax !== undefined && known.age > entry.ageMax) return false;
  }

  return true;
}

/**
 * A range in mg/dL says nothing about a value in mmol/L. Comparable units are
 * what the readings are already normalized to, so both sides are converted
 * there before being called equal.
 */
function unitsAgree(entryUnit: string | null | undefined, valueUnit: string | null) {
  const left = (entryUnit || '').trim();
  const right = (valueUnit || '').trim();

  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.toLowerCase() === right.toLowerCase()) return true;

  const entryScale = normalizeComparableMeasurement(1, left, null);
  const valueScale = normalizeComparableMeasurement(1, right, null);

  // Readings arrive already scaled to the base unit, while an interval may be
  // published in a scaled one — the red-cell range is written in 10^6/uL
  // against a value held in /uL. Requiring the two multipliers to match
  // discarded exactly those intervals, leaving the metric with no range at all.
  return Boolean(entryScale.comparableUnit) && entryScale.comparableUnit === valueScale.comparableUnit;
}

/** An interval's bounds written in the unit the reading is held in. */
function rangeInUnit(entry: RefRangeEntry, unit: string | null) {
  return formatRefRangeForUnit(entry, unit).range;
}

function judge(metricKey: string, point: SeriesPoint, patient: PatientContext) {
  // A glucose an hour after breakfast is expected to sit above the fasting
  // interval printed beside it. Judging it there manufactures a High and, read
  // over several visits, a rising trend that is a record of meals.
  if (!verdictApplies(metricKey, point.collectionContext)) {
    return {
      status: null,
      statusSource: null,
      refRange: null,
      rangeLabel: null,
      rangeNotes: `Taken ${point.collectionContext === 'post-meal' ? 'after a meal' : 'at a casual time'}; the published interval for this metric describes a fasting draw and does not apply.`,
    };
  }

  const reportRange = parseReferenceRange(point.refRange);

  if (reportRange) {
    return {
      status: getStatusFromRange(point.value, reportRange, point.storedStatus),
      statusSource: 'report' as const,
      refRange: point.refRange,
      rangeLabel: null,
      rangeNotes: null,
    };
  }

  const catalogEntry = pickCatalogRange(metricKey, point.unit, patient);

  if (catalogEntry) {
    const range = rangeInUnit(catalogEntry, point.unit);

    return {
      status: getStatusFromRange(point.value, parseReferenceRange(range), point.storedStatus),
      statusSource: 'catalog' as const,
      refRange: range,
      rangeLabel: catalogEntry.label,
      // Some intervals carry the caveat that decides how to read them — the
      // body-fat entry says a value below it is not necessarily abnormal.
      // Stripping that leaves a bare "Low" the caveat existed to prevent.
      rangeNotes: catalogEntry.notes ?? null,
    };
  }

  return { status: point.storedStatus, statusSource: null, refRange: null, rangeLabel: null, rangeNotes: null };
}

/**
 * How a reading sits against the intervals that describe someone on hormone
 * therapy. Nothing here asserts that the patient is on therapy — it says what
 * the alternative intervals are and where the number falls, so a reader with
 * that context is not left with only the laboratory's cis-referenced verdict.
 */
function therapyRangesFor(metricKey: string, point: SeriesPoint, patient: PatientContext): TherapyRange[] {
  return therapyRangesForValue(metricKey, point.value, point.unit, patient);
}

/** Latest reading per metric, judged and aged. */
export function buildSummary(source: SummarySource, series = buildSeries(source)): SummaryEntry[] {
  const entries: SummaryEntry[] = [];
  // The age an interval is chosen against is measured at the same instant as
  // staleness, so a caller reading the record as of a past date gets the age
  // the person was then rather than the age they are today.
  const patient = { ...source.patient, now: source.patient.now ?? source.now };

  for (const group of series.values()) {
    const [latest, previous] = group.points;
    if (!latest) continue;

    const definition = getMetricDefinitionByKey(group.metricKey) || getMetricDefinition(group.label);
    // A calculated value ages with its oldest input, so a BMI resting on a
    // three-year-old height is not presented as this morning's number.
    const freshness = measureFreshness(latest.basisDate, freshnessHorizon(group.label), source.now);
    const judged = judge(group.metricKey, latest, patient);

    entries.push({
      metricKey: group.metricKey,
      label: group.label,
      testType: definition.testType || 'other',
      value: round(latest.value),
      rawValue: latest.rawValue,
      unit: latest.unit,
      date: latest.date,
      basisDate: latest.basisDate,
      reportId: latest.reportId,
      reportKind: latest.reportKind,
      status: judged.status,
      statusSource: judged.statusSource,
      refRange: judged.refRange,
      rangeLabel: judged.rangeLabel,
      rangeNotes: judged.rangeNotes,
      ageDays: freshness?.ageDays ?? null,
      horizonDays: freshness?.horizonDays ?? null,
      stale: freshness?.stale ?? false,
      calculated: latest.calculated,
      collectionContext: latest.collectionContext,
      hoursSinceMeal: latest.hoursSinceMeal,
      therapyRanges: therapyRangesFor(group.metricKey, latest, patient),
      // Two readings only subtract when they were taken under the same
      // conditions; fasting minus post-meal is not a change in the body.
      delta: comparableDraw(group.metricKey, latest, previous) ? round(latest.value - previous!.value) : null,
      readingCount: group.points.length,
    });
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Buckets a series so a decade of daily weigh-ins survives as a shape rather
 * than three thousand points. Extremes are kept per bucket: a spike that gets
 * averaged away is the reading that mattered.
 */
export function downsample(points: SeriesPoint[], granularity: 'all' | 'monthly' | 'yearly') {
  if (granularity === 'all') return points;

  const width = granularity === 'monthly' ? 7 : 4;
  const buckets = new Map<string, SeriesPoint[]>();

  for (const point of points) {
    const bucket = point.date ? point.date.slice(0, width) : 'undated';
    buckets.set(bucket, [...(buckets.get(bucket) || []), point]);
  }

  const kept = new Set<SeriesPoint>();

  for (const group of buckets.values()) {
    const ordered = [...group].sort((a, b) => pointTime(a.date) - pointTime(b.date));
    kept.add(ordered.reduce((low, point) => (point.value < low.value ? point : low), ordered[0]));
    kept.add(ordered.reduce((high, point) => (point.value > high.value ? point : high), ordered[0]));
    kept.add(ordered[ordered.length - 1]);
  }

  return [...kept].sort((a, b) => pointTime(b.date) - pointTime(a.date));
}

/**
 * The stored status was computed when the report was parsed, against whatever
 * interval was printed beside the value. Where the draw conditions do not match
 * that interval, the verdict is withdrawn rather than repeated.
 */
export function statusForPoint(metricKey: string, point: SeriesPoint) {
  return verdictApplies(metricKey, point.collectionContext) ? point.storedStatus : null;
}

/** Whether a set of readings was drawn under conditions that let them form one line. */
export function drawsAreComparable(metricKey: string, points: SeriesPoint[]) {
  if (!assumesFasting(metricKey)) return true;

  const seen = new Set(points.map((point) => point.collectionContext));
  return seen.size <= 1;
}

/** Direction and size of change across a window, so a reader gets the trend without doing arithmetic over every point. */
export function describeTrend(points: SeriesPoint[]) {
  if (points.length < 2) return null;

  const ordered = [...points].sort((a, b) => pointTime(a.date) - pointTime(b.date));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const change = last.value - first.value;
  const spanDays = Math.round((pointTime(last.date) - pointTime(first.date)) / 86_400_000);
  const values = ordered.map((point) => point.value);

  return {
    from: { date: first.date, value: round(first.value) },
    to: { date: last.date, value: round(last.value) },
    change: round(change),
    spanDays,
    // Annualizing a fortnight of readings produces a number nobody should act
    // on, so a rate is only given once the window is long enough to carry one.
    perYear: spanDays >= 90 ? round((change / spanDays) * 365) : null,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    direction: change > 0 ? 'rising' : change < 0 ? 'falling' : 'flat',
  };
}

// Whether a series can carry an answer yet.
//
// A chart drawn through five points spread over nine years looks like a trend
// and is not one. Saying so — with what would change it — is a more useful
// answer than a slope, and it is the honest one while the record is thin.

/** Product rules, stated rather than hidden, so a reader can disagree with them. */
export const DIRECTION_MIN_POINTS = 6;
// Six weekly readings span five weeks, so this is the floor that makes "measure
// it once a week for six weeks" exactly sufficient. Its job is to reject six
// readings taken over three days, where a slope is noise.
export const DIRECTION_MIN_SPAN_DAYS = 35;

export type EvidenceAssessment = {
  metricKey: string;
  readingCount: number;
  spanDays: number | null;
  medianGapDays: number | null;
  firstDate: string | null;
  lastDate: string | null;
  /** Whether the series is dense enough over long enough to state a direction. */
  sufficient: boolean;
  /** What is missing, in the reader's terms. Null when nothing is. */
  shortfall: string | null;
  rule: string;
};

/** Takes no reference instant: the assessment is about the readings against each other. */
export function assessEvidence(metricKey: string, points: SeriesPoint[]): EvidenceAssessment {
  const dated = points.filter((point) => point.date).sort((a, b) => pointTime(a.date) - pointTime(b.date));
  const first = dated[0]?.date ?? null;
  const last = dated[dated.length - 1]?.date ?? null;
  const spanDays =
    dated.length > 1 ? Math.round((pointTime(last) - pointTime(first)) / 86_400_000) : dated.length ? 0 : null;

  const gaps: number[] = [];
  for (let i = 1; i < dated.length; i++) {
    gaps.push(Math.round((pointTime(dated[i].date) - pointTime(dated[i - 1].date)) / 86_400_000));
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGapDays = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : null;

  const enoughPoints = dated.length >= DIRECTION_MIN_POINTS;
  const enoughSpan = (spanDays ?? 0) >= DIRECTION_MIN_SPAN_DAYS;

  const rule = `A direction is stated once there are ${DIRECTION_MIN_POINTS} readings spanning ${DIRECTION_MIN_SPAN_DAYS} days or more.`;

  if (enoughPoints && enoughSpan) {
    return {
      metricKey,
      readingCount: dated.length,
      spanDays,
      medianGapDays,
      firstDate: first,
      lastDate: last,
      sufficient: true,
      shortfall: null,
      rule,
    };
  }

  const missingPoints = Math.max(0, DIRECTION_MIN_POINTS - dated.length);
  const shortfall = !enoughPoints
    ? `${dated.length} reading${dated.length === 1 ? '' : 's'} recorded; ${missingPoints} more would reach the threshold.`
    : `Readings span ${spanDays} days; ${DIRECTION_MIN_SPAN_DAYS} days or more is needed before a direction means anything.`;

  return {
    metricKey,
    readingCount: dated.length,
    spanDays,
    medianGapDays,
    firstDate: first,
    lastDate: last,
    sufficient: false,
    shortfall,
    rule,
  };
}
