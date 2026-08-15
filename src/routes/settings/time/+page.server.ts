import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { isValidTimeZone, timeZoneFromMetadata } from '$lib/time-zone';
import { db } from '$lib/server/db';
import { patient } from '$lib/server/db/schema';
import { getOwnedPatient, requireUserId } from '$lib/server/ownership';

function parseJsonLike(value: unknown) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {} as Record<string, unknown>;

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string'
      ? (JSON.parse(parsed) as Record<string, unknown>)
      : (parsed as Record<string, unknown>);
  } catch {
    return {} as Record<string, unknown>;
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  const userId = requireUserId(locals);
  const profiles = await db.select().from(patient).where(eq(patient.ownerUserId, userId));

  return {
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      timeZone: timeZoneFromMetadata(profile.extraData),
      hasTimeZone: isValidTimeZone(parseJsonLike(profile.extraData).timeZone),
    })),
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const form = await request.formData();
    const patientId = form.get('patientId')?.toString();
    const timeZone = form.get('timeZone')?.toString();

    if (!patientId) return fail(400, { code: 'missing_profile' });
    if (!isValidTimeZone(timeZone)) return fail(400, { code: 'invalid_time_zone', patientId });

    const ownedPatient = await getOwnedPatient(userId, patientId);
    if (!ownedPatient) return fail(404, { code: 'profile_not_found' });

    await db
      .update(patient)
      .set({
        extraData: JSON.stringify({
          ...parseJsonLike(ownedPatient.extraData),
          timeZone,
        }),
      })
      .where(eq(patient.id, ownedPatient.id));

    return { success: true, patientId };
  },
};
