import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const databasePath = join(tmpdir(), `health-tracker-archive-import-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let archiveModule: typeof import('./archive-import');
let archiveMediaModule: typeof import('./archive-media');

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
    CREATE TABLE report (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'lab',
      test_date TEXT NOT NULL,
      report_time TEXT,
      raw_data TEXT,
      organized_data TEXT,
      parsed_json_data TEXT,
      extra_data TEXT
    );
    CREATE TABLE record (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
      metric_name TEXT NOT NULL,
      value TEXT NOT NULL,
      unit TEXT,
      ref_range TEXT,
      status TEXT,
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
      status TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      purpose TEXT,
      prescriber TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      status TEXT NOT NULL,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy')),
      claim_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL,
      change_origin_provider TEXT
    );
    CREATE UNIQUE INDEX claim_revision_claim_idx
      ON claim_revision(claim_kind, claim_id, revision);
    CREATE TABLE energy_source (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      energy_claim_id TEXT NOT NULL REFERENCES energy_claim(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'photo',
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      file_name TEXT,
      byte_size INTEGER NOT NULL,
      object_etag TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO patient (id, owner_user_id, name)
      VALUES ('destination-patient', 'owner-1', 'Destination');
    INSERT INTO energy_claim (
      id, patient_id, direction, label, category, energy_kcal, occurred_at,
      local_date, timezone, timezone_offset_minutes, duration_minutes, status,
      notes, origin_kind, origin_provider, origin_external_id, revision, created_at, updated_at
    ) VALUES (
      'existing-energy', 'destination-patient', 'intake', 'Existing entry', 'lunch', 500,
      '2026-08-02T03:00:00.000Z', '2026-08-02', 'Asia/Tokyo', 540, NULL,
      'recorded', NULL, 'connector', 'connector-a', 'entry-42', 1,
      '2026-08-02T03:00:00.000Z', '2026-08-02T03:00:00.000Z'
    );
  `);

  archiveModule = await import('./archive-import');
  archiveMediaModule = await import('./archive-media');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([
    unlink(databasePath),
    unlink(`${databasePath}-shm`),
    unlink(`${databasePath}-wal`),
  ]);
});

