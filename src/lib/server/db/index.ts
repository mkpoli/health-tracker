import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

// A database waking from idle can leave a request hanging for minutes.
// Bounding every transport attempt turns that hang into a fast failure the
// caller can retry.
const REQUEST_TIMEOUT_MS = 10_000;

function boundedFetch(input: Request | URL | string, init?: RequestInit) {
  return fetch(input as never, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

function getDb(): Db {
  if (_db) return _db;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
  // The https scheme selects the HTTP transport, which honours the bounded
  // fetch; the default libsql scheme would open a websocket that ignores it.
  const url = env.DATABASE_URL.replace(/^libsql:/, 'https:');
  const client = url.startsWith('https:')
    ? createClient({ url, authToken: env.DATABASE_AUTH_TOKEN, fetch: boundedFetch })
    : createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  _db = drizzle(client, { schema });
  return _db;
}

// Proxy so importers can keep writing `db.select(...)` etc. — the underlying
// client is only constructed on first property access, which keeps the
// SvelteKit build's static analyse step from tripping on missing env vars.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as Db;

/**
 * Runs a read-only batch, retrying once after a short pause. The retry is
 * safe only because nothing in the batch writes; a wake-from-idle failure on
 * the first attempt resolves on the second.
 */
export async function withReadRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return read();
  }
}
