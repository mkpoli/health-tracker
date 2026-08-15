import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { record } from '$lib/server/db/schema';
import { resolveStoredReportSource } from '$lib/server/extraction';
import { saveReviewedReport } from '$lib/server/report-review';
import { getOwnedLabReport, getOwnedPatient, requireUserId } from '$lib/server/ownership';
import { InvalidReportTimeError } from '$lib/server/report-time';

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = requireUserId(locals);
  const currentReport = await getOwnedLabReport(userId, params.reportId);

  if (!currentReport) throw redirect(303, '/');

  const currentPatient = await getOwnedPatient(userId, currentReport.patientId);

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
  save: async ({ request, params, locals }) => {
    const userId = requireUserId(locals);
    const data = await request.formData();
    const metricsStr = data.get('metrics')?.toString();

    if (!metricsStr) return fail(400, { error: 'Missing metrics' });

    const currentReport = await getOwnedLabReport(userId, params.reportId);
    if (!currentReport) return fail(404, { error: 'Report not found' });

    try {
      await saveReviewedReport({
        patientId: currentReport.patientId,
        metricsStr,
        reportFacility: data.get('reportFacility')?.toString(),
        reportTestDate: data.get('reportTestDate')?.toString(),
        reportTimeZone: data.get('reportTimeZone')?.toString(),
        targetReportId: params.reportId,
        reportRawSource: data.get('reportRawSource')?.toString(),
        deletedRecordIdsStr: data.get('deletedRecordIds')?.toString(),
      });
    } catch (error) {
      if (error instanceof InvalidReportTimeError) return fail(400, { code: 'invalid_report_time' });
      throw error;
    }

    throw redirect(303, `/?patientId=${currentReport.patientId}`);
  },
};
