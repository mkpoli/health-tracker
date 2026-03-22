import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { patient, report, record } from '$lib/server/db/schema';
import { resolveStoredReportSource } from '$lib/server/extraction';
import { saveReviewedReport } from '$lib/server/report-review';

export const load: PageServerLoad = async ({ params }) => {
  const reportResult = await db.select().from(report).where(eq(report.id, params.reportId));
  const currentReport = reportResult[0];

  if (!currentReport) throw redirect(303, '/');

  const patientResult = await db.select().from(patient).where(eq(patient.id, currentReport.patientId));
  const currentPatient = patientResult[0];

  if (!currentPatient) throw redirect(303, '/');

  const reportRecords = await db.select().from(record).where(and(eq(record.reportId, currentReport.id), eq(record.patientId, currentPatient.id))).orderBy(desc(record.id));

  return {
    currentPatient,
    report: {
      ...currentReport,
      rawData: resolveStoredReportSource(typeof currentReport.rawData === 'string' ? currentReport.rawData : null),
    },
    records: reportRecords,
  };
};

export const actions: Actions = {
  save: async ({ request, params }) => {
    const data = await request.formData();
    const metricsStr = data.get('metrics')?.toString();

    if (!metricsStr) return fail(400, { error: 'Missing metrics' });

    const reportResult = await db.select().from(report).where(eq(report.id, params.reportId));
    const currentReport = reportResult[0];
    if (!currentReport) return fail(404, { error: 'Report not found' });

    await saveReviewedReport({
      patientId: currentReport.patientId,
      metricsStr,
      reportFacility: data.get('reportFacility')?.toString(),
      reportTestDate: data.get('reportTestDate')?.toString(),
      targetReportId: params.reportId,
      reportRawSource: data.get('reportRawSource')?.toString(),
      deletedRecordIdsStr: data.get('deletedRecordIds')?.toString(),
    });

    throw redirect(303, `/?patientId=${currentReport.patientId}`);
  },
};
