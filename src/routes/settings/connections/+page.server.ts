import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { patient } from '$lib/server/db/schema';
import { requireUserId } from '$lib/server/ownership';
import { grantPatientIds, listGrants, mcpEnabled, resourceUrl, revokeGrant } from '$lib/server/mcp/oauth';

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = requireUserId(locals);

  const patients = await db
    .select({ id: patient.id, name: patient.name })
    .from(patient)
    .where(eq(patient.ownerUserId, userId));
  const nameById = new Map(patients.map((row) => [row.id, row.name]));

  const grants = await listGrants(userId);

  return {
    endpoint: resourceUrl(url.origin),
    configured: mcpEnabled(),
    connections: grants
      .filter((grant) => !grant.revokedAt)
      .map((grant) => ({
        id: grant.id,
        clientName: grant.clientName,
        patients: grantPatientIds(grant).map((id) => nameById.get(id) || id),
        shareDemographics: grant.shareDemographics === 1,
        createdAt: grant.createdAt,
        lastUsedAt: grant.lastUsedAt,
      })),
  };
};

export const actions: Actions = {
  revoke: async ({ request, locals }) => {
    const userId = requireUserId(locals);
    const form = await request.formData();
    const grantId = form.get('grant_id')?.toString();

    if (grantId) await revokeGrant(userId, grantId);

    return { success: true };
  },
};
