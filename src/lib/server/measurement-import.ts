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

    await db.transaction(async (tx) => {
      let reportId = existingId;

      if (reportId) {
        await tx
          .update(report)
          .set({ testDate: measuredAt.toISOString() })
          .where(eq(report.id, reportId));
        result.updatedSessions += 1;
      } else {
        const inserted = await tx
          .insert(report)
          .values({
            patientId: input.patientId,
            kind: session.kind,
            testDate: measuredAt.toISOString(),
            extraData: JSON.stringify({ importedFrom: input.source, importSourceKey: sourceKey }),
          })
          .returning();

        reportId = inserted[0].id;
        result.createdSessions += 1;
      }

      const existingRecords = await tx.select().from(record).where(eq(record.reportId, reportId));
      const byName = new Map(existingRecords.map((item) => [item.metricName, item]));

      for (const entry of entries) {
        const current = byName.get(entry.metricName);

        if (current) {
          await tx
            .update(record)
            .set({ value: entry.value, unit: entry.unit, extraData: buildExtraData(entry, input.source) })
            .where(eq(record.id, current.id));
        } else {
          await tx.insert(record).values({
            patientId: input.patientId,
            reportId,
            metricName: entry.metricName,
            value: entry.value,
            unit: entry.unit,
            status: null,
            extraData: buildExtraData(entry, input.source),
          });
        }

        result.writtenValues += 1;
      }
    });
  }

  return result;
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
