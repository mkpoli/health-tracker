import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type { McpContext } from './context';

const databasePath = join(tmpdir(), `health-tracker-mcp-claims-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let claimTools: typeof import('./claim-tools');
let toolsModule: typeof import('./tools');
let protocolModule: typeof import('./protocol');
let contextModule: typeof import('./context');

const context: McpContext = {
  userId: 'owner-1',
  grant: { id: 'grant-1', lastUsedAt: null },
  clientId: 'assistant-client',
  patientIds: ['profile-1'],
  shareDemographics: false,
  canWriteMeasurements: true,
  canWriteClaims: true,
  origin: 'https://health.example',
  now: Date.parse('2026-08-15T12:34:56.000Z'),
};

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_AUTH_TOKEN = 'local-test-token';
  vi.doMock('$env/dynamic/private', () => ({
    env: {
      DATABASE_URL: databaseUrl,
      DATABASE_AUTH_TOKEN: 'local-test-token',
    },
  }));
  client = createClient({ url: databaseUrl });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE patient (
      id TEXT PRIMARY KEY NOT NULL,
      owner_user_id TEXT,
      name TEXT NOT NULL,
      agab TEXT,
      birthday TEXT,
      extra_data TEXT
    );
    CREATE TABLE medicine_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      generic_name TEXT,
      form TEXT,
      strength TEXT,
      route TEXT,
      schedule TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT,
      end_date TEXT,
      purpose TEXT,
      prescriber TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE energy_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      label TEXT,
      category TEXT,
      energy_kcal REAL,
      occurred_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      timezone TEXT,
      timezone_offset_minutes INTEGER NOT NULL,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'recorded',
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE UNIQUE INDEX energy_claim_id_patient_idx ON energy_claim(id, patient_id);
    CREATE UNIQUE INDEX energy_claim_external_idx
      ON energy_claim(patient_id, origin_provider, origin_external_id);
    CREATE TABLE energy_source (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      energy_claim_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      file_name TEXT,
      byte_size INTEGER NOT NULL,
      object_etag TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (energy_claim_id, patient_id)
        REFERENCES energy_claim(id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy')),
      claim_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL DEFAULT 'manual',
      change_origin_provider TEXT
    );
    CREATE UNIQUE INDEX claim_revision_claim_idx
      ON claim_revision(claim_kind, claim_id, revision);
    INSERT INTO patient (id, owner_user_id, name, extra_data) VALUES
      ('profile-1', 'owner-1', 'Primary', '{"timeZone":"Asia/Tokyo"}'),
      ('profile-2', 'owner-1', 'Outside grant', '{"timeZone":"UTC"}'),
      ('profile-3', 'owner-2', 'Other owner', '{"timeZone":"UTC"}');
  `);
  claimTools = await import('./claim-tools');
  toolsModule = await import('./tools');
  protocolModule = await import('./protocol');
  contextModule = await import('./context');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([
    unlink(databasePath),
    unlink(`${databasePath}-shm`),
    unlink(`${databasePath}-wal`),
  ]);
});

