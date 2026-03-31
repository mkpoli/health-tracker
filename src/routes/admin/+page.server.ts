import { db } from '$lib/server/db';
import { patient, record, report } from '$lib/server/db/schema';
import { desc, eq, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { requireUserId } from '$lib/server/ownership';

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

export const load: PageServerLoad = async ({ locals }) => {
  const userId = requireUserId(locals);
  const patients = await db
    .select()
    .from(patient)
    .where(eq(patient.ownerUserId, userId))
    .orderBy(desc(patient.id));
  const patientIds = patients.map((item) => item.id);
  const [records, reports] = patientIds.length
    ? await Promise.all([
        db.select().from(record).where(inArray(record.patientId, patientIds)).orderBy(desc(record.id)),
        db.select().from(report).where(inArray(report.patientId, patientIds)).orderBy(desc(report.testDate)),
      ])
    : [[], []];

  return {
    patients,
    records,
    reports,
    recordMetadata: Object.fromEntries(records.map((item) => [item.id, parseJsonLike(item.extraData)])),
  };
};
