import { getOwnedPatient } from '$lib/server/ownership';
import { getActiveGrant, grantPatientIds, MCP_SCOPES, readAccessToken, resourceUrl } from './oauth';

const READ_SCOPE = MCP_SCOPES[0];

export type McpContext = {
  /** Auth0 subject — the same value `patient.ownerUserId` stores. */
  userId: string;
  grant: { id: string; lastUsedAt: string | null };
  clientId: string;
  patientIds: string[];
  shareDemographics: boolean;
  now: number;
};

export async function resolveContext(request: Request, origin: string): Promise<McpContext | null> {
  const header = request.headers.get('authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) return null;

  const claims = await readAccessToken(token, resourceUrl(origin));
  if (!claims) return null;

  // Every tool here reads, so a token that was not granted the read scope has
  // no business being served. Checked rather than parsed and ignored, so adding
  // a second scope later cannot silently widen tokens that predate it.
  if (!claims.scope.split(' ').includes(READ_SCOPE)) return null;

  const grant = await getActiveGrant(claims.grant);
  if (!grant || grant.ownerUserId !== claims.sub) return null;
  if (claims.client && grant.clientId !== claims.client) return null;
  if (!grant.scope.split(' ').includes(READ_SCOPE)) return null;

  return {
    userId: claims.sub,
    grant: { id: grant.id, lastUsedAt: grant.lastUsedAt },
    clientId: grant.clientId,
    patientIds: grantPatientIds(grant),
    shareDemographics: grant.shareDemographics === 1,
    now: Date.now(),
  };
}

/**
 * Two gates, and neither substitutes for the other: ownership is the security
 * boundary, the grant is what the account holder actually consented to.
 */
export async function requirePatient(ctx: McpContext, patientId: unknown) {
  if (typeof patientId !== 'string' || !patientId) {
    throw new ToolError('patient_id is required');
  }

  if (!ctx.patientIds.includes(patientId)) {
    // Same answer as a patient that does not exist, so a caller cannot use the
    // difference to learn which ids are real.
    throw new ToolError('No such patient');
  }

  const owned = await getOwnedPatient(ctx.userId, patientId);
  if (!owned) throw new ToolError('No such patient');

  return owned;
}

export class ToolError extends Error {}