function tool(name: string) {
  const definition = claimTools.healthClaimTools.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

describe('MCP medicine claims', () => {
  it('uses request IDs for retry safety and keeps every saved revision', async () => {
    const create = tool('create_medicine');
    const first = (await create.handler(context, {
      patient_id: 'profile-1',
      request_id: 'medicine-chat-1',
      name: 'Amoxicillin',
      form: 'capsule',
      strength: '500 mg',
      schedule: 'Three times daily',
      status: 'active',
    })) as any;
    const retry = (await create.handler(context, {
      patient_id: 'profile-1',
      request_id: 'medicine-chat-1',
      name: 'Changed retry payload',
      status: 'stopped',
    })) as any;

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.medicine).toMatchObject({
      medicine_id: first.medicine.medicine_id,
      name: 'Amoxicillin',
      revision: 1,
    });

    const update = tool('update_medicine');
    const changed = (await update.handler(context, {
      patient_id: 'profile-1',
      medicine_id: first.medicine.medicine_id,
      expected_revision: 1,
      schedule: 'Every eight hours with food',
      notes: 'Confirmed in chat',
    })) as any;
    expect(changed.medicine).toMatchObject({
      name: 'Amoxicillin',
      schedule: 'Every eight hours with food',
      revision: 2,
    });

    await expect(
      update.handler(context, {
        patient_id: 'profile-1',
        medicine_id: first.medicine.medicine_id,
        expected_revision: 1,
        schedule: 'Stale edit',
      }),
    ).rejects.toThrow('current_revision is 2');

    const history = (await tool('get_claim_history').handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'medicine',
      claim_id: first.medicine.medicine_id,
    })) as any;
    expect(history.total).toBe(2);
    expect(history.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect(history.revisions[0].change_source).toEqual({
      kind: 'mcp',
      provider: 'mcp:assistant-client',
    });

    const counts = await client.execute(`
      SELECT
        (SELECT count(*) FROM medicine_claim) AS medicines,
        (SELECT count(*) FROM claim_revision WHERE claim_kind = 'medicine') AS revisions
    `);
    expect(counts.rows[0]).toMatchObject({ medicines: 1, revisions: 2 });
  });

  it('filters the current catalog and enforces the selected-profile grant', async () => {
    const listed = (await tool('list_medicines').handler(context, {
      patient_id: 'profile-1',
      query: 'amoxi',
      status: 'active',
    })) as any;
    expect(listed.total).toBe(1);
    expect(listed.medicines[0].name).toBe('Amoxicillin');

    await expect(
      tool('list_medicines').handler(context, { patient_id: 'profile-2' }),
    ).rejects.toThrow('No such patient');
    await expect(
      tool('list_medicines').handler(context, {
        patient_id: 'profile-1',
        status: 7,
      }),
    ).rejects.toThrow('status must be text');
  });
});

describe('MCP energy claims', () => {
  it('separates intake and expenditure while retaining local time and source counts', async () => {
    const log = tool('log_energy_entry');
    const meal = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'meal-1',
      direction: 'intake',
      label: 'Rice bowl',
      category: 'lunch',
      energy_kcal: 640,
      occurred_at: '2026-08-15T12:15:00+09:00',
      timezone: 'Asia/Tokyo',
    })) as any;
    const exercise = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'exercise-1',
      direction: 'expenditure',
      label: 'Strength training',
      energy_kcal: 300,
      duration_minutes: 50,
      occurred_at: '2026-08-15T18:00:00+09:00',
      timezone: 'Asia/Tokyo',
    })) as any;
    const retry = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'meal-1',
      direction: 'intake',
      label: 'Duplicate',
      energy_kcal: 999,
    })) as any;

    expect(meal.created).toBe(true);
    expect(exercise.created).toBe(true);
    expect(retry).toMatchObject({
      created: false,
      entry: { energy_entry_id: meal.entry.energy_entry_id, energy_kcal: 640 },
    });
    expect(meal.entry).toMatchObject({
      occurred_at: '2026-08-15T03:15:00.000Z',
      local_date: '2026-08-15',
      timezone_offset_minutes: 540,
    });

    await client.execute({
      sql: `INSERT INTO energy_source
        (patient_id, energy_claim_id, storage_key, mime_type, file_name, byte_size)
        VALUES (?, ?, ?, 'image/jpeg', 'meal.jpg', 1234)`,
      args: ['profile-1', meal.entry.energy_entry_id, 'energy/profile-1/meal.jpg'],
    });

    const listed = (await tool('list_energy_entries').handler(context, {
      patient_id: 'profile-1',
      from: '2026-08-15',
      to: '2026-08-15',
    })) as any;
    expect(listed.total).toBe(2);
    expect(listed.totals_kcal).toEqual({ intake: 640, expenditure: 300, net: 340 });
    expect(
      listed.entries.find((entry: any) => entry.energy_entry_id === meal.entry.energy_entry_id),
    ).toMatchObject({ retained_file_count: 1 });
    expect(listed.entries.every((entry: any) => !('source_url' in entry))).toBe(true);
    await expect(
      tool('list_energy_entries').handler(context, {
        patient_id: 'profile-1',
        query: { value: 'rice' },
      }),
    ).rejects.toThrow('query must be text');
  });

  it('updates a claim optimistically and accepts a labeled draft', async () => {
    const listed = (await tool('list_energy_entries').handler(context, {
      patient_id: 'profile-1',
      query: 'rice',
    })) as any;
    const meal = listed.entries[0];
    const changed = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: meal.energy_entry_id,
      expected_revision: meal.revision,
      energy_kcal: 675,
      notes: 'Estimate corrected',
    })) as any;
    expect(changed.entry).toMatchObject({
      energy_kcal: 675,
      revision: 2,
      retained_file_count: 1,
    });

    await expect(
      tool('update_energy_entry').handler(context, {
        patient_id: 'profile-1',
        energy_entry_id: meal.energy_entry_id,
        expected_revision: 1,
        energy_kcal: 700,
      }),
    ).rejects.toThrow('current_revision is 2');

    const draft = (await tool('log_energy_entry').handler(context, {
      patient_id: 'profile-1',
      request_id: 'unestimated-meal',
      direction: 'intake',
      label: 'Meal photo to review later',
      occurred_at: '2026-08-16T08:00:00+09:00',
    })) as any;
    expect(draft.entry).toMatchObject({ energy_kcal: null, status: 'draft' });

    const history = (await tool('get_claim_history').handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'energy',
      claim_id: meal.energy_entry_id,
    })) as any;
    expect(history.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect(history.current.retained_file_count).toBe(1);
    expect(history.revisions[0].snapshot.retained_file_count).toBe(1);
  });
});

