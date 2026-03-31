import { env } from '$env/dynamic/private';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { redirect, type Cookies } from '@sveltejs/kit';

const SESSION_COOKIE_NAME = 'auth_session';
const TRANSACTION_COOKIE_NAME = 'auth_transaction';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const TRANSACTION_MAX_AGE = 60 * 10;

export type AuthUser = {
  sub: string;
  name: string | null;
  email: string | null;
  picture: string | null;
};

export type AuthSession = {
  user: AuthUser;
};

type AuthTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

function requireEnv(name: keyof typeof env) {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function getIssuer() {
  return `https://${requireEnv('AUTH0_DOMAIN')}/`;
}

function getSessionKey() {
  return new TextEncoder().encode(requireEnv('AUTH0_SESSION_SECRET'));
}

const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', getIssuer()));

function cookieOptions(maxAge: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    maxAge,
  };
}

function base64UrlEncode(input: Uint8Array) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomString(bytes = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

async function signToken(payload: Record<string, unknown>, expiresIn: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(getSessionKey());
}

async function verifyToken<T>(token: string) {
  const verified = await jwtVerify(token, getSessionKey(), {
    algorithms: ['HS256'],
  });

  return verified.payload as T;
}

async function setSignedCookie(cookies: Cookies, name: string, payload: Record<string, unknown>, maxAge: number) {
  const value = await signToken(payload, maxAge);
  cookies.set(name, value, cookieOptions(maxAge));
}

export async function getSession(cookies: Cookies): Promise<AuthSession | null> {
  const token = cookies.get(SESSION_COOKIE_NAME);

  if (!token) return null;

  try {
    const payload = await verifyToken<{ user?: AuthUser }>(token);
    return payload.user ? { user: payload.user } : null;
  } catch {
    cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }
}

export async function startAuthFlow(cookies: Cookies, origin: string, returnTo: string): Promise<never> {
  const state = randomString();
  const nonce = randomString();
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256(codeVerifier);
  const audience = env.AUTH0_AUDIENCE?.trim();

  await setSignedCookie(
    cookies,
    TRANSACTION_COOKIE_NAME,
    {
      state,
      nonce,
      codeVerifier,
      returnTo,
    },
    TRANSACTION_MAX_AGE,
  );

  const authorizeUrl = new URL('authorize', getIssuer());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', requireEnv('AUTH0_CLIENT_ID'));
  authorizeUrl.searchParams.set('redirect_uri', `${origin}/auth/callback`);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  if (audience) {
    authorizeUrl.searchParams.set('audience', audience);
  }

  throw redirect(302, authorizeUrl.toString());
}

export async function completeAuthFlow(cookies: Cookies, url: URL): Promise<never> {
  const transactionToken = cookies.get(TRANSACTION_COOKIE_NAME);
  cookies.delete(TRANSACTION_COOKIE_NAME, { path: '/' });

  if (!transactionToken) {
    throw redirect(302, '/auth/login');
  }

  const transaction = await verifyToken<AuthTransaction>(transactionToken);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const authError = url.searchParams.get('error');

  if (authError || !code || !state || state !== transaction.state) {
    throw redirect(302, '/auth/login');
  }

  const tokenResponse = await fetch(new URL('oauth/token', getIssuer()), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: requireEnv('AUTH0_CLIENT_ID'),
      client_secret: requireEnv('AUTH0_CLIENT_SECRET'),
      code,
      code_verifier: transaction.codeVerifier,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });

  if (!tokenResponse.ok) {
    throw redirect(302, '/auth/login');
  }

  const tokens = (await tokenResponse.json()) as { id_token?: string };

  if (!tokens.id_token) {
    throw redirect(302, '/auth/login');
  }

  const verified = await jwtVerify(tokens.id_token, jwks, {
    issuer: getIssuer(),
    audience: requireEnv('AUTH0_CLIENT_ID'),
  });

  if (verified.payload.nonce !== transaction.nonce || typeof verified.payload.sub !== 'string') {
    throw redirect(302, '/auth/login');
  }

  const user: AuthUser = {
    sub: verified.payload.sub,
    name: typeof verified.payload.name === 'string' ? verified.payload.name : null,
    email: typeof verified.payload.email === 'string' ? verified.payload.email : null,
    picture: typeof verified.payload.picture === 'string' ? verified.payload.picture : null,
  };

  await setSignedCookie(cookies, SESSION_COOKIE_NAME, { user }, SESSION_MAX_AGE);

  throw redirect(302, normalizeReturnTo(transaction.returnTo));
}

export function clearSession(cookies: Cookies) {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  cookies.delete(TRANSACTION_COOKIE_NAME, { path: '/' });
}

export function buildLogoutUrl(origin: string) {
  const logoutUrl = new URL('v2/logout', getIssuer());
  logoutUrl.searchParams.set('client_id', requireEnv('AUTH0_CLIENT_ID'));
  logoutUrl.searchParams.set('returnTo', origin);
  return logoutUrl.toString();
}

export function normalizeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}
