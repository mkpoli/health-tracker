import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOwnedEnergySource, requireUserId } from '$lib/server/ownership';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const userId = requireUserId(locals);
  const sourceId = url.searchParams.get('id');

  if (!sourceId) throw error(400, 'Missing source ID');

  const source = await getOwnedEnergySource(userId, sourceId);
  if (!source) throw error(404, 'Source not found');

  const object = await platform?.env.REPORT_SOURCES?.get(source.storageKey);
  if (!object) throw error(404, 'Source file not found');

  const headers = new Headers({
    'cache-control': 'private, no-store',
    'content-type': object.httpMetadata?.contentType || source.mimeType,
    'x-content-type-options': 'nosniff',
    etag: object.httpEtag,
  });

  return new Response(object.body, { headers });
};
