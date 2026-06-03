import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';
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
  const isPublicLandingRoute = event.route.id === '/';

  if (!session?.user && !isAuthRoute && !isPublicLandingRoute) {
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

// Drizzle rethrows driver failures as an opaque "Failed query: …" and stashes
// the real reason (e.g. "FOREIGN KEY constraint failed") on error.cause, which
// SvelteKit's default logger never prints. Walk the cause chain so the actual
// SQLite/libsql error reaches the logs.
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const causes: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  while (current && causes.length < 8) {
    causes.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }

  console.error('[handleError]', event.request.method, event.url.pathname, {
    status,
    message: error instanceof Error ? error.message : String(error),
    causes,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return { message };
};
