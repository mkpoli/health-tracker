import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const databasePath = join(tmpdir(), `health-tracker-hevy-import-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let importModule: typeof import('./hevy-import');

const header = [
  'title',
  'start_time',
  'end_time',
  'description',
  'exercise_title',
  'superset_id',
  'exercise_notes',
  'set_index',
  'set_type',
  'weight_kg',
  'reps',
  'distance_km',
  'duration_seconds',
  'rpe',
  'future_metric',
].join(',');

function csv(repetitions: number, extra = 'retained') {
  return [
    header,
    `Session,"25 Aug 2025, 09:38","25 Aug 2025, 10:18",Imported,Squat,,,0,normal,80,${repetitions},,,8,${extra}`,
  ].join('\n');
}

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
    CREATE TABLE data_import (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
      file_name TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      interpretation_key TEXT NOT NULL DEFAULT '',
      storage_key TEXT NOT NULL UNIQUE,
      object_etag TEXT,
      timezone TEXT,
      summary_data TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(patient_id, provider, format, content_sha256, interpretation_key)
    );
    CREATE TABLE exercise_definition (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      category TEXT,
      equipment TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id, patient_id),
      UNIQUE(patient_id, normalized_key),
      UNIQUE(patient_id, origin_provider, origin_external_id)
    );
    CREATE TABLE workout_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('session', 'plan')),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      based_on_workout_id TEXT,
      started_at TEXT,
      ended_at TEXT,
      local_date TEXT,
      timezone TEXT,
      timezone_offset_minutes INTEGER,
      ended_timezone_offset_minutes INTEGER,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      source_created_at TEXT,
      source_updated_at TEXT,
      source_data TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id, patient_id),
      UNIQUE(patient_id, kind, origin_provider, origin_external_id)
    );
    CREATE TABLE workout_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      workout_claim_id TEXT NOT NULL,
      exercise_definition_id TEXT,
      order_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      equipment TEXT,
      notes TEXT,
      rest_seconds INTEGER,
      superset_group TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      UNIQUE(id, workout_claim_id, patient_id),
      UNIQUE(workout_claim_id, order_index),
      UNIQUE(workout_claim_id, origin_external_id),
      FOREIGN KEY(workout_claim_id, patient_id)
        REFERENCES workout_claim(id, patient_id) ON DELETE CASCADE,
      FOREIGN KEY(exercise_definition_id, patient_id)
        REFERENCES exercise_definition(id, patient_id)
    );
    CREATE TABLE workout_set (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      workout_claim_id TEXT NOT NULL,
      workout_exercise_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      set_type TEXT NOT NULL,
      status TEXT NOT NULL,
      weight_value REAL,
      weight_unit TEXT,
      repetitions INTEGER,
      duration_seconds INTEGER,
      distance_value REAL,
      distance_unit TEXT,
      rpe REAL,
      rir REAL,
      notes TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      UNIQUE(workout_exercise_id, order_index),
      UNIQUE(workout_exercise_id, origin_external_id),
      FOREIGN KEY(workout_exercise_id, workout_claim_id, patient_id)
        REFERENCES workout_exercise(id, workout_claim_id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy', 'workout')),
      claim_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL,
      change_origin_provider TEXT,
      UNIQUE(claim_kind, claim_id, revision)
    );
  `);
  await client.execute({
    sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
    args: ['patient-1', 'owner-1', 'Patient'],
  });
  importModule = await import('./hevy-import');
});

afterAll(async () => {
  client?.close();
  await unlink(databasePath).catch(() => undefined);
  vi.doUnmock('$env/dynamic/private');
});

