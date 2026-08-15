import { redirect, fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import { and, eq, desc, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { patient, report } from '$lib/server/db/schema';
import { buildRawReportSource, ExtractionInputError, extractMedicalData } from '$lib/server/extraction';
import { saveReviewedReport } from '$lib/server/report-review';
import { getOwnedLabReport, getOwnedPatient, requireUserId } from '$lib/server/ownership';
import { BODY_REPORT_KIND } from '$lib/report-kind';
import { InvalidReportTimeError } from '$lib/server/report-time';

export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = requireUserId(locals);
  const patientId = url.searchParams.get('patientId');

  if (!patientId) {
    throw redirect(303, '/');
  }

  const selectedPatient = await getOwnedPatient(userId, patientId);

  if (!selectedPatient) {
    throw redirect(303, '/');
  }

  const reports = await db
    .select()
    .from(report)
    .where(and(eq(report.patientId, selectedPatient.id), ne(report.kind, BODY_REPORT_KIND)))
    .orderBy(desc(report.testDate));
  return {
    currentPatient: selectedPatient,
    reports,
  };
};

export const actions: Actions = {
  extract: async ({ request, url, platform, locals }) => {
    const userId = requireUserId(locals);
    const patientId = url.searchParams.get('patientId');
    if (!patientId) return fail(400, { error: 'Missing patient' });

    const ownedPatient = await getOwnedPatient(userId, patientId);
    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    const data = await request.formData();
    const textContext = data.get('text')?.toString() || null;
    const file = data.get('file') as File | null;

    try {
      const extracted = await extractMedicalData(textContext, file);
      const rawSource = await buildRawReportSource(textContext, file, {
        patientId,
        bucket: platform?.env.REPORT_SOURCES,
        // A dev server is bound to the preview bucket, so the object lands
        // somewhere the deployed app cannot read. Recording that is what stops
        // the document from silently going missing later.
        localOnly: dev,
      });

      return {
        success: true,
        review: {
          patientId: ownedPatient.id,
          rawSource,
          facilityName: extracted.facilityName || '',
          reportDate: extracted.reportDate || '',
          extractionEvidence: JSON.stringify({
            sourceTranscript: extracted.sourceTranscript || '',
            dateEvidence: extracted.dateEvidence || [],
            reportDate: extracted.reportDate || '',
            reportTime: extracted.reportTime || '',
          }),
          metrics: extracted.metrics || [],
        },
      };
    } catch (error) {
      // A document too large, or a paste of the wrong thing, is the person's to
      // fix. Reporting it as a server failure hides what would.
      if (error instanceof ExtractionInputError) {
        return fail(413, { error: error.message });
      }

      return fail(500, { error: 'Failed to extract medical data' });
    }
  },

  save: async ({ request, url, locals }) => {
    const userId = requireUserId(locals);
    const patientId = url.searchParams.get('patientId');
    if (!patientId) return fail(400, { error: 'Missing patient' });

    const ownedPatient = await getOwnedPatient(userId, patientId);
    if (!ownedPatient) return fail(404, { error: 'Patient not found' });

    const data = await request.formData();
    const metricsStr = data.get('metrics')?.toString();

    if (!metricsStr) return fail(400, { error: 'Missing metrics' });

    const targetReportId = data.get('targetReportId')?.toString();

    if (targetReportId) {
      const ownedReport = await getOwnedLabReport(userId, targetReportId);
      if (!ownedReport || ownedReport.patientId !== ownedPatient.id) {
        return fail(404, { error: 'Report not found' });
      }
    }

    try {
      await saveReviewedReport({
        patientId: ownedPatient.id,
        metricsStr,
        reportFacility: data.get('reportFacility')?.toString(),
        reportTestDate: data.get('reportTestDate')?.toString(),
        reportTimeZone: data.get('reportTimeZone')?.toString(),
        targetReportId,
        reportRawSource: data.get('reportRawSource')?.toString(),
        reportExtractionEvidence: data.get('reportExtractionEvidence')?.toString(),
        deletedRecordIdsStr: data.get('deletedRecordIds')?.toString(),
      });
    } catch (error) {
      if (error instanceof InvalidReportTimeError) return fail(400, { code: 'invalid_report_time' });
      throw error;
    }

    throw redirect(303, `/?patientId=${ownedPatient.id}`);
  },
};
