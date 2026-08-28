import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const databasePath = join(tmpdir(), `health-tracker-medicine-plan-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let mutations: typeof import('./medicine-plan-mutations');
let revisions: typeof import('./claim-revisions');

const origin = { kind: 'manual', provider: 'local' } as const;

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
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
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
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      medicine_claim_id TEXT NOT NULL REFERENCES medicine_claim(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'initial',
      status TEXT NOT NULL DEFAULT 'active',
      previous_course_id TEXT REFERENCES medicine_course(id),
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
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
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
    INSERT INTO medicine_claim (id, patient_id, name) VALUES
      ('medicine-1', 'profile-1', 'アモキシシリン');
  `);
  mutations = await import('./medicine-plan-mutations');
  revisions = await import('./claim-revisions');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([
    unlink(databasePath),
    unlink(`${databasePath}-shm`),
    unlink(`${databasePath}-wal`),
  ]);
});

async function revisionRows(claimKind: string, claimId: string) {
  const rows = await client.execute({
    sql: 'SELECT revision FROM claim_revision WHERE claim_kind = ? AND claim_id = ? ORDER BY revision',
    args: [claimKind, claimId],
  });
  return rows.rows.map((row) => Number(row.revision));
}

describe('medicine plan mutations', () => {
  it('keeps a full revision ledger through course, regimen, and dose changes', async () => {
    const course = await mutations.createMedicineCourse({
      patientId: 'profile-1',
      medicineClaimId: 'medicine-1',
      input: {
        kind: 'initial',
        status: 'active',
        previousCourseId: null,
        startDate: '2026-08-01',
        endDate: null,
        endReason: null,
        notes: null,
      },
      origin,
    });
    expect(await revisionRows('medicine_course', course.id)).toEqual([1]);

    const regimen = await mutations.createDoseRegimen({
      patientId: 'profile-1',
      courseId: course.id,
      input: {
        ruleKind: 'fixed_slots',
        slots: [
          {
            key: 0,
            label: '朝食後',
            anchorKind: 'meal',
            anchorMeal: 'breakfast',
            anchorOffsetMinutes: null,
            time: null,
            amountValue: 2,
            amountUnit: '錠',
          },
          {
            key: 1,
            label: '夕食後',
            anchorKind: 'meal',
            anchorMeal: 'dinner',
            anchorOffsetMinutes: null,
            time: null,
            amountValue: 2,
            amountUnit: '錠',
          },
        ],
        daysOfWeek: null,
        intervalHours: null,
        anchorAt: null,
        doseText: '250mg×2',
        route: 'oral',
        site: null,
        timezone: 'Asia/Tokyo',
        effectiveFrom: '2026-08-01',
        effectiveTo: null,
        remindMinutesBefore: null,
        notes: null,
      },
      origin,
    });
    expect(regimen.slots).toHaveLength(2);

    const currentRegimen = await client.execute({
      sql: 'SELECT * FROM dose_regimen WHERE id = ?',
      args: [regimen.id],
    });
    const regimenRow = {
      ...(currentRegimen.rows[0] as unknown as Record<string, unknown>),
      id: regimen.id,
      patientId: 'profile-1',
      courseId: course.id,
      ruleKind: 'fixed_slots',
      slots: JSON.parse(String(currentRegimen.rows[0].slots)),
      daysOfWeek: null,
      intervalHours: null,
      anchorAt: null,
      doseText: '250mg×2',
      route: 'oral',
      site: null,
      timezone: 'Asia/Tokyo',
      effectiveFrom: '2026-08-01',
      effectiveTo: null,
      remindMinutesBefore: null,
      notes: null,
      originKind: 'manual',
      originProvider: 'local',
      originExternalId: null,
      revision: 1,
      createdAt: String(currentRegimen.rows[0].created_at),
      updatedAt: String(currentRegimen.rows[0].updated_at),
    };

    const courseRow = {
      id: course.id,
      patientId: 'profile-1',
      medicineClaimId: 'medicine-1',
      kind: 'initial',
      status: 'active',
      previousCourseId: null,
      startDate: '2026-08-01',
      endDate: null,
      endReason: null,
      notes: null,
      originKind: 'manual',
      originProvider: 'local',
      originExternalId: null,
      revision: 1,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };

    const taken = await mutations.recordPlannedDose({
      course: courseRow,
      regimen: regimenRow as never,
      localDate: '2026-08-10',
      slotKey: 0,
      input: {
        status: 'taken',
        actualAt: '2026-08-10T04:30:00.000Z',
        actualValue: null,
        actualUnit: null,
        actualText: null,
        route: null,
        site: null,
        reason: null,
        reaction: null,
        notes: null,
      },
      origin,
    });
    expect(taken).toMatchObject({
      status: 'taken',
      localDate: '2026-08-10',
      slotKey: 0,
      plannedAt: null,
      regimenId: regimen.id,
    });

    // The same slot cannot be recorded twice; a concurrent first record
    // surfaces as a stale-revision conflict.
    await expect(
      mutations.recordPlannedDose({
        course: courseRow,
        regimen: regimenRow as never,
        localDate: '2026-08-10',
        slotKey: 0,
        input: {
          status: 'skipped',
          actualAt: null,
          actualValue: null,
          actualUnit: null,
          actualText: null,
          route: null,
          site: null,
          reason: null,
          reaction: null,
          notes: null,
        },
        origin,
      }),
    ).rejects.toBeInstanceOf(revisions.StaleClaimRevisionError);

    // A slot the regimen does not plan is rejected.
    await expect(
      mutations.recordPlannedDose({
        course: courseRow,
        regimen: regimenRow as never,
        localDate: '2026-08-10',
        slotKey: 7,
        input: {
          status: 'taken',
          actualAt: null,
          actualValue: null,
          actualUnit: null,
          actualText: null,
          route: null,
          site: null,
          reason: null,
          reaction: null,
          notes: null,
        },
        origin,
      }),
    ).rejects.toBeInstanceOf(mutations.UnknownDoseSlotError);

    const corrected = await mutations.updateDoseOccurrence({
      current: taken as never,
      input: {
        status: 'partial',
        actualAt: '2026-08-10T05:00:00.000Z',
        actualValue: 1,
        actualUnit: '錠',
        actualText: null,
        route: null,
        site: null,
        reason: '半分だけ',
        reaction: null,
        notes: null,
      },
      expectedRevision: 1,
      source: origin,
    });
    expect(corrected).toMatchObject({ status: 'partial', revision: 2, actualValue: 1 });
    expect(await revisionRows('dose_occurrence', taken.id)).toEqual([1, 2]);
  });

  it('closes the open regimen when a new rule takes effect', async () => {
    const course = await mutations.createMedicineCourse({
      patientId: 'profile-1',
      medicineClaimId: 'medicine-1',
      input: {
        kind: 'restart',
        status: 'active',
        previousCourseId: null,
        startDate: '2026-07-01',
        endDate: null,
        endReason: null,
        notes: null,
      },
      origin,
    });

    const baseInput = {
      ruleKind: 'fixed_slots' as const,
      slots: [
        {
          key: 0,
          label: null,
          anchorKind: 'clock' as const,
          anchorMeal: null,
          anchorOffsetMinutes: null,
          time: '21:00',
          amountValue: 1,
          amountUnit: '錠',
        },
      ],
      daysOfWeek: null,
      intervalHours: null,
      anchorAt: null,
      doseText: null,
      route: null,
      site: null,
      timezone: 'Asia/Tokyo',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      remindMinutesBefore: null,
      notes: null,
    };
    const first = await mutations.createDoseRegimen({
      patientId: 'profile-1',
      courseId: course.id,
      input: baseInput,
      origin,
    });
    const second = await mutations.createDoseRegimen({
      patientId: 'profile-1',
      courseId: course.id,
      input: { ...baseInput, effectiveFrom: '2026-08-15' },
      origin,
    });

    const closed = await client.execute({
      sql: 'SELECT effective_to, revision FROM dose_regimen WHERE id = ?',
      args: [first.id],
    });
    expect(closed.rows[0].effective_to).toBe('2026-08-14');
    expect(Number(closed.rows[0].revision)).toBe(2);
    expect(second.effectiveTo).toBeNull();
    expect(await revisionRows('dose_regimen', first.id)).toEqual([1, 2]);
  });
});
