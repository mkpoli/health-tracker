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
      product_id TEXT,
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
    CREATE INDEX medicine_course_medicine_idx ON medicine_course(medicine_claim_id);
    CREATE INDEX medicine_course_active_snapshot_idx ON medicine_course(medicine_claim_id, patient_id, status);
    CREATE INDEX dose_regimen_course_idx ON dose_regimen(course_id);
    CREATE TABLE mcp_write_receipt (
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL, receipt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX mcp_write_receipt_key_idx ON mcp_write_receipt(patient_id, client_id, operation, request_id);
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

  it('restarts a stopped medicine on a new course', async () => {
    await client.execute({
      sql: `INSERT INTO medicine_claim (id, patient_id, name, status, start_date) VALUES (?, ?, ?, ?, ?)`,
      args: ['stopped-1', 'profile-1', 'Stopped tablet', 'stopped', '2026-09-01'],
    });
    await client.execute({
      sql: `INSERT INTO medicine_course (id, patient_id, medicine_claim_id, status, start_date) VALUES (?, ?, ?, ?, ?)`,
      args: ['stopped-course', 'profile-1', 'stopped-1', 'held', '2026-10-20'],
    });
    const result = (await tool('set_regimen').handler(context, {
      patient_id: 'profile-1',
      medicine_id: 'stopped-1',
      request_id: 'stopped-restart',
      regimen: {
        rule: 'fixed_slots',
        effective_from: '2026-10-25',
        slots: [{ label: '就寝前', anchor: { kind: 'bedtime' } }],
      },
    })) as any;
    expect(result.course).toMatchObject({
      kind: 'restart',
      status: 'active',
      previous_course_id: 'stopped-course',
      start_date: '2026-10-25',
    });

    // A later rule change lands on the same restart course.
    const changed = (await tool('set_regimen').handler(context, {
      patient_id: 'profile-1',
      medicine_id: 'stopped-1',
      request_id: 'stopped-change',
      regimen: {
        rule: 'fixed_slots',
        effective_from: '2026-11-01',
        slots: [{ label: '朝食後', anchor: { kind: 'meal', meal: 'breakfast' } }],
      },
    })) as any;
    expect(changed.course.course_id).toBe(result.course.course_id);
  });
});

