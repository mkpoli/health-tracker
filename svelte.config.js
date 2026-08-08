import adapter from '@sveltejs/adapter-cloudflare';

// SvelteKit's built-in origin check rejects every form-encoded POST that
// carries no Origin header, which is exactly the shape RFC 6749 requires of an
// OAuth token request from a non-browser client. Leaving it on makes the token
// endpoint unreachable for every agent. The check is reimplemented in
// `handleFormOrigin` (src/hooks.server.ts), which applies it to the app's own
// form actions and exempts the two OAuth endpoints.
/** @type {import('@sveltejs/kit').Config} */
const config = { kit: { adapter: adapter(), csrf: { checkOrigin: false } } };

export default config;
