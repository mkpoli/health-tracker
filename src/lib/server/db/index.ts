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

// Proxy so importers can keep writing `db.select(...)` etc. — the underlying
// client is only constructed on first property access, which keeps the
// SvelteKit build's static analyse step from tripping on missing env vars.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as Db;
