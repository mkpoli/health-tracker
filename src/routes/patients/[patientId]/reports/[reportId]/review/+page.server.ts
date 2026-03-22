import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  throw redirect(303, `/reports/${params.reportId}/review`);
};

export const actions: Actions = {
  save: async ({ params }) => {
    throw redirect(303, `/reports/${params.reportId}/review`);
  },
};
