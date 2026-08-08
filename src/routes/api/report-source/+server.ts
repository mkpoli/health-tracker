import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOwnedPatient, requireUserId } from '$lib/server/ownership';

// Keys are written as `report-sources/<patientId>/<uuid>-<filename>`, so the
// patient a document belongs to is readable from the key itself. Being signed
// in says nothing about who owns the scan behind a given key, and the UUID is
// not an access control.
const SOURCE_KEY_PATTERN = /^report-sources\/([^/]+)\/[^/]+$/;

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const userId = requireUserId(locals);
  const key = url.searchParams.get('key');
  const patientId = key?.match(SOURCE_KEY_PATTERN)?.[1];

  if (!patientId) {
    throw error(400, 'Invalid source key');
  }

  if (!(await getOwnedPatient(userId, patientId))) {
    throw error(404, 'Source not found');
  }

  const object = await platform?.env.REPORT_SOURCES?.get(key!);

  if (!object) {
    // Documents uploaded from a local dev server went to the bucket that server
    // was bound to, so the key resolves to nothing here. Saying which case this
    // is turns an unexplained 404 into something recoverable.
    throw error(404, 'The original document is not in storage for this deployment');
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
