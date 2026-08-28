import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type { McpContext } from './context';

const databasePath = join(tmpdir(), `health-tracker-mcp-doses-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let doseTools: typeof import('./dose-tools');

const context: McpContext = {
  userId: 'owner-1',
  grant: { id: 'grant-1', lastUsedAt: null },
  clientId: 'watcher-client',
  patientIds: ['profile-1'],
  shareDemographics: false,
  canWriteMeasurements: false,
  canWriteClaims: true,
  origin: 'https://health.example',
  now: Date.parse('2026-08-28T03:00:00.000Z'),
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
    CREATE TABLE medicine_course (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      medicine_claim_id TEXT NOT NULL REFERENCES medicine_claim(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'initial',
      status TEXT NOT NULL DEFAULT 'active',
      previous_course_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      end_reason TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE dose_regimen (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES medicine_course(id) ON DELETE CASCADE,
      rule_kind TEXT NOT NULL,
      slots TEXT NOT NULL DEFAULT '[]',
      days_of_week TEXT,
      interval_hours REAL,
      anchor_at TEXT,
      dose_text TEXT,
      route TEXT,
      site TEXT,
      timezone TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      remind_minutes_before INTEGER,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE dose_occurrence (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES medicine_course(id) ON DELETE CASCADE,
      regimen_id TEXT REFERENCES dose_regimen(id) ON DELETE SET NULL,
      regimen_revision INTEGER,
      slot_key INTEGER,
      local_date TEXT NOT NULL,
      planned_at TEXT,
      timezone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      actual_at TEXT,
      actual_value REAL,
      actual_unit TEXT,
      actual_text TEXT,
      route TEXT,
      site TEXT,
      reason TEXT,
      reaction TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE UNIQUE INDEX dose_occurrence_slot_idx
      ON dose_occurrence(regimen_id, local_date, slot_key);
    CREATE TABLE dose_delivery (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      occurrence_ref TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      channel TEXT NOT NULL,
      provider TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE UNIQUE INDEX dose_delivery_attempt_idx
      ON dose_delivery(patient_id, occurrence_ref, delivered_at, channel);
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL,
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
      ('profile-1', 'owner-1', 'Primary', '{"timeZone":"Asia/Tokyo"}');
    INSERT INTO medicine_claim (id, patient_id, name, generic_name, form, route) VALUES
      ('medicine-1', 'profile-1', 'アモキシシリン', 'amoxicillin', '錠剤', '経口');
    INSERT INTO medicine_course (id, patient_id, medicine_claim_id, kind, status, start_date) VALUES
      ('course-1', 'profile-1', 'medicine-1', 'initial', 'active', '2026-08-01');
    INSERT INTO dose_regimen (
      id, patient_id, course_id, rule_kind, slots, timezone, effective_from, remind_minutes_before
    ) VALUES (
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'profile-1', 'course-1', 'fixed_slots',
      '[{"label":"朝食後","anchorKind":"meal","anchorMeal":"breakfast","anchorOffsetMinutes":null,"time":null,"amountValue":2,"amountUnit":"錠"},{"label":"21:00","anchorKind":"clock","anchorMeal":null,"anchorOffsetMinutes":null,"time":"21:00","amountValue":2,"amountUnit":"錠"}]',
      'Asia/Tokyo', '2026-08-01', 120
    );
  `);
  doseTools = await import('./dose-tools');
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
  const definition = doseTools.doseTools.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

