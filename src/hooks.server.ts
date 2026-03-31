import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getSession } from '$lib/server/auth0';
import { redirect } from '@sveltejs/kit';

const handleAuth: Handle = async ({ event, resolve }) => {
  const session = await getSession(event.cookies);

  event.locals.session = session;
  event.locals.user = session?.user;

  if (!event.route.id) {
    return resolve(event);
  }

  const pathname = event.url.pathname;
  const isAuthRoute = pathname.startsWith('/auth');

  if (!session?.user && !isAuthRoute) {
    const returnTo = `${pathname}${event.url.search}`;
    throw redirect(302, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return resolve(event);
};

const handleParaglide: Handle = ({ event, resolve }) => paraglideMiddleware(event.request, ({ request, locale }) => {
	event.request = request;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale).replace('%paraglide.dir%', getTextDirection(locale))
	});
});

export const handle: Handle = sequence(handleAuth, handleParaglide);
