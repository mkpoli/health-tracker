import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  ACCESS_TOKEN_TTL,
  getActiveGrant,
  issueAccessToken,
  mcpEnabled,
  randomToken,
  redeemAuthCode,
  resourceUrl,
  rotateRefreshToken,
  setRefreshToken,
  sweepExpiredAuthCodes,
  verifyPkce,
} from '$lib/server/mcp/oauth';

function oauthError(error: string, status = 400) {
  return json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

/** RFC 7636: 43–128 characters from the unreserved set. Anything else is not a verifier. */
function isWellFormedVerifier(value: string) {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

async function tokenResponse(
  grant: { id: string; ownerUserId: string; clientId: string; scope: string },
  origin: string,
  refreshToken: string,
) {
  const accessToken = await issueAccessToken({
    sub: grant.ownerUserId,
    grant: grant.id,
    client: grant.clientId,
    scope: grant.scope,
    aud: resourceUrl(origin),
  });

  return json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: grant.scope,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!mcpEnabled()) return oauthError('temporarily_unavailable', 503);

  const form = await request.formData();
  const grantType = form.get('grant_type')?.toString();

  if (grantType === 'authorization_code') {
    const code = form.get('code')?.toString();
    const verifier = form.get('code_verifier')?.toString();
    const clientId = form.get('client_id')?.toString();
    const redirectUri = form.get('redirect_uri')?.toString();

    if (!code || !verifier || !clientId) return oauthError('invalid_request');
    if (!isWellFormedVerifier(verifier)) return oauthError('invalid_request');

    const authCode = await redeemAuthCode(code);
    if (!authCode) return oauthError('invalid_grant');

    if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
      return oauthError('invalid_grant');
    }

    if (!(await verifyPkce(verifier, authCode.codeChallenge))) return oauthError('invalid_grant');

    // The code was issued for one resource; a token for a different one would
    // be a credential this server has no business minting.
    if (authCode.resource && authCode.resource !== resourceUrl(url.origin)) {
      return oauthError('invalid_target');
    }

    const grant = await getActiveGrant(authCode.grantId);
    if (!grant) return oauthError('invalid_grant');
    // The grant and the code must belong to the same client, or a code issued
    // for one client would mint a token bound to another's grant.
    if (grant.clientId !== clientId) return oauthError('invalid_grant');

    const refreshToken = randomToken();
    await setRefreshToken(grant.id, refreshToken);
    await sweepExpiredAuthCodes();

    return tokenResponse(grant, url.origin, refreshToken);
  }

  if (grantType === 'refresh_token') {
    const presented = form.get('refresh_token')?.toString();
    const clientId = form.get('client_id')?.toString();

    if (!presented) return oauthError('invalid_request');

    const rotated = await rotateRefreshToken(presented);
    if (!rotated) return oauthError('invalid_grant');
    if (clientId && rotated.grant.clientId !== clientId) return oauthError('invalid_grant');

    return tokenResponse(rotated.grant, url.origin, rotated.refreshToken);
  }

  return oauthError('unsupported_grant_type');
};
