import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { record, report } from '$lib/server/db/schema';
import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
import { normalizeComparableMeasurement, parseNumber } from '$lib/metrics/normalization';
import { isMeasurementKind, type ReportKind } from '$lib/report-kind';

// Bulk path for imported data. Unlike the interactive save, this writes many
// sessions at once and has to survive being run twice on the same export, so
// each session carries the source's own identity and is matched on it.

export type ImportedSession = {
  kind: ReportKind;
  measuredAt: string;
  sourceKey: string;
  entries: Array<{ key?: string; label?: string; value: string | number; unit?: string | null }>;
};

export type ImportResult = {
  createdSessions: number;
  updatedSessions: number;
  writtenValues: number;
  skippedSessions: number;
};

const MAX_SESSIONS = 5000;

function resolveEntries(entries: ImportedSession['entries']) {
  const resolved = new Map<string, { metricKey: string | null; metricName: string; value: string; unit: string | null }>();

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

function buildExtraData(
  entry: { metricKey: string | null; metricName: string; value: string; unit: string | null },
  source: string,
) {
  const comparable = normalizeComparableMeasurement(entry.value, entry.unit, null);

  return JSON.stringify({
    metricKey: entry.metricKey,
    parsedLabel: entry.metricName,
    originalLabel: entry.metricName,
    importedFrom: source,
    comparableValue: comparable.comparableValue,
    comparableUnit: comparable.comparableUnit,
    comparableReferenceRange: comparable.comparableReferenceRange,
  });
}

function parseJsonLike(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === 'object') return value as Record<string, unknown>;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }

  return {} as Record<string, unknown>;
}

