import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const databasePath = join(tmpdir(), `health-tracker-mcp-oauth-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let oauth: typeof import('./oauth');

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_AUTH_TOKEN = 'local-test-token';
  vi.doMock('$env/dynamic/private', () => ({
    env: {
      DATABASE_URL: databaseUrl,
      DATABASE_AUTH_TOKEN: 'local-test-token',
      MCP_TOKEN_SECRET: 'synthetic-test-secret-not-real-0123456789',
    },
  }));
  client = createClient({ url: databaseUrl });
  await client.execute(
    `CREATE TABLE mcp_grant (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, client_id TEXT NOT NULL, patient_ids TEXT NOT NULL, share_demographics INTEGER NOT NULL DEFAULT 0, scope TEXT NOT NULL, refresh_token_hash TEXT, previous_refresh_token_hash TEXT, refresh_rotated_at TEXT, refresh_expires_at TEXT, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z', last_used_at TEXT, revoked_at TEXT)`,
  );
  oauth = await import('./oauth');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([unlink(databasePath), unlink(`${databasePath}-wal`), unlink(`${databasePath}-shm`)]);
});

const START = Date.parse('2026-11-17T20:15:00.000Z');

async function revoked() {
  const rows = await client.execute(`SELECT revoked_at FROM mcp_grant WHERE id='grant-1'`);
  return rows.rows[0]!.revoked_at !== null;
}

describe('refresh token rotation', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: START });
    await client.execute('DELETE FROM mcp_grant');
    await client.execute(
      `INSERT INTO mcp_grant (id, owner_user_id, client_id, patient_ids, scope) VALUES ('grant-1', 'owner-1', 'client-1', '["profile-1"]', 'health:read')`,
    );
    await oauth.setRefreshToken('grant-1', 'first-token');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a retried rotation with the token the first answer carried', async () => {
    const rotated = await oauth.rotateRefreshToken('first-token');
    expect(rotated?.refreshToken).toBeTruthy();

    vi.setSystemTime(START + 60_000);
    const retried = await oauth.rotateRefreshToken('first-token');
    expect(retried?.refreshToken).toBe(rotated!.refreshToken);
    expect(await revoked()).toBe(false);

    const onward = await oauth.rotateRefreshToken(retried!.refreshToken);
    expect(onward?.refreshToken).toBeTruthy();
    expect(onward!.refreshToken).not.toBe(rotated!.refreshToken);
  });

  it('revokes the grant when a spent token returns after the retry window', async () => {
    const rotated = await oauth.rotateRefreshToken('first-token');

    vi.setSystemTime(START + (oauth.REFRESH_RETRY_WINDOW + 1) * 1000);
    expect(await oauth.rotateRefreshToken('first-token')).toBeNull();
    expect(await revoked()).toBe(true);
    expect(await oauth.rotateRefreshToken(rotated!.refreshToken)).toBeNull();
  });

  it('refuses a token two generations old inside the window', async () => {
    const second = await oauth.rotateRefreshToken('first-token');
    await oauth.rotateRefreshToken(second!.refreshToken);

    expect(await oauth.rotateRefreshToken('first-token')).toBeNull();
    expect(await revoked()).toBe(false);
  });

  it('refuses a token it never issued and leaves the grant alone', async () => {
    expect(await oauth.rotateRefreshToken('unknown-token')).toBeNull();
    expect(await revoked()).toBe(false);
  });
});
