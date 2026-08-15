import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachmentContentDisposition } from '$lib/content-disposition';
import { getOwnedDataImport, requireUserId } from '$lib/server/ownership';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
  const userId = requireUserId(locals);
  const importId = url.searchParams.get('id');
  if (!importId) throw error(400, 'Missing import ID');

  const source = await getOwnedDataImport(userId, importId);
  if (!source) throw error(404, 'Import source not found');

  const object = await platform?.env.REPORT_SOURCES?.get(source.storageKey);
  if (!object) throw error(404, 'Import source file not found');

  const fileName = source.fileName || `${source.provider}-import.csv`;
  const headers = new Headers({
    'cache-control': 'private, no-store',
    'content-disposition': attachmentContentDisposition(fileName),
    'content-type': object.httpMetadata?.contentType || source.mimeType,
    'x-content-type-options': 'nosniff',
    etag: object.httpEtag,
  });

  return new Response(object.body, { headers });
};
