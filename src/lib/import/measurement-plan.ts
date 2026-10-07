import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
import { parseNumber } from '$lib/metrics/normalization';
import { isMeasurementKind, type ReportKind } from '$lib/report-kind';

export type ImportedSession = {
  kind: ReportKind;
  measuredAt: string;
  sourceKey: string;
  entries: Array<{ key?: string; label?: string; value: string | number; unit?: string | null }>;
};

export type ImportReport = { id: string; testDate: string; extraData: unknown };
export type ImportRecord = { id: string; reportId: string; metricName: string; value: string; unit: string | null };
export type ImportCounts = { newValues: number; updatedValues: number; duplicateValues: number };
export type ResolvedImportEntry = { metricKey: string | null; metricName: string; value: string; unit: string | null };
type PlannedEntry = ResolvedImportEntry & { existingId?: string; action: 'insert' | 'update' | 'skip' };
type PlannedSession = { existingId?: string; sourceKey: string; kind: ReportKind; measuredAt: string; entries: PlannedEntry[] };

export function importMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return importMetadata(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function resolveEntries(entries: ImportedSession['entries']): ResolvedImportEntry[] {
  const resolved = new Map<string, ResolvedImportEntry>();
  if (!Array.isArray(entries)) return [];
  for (const entry of entries.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const numeric = parseNumber(typeof entry.value === 'number' ? entry.value : String(entry.value ?? ''));
    if (numeric === null || numeric < 0) continue;
    const definition = typeof entry.key === 'string' ? getMetricDefinitionByKey(entry.key) : null;
    const label = definition?.canonicalLabel || (typeof entry.label === 'string' ? entry.label.trim() : '');
    if (!label) continue;
    resolved.set(label, {
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
    if (typeof key === 'string') reportsByKey.set(key, report);
  }
  const recordsByReport = new Map<string, Map<string, ImportRecord>>();
  for (const record of input.records) {
    const byName = recordsByReport.get(record.reportId) ?? new Map<string, ImportRecord>();
    byName.set(record.metricName, record);
    recordsByReport.set(record.reportId, byName);
  }

  // A repeated source key within one payload must not create two reports.
  const uniqueSessions = new Map<string, { kind: ReportKind; measuredAt: string; entries: Map<string, ResolvedImportEntry> }>();
  let skippedSessions = 0;
  for (const session of input.sessions) {
    if (!session || !isMeasurementKind(session.kind) || typeof session.sourceKey !== 'string' || !session.sourceKey.trim()) {
      skippedSessions += 1;
      continue;
    }
    const measuredAt = new Date(session.measuredAt);
    const entries = resolveEntries(session.entries);
    if (Number.isNaN(measuredAt.getTime()) || entries.length === 0) {
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
      const unchanged = record && sameTime && parseNumber(record.value) === Number(entry.value) && (record.unit?.trim() || null) === entry.unit;
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
