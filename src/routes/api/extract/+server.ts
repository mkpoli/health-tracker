import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extractMedicalData } from '$lib/server/extraction';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const data = await request.formData();
    const textContext = data.get('text') as string | null;
    const file = data.get('file') as File | null;

    return json(await extractMedicalData(textContext, file));
  } catch (error) {
    console.error('API Error:', error);
    return json({ error: 'Failed to extract medical data' }, { status: 500 });
  }
};
