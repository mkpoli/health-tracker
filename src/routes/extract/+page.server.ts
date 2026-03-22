import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { patient, report, record } from '$lib/server/db/schema';
import { buildRawReportSource, extractMedicalData } from '$lib/server/extraction';
import { saveReviewedReport } from '$lib/server/report-review';

export const load: PageServerLoad = async ({ url }) => {
  const patientId = url.searchParams.get('patientId');

  if (!patientId) {
    throw redirect(303, '/');
  }

  const currentPatient = await db.select().from(patient).where(eq(patient.id, patientId));
  const selectedPatient = currentPatient[0];

  if (!selectedPatient) {
    throw redirect(303, '/');
  }

  const reports = await db.select().from(report).where(eq(report.patientId, selectedPatient.id)).orderBy(desc(report.testDate));
  const records = await db.select().from(record).where(eq(record.patientId, selectedPatient.id)).orderBy(desc(record.id));

  return {
    currentPatient: selectedPatient,
    reports,
    records,
  };
};

export const actions: Actions = {
  extract: async ({ request, url, platform }) => {
    const patientId = url.searchParams.get('patientId');
    if (!patientId) return fail(400, { error: 'Missing patient' });

    const data = await request.formData();
    const textContext = data.get('text')?.toString() || null;
    const file = data.get('file') as File | null;

    try {
      const extracted = await extractMedicalData(textContext, file);
      const rawSource = await buildRawReportSource(textContext, file, {
        patientId,
        bucket: platform?.env.REPORT_SOURCES,
      });

      return {
        success: true,
        review: {
          patientId,
          rawSource,
          facilityName: extracted.facilityName || '',
          reportDate: extracted.reportDate || '',
          metrics: extracted.metrics || [],
        },
      };
    } catch {
      return fail(500, { error: 'Failed to extract medical data' });
    }
  },

  save: async ({ request, url }) => {
    const patientId = url.searchParams.get('patientId');
    if (!patientId) return fail(400, { error: 'Missing patient' });

    const data = await request.formData();
    const metricsStr = data.get('metrics')?.toString();

    if (!metricsStr) return fail(400, { error: 'Missing metrics' });

    await saveReviewedReport({
      patientId,
      metricsStr,
      reportFacility: data.get('reportFacility')?.toString(),
      reportTestDate: data.get('reportTestDate')?.toString(),
      targetReportId: data.get('targetReportId')?.toString(),
      reportRawSource: data.get('reportRawSource')?.toString(),
      deletedRecordIdsStr: data.get('deletedRecordIds')?.toString(),
    });

    throw redirect(303, `/?patientId=${patientId}`);
  },
};
