import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  throw redirect(303, `/extract?patientId=${params.patientId}${url.search ? `&${url.searchParams.toString()}` : ''}`);
};

export const actions: Actions = {
  extract: async ({ params }) => {
    throw redirect(303, `/extract?patientId=${params.patientId}`);
  },
  save: async ({ params }) => {
    throw redirect(303, `/extract?patientId=${params.patientId}`);
  },
};
