import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  findGrantByRefreshToken,
  mcpEnabled,
  readAccessToken,
  resourceUrl,
  revokeGrantById,
} from '$lib/server/mcp/oauth';

// RFC 7009. A client may present either token type, so both are resolved to the
// grant behind them. Answering 200 either way is deliberate: the endpoint must
// not tell a caller whether the token it presented was real.
export const POST: RequestHandler = async ({ request, url }) => {
  const ok = json({}, { headers: { 'cache-control': 'no-store' } });

  if (!mcpEnabled()) return ok;

  const form = await request.formData();
  const token = form.get('token')?.toString();

  if (!token) return ok;

  const byRefresh = await findGrantByRefreshToken(token);

  if (byRefresh) {
    await revokeGrantById(byRefresh.id);
    return ok;
  }

  const claims = await readAccessToken(token, resourceUrl(url.origin));

  if (claims) await revokeGrantById(claims.grant);

  return ok;
};
