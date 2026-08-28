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

// A database waking from idle can leave a request hanging for minutes. A
// second client, used only for retryable read batches, bounds every transport
// attempt so a stalled wake fails fast and the retry lands on the woken
// database. Writes stay on the default client: an aborted commit can report
// failure after the server applied it, so a write must never race a timeout.
const READ_TIMEOUT_MS = 15_000;

function boundedFetch(input: Request | URL | string, init?: RequestInit) {
  return fetch(input as never, { ...init, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
}

let _readDb: Db | null = null;

function getReadDb(): Db {
  if (_readDb) return _readDb;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
  // The https scheme selects the HTTP transport, which honours the bounded
  // fetch; the default libsql scheme would open a websocket that ignores it.
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

/**
 * Runs a read-only batch, retrying once after a short pause. The retry is
 * safe only because nothing in the batch writes; a wake-from-idle failure on
 * the first attempt resolves on the second.
 */
export async function withReadRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      return await read();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
