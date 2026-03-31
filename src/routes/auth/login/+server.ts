import type { RequestHandler } from './$types';
import { normalizeReturnTo, startAuthFlow } from '$lib/server/auth0';

export const GET: RequestHandler = ({ cookies, url }) => {
  const returnTo = normalizeReturnTo(url.searchParams.get('returnTo'));
  return startAuthFlow(cookies, url.origin, returnTo);
};
