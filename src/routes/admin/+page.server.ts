import { db } from '$lib/server/db';
import { patient, record, report } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

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

export const load: PageServerLoad = async () => {
  const [patients, records, reports] = await Promise.all([
    db.select().from(patient).orderBy(desc(patient.id)),
    db.select().from(record).orderBy(desc(record.id)),
    db.select().from(report).orderBy(desc(report.testDate)),
  ]);

  return {
    patients,
    records,
    reports,
    recordMetadata: Object.fromEntries(records.map((item) => [item.id, parseJsonLike(item.extraData)])),
  };
};
