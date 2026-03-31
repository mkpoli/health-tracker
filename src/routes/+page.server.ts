import { db } from '$lib/server/db';
import { patient, report, record } from '$lib/server/db/schema';
import { eq, desc, inArray, and } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { normalizeComparableMeasurement } from '$lib/metrics/normalization';
import { saveReviewedReport } from '$lib/server/report-review';
import { getOwnedPatient, getOwnedRecord, getOwnedReport, requireUserId } from '$lib/server/ownership';

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

export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = requireUserId(locals);
  const selectedPatientId = url.searchParams.get('patientId');

  const patients = await db
    .select()
    .from(patient)
    .where(eq(patient.ownerUserId, userId))
    .orderBy(desc(patient.id));

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
  createPatient: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const name = data.get('name')?.toString();
    const agab = data.get('agab')?.toString();
    const birthday = data.get('birthday')?.toString();

    if (!name) return fail(400, { error: 'Name is required' });

    const newPatient = await db.insert(patient).values({
      ownerUserId: userId,
      name,
      agab,
      birthday
    }).returning();

    return { success: true, patient: newPatient[0] };
  },

  addManualRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const type = data.get('type')?.toString();
    const value = data.get('value')?.toString();
    const date = data.get('date')?.toString();
    const notes = data.get('notes')?.toString();
    const facilityName = data.get('facilityName')?.toString().trim();

    if (!patientId || !type || !value) return fail(400, { error: 'Missing required fields' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    const newReport = await db.insert(report).values({
      patientId: ownedPatient.id,
      testDate: date || new Date().toISOString(),
      extraData: JSON.stringify({ facilityName: facilityName || null })
    }).returning();

    await db.insert(record).values({
      patientId: ownedPatient.id,
      reportId: newReport[0].id,
      metricName: type,
      value,
      status: 'Manual',
      extraData: JSON.stringify({ notes })
    });

    return { success: true };
  },

  addReport: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const patientId = data.get('patientId')?.toString();
    const metricsStr = data.get('metrics')?.toString();
    const reportFacility = data.get('reportFacility')?.toString();
    const reportTestDate = data.get('reportTestDate')?.toString();
    const targetReportId = data.get('targetReportId')?.toString();
    const reportRawSource = data.get('reportRawSource')?.toString();

    if (!patientId || !metricsStr) return fail(400, { error: 'Missing inputs' });

    const ownedPatient = await getOwnedPatient(userId, patientId);

    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    if (targetReportId) {
      const ownedReport = await getOwnedReport(userId, targetReportId);
      if (!ownedReport || ownedReport.patientId !== ownedPatient.id) {
        return fail(404, { error: 'Report not found' });
      }
    }

    const result = await saveReviewedReport({
      patientId: ownedPatient.id,
      metricsStr,
      reportFacility,
      reportTestDate,
      targetReportId,
      reportRawSource,
      deletedRecordIdsStr: data.get('deletedRecordIds')?.toString()
    });

    return { success: true, ...result };
  },

  updateRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const metricName = data.get('metricName')?.toString().trim();
    const value = data.get('value')?.toString();
    const status = data.get('status')?.toString();

    if (!id || !metricName || !value) return fail(400, { error: 'Missing required fields' });

    const current = await getOwnedRecord(userId, id);

    if (!current) return fail(404, { error: 'Record not found' });

    const existingExtraData = parseJsonLike(current.extraData);
    const { category: _legacyCategory, ...extraDataWithoutLegacyCategory } = existingExtraData;
    const fallbackComparable = normalizeComparableMeasurement(value, current.unit, current.refRange);

    await db.update(record).set({
      metricName,
      value,
      status,
      extraData: JSON.stringify({
        ...extraDataWithoutLegacyCategory,
        parsedLabel: metricName,
        comparableValue: fallbackComparable.comparableValue,
        comparableUnit: fallbackComparable.comparableUnit,
        comparableReferenceRange: fallbackComparable.comparableReferenceRange
      })
    }).where(eq(record.id, id));

    return { success: true };
  },

  updateReport: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const testDate = data.get('testDate')?.toString();
    const title = data.get('title')?.toString().trim();
    const facilityName = data.get('facilityName')?.toString().trim();
    const notes = data.get('notes')?.toString().trim();

    if (!id || !testDate) return fail(400, { error: 'Missing required fields' });

    const current = await getOwnedReport(userId, id);

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

  deleteReport: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedReport(userId, id);

    if (!current) return fail(404, { error: 'Report not found' });

    await db.delete(record).where(eq(record.reportId, id));
    await db.delete(report).where(eq(report.id, id));

    return { success: true };
  },

  deletePatient: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('patientId')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedPatient(userId, id);

    if (!current) return fail(404, { error: 'Patient not found' });

    await db.delete(record).where(eq(record.patientId, id));
    await db.delete(report).where(eq(report.patientId, id));
    await db.delete(patient).where(eq(patient.id, id));

    return { success: true };
  },

  deleteRecord: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const id = data.get('id')?.toString();

    if (!id) return fail(400, { error: 'Missing ID' });

    const current = await getOwnedRecord(userId, id);

    if (!current) return fail(404, { error: 'Record not found' });

    await db.delete(record).where(eq(record.id, id));

    return { success: true };
  },

  batchDeleteRecords: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const idsStr = data.get('ids')?.toString();

    if (!idsStr) return fail(400, { error: 'Missing IDs' });

    try {
      const ids = JSON.parse(idsStr);
      if (!Array.isArray(ids) || ids.length === 0) {
        return fail(400, { error: 'Invalid IDs array' });
      }

      const ownedRecords = await Promise.all(ids.map((id) => getOwnedRecord(userId, String(id))));
      const ownedIds = ownedRecords.map((item) => item?.id).filter(Boolean) as string[];

      if (ownedIds.length === 0) {
        return fail(404, { error: 'No matching records found' });
      }

      await db.delete(record).where(inArray(record.id, ownedIds));
      return { success: true };
    } catch (e) {
      return fail(400, { error: 'Failed to process batch deletion' });
    }
  }
};