describe('importHevyCsvFile', () => {
  it('creates, repeats, updates, and protects locally revised workouts', async () => {
    const objects = new Map<string, { httpEtag: string }>();
    const put = vi.fn(async (key: string) => {
      const object = { httpEtag: `etag-${objects.size + 1}` };
      objects.set(key, object);
      return object;
    });
    const head = vi.fn(async (key: string) => objects.get(key) || null);
    const bucket = { put, head } as unknown as R2Bucket;
    const firstFile = new File([csv(5)], 'hevy.csv', { type: 'text/csv' });

    const first = await importModule.importHevyCsvFile({
      patientId: 'patient-1',
      file: firstFile,
      timeZone: 'Asia/Tokyo',
      bucket,
    });
    expect(first).toMatchObject({
      repeated: false,
      summary: { result: { created: 1, updated: 0, unchanged: 0, conflicts: 0 } },
      source: { status: 'completed', provider: 'hevy', timezone: 'Asia/Tokyo' },
    });

    const state = await client.execute(`
      SELECT
        (SELECT count(*) FROM data_import) AS imports,
        (SELECT count(*) FROM workout_claim) AS workouts,
        (SELECT count(*) FROM workout_exercise) AS exercises,
        (SELECT count(*) FROM workout_set) AS sets,
        (SELECT count(*) FROM claim_revision) AS revisions,
        (SELECT repetitions FROM workout_set LIMIT 1) AS repetitions,
        (SELECT json_extract(source_data, '$.raw.future_metric') FROM workout_set LIMIT 1) AS raw_value
    `);
    expect(state.rows[0]).toMatchObject({
      imports: 1,
      workouts: 1,
      exercises: 1,
      sets: 1,
      revisions: 1,
      repetitions: 5,
      raw_value: 'retained',
    });

    const repeated = await importModule.importHevyCsvFile({
      patientId: 'patient-1',
      file: firstFile,
      timeZone: 'Asia/Tokyo',
      bucket,
    });
    expect(repeated.repeated).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);

    objects.clear();
    const repairedSource = await importModule.importHevyCsvFile({
      patientId: 'patient-1',
      file: firstFile,
      timeZone: 'Asia/Tokyo',
      bucket,
    });
    expect(repairedSource.repeated).toBe(true);
    expect(put).toHaveBeenCalledTimes(2);

    const changed = await importModule.importHevyCsvFile({
      patientId: 'patient-1',
      file: new File([csv(6, 'changed')], 'hevy-corrected.csv', { type: 'text/csv' }),
      timeZone: 'Asia/Tokyo',
      bucket,
    });
    expect(changed.summary.result).toEqual({
      created: 0,
      updated: 1,
      unchanged: 0,
      conflicts: 0,
    });
    const updated = await client.execute(`
      SELECT workout_claim.id, workout_claim.revision, workout_set.repetitions
      FROM workout_claim
      JOIN workout_set ON workout_set.workout_claim_id = workout_claim.id
    `);
    expect(updated.rows[0]).toMatchObject({ revision: 2, repetitions: 6 });
    const workoutId = String(updated.rows[0]?.id);
    const revisions = await client.execute({
      sql: 'SELECT count(*) AS count FROM claim_revision WHERE claim_id = ?',
      args: [workoutId],
    });
    expect(revisions.rows[0]?.count).toBe(2);

    await client.execute({
      sql: 'UPDATE workout_claim SET revision = 3, notes = ? WHERE id = ?',
      args: ['Local correction', workoutId],
    });
    const conflicted = await importModule.importHevyCsvFile({
      patientId: 'patient-1',
      file: new File([csv(7, 'third')], 'hevy-latest.csv', { type: 'text/csv' }),
      timeZone: 'Asia/Tokyo',
      bucket,
    });
    expect(conflicted.summary.result).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 1,
    });
    const protectedWorkout = await client.execute({
      sql: `SELECT workout_claim.revision, workout_claim.notes, workout_set.repetitions
        FROM workout_claim JOIN workout_set ON workout_set.workout_claim_id = workout_claim.id
        WHERE workout_claim.id = ?`,
      args: [workoutId],
    });
    expect(protectedWorkout.rows[0]).toMatchObject({
      revision: 3,
      notes: 'Local correction',
      repetitions: 6,
    });
    expect(put).toHaveBeenCalledTimes(4);
  });
});