const medicineCurrent = {
  id: 'source-medicine',
  patientId: 'source-patient',
  name: 'Example medicine',
  genericName: null,
  form: 'tablet',
  strength: '10 mg',
  route: 'oral',
  schedule: 'Every evening',
  status: 'active',
  startDate: '2026-08-01',
  endDate: null,
  purpose: null,
  prescriber: null,
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  revision: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const medicineFirst = {
  ...medicineCurrent,
  schedule: 'Every morning',
  revision: 1,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const energyCurrent = {
  id: 'source-energy',
  patientId: 'source-patient',
  direction: 'intake',
  label: 'Example meal',
  category: 'lunch',
  energyKcal: 540,
  occurredAt: '2026-08-02T03:00:00.000Z',
  localDate: '2026-08-02',
  timezone: 'Asia/Tokyo',
  timezoneOffsetMinutes: 540,
  durationMinutes: null,
  status: 'recorded',
  notes: null,
  originKind: 'manual',
  originProvider: 'connector-a',
  originExternalId: 'entry-42',
  revision: 1,
  createdAt: '2026-08-02T03:00:00.000Z',
  updatedAt: '2026-08-02T03:00:00.000Z',
};

describe('archive import storage', () => {
  it('remaps parents, preserves revisions, and stays idempotent', async () => {
    const batches = [
      {
        kind: 'profile' as const,
        items: [
          {
            id: 'source-patient',
            name: 'Archive profile',
            agab: 'female',
            birthday: '1990-04-12',
            extraData: { preferredUnits: 'metric' },
          },
        ],
      },
      {
        kind: 'reports' as const,
        items: [
          {
            id: 'source-report',
            patientId: 'source-patient',
            kind: 'lab',
            testDate: '2026-08-01T00:00:00.000Z',
            reportTime: null,
            rawData: null,
            organizedData: { title: 'Example report' },
            parsedJsonData: null,
            extraData: { facilityName: 'Example clinic' },
          },
        ],
      },
      {
        kind: 'records' as const,
        items: [
          {
            id: 'source-record',
            patientId: 'source-patient',
            reportId: 'source-report',
            metricName: 'Example marker',
            value: '12.3',
            unit: 'mg/dL',
            refRange: '10-20',
            status: 'Normal',
            extraData: { note: 'retained' },
          },
        ],
      },
      { kind: 'medicines' as const, items: [medicineCurrent] },
      { kind: 'energy' as const, items: [energyCurrent] },
      {
        kind: 'revisions' as const,
        items: [
          {
            id: 'source-medicine-revision-1',
            patientId: 'source-patient',
            claimKind: 'medicine',
            claimId: 'source-medicine',
            revision: 1,
            snapshot: medicineFirst,
            changedAt: medicineFirst.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-medicine-revision-2',
            patientId: 'source-patient',
            claimKind: 'medicine',
            claimId: 'source-medicine',
            revision: 2,
            snapshot: medicineCurrent,
            changedAt: medicineCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-energy-revision-1',
            patientId: 'source-patient',
            claimKind: 'energy',
            claimId: 'source-energy',
            revision: 1,
            snapshot: energyCurrent,
            changedAt: energyCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
        ],
      },
    ];

    for (const batch of batches) {
      await archiveModule.importArchiveBatch({
        patientId: 'destination-patient',
        sourcePatientId: 'source-patient',
        ...batch,
      });
    }
    for (const batch of batches) {
      await archiveModule.importArchiveBatch({
        patientId: 'destination-patient',
        sourcePatientId: 'source-patient',
        ...batch,
      });
    }

    const counts = await client.execute(`
      SELECT
        (SELECT count(*) FROM report) AS reports,
        (SELECT count(*) FROM record) AS records,
        (SELECT count(*) FROM medicine_claim) AS medicines,
        (SELECT count(*) FROM energy_claim) AS energy,
        (SELECT count(*) FROM claim_revision) AS revisions
    `);
    expect(counts.rows[0]).toMatchObject({
      reports: 1,
      records: 1,
      medicines: 1,
      energy: 1,
      revisions: 3,
    });

    const relationship = await client.execute(`
      SELECT report.patient_id AS patient_id
      FROM record
      JOIN report ON report.id = record.report_id
    `);
    expect(relationship.rows[0]?.patient_id).toBe('destination-patient');

    const revisions = await client.execute(`
      SELECT claim_kind, revision,
        json_extract(snapshot, '$.patientId') AS snapshot_patient,
        json_extract(snapshot, '$.id') AS snapshot_id,
        claim_id
      FROM claim_revision
      ORDER BY claim_kind, revision
    `);
    expect(revisions.rows).toHaveLength(3);
    expect(revisions.rows.every((row) => row.snapshot_patient === 'destination-patient')).toBe(true);
    expect(revisions.rows.every((row) => row.snapshot_id === row.claim_id)).toBe(true);

    const retainedEnergy = await client.execute(
      'SELECT id, label FROM energy_claim WHERE patient_id = \'destination-patient\'',
    );
    expect(retainedEnergy.rows[0]).toMatchObject({ id: 'existing-energy', label: 'Existing entry' });

    const restoredProfile = await client.execute({
      sql: 'SELECT name, agab, birthday, extra_data FROM patient WHERE id = ?',
      args: ['destination-patient'],
    });
    expect(restoredProfile.rows[0]).toMatchObject({
      name: 'Archive profile',
      agab: 'female',
      birthday: '1990-04-12',
    });
    expect(JSON.parse(String(restoredProfile.rows[0]?.extra_data))).toEqual({
      preferredUnits: 'metric',
    });

    const storedKeys = new Set<string>();
    const put = vi.fn(async (key: string) => {
      storedKeys.add(key);
      return { httpEtag: `etag-${key}` };
    });
    const head = vi.fn(async (key: string) => (storedKeys.has(key) ? { key } : null));
    const bucket = { put, head } as unknown as R2Bucket;
    await archiveMediaModule.restoreArchiveMedia({
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/reports/source-report-scan.pdf',
        sourceKind: 'report-source',
        sourceId: 'source-report',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      },
      file: new File(['report'], 'scan.pdf', { type: 'application/pdf' }),
      bucket,
    });
    await archiveMediaModule.restoreArchiveMedia({
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/reports/source-report-scan.pdf',
        sourceKind: 'report-source',
        sourceId: 'source-report',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      },
      file: new File(['report'], 'scan.pdf', { type: 'application/pdf' }),
      bucket,
    });
    const energyMedia = {
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/calories/source-photo-meal.jpg',
        sourceKind: 'energy-photo' as const,
        sourceId: 'source-photo',
        energyClaimId: 'source-energy',
        originProvider: 'connector-a',
        originExternalId: 'entry-42',
        fileName: 'meal.jpg',
        mimeType: 'image/jpeg',
      },
      file: new File(['photo'], 'meal.jpg', { type: 'image/jpeg' }),
      bucket,
    };
    await archiveMediaModule.restoreArchiveMedia(energyMedia);
    await archiveMediaModule.restoreArchiveMedia(energyMedia);

    const mediaState = await client.execute(`
      SELECT
        (SELECT count(*) FROM energy_source) AS energy_sources,
        (SELECT raw_data FROM report LIMIT 1) AS report_source
    `);
    expect(mediaState.rows[0]?.energy_sources).toBe(1);
    expect(JSON.parse(String(mediaState.rows[0]?.report_source))).toMatchObject({
      kind: 'r2-file',
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(
      put.mock.calls.every(([key]) => String(key).includes('destination-patient')),
    ).toBe(true);

    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: ['destination-patient'] });
    const afterDelete = await client.execute('SELECT count(*) AS count FROM claim_revision');
    expect(afterDelete.rows[0]?.count).toBe(0);
  });
});
