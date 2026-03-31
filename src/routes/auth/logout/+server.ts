import type { RequestHandler } from './$types';
import { buildLogoutUrl, clearSession } from '$lib/server/auth0';
import { redirect } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ cookies, url }) => {
  clearSession(cookies);
  throw redirect(302, buildLogoutUrl(url.origin));
};