describe('MCP claim permissions', () => {
  it('requires the token and stored grant to carry the same write scope', () => {
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:claims:write',
        'health:read health:claims:write',
        'health:claims:write',
      ),
    ).toBe(true);
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:claims:write',
        'health:read health:write',
        'health:claims:write',
      ),
    ).toBe(false);
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:write',
        'health:read health:claims:write',
        'health:claims:write',
      ),
    ).toBe(false);
  });

  it('hides writes from read grants and advertises retry-safe creation', async () => {
    const readContext = {
      ...context,
      canWriteMeasurements: false,
      canWriteClaims: false,
    };
    const names = toolsModule.toolsFor(readContext).map((definition) => definition.name);
    expect(names).toContain('list_medicines');
    expect(names).toContain('list_energy_entries');
    expect(names).toContain('get_claim_history');
    expect(names).not.toContain('create_medicine');
    expect(names).not.toContain('log_energy_entry');

    const measurementNames = toolsModule
      .toolsFor({ ...context, canWriteMeasurements: true, canWriteClaims: false })
      .map((definition) => definition.name);
    expect(measurementNames).toContain('log_measurement');
    expect(measurementNames).not.toContain('create_medicine');

    const claimNames = toolsModule
      .toolsFor({ ...context, canWriteMeasurements: false, canWriteClaims: true })
      .map((definition) => definition.name);
    expect(claimNames).not.toContain('log_measurement');
    expect(claimNames).toContain('create_medicine');

    const response = (await protocolModule.dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
    )) as any;
    const definitions = response.result.tools as any[];
    expect(definitions.find((definition) => definition.name === 'create_medicine').annotations)
      .toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });

    const refused = (await protocolModule.dispatch(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_medicine',
          arguments: {
            patient_id: 'profile-1',
            request_id: 'read-only-attempt',
            name: 'Should stay absent',
          },
        },
      },
      readContext,
    )) as any;
    expect(refused.result.isError).toBe(true);
    const absent = await client.execute({
      sql: 'SELECT count(*) AS count FROM medicine_claim WHERE name = ?',
      args: ['Should stay absent'],
    });
    expect(absent.rows[0]?.count).toBe(0);
  });
});
