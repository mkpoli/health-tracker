import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { record, report } from '$lib/server/db/schema';
import { getMetricDefinitionByKey, getMetricDefinition, getMetricTags } from '$lib/metrics/catalog';
import { normalizeComparableMeasurement, parseNumber } from '$lib/metrics/normalization';
import { isMeasurementKind, type ReportKind } from '$lib/report-kind';

export type BodyMeasurementEntry = {
  /** Catalog key, when the measurement comes from the body-metric catalog. */
  key?: string | null;
  /** Free-form name, for a measurement the catalog does not cover. */
  label?: string | null;
  value: string | number;
  unit?: string | null;
  notes?: string | null;
};

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

/**
 * The client submits a resolved instant, so a missing or unparseable value is a
 * broken request rather than something to paper over with the current time —
 * silently stamping "now" onto a back-dated weigh-in corrupts the history.
 */
export function parseMeasuredAt(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

type ResolvedEntry = {
  metricKey: string | null;
  metricName: string;
  value: string;
  unit: string | null;
  notes: string | null;
};

const MAX_ENTRIES = 300;
const MAX_TEXT_LENGTH = 200;

/** Everything submitted was rejected — the caller must not report a save. */
export class InvalidMeasurementsError extends Error {
  constructor() {
    super('No valid measurements in payload');
    this.name = 'InvalidMeasurementsError';
  }
}

function readText(value: unknown, limit = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, limit);
}

/**
 * The payload arrives as untrusted JSON, so each entry is narrowed here rather
 * than trusted from the client: anything that is not a string key/label with a
 * finite numeric value is dropped instead of reaching the database.
 */
export function resolveEntries(entries: unknown): ResolvedEntry[] {
  if (!Array.isArray(entries)) return [];

  const resolved = new Map<string, ResolvedEntry>();

  for (const raw of entries.slice(0, MAX_ENTRIES)) {
    if (!raw || typeof raw !== 'object') continue;

    const entry = raw as Record<string, unknown>;
    const rawValue = typeof entry.value === 'number' ? String(entry.value) : readText(entry.value, 60);

    if (rawValue === null) continue;

    // The same parse the trend pipeline uses, so a value that saves is a value
    // that charts — "1e3" would otherwise store fine and then never plot.
    const numericValue = parseNumber(rawValue);
    if (numericValue === null || numericValue < 0) continue;

    const key = readText(entry.key, 80);
    const definition = key ? getMetricDefinitionByKey(key) : null;
    const label = definition?.canonicalLabel || readText(entry.label);
    if (!label) continue;

    const metricKey = definition?.key || getMetricDefinition(label).key;
    const unit = readText(entry.unit, 24) ?? definition?.unit ?? null;

    // A catalog entry wins over a free-form row that resolves to the same
    // metric, so typing "Body Weight" as a custom row cannot shadow the field.
    const existing = resolved.get(metricKey);
    if (existing && !definition) continue;

    resolved.set(metricKey, {
      metricKey: definition?.key || null,
      metricName: label,
      value: rawValue,
      unit,
      notes: readText(entry.notes, 500),
    });
  }

  return Array.from(resolved.values());
}

function buildRecordExtraData(entry: ResolvedEntry, previous?: Record<string, unknown>) {
  const comparable = normalizeComparableMeasurement(entry.value, entry.unit, null);
  const tags = getMetricTags(getMetricDefinition(entry.metricName));

  return JSON.stringify({
    ...previous,
    metricKey: entry.metricKey,
    parsedLabel: entry.metricName,
    originalLabel: entry.metricName,
    derivedCategory: tags.categories[0] || 'other',
    notes: entry.notes,
    comparableValue: comparable.comparableValue,
    comparableUnit: comparable.comparableUnit,
    comparableReferenceRange: comparable.comparableReferenceRange,
  });
}

export async function saveMeasurementSession(input: {
  kind: ReportKind;
  patientId: string;
  sessionId?: string | null;
  measuredAt: string;
  notes?: string | null;
  entries: unknown;
}) {
  const measuredAt = input.measuredAt;
  const notes = input.notes?.trim() || null;
  const entries = resolveEntries(input.entries);

  if (entries.length === 0) {
    throw new InvalidMeasurementsError();
  }

  return db.transaction(async (tx) => {
    let sessionId = input.sessionId || null;

    if (sessionId) {
      // Scoped to body sessions of this patient: a clinical report reaching
      // this path would have its records pruned to the submitted entries.
      const existing = await tx
        .select()
        .from(report)
        .where(
          and(
            eq(report.id, sessionId),
            eq(report.patientId, input.patientId),
            eq(report.kind, input.kind),
          ),
        );
      const current = existing[0];

      if (!current) {
        throw new Error('Measurement session not found');
      }

      await tx
        .update(report)
        .set({
          testDate: measuredAt,
          extraData: JSON.stringify({ ...parseJsonLike(current.extraData), notes }),
        })
        .where(eq(report.id, current.id));
    }

    if (!sessionId) {
      const inserted = await tx
        .insert(report)
        .values({
          patientId: input.patientId,
          kind: input.kind,
          testDate: measuredAt,
          extraData: JSON.stringify({ notes }),
        })
        .returning();

      sessionId = inserted[0].id;
    }

    const existingRecords = await tx.select().from(record).where(eq(record.reportId, sessionId));
    const existingByName = new Map(existingRecords.map((item) => [item.metricName, item]));
    const submittedNames = new Set(entries.map((entry) => entry.metricName));

    let removedCount = 0;

    for (const existing of existingRecords) {
      if (submittedNames.has(existing.metricName)) continue;
      await tx.delete(record).where(eq(record.id, existing.id));
      removedCount += 1;
    }

    for (const entry of entries) {
      const existing = existingByName.get(entry.metricName);

      if (existing) {
        await tx
          .update(record)
          .set({
            value: entry.value,
            unit: entry.unit,
            extraData: buildRecordExtraData(entry, parseJsonLike(existing.extraData)),
          })
          .where(eq(record.id, existing.id));
        continue;
      }

      await tx.insert(record).values({
        patientId: input.patientId,
        reportId: sessionId,
        metricName: entry.metricName,
        value: entry.value,
        unit: entry.unit,
        status: null,
        extraData: buildRecordExtraData(entry),
      });
    }

    return { sessionId, savedCount: entries.length, removedCount };
  });
}

export async function deleteMeasurementSession(patientId: string, sessionId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(report)
      .where(and(eq(report.id, sessionId), eq(report.patientId, patientId)));

    // Only hand-entered sessions; a clinical report is deleted through its own
    // action so its stored source document is handled too.
    if (!rows[0] || !isMeasurementKind(rows[0].kind)) return false;

    await tx.delete(record).where(eq(record.reportId, sessionId));
    await tx.delete(report).where(eq(report.id, sessionId));

    return true;
  });
}
