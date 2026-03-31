import type { RequestHandler } from './$types';
import { completeAuthFlow } from '$lib/server/auth0';

export const GET: RequestHandler = ({ cookies, url }) => {
  return completeAuthFlow(cookies, url);
};
