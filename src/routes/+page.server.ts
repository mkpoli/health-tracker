import { db } from '$lib/server/db';
import { patient, report, record } from '$lib/server/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
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

export const load: PageServerLoad = async ({ url }) => {
  const selectedPatientId = url.searchParams.get('patientId');

  const patients = await db.select().from(patient).orderBy(desc(patient.id));

  let currentPatient = null;
  let recordsList: typeof record.$inferSelect[] = [];
  let reportsList: typeof report.$inferSelect[] = [];

  if (patients.length > 0) {
    const targetId = selectedPatientId || patients[0].id;
    currentPatient = patients.find(p => p.id === targetId) || patients[0];

    recordsList = await db
      .select()
      .from(record)
      .where(eq(record.patientId, currentPatient.id))
      .orderBy(desc(record.id));

    reportsList = await db
      .select()
      .from(report)
      .where(eq(report.patientId, currentPatient.id))
      .orderBy(desc(report.testDate));
  }

  return {
    patients,
    currentPatient,
    records: recordsList,
    reports: reportsList
  };
};

export const actions: Actions = {
  createPatient: async ({ request }) => {
    const data = await request.formData();
    const name = data.get('name')?.toString();
    const agab = data.get('agab')?.toString();
    const birthday = data.get('birthday')?.toString();

    if (!name) return fail(400, { error: 'Name is required' });

    const newPatient = await db.insert(patient).values({
      name,
      agab,
      birthday
    }).returning();

    return { success: true, patient: newPatient[0] };
  },

  addManualRecord: async ({ request }) => {
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const type = data.get('type')?.toString();
    const value = data.get('value')?.toString();
    const date = data.get('date')?.toString();
    const notes = data.get('notes')?.toString();
    const facilityName = data.get('facilityName')?.toString().trim();

    if (!patientId || !type || !value) return fail(400, { error: 'Missing required fields' });

    const newReport = await db.insert(report).values({
      patientId,
      testDate: date || new Date().toISOString(),
      extraData: JSON.stringify({ facilityName: facilityName || null })
    }).returning();

    await db.insert(record).values({
      patientId,
      reportId: newReport[0].id,
      metricName: type,
      value,
      status: 'Manual',
      extraData: JSON.stringify({ notes })
    });

    return { success: true };
  },

  addReport: async ({ request }) => {
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const metricsStr = data.get('metrics')?.toString();
    const reportFacility = data.get('reportFacility')?.toString().trim();
    const reportTestDate = data.get('reportTestDate')?.toString();

    if (!patientId || !metricsStr) return fail(400, { error: 'Missing inputs' });

    const metrics = JSON.parse(metricsStr);

    const newReport = await db.insert(report).values({
      patientId,
      testDate: normalizeReportDate(reportTestDate),
      parsedJsonData: metricsStr,
      extraData: JSON.stringify({ facilityName: reportFacility || null })
    }).returning();

    for (const m of metrics) {
      const originalLabel = m.originalLabel || m.label || null;
      const parsedLabel = m.parsedLabel || m.label || m.type || 'Other';
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
        reportId: newReport[0].id,
        metricName: parsedLabel,
        value: String(m.value) || 'N/A',
        unit: m.unit || null,
        refRange: m.referenceRange || null,
        status: m.status || 'Review Required',
        extraData: JSON.stringify({
          notes: m.notes,
          category: m.type,
          originalLabel,
          parsedLabel,
          comparableValue: Number.isFinite(comparableValue) ? comparableValue : null,
          comparableUnit,
          comparableReferenceRange
        })
      });
    }
    return { success: true };
  },

  updateRecord: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const metricName = data.get('metricName')?.toString().trim();
    const value = data.get('value')?.toString();
    const status = data.get('status')?.toString();

    if (!id || !metricName || !value) return fail(400, { error: 'Missing required fields' });

    const existingRecord = await db.select().from(record).where(eq(record.id, id));
    const current = existingRecord[0];

    if (!current) return fail(404, { error: 'Record not found' });

    const existingExtraData = parseJsonLike(current.extraData);
    const fallbackComparable = normalizeComparableMeasurement(value, current.unit, current.refRange);

    await db.update(record).set({
      metricName,
      value,
      status,
      extraData: JSON.stringify({
        ...existingExtraData,
        parsedLabel: metricName,
        comparableValue: fallbackComparable.comparableValue,
        comparableUnit: fallbackComparable.comparableUnit,
        comparableReferenceRange: fallbackComparable.comparableReferenceRange
      })
    }).where(eq(record.id, id));

    return { success: true };
  },

  updateReport: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const testDate = data.get('testDate')?.toString();
    const title = data.get('title')?.toString().trim();
    const facilityName = data.get('facilityName')?.toString().trim();
    const notes = data.get('notes')?.toString().trim();

    if (!id || !testDate) return fail(400, { error: 'Missing required fields' });

    const existingReport = await db.select().from(report).where(eq(report.id, id));
    const current = existingReport[0];

    if (!current) return fail(404, { error: 'Report not found' });

    const existingExtraData = parseJsonLike(current.extraData);

    await db.update(report).set({
      testDate,
      extraData: JSON.stringify({
        ...existingExtraData,
        title: title || null,
        facilityName: facilityName || null,
        notes: notes || null
      })
    }).where(eq(report.id, id));

    return { success: true };
  },

  deleteReport: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    await db.delete(record).where(eq(record.reportId, id));
    await db.delete(report).where(eq(report.id, id));

    return { success: true };
  },

  deletePatient: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('patientId')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    await db.delete(record).where(eq(record.patientId, id));
    await db.delete(report).where(eq(report.patientId, id));
    await db.delete(patient).where(eq(patient.id, id));

    return { success: true };
  },

  deleteRecord: async ({ request }) => {
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    await db.delete(record).where(eq(record.id, id));

    return { success: true };
  },

  batchDeleteRecords: async ({ request }) => {
    const data = await request.formData();
    const idsStr = data.get('ids')?.toString();

    if (!idsStr) return fail(400, { error: 'Missing IDs' });

    try {
      const ids = JSON.parse(idsStr);
      if (!Array.isArray(ids) || ids.length === 0) {
        return fail(400, { error: 'Invalid IDs array' });
      }

      await db.delete(record).where(inArray(record.id, ids));
      return { success: true };
    } catch (e) {
      return fail(400, { error: 'Failed to process batch deletion' });
    }
  }
};
