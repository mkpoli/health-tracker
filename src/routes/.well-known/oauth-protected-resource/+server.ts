import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MCP_SCOPES, resourceUrl } from '$lib/server/mcp/oauth';

// RFC 9728. The client reads this after a 401 to learn what it is authenticating
// against and who issues tokens for it.
export const GET: RequestHandler = async ({ url }) =>
  json({
    resource: resourceUrl(url.origin),
    authorization_servers: [url.origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
  });