describe('stop_medicine_courses', () => {
  async function seed(suffix: string, options: { status?: string; start?: string; end?: string | null } = {}) {
    const medicine = `medicine-${suffix}`;
    const course = `course-${suffix}`;
    const regimen = `regimen-${suffix}`;
    await client.execute({ sql: `INSERT INTO medicine_claim (id, patient_id, name, status, start_date, created_at, updated_at) VALUES (?, 'profile-1', 'Example', ?, '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, args: [medicine, options.status ?? 'active'] });
    await client.execute({ sql: `INSERT INTO medicine_course (id, patient_id, medicine_claim_id, kind, status, start_date, end_date) VALUES (?, 'profile-1', ?, 'restart', 'active', ?, ?)`, args: [course, medicine, options.start ?? '2026-01-01', options.end ?? null] });
    await client.execute({ sql: `INSERT INTO dose_regimen (id, patient_id, course_id, rule_kind, timezone, effective_from) VALUES (?, 'profile-1', ?, 'as_needed', 'UTC', ?)`, args: [regimen, course, options.start ?? '2026-01-01'] });
    return { patient_id: 'profile-1', medicine_id: medicine, expected_medicine_revision: 1, expected_courses: [{ course_id: course, revision: 1, regimens: [{ regimen_id: regimen, revision: 1 }] }], end_date: '2026-02-01', request_id: `request-${suffix}` };
  }
  const call = async (args: Record<string, unknown>, ctx = context) => {
    const definition = toolsModule.tools.find((entry) => entry.name === 'stop_medicine_courses');
    if (!definition) throw new Error('Missing tool');
    return definition.handler(ctx, args) as Promise<any>;
  };

  it('returns an immutable receipt through MCP, including stopped-claim restarts and preserved doses', async () => {
    const args = await seed('receipt', { status: 'stopped' });
    await client.execute(`UPDATE medicine_claim SET end_date='2026-01-15' WHERE id='medicine-receipt'`);
    await client.execute({ sql: `INSERT INTO dose_occurrence (id,patient_id,course_id,regimen_id,local_date,timezone,status) VALUES ('receipt-dose','profile-1',?,?,'2026-01-02','UTC','taken')`, args: [args.expected_courses[0].course_id, args.expected_courses[0].regimens[0].regimen_id] });
    const response = await protocolModule.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'stop_medicine_courses', arguments: args } }, { ...context, grant: { ...context.grant, lastUsedAt: new Date().toISOString() } });
    const result = response?.result as any;
    const expected = {
      request_id: args.request_id,
      medicine: { medicine_id: args.medicine_id, patient_id: 'profile-1', product_id: null, name: 'Example', generic_name: null, form: null, strength: null, route: null, status: 'stopped', start_date: '2026-01-01', end_date: '2026-02-01', purpose: null, prescriber: null, notes: null, origin: { kind: 'manual', provider: null, external_id: null }, revision: 2, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-08-15T12:34:56.000Z' },
      courses: [{ course_id: 'course-receipt', old_revision: 1, new_revision: 2, old_status: 'active', new_status: 'ended', old_end_date: null, new_end_date: '2026-02-01', regimens: [{ regimen_id: 'regimen-receipt', old_revision: 1, new_revision: 1, old_effective_to: null, new_effective_to: null }] }],
    };
    expect(result.structuredContent).toEqual(expected);
    expect(JSON.parse(result.content[0].text)).toEqual(expected);
    expect((await client.execute(`SELECT status FROM dose_occurrence WHERE id = 'receipt-dose'`)).rows[0].status).toBe('taken');
    await client.execute(`UPDATE medicine_claim SET status = 'active', revision = 3 WHERE id = 'medicine-receipt'`);
    expect(await call(args)).toEqual(expected);
    await expect(call({ ...args, end_date: '2026-02-02' })).rejects.toThrow('different payload');
    await expect(call(args, { ...context, canWriteClaims: false })).rejects.toThrow('health:claims:write');
    await expect(call(args, { ...context, patientIds: [] })).rejects.toThrow('No such patient');
    await expect(call(args, { ...context, userId: 'owner-2' })).rejects.toThrow('No such patient');
  });

  it('holds future courses and preserves shorter end dates and other courses', async () => {
    const future = await seed('future', { start: '2026-02-02' });
    expect((await call(future)).courses[0]).toMatchObject({ new_status: 'held', new_end_date: null });
    const shorter = await seed('shorter', { end: '2026-01-20' });
    await client.execute(`INSERT INTO medicine_course (id,patient_id,medicine_claim_id,status,start_date) VALUES ('other-held','profile-1','medicine-shorter','held','2026-01-01')`);
    expect((await call(shorter)).courses[0]).toMatchObject({ new_status: 'ended', new_end_date: '2026-01-20' });
    expect((await client.execute(`SELECT status,revision FROM medicine_course WHERE id = 'other-held'`)).rows[0]).toMatchObject({ status: 'held', revision: 1 });
    const invalid = await seed('date');
    await expect(call({ ...invalid, end_date: '2026-02-30' })).rejects.toThrow('calendar date');
    await expect(call({ ...invalid, end_date: '2025-12-31' })).rejects.toThrow('STOP_REJECTED: end_date precedes medicine start_date');
  });

  it('rejects added, removed and revised snapshot rows without writing', async () => {
    const args = await seed('conflict');
    await expect(call({ ...args, request_id: 'conflict-medicine', expected_medicine_revision: 2 })).rejects.toThrow('STOP_REJECTED: Medicine revision conflict');
    await expect(call({ ...args, request_id: 'conflict-missing-course', expected_courses: [] })).rejects.toThrow('snapshot conflict');
    await expect(call({ ...args, request_id: 'conflict-missing-regimen', expected_courses: [{ ...args.expected_courses[0], regimens: [] }] })).rejects.toThrow('snapshot conflict');
    await expect(call({ ...args, request_id: 'conflict-course-revision', expected_courses: [{ ...args.expected_courses[0], revision: 2 }] })).rejects.toThrow('snapshot conflict');
    await expect(call({ ...args, request_id: 'conflict-regimen-revision', expected_courses: [{ ...args.expected_courses[0], regimens: [{ regimen_id: 'regimen-conflict', revision: 2 }] }] })).rejects.toThrow('snapshot conflict');
    await client.execute(`INSERT INTO medicine_course (id, patient_id, medicine_claim_id,status,start_date) VALUES ('phantom','profile-1','medicine-conflict','active','2026-01-01')`);
    await expect(call(args)).rejects.toThrow('snapshot conflict');
    expect((await client.execute(`SELECT revision,status FROM medicine_claim WHERE id='medicine-conflict'`)).rows[0]).toMatchObject({ revision: 1, status: 'active' });
    expect((await client.execute(`SELECT count(*) AS n FROM mcp_write_receipt WHERE request_id='request-conflict'`)).rows[0].n).toBe(1);
    await client.execute(`DELETE FROM medicine_course WHERE id='phantom'`);
    await expect(call(args)).rejects.toThrow('STOP_REJECTED: Active plan snapshot conflict');
    expect((await call({ ...args, request_id: 'new-after-conflict' })).medicine.revision).toBe(2);
  });

  it('updates a full bounded snapshot in one transaction', async () => {
    const args = await seed('large');
    let statements = '';
    for (let index = 1; index < 50; index++) {
      const suffix = String(index).padStart(2, '0');
      statements += `INSERT INTO medicine_course (id,patient_id,medicine_claim_id,status,start_date) VALUES ('large-c${suffix}','profile-1','medicine-large','active','2026-01-01');`;
      const regimens = [];
      for (let n = 0; n < 4; n++) {
        const regimenId = `large-r${suffix}-${n}`;
        statements += `INSERT INTO dose_regimen (id,patient_id,course_id,rule_kind,timezone,effective_from) VALUES ('${regimenId}','profile-1','large-c${suffix}','as_needed','UTC','2026-01-01');`;
        regimens.push({ regimen_id: regimenId, revision: 1 });
      }
      args.expected_courses.push({ course_id: `large-c${suffix}`, revision: 1, regimens });
    }
    for (let n = 0; n < 3; n++) {
      statements += `INSERT INTO dose_regimen (id,patient_id,course_id,rule_kind,timezone,effective_from) VALUES ('large-original-${n}','profile-1','course-large','as_needed','UTC','2026-01-01');`;
      args.expected_courses[0].regimens.push({ regimen_id: `large-original-${n}`, revision: 1 });
    }
    await client.executeMultiple(statements);
    const result = await call(args);
    expect(result.courses).toHaveLength(50);
    expect(result.courses.reduce((n: number, course: any) => n + course.regimens.length, 0)).toBe(200);
    expect((await client.execute(`SELECT count(*) AS n FROM medicine_course WHERE medicine_claim_id='medicine-large' AND status='ended' AND revision=2`)).rows[0].n).toBe(50);
    expect(await call({ ...args, expected_courses: [...args.expected_courses].reverse() })).toEqual(result);
    await expect(call({ ...args, request_id: 'over-courses', expected_courses: [...args.expected_courses, args.expected_courses[0]] })).rejects.toThrow('at most 50 courses');
  });

  it('rejects regimen phantoms and scopes request keys to patient and client', async () => {
    const args = await seed('regimen-phantom');
    await client.execute(`INSERT INTO dose_regimen (id,patient_id,course_id,rule_kind,timezone,effective_from) VALUES ('regimen-added','profile-1','course-regimen-phantom','as_needed','UTC','2026-01-01')`);
    await expect(call(args)).rejects.toThrow('STOP_REJECTED: Active plan snapshot conflict');
    await client.execute(`DELETE FROM dose_regimen WHERE id='regimen-added'`);
    await expect(call(args)).rejects.toThrow('STOP_REJECTED: Active plan snapshot conflict');
    const otherClient = { ...context, clientId: 'other-client' };
    expect((await call(args, otherClient)).medicine.status).toBe('stopped');
    const other = await seed('other-patient');
    await client.execute(`UPDATE medicine_claim SET patient_id='profile-2' WHERE id='medicine-other-patient'`);
    await client.execute(`UPDATE medicine_course SET patient_id='profile-2' WHERE id='course-other-patient'`);
    await client.execute(`UPDATE dose_regimen SET patient_id='profile-2' WHERE id='regimen-other-patient'`);
    expect((await call({ ...other, patient_id: 'profile-2', request_id: args.request_id }, { ...context, patientIds: ['profile-1', 'profile-2'] })).medicine.patient_id).toBe('profile-2');
  });

  it('rolls back all changes when receipt insertion fails', async () => {
    const args = await seed('rollback');
    await client.execute(`CREATE TRIGGER fail_receipt BEFORE INSERT ON mcp_write_receipt WHEN NEW.request_id = 'request-rollback' BEGIN SELECT RAISE(ABORT,'test failure'); END`);
    await expect(call(args)).rejects.toThrow();
    await client.execute(`DROP TRIGGER fail_receipt`);
    expect((await client.execute(`SELECT status,revision FROM medicine_claim WHERE id='medicine-rollback'`)).rows[0]).toMatchObject({ status: 'active', revision: 1 });
    expect((await client.execute(`SELECT status,revision FROM medicine_course WHERE id='course-rollback'`)).rows[0]).toMatchObject({ status: 'active', revision: 1 });
    expect((await client.execute(`SELECT count(*) AS n FROM claim_revision WHERE claim_id IN ('course-rollback','medicine-rollback')`)).rows[0].n).toBe(0);
    expect((await call(args)).medicine.revision).toBe(2);
  });

  it('serializes concurrent retries and conflicting edits', async () => {
    const args = await seed('race');
    const results = await Promise.allSettled([call(args), call(args), call({ ...args, end_date: '2026-01-31' })]);
    const success = results.filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled');
    expect(success.length).toBeGreaterThanOrEqual(1);
    expect(success.every((result) => JSON.stringify(result.value) === JSON.stringify(success[0].value))).toBe(true);
    expect((await client.execute(`SELECT revision FROM medicine_claim WHERE id='medicine-race'`)).rows[0].revision).toBe(2);
    expect((await client.execute(`SELECT count(*) AS n FROM mcp_write_receipt WHERE request_id='request-race'`)).rows[0].n).toBe(1);
    const winnerDate = success[0].value.medicine.end_date;
    const winner = { ...args, end_date: winnerDate };
    expect(await call(winner)).toEqual(success[0].value);
    await expect(call({ ...winner, end_date: winnerDate === '2026-02-01' ? '2026-01-31' : '2026-02-01' })).rejects.toThrow('different payload');
  });

  it('serializes an edit racing the snapshot and fences a rejected request', async () => {
    const args = await seed('edit-race');
    const edit = client.execute(`INSERT INTO medicine_course (id,patient_id,medicine_claim_id,status,start_date) VALUES ('race-added','profile-1','medicine-edit-race','active','2026-01-01')`);
    const [stop, inserted] = await Promise.allSettled([call(args), edit]);
    expect(inserted.status).toBe('fulfilled');
    if (stop.status === 'fulfilled') {
      expect(stop.value.courses.map((course: any) => course.course_id)).toEqual(['course-edit-race']);
      expect(await call(args)).toEqual(stop.value);
    } else if (String(stop.reason).includes('STOP_REJECTED:')) {
      await client.execute(`DELETE FROM medicine_course WHERE id='race-added'`);
      await expect(call(args)).rejects.toThrow('STOP_REJECTED: Active plan snapshot conflict');
    } else {
      // A database busy/transport error leaves the outcome unknown; retry resolves it.
      await expect(call(args)).rejects.toThrow('STOP_REJECTED: Active plan snapshot conflict');
    }
  });

  it('uses indexes for bounded snapshot and receipt lookups', async () => {
    const coursePlan = (await client.execute(`EXPLAIN QUERY PLAN SELECT * FROM medicine_course WHERE medicine_claim_id='x' AND patient_id='p' AND status='active' LIMIT 51`)).rows.map((row) => String(row.detail)).join(' ');
    expect(coursePlan).toMatch(/medicine_course_active_snapshot_idx \(medicine_claim_id=\? AND patient_id=\? AND status=\?\)/);
    for (const sql of [
      `EXPLAIN QUERY PLAN SELECT * FROM medicine_course WHERE medicine_claim_id='x' AND patient_id='p' AND status='active' LIMIT 51`,
      `EXPLAIN QUERY PLAN SELECT * FROM dose_regimen WHERE course_id IN ('x','y') LIMIT 201`,
      `EXPLAIN QUERY PLAN SELECT * FROM mcp_write_receipt WHERE patient_id='p' AND client_id='c' AND operation='o' AND request_id='r' LIMIT 1`,
    ]) {
      const plan = (await client.execute(sql)).rows.map((row) => String(row.detail)).join(' ');
      expect(plan).toMatch(/USING INDEX/);
      expect(plan).not.toMatch(/USE TEMP B-TREE|SCAN /);
    }
    const probePath = join(tmpdir(), `health-tracker-index-${crypto.randomUUID()}.db`);
    let isolated = createClient({ url: `file:${probePath}` });
    try {
      await isolated.executeMultiple(`CREATE TABLE medicine_course (medicine_claim_id TEXT, patient_id TEXT, status TEXT); CREATE INDEX medicine_course_active_snapshot_idx ON medicine_course(medicine_claim_id, patient_id, status);`);
      const query = `EXPLAIN QUERY PLAN SELECT * FROM medicine_course WHERE medicine_claim_id='x' AND patient_id='p' AND status='active' LIMIT 51`;
      expect((await isolated.execute(query)).rows.map((row) => String(row.detail)).join(' ')).toMatch(/medicine_claim_id=\? AND patient_id=\? AND status=\?/);
      isolated.close();
      isolated = createClient({ url: `file:${probePath}` });
      await isolated.execute(`DROP INDEX medicine_course_active_snapshot_idx`);
      expect((await isolated.execute(query)).rows.map((row) => String(row.detail)).join(' ')).toMatch(/SCAN medicine_course/);
    } finally {
      isolated.close();
      await Promise.allSettled([unlink(probePath), unlink(`${probePath}-shm`), unlink(`${probePath}-wal`)]);
    }
  });
});
