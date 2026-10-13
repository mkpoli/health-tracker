import type { MetricDefinition } from './catalog';

export const activityMetrics = [
  { key: 'daily-steps', canonicalLabel: 'Daily Steps', unit: 'count', group: 'activity', aggregation: 'sum' },
  { key: 'walking-running-distance', canonicalLabel: 'Walking and Running Distance', unit: 'km', group: 'activity', aggregation: 'sum' },
  { key: 'active-energy', canonicalLabel: 'Active Energy', unit: 'kcal', group: 'activity', aggregation: 'sum' },
  { key: 'resting-energy', canonicalLabel: 'Resting Energy', unit: 'kcal', group: 'activity', aggregation: 'sum' },
  { key: 'walking-speed', canonicalLabel: 'Walking Speed', unit: 'km/h', group: 'mobility', aggregation: 'mean' },
  { key: 'walking-step-length', canonicalLabel: 'Walking Step Length', unit: 'cm', group: 'mobility', aggregation: 'mean' },
  { key: 'walking-double-support', canonicalLabel: 'Walking Double Support', unit: '%', group: 'mobility', aggregation: 'mean' },
  { key: 'walking-asymmetry', canonicalLabel: 'Walking Asymmetry', unit: '%', group: 'mobility', aggregation: 'mean' },
] as const;
export type ActivityMetricKey = typeof activityMetrics[number]['key'];
export const activityMetricDefinitions: MetricDefinition[] = activityMetrics.map(({ key, canonicalLabel, unit, group }) => ({
  key, canonicalLabel, unit, testType: 'activity', categories: [group],
}));
export const activityMetricByKey = new Map(activityMetrics.map((metric) => [metric.key as string, metric]));

export type DailySummary = {
  date: string;
  timeZone: string;
  aggregation: 'sum' | 'mean';
  source: string;
  sampleCount: number;
  coverageSeconds: number;
  excludedSamples: number;
  estimated: boolean;
};

/** Validate imported provenance before storing it alongside a daily value. */
export function readDailySummary(value: unknown, key: string): DailySummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const metric = activityMetricByKey.get(key);
  if (!metric || typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;
  const day = new Date(`${input.date}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== input.date) return null;
  if (typeof input.timeZone !== 'string' || input.timeZone.length > 100) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { return null; }
  if (input.aggregation !== metric.aggregation || typeof input.source !== 'string' || !input.source.trim()) return null;
  if (!Number.isSafeInteger(input.sampleCount) || Number(input.sampleCount) < 1 || Number(input.sampleCount) > 10_000_000) return null;
  if (!Number.isSafeInteger(input.excludedSamples) || Number(input.excludedSamples) < 0 || Number(input.excludedSamples) > 100_000_000) return null;
  if (typeof input.coverageSeconds !== 'number' || !Number.isFinite(input.coverageSeconds) || input.coverageSeconds < 0 || input.coverageSeconds > 172800) return null;
  if (metric.aggregation === 'mean' && input.coverageSeconds === 0) return null;
  if (typeof input.estimated !== 'boolean') return null;
  return {
    date: input.date, timeZone: input.timeZone, aggregation: metric.aggregation,
    source: input.source.trim().slice(0, 256), sampleCount: Number(input.sampleCount),
    coverageSeconds: input.coverageSeconds, excludedSamples: Number(input.excludedSamples), estimated: input.estimated,
  };
}
