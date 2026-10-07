import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { record, report } from '$lib/server/db/schema';
import { normalizeComparableMeasurement } from '$lib/metrics/normalization';
import type { ReportKind } from '$lib/report-kind';

import {
  importMetadata as parseJsonLike,
  planMeasurementImport,
  type ImportedSession,
  type ImportCounts,
  type ResolvedImportEntry,
} from '$lib/import/measurement-plan';

// Bulk path for imported data. Unlike the interactive save, this writes many
// sessions at once and has to survive being run twice on the same export, so
// each session carries the source's own identity and is matched on it.

export type { ImportedSession } from '$lib/import/measurement-plan';

export type ImportResult = ImportCounts & {
  createdSessions: number;
  updatedSessions: number;
  writtenValues: number;
  skippedSessions: number;
};

const MAX_SESSIONS = 5000;

function buildExtraData(
  entry: ResolvedImportEntry,
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

export async function importMeasurementSessions(input: {
  patientId: string;
  source: string;
  sessions: ImportedSession[];
}): Promise<ImportResult> {
  const sessions = input.sessions.slice(0, MAX_SESSIONS);
  const existingReports = await db.select().from(report).where(eq(report.patientId, input.patientId));
  const sourceKeys = new Set(sessions.filter(Boolean).map((session) => `${input.source}:${session.sourceKey}`));
  const reusedReportIds = existingReports
    .filter((item) => sourceKeys.has(String(parseJsonLike(item.extraData).importSourceKey)))
    .map((item) => item.id);
  const existingRecords: typeof record.$inferSelect[] = [];
  for (const chunk of chunked(reusedReportIds, 200)) {
    existingRecords.push(...await db.select().from(record).where(and(
      eq(record.patientId, input.patientId), inArray(record.reportId, chunk),
    )));
  }
  const plan = planMeasurementImport({ source: input.source, sessions, reports: existingReports, records: existingRecords });
  const result: ImportResult = {
    ...plan.counts,
    createdSessions: 0,
    updatedSessions: 0,
    writtenValues: plan.counts.newValues + plan.counts.updatedValues,
    skippedSessions: plan.skippedSessions,
  };
  const reportsToInsert: Array<{ id: string; kind: ReportKind; testDate: string; sourceKey: string }> = [];
  const recordsToInsert: Array<{ id: string; reportId: string; metricName: string; value: string; unit: string | null; extraData: string }> = [];
  const reportsToTouch: Array<{ id: string; testDate: string }> = [];
  const recordsToUpdate: Array<{ id: string; value: string; unit: string | null; extraData: string }> = [];

  for (const session of plan.sessions) {
    const changedEntries = session.entries.filter((entry) => entry.action !== 'skip');
    if (changedEntries.length === 0) continue;
    const id = session.existingId ?? crypto.randomUUID();
    if (session.existingId) {
      reportsToTouch.push({ id, testDate: session.measuredAt });
      result.updatedSessions += 1;
    } else {
      reportsToInsert.push({ id, kind: session.kind, testDate: session.measuredAt, sourceKey: session.sourceKey });
      result.createdSessions += 1;
    }
    for (const entry of changedEntries) {
      const extraData = buildExtraData(entry, input.source);
      if (entry.existingId) {
        recordsToUpdate.push({ id: entry.existingId, value: entry.value, unit: entry.unit, extraData });
      } else {
        recordsToInsert.push({ id: crypto.randomUUID(), reportId: id, metricName: entry.metricName, value: entry.value, unit: entry.unit, extraData });
      }
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
