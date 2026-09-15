import type { McpContext } from './context';

export const REQUEST_ID_LIMIT = 128;

export type StableClaimKind =
  | 'medicine'
  | 'medicine:course'
  | 'medicine:regimen'
  | 'regimen'
  | 'regimen:course'
  | 'energy';

/**
 * The id a creation gets from its request_id, scoped to the client, the
 * profile and the kind of row, so a retry lands on the row the first call
 * made and two tools never share one namespace.
 */
export async function stableClaimId(
  ctx: McpContext,
  patientId: string,
  kind: StableClaimKind,
  idempotencyKey: string,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        ['health-tracker-mcp-claim', patientId, ctx.clientId, kind, idempotencyKey].join(''),
      ),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
