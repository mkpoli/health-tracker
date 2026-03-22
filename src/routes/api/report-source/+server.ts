import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const key = url.searchParams.get('key');

  if (!key || !key.startsWith('report-sources/')) {
    throw error(400, 'Invalid source key');
  }

  const object = await platform?.env.REPORT_SOURCES?.get(key);

  if (!object) {
    throw error(404, 'Source not found');
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=3600');

  return new Response(object.body, { headers });
};
