import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

function getDb(): Db {
  if (_db) return _db;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
  const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  _db = drizzle(client, { schema });
  return _db;
}

// The database server can stall on a request far longer than a person will
// wait — observed as minutes-long hangs ending in an upstream 524 while
// neighbouring requests answered in seconds. A second client, used only for
// retryable read batches, bounds every transport attempt so such a stall
// fails fast and the retry lands on a healthy path. Writes stay on the
// default client: an aborted commit can report failure after the server
// applied it, so a write must never race a timeout.
const READ_TIMEOUT_MS = 15_000;

function boundedFetch(input: Request | URL | string, init?: RequestInit) {
  return fetch(input as never, { ...init, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
}

let _readDb: Db | null = null;

function getReadDb(): Db {
  if (_readDb) return _readDb;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
  // On workerd the client already maps libsql: to the HTTP transport; the
  // rewrite makes the node runtime (dev server) take the same transport, so
  // the bounded fetch holds everywhere.
  const url = env.DATABASE_URL.replace(/^libsql:/, 'https:');
  if (!url.startsWith('https:')) return getDb();
  _readDb = drizzle(
    createClient({ url, authToken: env.DATABASE_AUTH_TOKEN, fetch: boundedFetch }),
    { schema },
  );
  return _readDb;
}

/** Read-only client with bounded attempts; every query through it must be
 * safe to repeat. */
export const readDb = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getReadDb() as object, prop, receiver);
  },
}) as Db;

// Proxy so importers can keep writing `db.select(...)` etc. — the underlying
// client is only constructed on first property access, which keeps the
// SvelteKit build's static analyse step from tripping on missing env vars.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as Db;

/** Walks the cause chain for the shape of a transport failure: an aborted or
 * timed-out attempt, a network error, or a server that answered 5xx. A SQL or
 * schema error fails the same way every time and is not worth repeating. */
export function isTransientReadError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      if (current.name === 'AbortError' || current.name === 'TimeoutError') return true;
      if (current.name === 'TypeError') return true;
      if ('code' in current && (current as { code?: unknown }).code === 'SERVER_ERROR') return true;
      if (/status 5\d\d/i.test(current.message)) return true;
      current = current.cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * Runs a read-only batch, retrying once after a short pause when the failure
 * looks like transport trouble. The retry is safe only because nothing in the
 * batch writes.
 */
export async function withReadRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isTransientReadError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return read();
  }
}
