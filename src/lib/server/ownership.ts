import { db } from '$lib/server/db';
import { patient, record, report } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

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

export async function getOwnedRecord(userId: string, recordId: string) {
  const rows = await db.select().from(record).where(eq(record.id, recordId));
  const currentRecord = rows[0];

  if (!currentRecord) return null;

  const ownedPatient = await getOwnedPatient(userId, currentRecord.patientId);
  return ownedPatient ? currentRecord : null;
}
