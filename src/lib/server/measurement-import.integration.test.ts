import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { planMeasurementImport, type ImportedSession } from '$lib/import/measurement-plan';

const databasePath = join(tmpdir(), `health-tracker-measurement-import-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let importer: typeof import('./measurement-import');
const session: ImportedSession = {
  kind: 'body', measuredAt: '2026-10-06T08:00:00.000Z', sourceKey: 'body:2026-10-06',
  entries: [{ key: 'body-weight', value: '70', unit: 'kg' }],
};

beforeAll(async () => {
  vi.doMock('$env/dynamic/private', () => ({ env: { DATABASE_URL: databaseUrl, DATABASE_AUTH_TOKEN: 'local-test-token' } }));
  client = createClient({ url: databaseUrl });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE patient (id TEXT PRIMARY KEY);
    CREATE TABLE report (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id), kind TEXT NOT NULL,
      test_date TEXT NOT NULL, report_time TEXT, raw_data TEXT, organized_data TEXT,
      parsed_json_data TEXT, extra_data TEXT
    );
    CREATE TABLE record (
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id),
      report_id TEXT NOT NULL REFERENCES report(id), metric_name TEXT NOT NULL,
      value TEXT NOT NULL, unit TEXT, ref_range TEXT, status TEXT, extra_data TEXT
    );
    CREATE TABLE write_audit (operation TEXT);
    CREATE TRIGGER report_update AFTER UPDATE ON report BEGIN INSERT INTO write_audit VALUES ('report'); END;
    CREATE TRIGGER record_update AFTER UPDATE ON record BEGIN INSERT INTO write_audit VALUES ('record'); END;
    INSERT INTO patient VALUES ('a'), ('b');
  `);
  importer = await import('./measurement-import');
});
beforeEach(async () => { await client.executeMultiple('DELETE FROM record; DELETE FROM report; DELETE FROM write_audit;'); });
afterAll(async () => { client?.close(); await unlink(databasePath).catch(() => {}); });

function run(sessions = [session], patientId = 'a', source = 'apple-health') {
  return importer.importMeasurementSessions({ patientId, source, sessions });
}

async function preview(sessions: ImportedSession[]) {
  const reports = (await client.execute("SELECT * FROM report WHERE patient_id = 'a'")).rows.map((row) => ({
    id: String(row.id), testDate: String(row.test_date), extraData: row.extra_data,
  }));
  const records = (await client.execute("SELECT * FROM record WHERE patient_id = 'a'")).rows.map((row) => ({
    id: String(row.id), reportId: String(row.report_id), metricName: String(row.metric_name), value: String(row.value), unit: row.unit === null ? null : String(row.unit),
  }));
  return planMeasurementImport({ source: 'apple-health', sessions, reports, records });
}

describe('measurement re-imports', () => {
  it('skips an identical export without inserting or rewriting records', async () => {
    expect(await run()).toMatchObject({ newValues: 1, updatedValues: 0, duplicateValues: 0, createdSessions: 1 });
    const before = await client.execute('SELECT * FROM record');
    expect((await preview([session])).counts).toEqual({ newValues: 0, updatedValues: 0, duplicateValues: 1 });
    expect(await run()).toMatchObject({ newValues: 0, updatedValues: 0, duplicateValues: 1, writtenValues: 0, createdSessions: 0, updatedSessions: 0 });
    expect((await client.execute('SELECT * FROM record')).rows).toEqual(before.rows);
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(1);
    expect((await client.execute('SELECT * FROM write_audit')).rows).toHaveLength(0);
  });

  it('agrees with the preview for mixed additions, updates, and duplicates', async () => {
    await run([{ ...session, entries: [...session.entries, { key: 'height', value: '170', unit: 'cm' }] }]);
    const incoming: ImportedSession[] = [{ ...session, entries: [
      { key: 'body-weight', value: '71', unit: 'kg' },
      { key: 'height', value: '170.00', unit: 'cm' },
      { key: 'waist-circumference', value: '80', unit: 'cm' },
    ] }, { ...session, measuredAt: '2026-10-07T08:00:00.000Z', sourceKey: 'body:2026-10-07' }];
    const expected = { newValues: 2, updatedValues: 1, duplicateValues: 1 };
    expect((await preview(incoming)).counts).toEqual(expected);
    expect(await run(incoming)).toMatchObject({ ...expected, writtenValues: 3, createdSessions: 1, updatedSessions: 1 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(2);
    expect((await client.execute('SELECT * FROM record')).rows).toHaveLength(4);
    expect(await run(incoming)).toMatchObject({ newValues: 0, updatedValues: 0, duplicateValues: 4, writtenValues: 0 });
  });

  it('treats a changed measurement time as an update and equivalent instants as duplicates', async () => {
    await run();
    expect(await run([{ ...session, measuredAt: '2026-10-06T17:00:00+09:00' }])).toMatchObject({ duplicateValues: 1, updatedValues: 0 });
    const incoming = [{ ...session, measuredAt: '2026-10-06T09:00:00.000Z' }];
    expect((await preview(incoming)).counts.updatedValues).toBe(1);
    expect(await run(incoming)).toMatchObject({ updatedValues: 1, duplicateValues: 0 });
  });

  it('keeps patients and import sources separate', async () => {
    await run();
    expect(await run([session], 'b')).toMatchObject({ newValues: 1, duplicateValues: 0 });
    expect(await run([session], 'a', 'health-tracker-export')).toMatchObject({ newValues: 1, duplicateValues: 0 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(3);
  });

  it('does not duplicate repeated source keys within a request', async () => {
    const incoming = [session, { ...session, entries: [{ key: 'height', value: '170', unit: 'cm' }] }, session];
    expect(await run(incoming)).toMatchObject({ createdSessions: 1, newValues: 2 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(1);
    expect((await client.execute('SELECT * FROM record')).rows).toHaveLength(2);
  });

  it('repairs an import interrupted after its report was inserted', async () => {
    await run();
    await client.execute('DELETE FROM record');
    expect(await run()).toMatchObject({ createdSessions: 0, updatedSessions: 1, newValues: 1 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(1);
  });
});
