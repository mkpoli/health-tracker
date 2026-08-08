import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MCP_SCOPES } from '$lib/server/mcp/oauth';

// RFC 8414. Registration is open because MCP clients register themselves; what
// keeps that safe is that a registered client can do nothing until a signed-in
// person approves it on the consent screen.
export const GET: RequestHandler = async ({ url }) =>
  json({
    issuer: url.origin,
    authorization_endpoint: `${url.origin}/oauth/authorize`,
    token_endpoint: `${url.origin}/oauth/token`,
    registration_endpoint: `${url.origin}/oauth/register`,
    revocation_endpoint: `${url.origin}/oauth/revoke`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
