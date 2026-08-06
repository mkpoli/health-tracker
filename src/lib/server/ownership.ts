import { db } from '$lib/server/db';
import { patient, record, report } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { BODY_REPORT_KIND } from '$lib/report-kind';

export function requireUserId(locals: App.Locals) {
  const userId = locals.user?.sub;

  if (!userId) {
    throw new Error('Authenticated user is required');
  }

  return userId;
}

export async function getOwnedPatient(userId: string, patientId: string) {
  const rows = await db
    .select()
    .from(patient)
    .where(and(eq(patient.id, patientId), eq(patient.ownerUserId, userId)));

  return rows[0] || null;
}

export async function getOwnedReport(userId: string, reportId: string) {
  const rows = await db.select().from(report).where(eq(report.id, reportId));
  const currentReport = rows[0];

  if (!currentReport) return null;

  const ownedPatient = await getOwnedPatient(userId, currentReport.patientId);
  return ownedPatient ? currentReport : null;
}

/**
 * Clinical reports only. The lab review flow rewrites a report's metadata and
 * prunes its records, so a body measurement session must never be reachable
 * through it — the same restriction the body save path applies in reverse.
 */
export async function getOwnedLabReport(userId: string, reportId: string) {
  const currentReport = await getOwnedReport(userId, reportId);

  if (!currentReport || currentReport.kind === BODY_REPORT_KIND) return null;

  return currentReport;
}

export async function getOwnedRecord(userId: string, recordId: string) {
  const rows = await db.select().from(record).where(eq(record.id, recordId));
  const currentRecord = rows[0];

  if (!currentRecord) return null;

  const ownedPatient = await getOwnedPatient(userId, currentRecord.patientId);
  return ownedPatient ? currentRecord : null;
}
