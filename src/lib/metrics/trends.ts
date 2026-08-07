import * as m from '$lib/paraglide/messages.js';
import { getMetricDefinition } from './catalog';
import { computeDerivedMetrics, type DerivedPoint } from './derived';

// Shared shape of the diachronic view. Every dashboard section builds the same
// series from its own records, so lab results, body measurements and vitals
// read identically over time.

export type TrendPoint = {
  id: string;
  metricName: string;
  value: number;
  rawValue: string;
  unit: string | null;
  rawUnit: string | null;
  status: string | null;
  date: string | null;
  chartDate: string;
  formattedDate: string;
  refRange: string | null;
  rawRefRange: string | null;
  reportId: string | null;
  calculated: boolean;
};

export type TrendMetricGroup = {
  metricName: string;
  points: TrendPoint[];
};

export type ParsedRefRange = {
  low: number | null;
  high: number | null;
  label: string;
};

export function parseReferenceRange(refRange?: string | null): ParsedRefRange | null {
  if (!refRange) return null;

  const matches = Array.from(refRange.matchAll(/(?<![\d.])[+-]?\d*\.?\d+/g), (match) => Number(match[0])).filter(
    (value) => Number.isFinite(value),
  );

  if (matches.length >= 2) {
    const [first, second] = matches;
    return {
      low: Math.min(first, second),
      high: Math.max(first, second),
      label: refRange,
    };
  }

  if (matches.length === 1) {
    const value = matches[0];

    if (refRange.includes('<')) {
      return { low: null, high: value, label: refRange };
    }

    if (refRange.includes('>')) {
      return { low: value, high: null, label: refRange };
    }
  }

  return null;
}

export function getStatusFromRange(value: number, range: ParsedRefRange | null, fallbackStatus?: string | null) {
  if (!range) return fallbackStatus || null;

  if (range.low !== null && value < range.low) return 'Low';
  if (range.high !== null && value > range.high) return 'High';
  if (range.low !== null || range.high !== null) return 'Normal';

  return fallbackStatus || null;
}

export function getStatusLabel(status?: string | null) {
  if (status === 'High') return m.status_high();
  if (status === 'Low') return m.status_low();
  if (status === 'Normal') return m.status_normal();
  if (status === 'Optimal') return m.status_optimal();
  if (status === 'Stable') return m.status_stable();
  if (status === 'Review Required') return m.status_review_required();
  if (status === 'Manual') return m.status_manual();
  return status || '';
}

export function getStatusTone(status?: string | null) {
  if (status === 'High') return 'text-rose-700 bg-rose-50 border-rose-200';
  if (status === 'Low') return 'text-orange-700 bg-orange-50 border-orange-200';
  if (status === 'Normal') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (status === 'Optimal') return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

export type TrendSourceRecord = {
  id: string;
  reportId: string;
  metricName: string;
  value: string;
  unit: string | null;
  refRange: string | null;
  status: string | null;
  extraData: unknown;
  /** Extra columns the caller's row type may carry. */
  [key: string]: unknown;
};

export type TrendSourceReport = { id: string; testDate: string | null; [key: string]: unknown };

type BuildInput<R extends TrendSourceRecord, P extends TrendSourceReport> = {
  records: R[];
  reports: P[];
  comparableValue: (record: R) => number | null;
  comparableUnit: (record: R) => string | null;
  comparableRange: (record: R) => string | null;
  formatDate: (value: string | null, options?: Intl.DateTimeFormatOptions) => string;
};

/**
 * One series per metric, plus the metrics that are calculated from others.
 * Series are keyed on the catalog label, so a value the extractor recorded as
 * "Weight" and one logged as "Body Weight" stay a single line.
 */
export function buildTrendMetrics<R extends TrendSourceRecord, P extends TrendSourceReport>(
  input: BuildInput<R, P>,
): { metrics: TrendMetricGroup[]; derived: DerivedPoint[] } {
  const grouped = new Map<string, TrendPoint[]>();
  const reportById = new Map(input.reports.map((report) => [report.id, report]));

  const valuesByReport = new Map<string, Map<string, number>>();

  for (const item of input.records) {
    const numericValue = input.comparableValue(item);
    if (numericValue === null) continue;

    const values = valuesByReport.get(item.reportId) || new Map<string, number>();
    values.set(getMetricDefinition(item.metricName).key, numericValue);
    valuesByReport.set(item.reportId, values);

    const report = reportById.get(item.reportId);
    const seriesName = getMetricDefinition(item.metricName).canonicalLabel;

    const point: TrendPoint = {
      id: item.id,
      metricName: seriesName,
      value: numericValue,
      rawValue: item.value,
      unit: input.comparableUnit(item),
      rawUnit: item.unit,
      status: item.status,
      date: report?.testDate || null,
      chartDate: input.formatDate(report?.testDate || null, { dateStyle: 'medium' }),
      formattedDate: input.formatDate(report?.testDate || null),
      refRange: input.comparableRange(item),
      rawRefRange: item.refRange,
      reportId: item.reportId,
      calculated: false,
    };

    const existing = grouped.get(seriesName) || [];
    existing.push(point);
    grouped.set(seriesName, existing);
  }

  const derived = computeDerivedMetrics(input.reports, valuesByReport);

  for (const point of derived) {
    const report = reportById.get(point.reportId);

    const calculatedPoint: TrendPoint = {
      id: `calculated:${point.reportId}:${point.definition.key}`,
      metricName: point.definition.canonicalLabel,
      value: point.value,
      rawValue: point.value.toFixed(point.precision),
      unit: point.unit,
      rawUnit: point.unit,
      status: null,
      date: report?.testDate || null,
      chartDate: input.formatDate(report?.testDate || null, { dateStyle: 'medium' }),
      formattedDate: input.formatDate(report?.testDate || null),
      refRange: null,
      rawRefRange: null,
      reportId: point.reportId,
      calculated: true,
    };

    const existing = grouped.get(point.definition.canonicalLabel) || [];
    existing.push(calculatedPoint);
    grouped.set(point.definition.canonicalLabel, existing);
  }

  const metrics = Array.from(grouped.entries())
    .map(([metricName, points]) => ({
      metricName,
      points: points.sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return aTime - bTime;
      }),
    }))
    .filter(({ points }) => points.length > 0)
    .sort((a, b) => b.points.length - a.points.length || a.metricName.localeCompare(b.metricName));

  return { metrics, derived };
}
