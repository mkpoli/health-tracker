import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getSession } from '$lib/server/auth0';
import { redirect } from '@sveltejs/kit';

// Paths an agent reaches with a bearer token instead of a session cookie. Each
// one is listed: a `/.well-known/` prefix match would silently un-protect any
// route added under it later.
const AGENT_PATHS = new Set([
  '/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/oauth/register',
  '/oauth/token',
  '/oauth/revoke',
]);

// The token and revocation endpoints take urlencoded bodies from clients that
// send no Origin at all, so they are exempt; everything else keeps the check
// that `csrf.checkOrigin` used to perform.
const CROSS_ORIGIN_FORM_ALLOWED = new Set(['/oauth/token', '/oauth/revoke']);

const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

const handleFormOrigin: Handle = ({ event, resolve }) => {
  const method = event.request.method;
  const contentType = event.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  const isFormPost =
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && FORM_CONTENT_TYPES.includes(contentType);

  if (isFormPost && !CROSS_ORIGIN_FORM_ALLOWED.has(event.url.pathname)) {
    const origin = event.request.headers.get('origin');

    if (origin !== event.url.origin) {
      return new Response('Cross-site form submissions are forbidden', { status: 403 });
    }
  }

  return resolve(event);
};

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

  // An agent authenticates with a bearer token and cannot follow an HTML login.
  // These paths answer 401 with the metadata that starts the OAuth flow, so a
  // redirect here would strand every client on a sign-in page it cannot read.
  // /oauth/authorize is left out on purpose: it is the browser leg, and the
  // bounce to Auth0 is what signs the person in before they consent.
  const isAgentRoute = AGENT_PATHS.has(pathname);

  if (!session?.user && !isAuthRoute && !isPublicLandingRoute && !isAgentRoute) {
    const returnTo = `${pathname}${event.url.search}`;
    throw redirect(302, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return resolve(event);
};

// The authorization screen decides who reads someone's health records, so it
// must not be renderable inside another site's page where the click that
// approves it can be arranged.
const handleFraming: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  if (event.url.pathname.startsWith('/oauth/')) {
    response.headers.set('content-security-policy', "frame-ancestors 'none'");
    response.headers.set('x-frame-options', 'DENY');
  }

  return response;
};

const handleParaglide: Handle = ({ event, resolve }) => paraglideMiddleware(event.request, ({ request, locale }) => {
	event.request = request;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale).replace('%paraglide.dir%', getTextDirection(locale))
	});
});

export const handle: Handle = sequence(handleFormOrigin, handleFraming, handleAuth, handleParaglide);

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
