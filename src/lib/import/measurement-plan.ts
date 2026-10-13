import { activityMetricByKey, readDailySummary, type DailySummary } from '$lib/metrics/activity';
import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
import { parseNumber } from '$lib/metrics/normalization';
import { isImportableKind, type ReportKind } from '$lib/report-kind';

export type ImportedSession = {
  kind: ReportKind;
  measuredAt: string;
  sourceKey: string;
  entries: Array<{ key?: string; label?: string; value: string | number; unit?: string | null; dailySummary?: DailySummary }>;
};

export type ImportReport = { id: string; testDate: string; extraData: unknown };
export type ImportRecord = { id: string; reportId: string; metricName: string; value: string; unit: string | null; extraData?: unknown };
export type ImportCounts = { newValues: number; updatedValues: number; duplicateValues: number };
export type ResolvedImportEntry = { metricKey: string | null; metricName: string; value: string; unit: string | null; dailySummary?: DailySummary };
type PlannedEntry = ResolvedImportEntry & { existingId?: string; action: 'insert' | 'update' | 'skip' };
type PlannedSession = { existingId?: string; sourceKey: string; kind: ReportKind; measuredAt: string; entries: PlannedEntry[] };

export function importMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return importMetadata(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resolveEntries(entries: ImportedSession['entries'], kind: ReportKind): ResolvedImportEntry[] {
  const resolved = new Map<string, ResolvedImportEntry>();
  if (!Array.isArray(entries)) return [];
  for (const entry of entries.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const numeric = parseNumber(typeof entry.value === 'number' ? entry.value : String(entry.value ?? ''));
    if (numeric === null || numeric < 0) continue;
    const definition = typeof entry.key === 'string' ? getMetricDefinitionByKey(entry.key) : null;
    const label = definition?.canonicalLabel || (typeof entry.label === 'string' ? entry.label.trim() : '');
    if (!label) continue;
    const activityMetric = definition ? activityMetricByKey.get(definition.key) : undefined;
    const dailySummary = activityMetric ? readDailySummary(entry.dailySummary, definition!.key) : null;
    if (kind === 'activity' && (!activityMetric || !dailySummary || entry.unit !== activityMetric.unit || (activityMetric.unit === '%' && numeric > 100))) continue;
    if (kind !== 'activity' && activityMetric) continue;
    resolved.set(label, {
      ...(dailySummary ? { dailySummary } : {}),
      metricKey: definition?.key || null,
      metricName: label,
      value: String(numeric),
      unit: (typeof entry.unit === 'string' ? entry.unit.trim() : '') || definition?.unit || null,
    });
  }
  return Array.from(resolved.values());
}

/** Shared by the preview and writer. Callers supply only the selected patient's rows. */
export function planMeasurementImport(input: {
  source: string;
  sessions: ImportedSession[];
  reports: ImportReport[];
  records: ImportRecord[];
}) {
  const reportsByKey = new Map<string, ImportReport>();
  for (const report of input.reports) {
    const key = importMetadata(report.extraData).importSourceKey;
    if (typeof key !== 'string') continue;
    // Archive restores can leave several reports for one activity day. Reuse the
    // same stable winner as the activity view, regardless of database row order.
    const previous = reportsByKey.get(key);
    if (!key.includes(':activity:') || !previous || report.id > previous.id) reportsByKey.set(key, report);
  }
  const recordsByReport = new Map<string, Map<string, ImportRecord>>();
  for (const record of input.records) {
    const byName = recordsByReport.get(record.reportId) ?? new Map<string, ImportRecord>();
    const previous = byName.get(record.metricName);
    if (!previous || record.id > previous.id) byName.set(record.metricName, record);
    recordsByReport.set(record.reportId, byName);
  }

  // A repeated source key within one payload must not create two reports.
  const uniqueSessions = new Map<string, { kind: ReportKind; measuredAt: string; entries: Map<string, ResolvedImportEntry> }>();
  let skippedSessions = 0;
  for (const session of input.sessions) {
    if (!session || !isImportableKind(session.kind) || typeof session.sourceKey !== 'string' || !session.sourceKey.trim()) {
      skippedSessions += 1;
      continue;
    }
    const measuredAt = new Date(session.measuredAt);
    const entries = resolveEntries(session.entries, session.kind);
    if (Number.isNaN(measuredAt.getTime()) || entries.length === 0) {
      skippedSessions += 1;
      continue;
    }
    if (session.kind === 'activity' && entries.some((entry) =>
      session.sourceKey !== `activity:${entry.dailySummary?.date}` || measuredAt.toISOString() !== `${entry.dailySummary?.date}T12:00:00.000Z`)) {
      skippedSessions += 1;
      continue;
    }
    const sourceKey = `${input.source}:${session.sourceKey}`;
    const combined = uniqueSessions.get(sourceKey) ?? { kind: session.kind, measuredAt: measuredAt.toISOString(), entries: new Map<string, ResolvedImportEntry>() };
    combined.measuredAt = measuredAt.toISOString();
    for (const entry of entries) combined.entries.set(entry.metricName, entry);
    uniqueSessions.set(sourceKey, combined);
  }

  const counts: ImportCounts = { newValues: 0, updatedValues: 0, duplicateValues: 0 };
  const sessions: PlannedSession[] = [];
  for (const [sourceKey, session] of uniqueSessions) {
    const existing = reportsByKey.get(sourceKey);
    const existingEntries = existing ? recordsByReport.get(existing.id) : undefined;
    const sameTime = existing && new Date(existing.testDate).getTime() === new Date(session.measuredAt).getTime();
    const entries = Array.from(session.entries.values()).map((entry): PlannedEntry => {
      const record = existingEntries?.get(entry.metricName);
      const sameSummary = !entry.dailySummary || JSON.stringify(readDailySummary(importMetadata(record?.extraData).dailySummary, entry.metricKey!)) === JSON.stringify(entry.dailySummary);
      const unchanged = record && sameTime && sameSummary && parseNumber(record.value) === Number(entry.value) && (record.unit?.trim() || null) === entry.unit;
      const action = !record ? 'insert' : unchanged ? 'skip' : 'update';
      if (action === 'insert') counts.newValues += 1;
      else if (action === 'update') counts.updatedValues += 1;
      else counts.duplicateValues += 1;
      return { ...entry, existingId: record?.id, action };
    });
    sessions.push({ existingId: existing?.id, sourceKey, kind: session.kind, measuredAt: session.measuredAt, entries });
  }
  return { sessions, counts, skippedSessions };
}
