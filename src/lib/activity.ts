import { activityMetricByKey, readDailySummary, type DailySummary } from '$lib/metrics/activity';
import { getMetricDefinition } from '$lib/metrics/catalog';
import { importMetadata, type ImportRecord } from '$lib/import/measurement-plan';

export type ActivityPoint = { date: string; key: string; value: number; unit: string; summary: DailySummary };
export function activityPoints(reports: Array<{ id: string; kind?: string | null }>, records: ImportRecord[]): ActivityPoint[] {
  const ids = new Set(reports.filter((report) => report.kind === 'activity').map((report) => report.id));
  const points = new Map<string, { point: ActivityPoint; reportId: string; recordId: string }>();
  for (const record of records) {
    if (!ids.has(record.reportId)) continue;
    const metadata = importMetadata(record.extraData);
    const key = getMetricDefinition(record.metricName).key;
    const metric = activityMetricByKey.get(key);
    const summary = readDailySummary(metadata.dailySummary, key);
    const value = Number(record.value);
    if (!summary || !metric || record.unit !== metric.unit || !Number.isFinite(value) || value < 0) continue;
    const id = `${summary.date}:${key}`;
    const previous = points.get(id);
    // Restoring overlapping archives must never add the daily totals together.
    if (!previous || record.reportId > previous.reportId || (record.reportId === previous.reportId && record.id > previous.recordId)) {
      points.set(id, { point: { date: summary.date, key, value, unit: metric.unit, summary }, reportId: record.reportId, recordId: record.id });
    }
  }
  return [...points.values()].map(({ point }) => point).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
