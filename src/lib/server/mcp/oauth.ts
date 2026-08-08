import { env } from '$env/dynamic/private';
import { jwtVerify, SignJWT } from 'jose';
import { and, count, eq, isNull, lt, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mcpAuthCode, mcpClient, mcpGrant } from '$lib/server/db/schema';

// The app is the authorization server an agent talks to; Auth0 stays the thing
// that identifies the human. That split is what makes per-profile consent
// possible: an identity provider can issue a scope, it cannot say "this client
// may read this one profile and not the other".

export const READ_SCOPE = 'health:read';
/**
 * Writing is a separate grant, never implied by reading. A connection that can
 * log a measurement can also put a number into the record that the account
 * holder will later read back as their own history.
 */
export const WRITE_SCOPE = 'health:write';
export const MCP_SCOPES = [READ_SCOPE, WRITE_SCOPE] as const;
// Short, because the only thing that ends a token early is its own expiry —
// revocation is immediate in practice because the grant is re-read on every
// call, but a token that has left the machine should not stay useful for long.
export const ACCESS_TOKEN_TTL = 15 * 60;
// A connection nobody refreshes for three months has been forgotten; forgetting
// it back is better than leaving read access to health records live forever.
export const REFRESH_TOKEN_TTL = 90 * 24 * 60 * 60;
const AUTH_CODE_TTL = 60;

export type McpTokenClaims = {
  sub: string;
  grant: string;
  client: string;
  scope: string;
  aud: string;
};

function tokenKey() {
  const secret = env.MCP_TOKEN_SECRET;

  if (!secret) {
    // Deliberately not falling back to the session secret: agent tokens live on
    // other people's machines and have to be revocable on their own.
    throw new Error('MCP_TOKEN_SECRET is not set');
  }

  return new TextEncoder().encode(secret);
}

export function mcpEnabled() {
  return Boolean(env.MCP_TOKEN_SECRET);
}