export async function importMeasurementSessions(input: {
  patientId: string;
  source: string;
  sessions: ImportedSession[];
}): Promise<ImportResult> {
  const sessions = input.sessions.slice(0, MAX_SESSIONS);

  const result: ImportResult = {
    createdSessions: 0,
    updatedSessions: 0,
    writtenValues: 0,
    skippedSessions: 0,
  };

  // Existing imported sessions for this patient, so running the same export
  // twice updates in place instead of duplicating every day.
  const existingReports = await db.select().from(report).where(eq(report.patientId, input.patientId));
  const bySourceKey = new Map<string, string>();

  for (const existing of existingReports) {
    const extra = parseJsonLike(existing.extraData);
    if (typeof extra.importSourceKey === 'string') bySourceKey.set(extra.importSourceKey, existing.id);
  }

  // Everything is planned in memory first, then sent as a handful of batched
  // statements. Writing a row at a time inside a transaction per session meant
  // roughly a thousand network round trips to a remote database for one import,
  // which took minutes rather than seconds.
  type PlannedReport = { id: string; kind: ReportKind; testDate: string; sourceKey: string };
  type PlannedRecord = {
    id: string;
    reportId: string;
    metricName: string;
    value: string;
    unit: string | null;
    extraData: string;
  };

  const reportsToInsert: PlannedReport[] = [];
  const recordsToInsert: PlannedRecord[] = [];
  const reportsToTouch: Array<{ id: string; testDate: string }> = [];
  const recordsToUpdate: Array<{ id: string; value: string; unit: string | null; extraData: string }> = [];

  const reusedReportIds: string[] = [];
  const plannedBySession: Array<{ reportId: string; entries: ReturnType<typeof resolveEntries>; reused: boolean }> = [];

  for (const session of sessions) {
    if (!isMeasurementKind(session.kind)) {
      result.skippedSessions += 1;
      continue;
    }

    const measuredAt = new Date(session.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) {
      result.skippedSessions += 1;
      continue;
    }

    const entries = resolveEntries(session.entries);
    if (entries.length === 0) {
      result.skippedSessions += 1;
      continue;
    }

    const sourceKey = `${input.source}:${session.sourceKey}`;
    const existingId = bySourceKey.get(sourceKey);

    if (existingId) {
      reportsToTouch.push({ id: existingId, testDate: measuredAt.toISOString() });
      reusedReportIds.push(existingId);
      plannedBySession.push({ reportId: existingId, entries, reused: true });
      result.updatedSessions += 1;
    } else {
      const id = crypto.randomUUID();
      reportsToInsert.push({
        id,
        kind: session.kind,
        testDate: measuredAt.toISOString(),
        sourceKey,
      });
      plannedBySession.push({ reportId: id, entries, reused: false });
      result.createdSessions += 1;
    }
  }

  // Records of the sessions being re-imported, fetched in one query rather than
  // one per session.
  const existingRecordsByReport = new Map<string, Map<string, string>>();

  if (reusedReportIds.length > 0) {
    for (const chunk of chunked(reusedReportIds, 200)) {
      const rows = await db.select().from(record).where(inArray(record.reportId, chunk));

      for (const row of rows) {
        const byName = existingRecordsByReport.get(row.reportId) ?? new Map<string, string>();
        byName.set(row.metricName, row.id);
        existingRecordsByReport.set(row.reportId, byName);
      }
    }
  }

  for (const planned of plannedBySession) {
    const existingByName = planned.reused ? existingRecordsByReport.get(planned.reportId) : undefined;

    for (const entry of planned.entries) {
      const extraData = buildExtraData(entry, input.source);
      const existingRecordId = existingByName?.get(entry.metricName);

      if (existingRecordId) {
        recordsToUpdate.push({ id: existingRecordId, value: entry.value, unit: entry.unit, extraData });
      } else {
        recordsToInsert.push({
          id: crypto.randomUUID(),
          reportId: planned.reportId,
          metricName: entry.metricName,
          value: entry.value,
          unit: entry.unit,
          extraData,
        });
      }

      result.writtenValues += 1;
    }
  }

  // Reports before their records, so the foreign key holds within the batch.
  for (const chunk of chunked(reportsToInsert, 100)) {
    await db.insert(report).values(
      chunk.map((item) => ({
        id: item.id,
        patientId: input.patientId,
        kind: item.kind,
        testDate: item.testDate,
        extraData: JSON.stringify({ importedFrom: input.source, importSourceKey: item.sourceKey }),
      })),
    );
  }

  for (const chunk of chunked(recordsToInsert, 100)) {
    await db.insert(record).values(
      chunk.map((item) => ({
        id: item.id,
        patientId: input.patientId,
        reportId: item.reportId,
        metricName: item.metricName,
        value: item.value,
        unit: item.unit,
        status: null,
        extraData: item.extraData,
      })),
    );
  }

  for (const chunk of chunked(reportsToTouch, 50)) {
    await db.batch(
      chunk.map((item) => db.update(report).set({ testDate: item.testDate }).where(eq(report.id, item.id))) as never,
    );
  }

  for (const chunk of chunked(recordsToUpdate, 50)) {
    await db.batch(
      chunk.map((item) =>
        db
          .update(record)
          .set({ value: item.value, unit: item.unit, extraData: item.extraData })
          .where(eq(record.id, item.id)),
      ) as never,
    );
  }

  return result;
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Sessions already imported from this source, so the UI can offer to replace them. */
export async function countImportedSessions(patientId: string, source: string) {
  const rows = await db
    .select()
    .from(report)
    .where(and(eq(report.patientId, patientId)));

  return rows.filter((row) => {
    const extra = parseJsonLike(row.extraData);
    return extra.importedFrom === source;
  }).length;
}

export async function deleteImportedSessions(patientId: string, source: string) {
  const rows = await db.select().from(report).where(eq(report.patientId, patientId));
  const ids = rows
    .filter((row) => parseJsonLike(row.extraData).importedFrom === source)
    .map((row) => row.id);

  if (ids.length === 0) return 0;

  await db.delete(record).where(inArray(record.reportId, ids));
  await db.delete(report).where(inArray(report.id, ids));

  return ids.length;
}