const REGIMEN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('MCP dose tools', () => {
  it('lists planned slots with anchors, instants, and stable ids', async () => {
    const list = tool('list_dose_occurrences');
    const result = (await list.handler(context, {
      patient_id: 'profile-1',
      from: '2026-08-27T15:00:00.000Z',
      to: '2026-08-28T14:00:00.000Z',
    })) as any;

    // One local day (2026-08-28 in Asia/Tokyo): a meal slot and a clock slot.
    expect(result.occurrences).toHaveLength(2);
    const meal = result.occurrences.find((entry: any) => entry.anchor?.kind === 'meal');
    const clock = result.occurrences.find((entry: any) => entry.anchor?.kind === 'clock');

    expect(meal).toMatchObject({
      occurrence_id: `${REGIMEN_ID}:2026-08-28:0`,
      medicine_name: 'アモキシシリン',
      generic_name: 'amoxicillin',
      dose_line: '2錠',
      slot_label: '朝食後',
      anchor: { kind: 'meal', meal: 'breakfast', offset_minutes: null },
      planned_at: null,
      local_date: '2026-08-28',
      timezone: 'Asia/Tokyo',
      status: 'planned',
      as_needed: false,
      remind_minutes_before: 120,
    });
    expect(clock).toMatchObject({
      occurrence_id: `${REGIMEN_ID}:2026-08-28:1`,
      planned_at: '2026-08-28T12:00:00.000Z',
      planned_local: '2026-08-28T21:00',
      utc_offset_minutes: 540,
    });
  });

  it('rejects a window wider than 14 days', async () => {
    const list = tool('list_dose_occurrences');
    await expect(
      list.handler(context, {
        patient_id: 'profile-1',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-20T00:00:00.000Z',
      }),
    ).rejects.toThrowError('The window may span at most 14 days');
  });

  it('records an ack against a composite id, then corrects the same row', async () => {
    const record = tool('record_dose_action');
    const first = (await record.handler(context, {
      patient_id: 'profile-1',
      occurrence_id: `${REGIMEN_ID}:2026-08-28:0`,
      status: 'taken',
      actual_at: '2026-08-28T04:10:00.000Z',
    })) as any;
    expect(first).toMatchObject({ status: 'taken', record_revision: 1 });

    const second = (await record.handler(context, {
      patient_id: 'profile-1',
      occurrence_id: `${REGIMEN_ID}:2026-08-28:0`,
      status: 'partial',
      reason: '半分だけ',
    })) as any;
    expect(second).toMatchObject({ status: 'partial', record_revision: 2 });

    const list = tool('list_dose_occurrences');
    const after = (await list.handler(context, {
      patient_id: 'profile-1',
      from: '2026-08-27T15:00:00.000Z',
      to: '2026-08-28T14:00:00.000Z',
    })) as any;
    const meal = after.occurrences.find(
      (entry: any) => entry.occurrence_id === `${REGIMEN_ID}:2026-08-28:0`,
    );
    expect(meal).toMatchObject({ status: 'partial', reason: '半分だけ', record_revision: 2 });

    const ledger = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM claim_revision WHERE claim_kind = 'dose_occurrence'",
      args: [],
    });
    expect(Number(ledger.rows[0].n)).toBe(2);
  });

  it('answers an identical retry without a new revision and keeps the recorded time', async () => {
    const record = tool('record_dose_action');
    const retry = (await record.handler(context, {
      patient_id: 'profile-1',
      occurrence_id: `${REGIMEN_ID}:2026-08-28:0`,
      status: 'partial',
      reason: '半分だけ',
    })) as any;
    expect(retry).toMatchObject({ status: 'partial', record_revision: 2 });

    const stored = await client.execute({
      sql: "SELECT actual_at FROM dose_occurrence WHERE regimen_id = ? AND slot_key = 0",
      args: [REGIMEN_ID],
    });
    expect(stored.rows[0].actual_at).toBe('2026-08-28T04:10:00.000Z');
  });

  it('rejects a receipt for a dose the profile does not have', async () => {
    const deliver = tool('record_dose_deliveries');
    await expect(
      deliver.handler(context, {
        patient_id: 'profile-1',
        deliveries: [
          {
            occurrence_id: 'ffffffff-0000-0000-0000-000000000000:2026-08-28:0',
            delivered_at: '2026-08-28T03:05:00.000Z',
            channel: 'telegram',
          },
        ],
      }),
    ).rejects.toThrowError('A receipt names a dose slot this profile does not have');
  });

  it('rejects a slot the regimen does not plan', async () => {
    const record = tool('record_dose_action');
    await expect(
      record.handler(context, {
        patient_id: 'profile-1',
        occurrence_id: `${REGIMEN_ID}:2026-08-28:9`,
        status: 'taken',
      }),
    ).rejects.toThrowError('The regimen does not plan this dose slot');
  });

  it('stores delivery receipts idempotently', async () => {
    const deliver = tool('record_dose_deliveries');
    const receipts = {
      patient_id: 'profile-1',
      deliveries: [
        {
          occurrence_id: `${REGIMEN_ID}:2026-08-28:0`,
          delivered_at: '2026-08-28T03:05:00.000Z',
          channel: 'telegram',
        },
        {
          occurrence_id: `${REGIMEN_ID}:2026-08-28:1`,
          delivered_at: '2026-08-28T10:00:00.000Z',
          channel: 'telegram',
        },
      ],
    };

    const first = (await deliver.handler(context, receipts)) as any;
    expect(first).toMatchObject({ recorded: 2, duplicates: 0 });

    const retry = (await deliver.handler(context, receipts)) as any;
    expect(retry).toMatchObject({ recorded: 0, duplicates: 2 });
  });
});
