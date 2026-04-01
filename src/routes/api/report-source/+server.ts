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

  if (object.httpMetadata?.contentType) {
    headers.set('content-type', object.httpMetadata.contentType);
  }

  if (object.httpMetadata?.contentLanguage) {
    headers.set('content-language', object.httpMetadata.contentLanguage);
  }

  if (object.httpMetadata?.contentDisposition) {
    headers.set('content-disposition', object.httpMetadata.contentDisposition);
  }

  if (object.httpMetadata?.contentEncoding) {
    headers.set('content-encoding', object.httpMetadata.contentEncoding);
  }

  if (object.httpMetadata?.cacheControl) {
    headers.set('cache-control', object.httpMetadata.cacheControl);
  }

  if (object.httpMetadata?.cacheExpiry) {
    headers.set('expires', object.httpMetadata.cacheExpiry.toUTCString());
  }

  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'private, max-age=3600');

  return new Response(object.body, { headers });
};
