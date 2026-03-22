import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { record, report } from '$lib/server/db/schema';
import { getMetricDefinition, getMetricTags } from '$lib/metrics/catalog';
import { normalizeComparableMeasurement } from '$lib/metrics/normalization';

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

function normalizeReportDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return new Date().toISOString();

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();

  return parsed.toISOString();
}

function normalizeMetricMatchKey(value: unknown) {
  if (typeof value !== 'string') return '';

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDerivedCategory(label?: string | null) {
  const definition = getMetricDefinition(label);
  const tags = getMetricTags(definition);
  return tags.categories[0] || 'other';
}

export async function saveReviewedReport(input: {
  patientId: string;
  metricsStr: string;
  reportFacility?: string;
  reportTestDate?: string;
  targetReportId?: string;
  reportRawSource?: string;
  deletedRecordIdsStr?: string;
}) {
  const patientId = input.patientId;
  const reportFacility = input.reportFacility?.trim();
  const requestedReportDate = normalizeReportDate(input.reportTestDate);
  const targetReportId = input.targetReportId;
  const reportRawSource = input.reportRawSource;
  const deletedRecordIds = input.deletedRecordIdsStr ? JSON.parse(input.deletedRecordIdsStr) : [];

  const metrics = JSON.parse(input.metricsStr);
  const patientRecords = await db.select().from(record).where(eq(record.patientId, patientId));
  const patientRecordMap = new Map(patientRecords.map((item) => [item.id, item]));
  const patientReports = await db.select().from(report).where(eq(report.patientId, patientId));
  const patientReportMap = new Map(patientReports.map((item) => [item.id, item]));

  if (Array.isArray(deletedRecordIds) && deletedRecordIds.length > 0) {
    for (const recordId of deletedRecordIds) {
      const existingRecord = patientRecordMap.get(String(recordId));
      if (!existingRecord) continue;
      await db.delete(record).where(eq(record.id, existingRecord.id));
      patientRecordMap.delete(existingRecord.id);
    }
  }

  const metricsToCreate: any[] = [];
  const metricsToUpdate: Array<{ metric: any; targetRecordId: string }> = [];

  for (const metric of metrics) {
    const requestedTargetId = metric.matchedRecordId?.toString();
    const requestedMode = metric.saveMode === 'update' ? 'update' : 'create';

    if (requestedMode !== 'update') {
      metricsToCreate.push(metric);
      continue;
    }

    const requestedTarget = requestedTargetId ? patientRecordMap.get(requestedTargetId) : null;
    if (requestedTarget) {
      metricsToUpdate.push({ metric, targetRecordId: requestedTarget.id });
      continue;
    }

    const metricKeys = [metric.parsedLabel, metric.originalLabel, metric.label, metric.type]
      .map(normalizeMetricMatchKey)
      .filter(Boolean);

    const fallbackTarget = patientRecords.find((item) => {
      const metadata = parseJsonLike(item.extraData);
      const candidateKeys = [item.metricName, metadata.parsedLabel, metadata.originalLabel]
        .map(normalizeMetricMatchKey)
        .filter(Boolean);

      return metricKeys.some((key) => candidateKeys.includes(key));
    });

    if (fallbackTarget) {
      metricsToUpdate.push({ metric, targetRecordId: fallbackTarget.id });
    } else {
      metricsToCreate.push(metric);
    }
  }

  const targetExistingReport = targetReportId ? patientReportMap.get(targetReportId) || null : null;
  let createdReport: typeof report.$inferSelect | null = null;

  if (metricsToCreate.length > 0 && !targetExistingReport) {
    const insertedReports = await db.insert(report).values({
      patientId,
      testDate: requestedReportDate,
      rawData: reportRawSource || null,
      parsedJsonData: JSON.stringify(metricsToCreate),
      extraData: JSON.stringify({ facilityName: reportFacility || null }),
    }).returning();

    createdReport = insertedReports[0] || null;
  }

  for (const m of metricsToCreate) {
    const originalLabel = m.originalLabel || m.label || null;
    const parsedLabel = m.parsedLabel || m.label || m.type || 'Other';
    const derivedCategory = getDerivedCategory(parsedLabel);
    const fallbackComparable = normalizeComparableMeasurement(m.value, m.unit, m.referenceRange);
    const explicitComparableValue =
      m.comparableValue === '' || m.comparableValue === null || m.comparableValue === undefined
        ? null
        : Number(m.comparableValue);
    const comparableValue = Number.isFinite(explicitComparableValue)
      ? explicitComparableValue
      : fallbackComparable.comparableValue;
    const comparableUnit = m.comparableUnit || fallbackComparable.comparableUnit || null;
    const comparableReferenceRange =
      m.comparableReferenceRange || fallbackComparable.comparableReferenceRange || null;

    await db.insert(record).values({
      patientId,
      reportId: targetExistingReport?.id || createdReport!.id,
      metricName: parsedLabel,
      value: String(m.value) || 'N/A',
      unit: m.unit || null,
      refRange: m.referenceRange || null,
      status: m.status || 'Review Required',
      extraData: JSON.stringify({
        notes: m.notes,
        derivedCategory,
        originalLabel,
        parsedLabel,
        comparableValue: Number.isFinite(comparableValue) ? comparableValue : null,
        comparableUnit,
        comparableReferenceRange,
      }),
    });
  }

  for (const { metric: m, targetRecordId } of metricsToUpdate) {
    const existingRecord = patientRecordMap.get(targetRecordId);
    if (!existingRecord) continue;

    const originalLabel = m.originalLabel || m.label || null;
    const parsedLabel = m.parsedLabel || m.label || m.type || existingRecord.metricName;
    const fallbackComparable = normalizeComparableMeasurement(m.value, m.unit, m.referenceRange);
    const explicitComparableValue =
      m.comparableValue === '' || m.comparableValue === null || m.comparableValue === undefined
        ? null
        : Number(m.comparableValue);
    const comparableValue = Number.isFinite(explicitComparableValue)
      ? explicitComparableValue
      : fallbackComparable.comparableValue;
    const comparableUnit = m.comparableUnit || fallbackComparable.comparableUnit || null;
    const comparableReferenceRange =
      m.comparableReferenceRange || fallbackComparable.comparableReferenceRange || null;
    const existingExtraData = parseJsonLike(existingRecord.extraData);
    const { category: _legacyCategory, ...extraDataWithoutLegacyCategory } = existingExtraData;
    const derivedCategory = getDerivedCategory(parsedLabel);

    await db.update(record).set({
      metricName: parsedLabel,
      value: String(m.value) || 'N/A',
      unit: m.unit || null,
      refRange: m.referenceRange || null,
      status: m.status || 'Review Required',
      extraData: JSON.stringify({
        ...extraDataWithoutLegacyCategory,
        notes: m.notes,
        derivedCategory,
        originalLabel,
        parsedLabel,
        comparableValue: Number.isFinite(comparableValue) ? comparableValue : null,
        comparableUnit,
        comparableReferenceRange,
        lastReviewedSourceDate: requestedReportDate,
        lastReviewedSourceFacility: reportFacility || null,
      }),
    }).where(eq(record.id, targetRecordId));
  }

  if (targetExistingReport) {
    const existingExtraData = parseJsonLike(targetExistingReport.extraData);

    await db.update(report).set({
      testDate: requestedReportDate,
      rawData: reportRawSource || targetExistingReport.rawData || null,
      parsedJsonData: JSON.stringify(metrics),
      extraData: JSON.stringify({
        ...existingExtraData,
        facilityName: reportFacility || existingExtraData.facilityName || null,
      }),
    }).where(eq(report.id, targetExistingReport.id));
  }

  return {
    createdCount: metricsToCreate.length,
    updatedCount: metricsToUpdate.length,
    targetReportId: targetExistingReport?.id || createdReport?.id || null,
  };
}