export function resourceUrl(origin: string) {
  return `${origin}/mcp`;
}

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashToken(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

/** RFC 7636 S256 only — a `plain` challenge is no challenge. */
export async function verifyPkce(verifier: string, challenge: string) {
  return (await hashToken(verifier)) === challenge;
}

export async function issueAccessToken(claims: McpTokenClaims) {
  return new SignJWT({ scope: claims.scope, grant: claims.grant, client: claims.client })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setAudience(claims.aud)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL}s`)
    .sign(tokenKey());
}

/**
 * A token minted for another resource must not work here, or this server
 * becomes a way to spend someone else's credential.
 */
export async function readAccessToken(token: string, audience: string): Promise<McpTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, tokenKey(), { algorithms: ['HS256'], audience });

    if (typeof payload.sub !== 'string' || typeof payload.grant !== 'string') return null;

    return {
      sub: payload.sub,
      grant: payload.grant,
      client: typeof payload.client === 'string' ? payload.client : '',
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      aud: audience,
    };
  } catch {
    return null;
  }
}

export async function registerClient(input: { name: string; redirectUris: string[]; uri?: string | null }) {
  const rows = await db
    .insert(mcpClient)
    .values({
      name: input.name,
      redirectUris: input.redirectUris,
      uri: input.uri || null,
      createdAt: new Date().toISOString(),
    })
    .returning();

  return rows[0];
}

const UNAPPROVED_CLIENT_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * Registration needs no credential, so anyone can create client rows. One a
 * person never approved is worth nothing after a week; the ones with a grant
 * behind them are kept, because a connection still refers to them.
 */
export async function pruneUnapprovedClients() {
  const cutoff = new Date(Date.now() - UNAPPROVED_CLIENT_TTL).toISOString();
  const granted = db.select({ id: mcpGrant.clientId }).from(mcpGrant);

  await db.delete(mcpClient).where(and(lt(mcpClient.createdAt, cutoff), notInArray(mcpClient.id, granted)));
}

/** Registrations nobody has approved, held below a ceiling so an open endpoint cannot fill the database. */
const MAX_UNAPPROVED_CLIENTS = 200;

export async function unapprovedClientsAtCapacity() {
  const granted = db.select({ id: mcpGrant.clientId }).from(mcpGrant);
  const rows = await db.select({ count: count() }).from(mcpClient).where(notInArray(mcpClient.id, granted));

  return (rows[0]?.count ?? 0) >= MAX_UNAPPROVED_CLIENTS;
}

export async function getClient(clientId: string) {
  const rows = await db.select().from(mcpClient).where(eq(mcpClient.id, clientId));
  return rows[0] || null;
}

export function clientRedirectUris(row: { redirectUris: unknown }) {
  const value = typeof row.redirectUris === 'string' ? safeParse(row.redirectUris) : row.redirectUris;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function grantPatientIds(row: { patientIds: unknown }) {
  const value = typeof row.patientIds === 'string' ? safeParse(row.patientIds) : row.patientIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function createGrant(input: {
  ownerUserId: string;
  clientId: string;
  patientIds: string[];
  shareDemographics: boolean;
  scope: string;
}) {
  const rows = await db
    .insert(mcpGrant)
    .values({
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      patientIds: input.patientIds,
      shareDemographics: input.shareDemographics ? 1 : 0,
      scope: input.scope,
      createdAt: new Date().toISOString(),
    })
    .returning();

  return rows[0];
}

export async function getActiveGrant(grantId: string) {
  const rows = await db.select().from(mcpGrant).where(eq(mcpGrant.id, grantId));
  const row = rows[0];

  return row && !row.revokedAt ? row : null;
}

export async function listGrants(ownerUserId: string) {
  return db
    .select({
      id: mcpGrant.id,
      clientId: mcpGrant.clientId,
      clientName: mcpClient.name,
      patientIds: mcpGrant.patientIds,
      shareDemographics: mcpGrant.shareDemographics,
      scope: mcpGrant.scope,
      refreshExpiresAt: mcpGrant.refreshExpiresAt,
      createdAt: mcpGrant.createdAt,
      lastUsedAt: mcpGrant.lastUsedAt,
      revokedAt: mcpGrant.revokedAt,
    })
    .from(mcpGrant)
    .innerJoin(mcpClient, eq(mcpClient.id, mcpGrant.clientId))
    .where(eq(mcpGrant.ownerUserId, ownerUserId));
}

export async function revokeGrant(ownerUserId: string, grantId: string) {
  await db
    .update(mcpGrant)
    .set({ revokedAt: new Date().toISOString(), refreshTokenHash: null, previousRefreshTokenHash: null })
    .where(and(eq(mcpGrant.id, grantId), eq(mcpGrant.ownerUserId, ownerUserId)));
}

const TOUCH_INTERVAL_MS = 60_000;

/**
 * "Last used" only has to be accurate to the minute it is displayed at, and an
 * agent polling in a loop should not turn a read-only surface into a write per
 * call.
 */
export async function touchGrant(grant: { id: string; lastUsedAt: string | null }) {
  const last = grant.lastUsedAt ? new Date(grant.lastUsedAt).getTime() : 0;

  if (Date.now() - last < TOUCH_INTERVAL_MS) return;

  await db.update(mcpGrant).set({ lastUsedAt: new Date().toISOString() }).where(eq(mcpGrant.id, grant.id));
}

export async function issueAuthCode(input: {
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}) {
  const code = randomToken();

  await db.insert(mcpAuthCode).values({
    codeHash: await hashToken(code),
    grantId: input.grantId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL * 1000).toISOString(),
  });

  return code;
}

/**
 * Single use, and the delete is what decides it. Reading the row and then
 * deleting it lets two concurrent exchanges both pass the check and both walk
 * away with tokens; deleting first means exactly one caller gets the row back.
 */
export async function redeemAuthCode(code: string) {
  const codeHash = await hashToken(code);
  const rows = await db.delete(mcpAuthCode).where(eq(mcpAuthCode.codeHash, codeHash)).returning();
  const row = rows[0];

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) return null;

  return row;
}

/** Codes outlive their minute only as rows; sweeping on redemption keeps the table from growing without a job. */
export async function sweepExpiredAuthCodes() {
  await db.delete(mcpAuthCode).where(lt(mcpAuthCode.expiresAt, new Date().toISOString()));
}

export async function setRefreshToken(grantId: string, token: string | null) {
  await db
    .update(mcpGrant)
    .set({
      refreshTokenHash: token ? await hashToken(token) : null,
      previousRefreshTokenHash: null,
      refreshExpiresAt: token ? new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString() : null,
    })
    .where(eq(mcpGrant.id, grantId));
}

/**
 * Rotating, with the swap done as one conditional update so two concurrent
 * refreshes cannot both succeed. The spent hash is kept for one generation:
 * presenting it again means a copy of the token is in circulation, and the
 * whole grant is revoked rather than left running for whoever holds the newer
 * one.
 */
export async function rotateRefreshToken(token: string) {
  const hash = await hashToken(token);
  const next = randomToken();
  const now = new Date();

  const rows = await db
    .update(mcpGrant)
    .set({
      refreshTokenHash: await hashToken(next),
      previousRefreshTokenHash: hash,
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL * 1000).toISOString(),
      lastUsedAt: now.toISOString(),
    })
    .where(and(eq(mcpGrant.refreshTokenHash, hash), isNull(mcpGrant.revokedAt)))
    .returning();

  const row = rows[0];

  if (row) {
    if (row.refreshExpiresAt && new Date(row.refreshExpiresAt).getTime() < now.getTime()) {
      await revokeGrantById(row.id);
      return null;
    }

    return { grant: row, refreshToken: next };
  }

  const replayed = await db.select().from(mcpGrant).where(eq(mcpGrant.previousRefreshTokenHash, hash));

  if (replayed[0] && !replayed[0].revokedAt) {
    await revokeGrantById(replayed[0].id);
  }

  return null;
}

/** The grant a refresh or access token belongs to, without spending anything. */
export async function findGrantByRefreshToken(token: string) {
  const hash = await hashToken(token);
  const rows = await db.select().from(mcpGrant).where(eq(mcpGrant.refreshTokenHash, hash));
  return rows[0] || null;
}

export async function revokeGrantById(grantId: string) {
  await db
    .update(mcpGrant)
    .set({ revokedAt: new Date().toISOString(), refreshTokenHash: null, previousRefreshTokenHash: null })
    .where(eq(mcpGrant.id, grantId));
}

/**
 * Consent is the whole permission, so approving a client again replaces what it
 * had. Leaving the old grant alive would make the effective access the union of
 * every past approval, and unticking a profile on re-consent would not take it
 * away.
 */
export async function revokePriorGrants(ownerUserId: string, clientId: string) {
  await db
    .update(mcpGrant)
    .set({ revokedAt: new Date().toISOString(), refreshTokenHash: null, previousRefreshTokenHash: null })
    .where(
      and(eq(mcpGrant.ownerUserId, ownerUserId), eq(mcpGrant.clientId, clientId), isNull(mcpGrant.revokedAt)),
    );
}
