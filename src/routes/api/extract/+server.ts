import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ExtractionInputError, extractMedicalData } from '$lib/server/extraction';
import { requireUserId } from '$lib/server/ownership';

export const POST: RequestHandler = async ({ request, locals }) => {
  // The hook redirects an unauthenticated browser to the sign-in page, which is
  // not an answer a fetch can read. Asking here turns that into a 401, and the
  // scan behind this route is expensive enough to be worth the explicit check.
  requireUserId(locals);

  try {
    const data = await request.formData();
    const textContext = data.get('text') as string | null;
    const file = data.get('file') as File | null;

    return json(await extractMedicalData(textContext, file));
  } catch (error) {
    if (error instanceof ExtractionInputError) {
      return json({ error: error.message }, { status: 413 });
    }

    console.error('API Error:', error);
    return json({ error: 'Failed to extract medical data' }, { status: 500 });
  }
};
