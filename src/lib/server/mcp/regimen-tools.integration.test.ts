import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type { McpContext } from './context';

const databasePath = join(tmpdir(), `health-tracker-mcp-regimens-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let claimTools: typeof import('./claim-tools');
let regimenTools: typeof import('./regimen-tools');
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
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy', 'medicine_course', 'dose_regimen')),
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
  regimenTools = await import('./regimen-tools');
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
  const definition = [...claimTools.healthClaimTools, ...regimenTools.regimenTools].find(
    (candidate) => candidate.name === name,
  );
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

describe('MCP medicine plans', () => {
  it('reads the plan, replaces the rule from a date, corrects it in place and ends the course', async () => {
    const created = (await tool('create_medicine').handler(context, {
      patient_id: 'profile-1',
      request_id: 'montelukast',
      name: 'モンテルカスト',
      strength: '10 mg',
      status: 'active',
      start_date: '2026-09-09',
      regimen: {
        rule: 'fixed_slots',
        slots: [{ label: '就寝前', anchor: { kind: 'bedtime' }, amount_value: 1, amount_unit: '錠' }],
      },
    })) as any;
    const medicineId = created.medicine.medicine_id;

    const plan = (await tool('get_medicine_plan').handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
    })) as any;
    expect(plan.courses).toHaveLength(1);
    expect(plan.courses[0].regimens).toEqual([created.regimen]);

    const set = tool('set_regimen');
    const doubled = (await set.handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
      request_id: 'montelukast-double',
      regimen: {
        rule: 'fixed_slots',
        effective_from: '2026-09-20',
        slots: [{ label: '就寝前', anchor: { kind: 'bedtime' }, amount_value: 2, amount_unit: '錠' }],
      },
    })) as any;
    expect(doubled.created).toBe(true);
    expect(doubled.course.course_id).toBe(plan.courses[0].course_id);
    expect(doubled.regimen).toMatchObject({ effective_from: '2026-09-20', effective_to: null });

    const replay = (await set.handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
      request_id: 'montelukast-double',
      regimen: { rule: 'as_needed', effective_from: '2026-10-01' },
    })) as any;
    expect(replay.created).toBe(false);
    expect(replay.regimen.regimen_id).toBe(doubled.regimen.regimen_id);

    await expect(
      set.handler(context, {
        patient_id: 'profile-1',
        medicine_id: medicineId,
        request_id: 'no-date',
        regimen: { rule: 'as_needed' },
      }),
    ).rejects.toThrow('regimen.effective_from is required');
    await expect(
      set.handler(context, {
        patient_id: 'profile-1',
        medicine_id: medicineId,
        request_id: 'same-day',
        regimen: { rule: 'as_needed', effective_from: '2026-09-20' },
      }),
    ).rejects.toThrow('correct it with update_regimen');
    // The create's request_id names other rows; reusing it here starts a new rule.
    const reusedKey = (await set.handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
      request_id: 'montelukast',
      regimen: { rule: 'fixed_slots', effective_from: '2026-09-25', slots: [{ anchor: { kind: 'wake' } }] },
    })) as any;
    expect(reusedKey.created).toBe(true);
    expect(reusedKey.regimen.regimen_id).not.toBe(created.regimen.regimen_id);

    const after = (await tool('get_medicine_plan').handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
    })) as any;
    expect(after.courses[0].regimens.map((regimen: any) => [regimen.effective_from, regimen.effective_to])).toEqual([
      ['2026-09-25', null],
      ['2026-09-20', '2026-09-24'],
      ['2026-09-09', '2026-09-19'],
    ]);
    const first = after.courses[0].regimens[2];
    expect(first.revision).toBe(2);
    // A read of the plan can be sent back as a write.
    const echoed = (await tool('update_regimen').handler(context, {
      patient_id: 'profile-1',
      regimen_id: first.regimen_id,
      expected_revision: 2,
      regimen: {
        rule: first.rule,
        slots: first.slots,
        effective_from: first.effective_from,
        effective_to: first.effective_to,
      },
    })) as any;
    expect(echoed.regimen.slots).toEqual(first.slots);

    const update = tool('update_regimen');
    const corrected = (await update.handler(context, {
      patient_id: 'profile-1',
      regimen_id: doubled.regimen.regimen_id,
      expected_revision: 2,
      regimen: {
        rule: 'fixed_slots',
        slots: [
          { key: 0, label: '就寝前', anchor: { kind: 'bedtime' }, amount_value: 2, amount_unit: '錠' },
          { label: '朝食後', anchor: { kind: 'meal', meal: 'breakfast', offset_minutes: 30 } },
        ],
        dose_text: '合計3錠',
        effective_to: '2026-09-24',
      },
    })) as any;
    expect(corrected.regimen).toMatchObject({
      revision: 3,
      effective_from: '2026-09-20',
      timezone: 'Asia/Tokyo',
      dose_text: '合計3錠',
      slots: [
        { key: 0, label: '就寝前' },
        { key: 1, label: '朝食後', anchor: { kind: 'meal', meal: 'breakfast', offset_minutes: 30 } },
      ],
    });
    await expect(
      update.handler(context, {
        patient_id: 'profile-1',
        regimen_id: doubled.regimen.regimen_id,
        expected_revision: 2,
        regimen: { rule: 'as_needed' },
      }),
    ).rejects.toThrow('current_revision is 3');
    await expect(
      update.handler(context, {
        patient_id: 'profile-1',
        regimen_id: doubled.regimen.regimen_id,
        expected_revision: 3,
        regimen: { rule: 'as_needed', effective_from: '2026-09-15' },
      }),
    ).rejects.toThrow('overlaps another rule');

    // A removed slot's key is never handed to a new slot: a dose taken under
    // key 1 must not turn up as taken for whatever slot comes next.
    await client.execute({
      sql: `INSERT INTO dose_occurrence (id, patient_id, course_id, regimen_id, regimen_revision, slot_key, local_date, timezone, status)
            VALUES ('occ-1', 'profile-1', ?, ?, 3, 1, '2026-09-21', 'Asia/Tokyo', 'taken')`,
      args: [doubled.course.course_id, doubled.regimen.regimen_id],
    });
    const rekeyed = (await update.handler(context, {
      patient_id: 'profile-1',
      regimen_id: doubled.regimen.regimen_id,
      expected_revision: 3,
      regimen: {
        rule: 'fixed_slots',
        slots: [
          { key: 0, label: '就寝前', anchor: { kind: 'bedtime' } },
          { label: '昼食後', anchor: { kind: 'meal', meal: 'lunch' } },
        ],
        effective_to: '2026-09-24',
      },
    })) as any;
    expect(rekeyed.regimen.slots.map((slot: any) => [slot.key, slot.label])).toEqual([
      [0, '就寝前'],
      [2, '昼食後'],
    ]);

    const courseTool = tool('update_course');
    const courseId = doubled.course.course_id;
    await expect(
      courseTool.handler(context, {
        patient_id: 'profile-1',
        course_id: courseId,
        expected_revision: 1,
        status: 'ended',
        end_date: '2026-09-01',
      }),
    ).rejects.toThrow('end_date must not fall before start_date');
    await expect(
      courseTool.handler(context, {
        patient_id: 'profile-1',
        course_id: courseId,
        expected_revision: 1,
        status: 'ended',
      }),
    ).rejects.toThrow('needs its end_date');
    const ended = (await courseTool.handler(context, {
      patient_id: 'profile-1',
      course_id: courseId,
      expected_revision: 1,
      status: 'ended',
      end_date: '2026-09-16',
      end_reason: 'No longer needed',
    })) as any;
    expect(ended.course).toMatchObject({
      course_id: courseId,
      status: 'ended',
      end_date: '2026-09-16',
      end_reason: 'No longer needed',
      revision: 2,
    });
    await expect(
      courseTool.handler(context, {
        patient_id: 'profile-1',
        course_id: courseId,
        expected_revision: 1,
        status: 'ended',
        end_date: '2026-09-17',
      }),
    ).rejects.toThrow('current_revision is 2');

    const restarted = (await set.handler(context, {
      patient_id: 'profile-1',
      medicine_id: medicineId,
      request_id: 'montelukast-restart',
      regimen: {
        rule: 'fixed_slots',
        effective_from: '2026-10-01',
        slots: [{ label: '就寝前', anchor: { kind: 'bedtime' } }],
      },
    })) as any;
    expect(restarted.course).toMatchObject({
      kind: 'restart',
      status: 'active',
      previous_course_id: ended.course.course_id,
      start_date: '2026-10-01',
    });
    const activated = (await courseTool.handler(context, {
      patient_id: 'profile-1',
      course_id: restarted.course.course_id,
      expected_revision: 1,
      status: 'held',
    })) as any;
    expect(activated.course).toMatchObject({ status: 'held', start_date: '2026-10-01', revision: 2 });

    const history = tool('get_claim_history');
    const medicineHistory = (await history.handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'medicine',
      claim_id: medicineId,
    })) as any;
    expect(medicineHistory.total).toBe(1);
    const courseHistory = (await history.handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'medicine_course',
      claim_id: courseId,
    })) as any;
    expect(courseHistory.current).toEqual(ended.course);
    expect(courseHistory.revisions.map((revision: any) => [revision.revision, revision.snapshot.status])).toEqual([
      [2, 'ended'],
      [1, 'active'],
    ]);
    const regimenHistory = (await history.handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'dose_regimen',
      claim_id: doubled.regimen.regimen_id,
    })) as any;
    expect(regimenHistory.current).toEqual(rekeyed.regimen);
    expect(regimenHistory.revisions.map((revision: any) => revision.revision)).toEqual([4, 3, 2, 1]);
    expect(regimenHistory.revisions[0].change_source).toEqual({ kind: 'mcp', provider: 'mcp:assistant-client' });
  });

  it('gives a medicine that was never planned its first course', async () => {
    await client.execute({
      sql: `INSERT INTO medicine_claim (id, patient_id, name, status, start_date) VALUES (?, ?, ?, ?, ?)`,
      args: ['loose-1', 'profile-1', 'Loose tablet', 'active', '2026-08-01'],
    });
    const result = (await tool('set_regimen').handler(context, {
      patient_id: 'profile-1',
      medicine_id: 'loose-1',
      request_id: 'loose-plan',
      regimen: { rule: 'interval', effective_from: '2026-09-01', interval_hours: 48, anchor_at: '2026-09-01T20:00' },
    })) as any;
    expect(result.course).toMatchObject({ kind: 'initial', status: 'active', start_date: '2026-08-01' });
    expect(result.regimen).toMatchObject({
      rule: 'interval',
      interval_hours: 48,
      anchor_at: '2026-09-01T11:00:00.000Z',
    });

    await expect(
      tool('get_medicine_plan').handler(context, { patient_id: 'profile-2', medicine_id: 'loose-1' }),
    ).rejects.toThrow('No such patient');
  });
});
