import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { parseAppleHealthExport } from '$lib/import/apple-health';
import { isLabReport } from '$lib/report-kind';
import { activityPoints } from '$lib/activity';
import { importMetadata, planMeasurementImport, type ImportedSession } from '$lib/import/measurement-plan';

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
    id: String(row.id), reportId: String(row.report_id), metricName: String(row.metric_name), value: String(row.value), extraData: row.extra_data, unit: row.unit === null ? null : String(row.unit),
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


describe('Apple daily activity imports', () => {
  function activity(value = 100, source = 'Watch', extra = '') {
    return parseAppleHealthExport(`<HealthData><Record type="HKQuantityTypeIdentifierStepCount" sourceName="${source}" unit="count" value="${value}" startDate="2026-10-01T08:00:00Z" endDate="2026-10-01T09:00:00Z"/>${extra}</HealthData>`, 'Asia/Tokyo').sessions;
  }

  it('persists daily summaries and skips a repeated export without any writes', async () => {
    const sessions = activity();
    expect(await run(sessions)).toMatchObject({ createdSessions: 1, newValues: 1 });
    const before = (await client.execute('SELECT * FROM record')).rows;
    const metadata = importMetadata(before[0].extra_data);
    expect(metadata.dailySummary).toMatchObject({ date: '2026-10-01', timeZone: 'Asia/Tokyo', source: 'Watch', sampleCount: 1, coverageSeconds: 3600 });
    expect((await preview(sessions)).counts).toEqual({ newValues: 0, updatedValues: 0, duplicateValues: 1 });
    expect(await run(sessions)).toMatchObject({ writtenValues: 0, duplicateValues: 1 });
    expect((await client.execute('SELECT * FROM record')).rows).toEqual(before);
    expect((await client.execute('SELECT * FROM write_audit')).rows).toHaveLength(0);
  });

  it('replaces a changed same-day total without adding a second day or accumulating old totals', async () => {
    await run(activity(100));
    const incoming = activity(150);
    expect((await preview(incoming)).counts).toEqual({ newValues: 0, updatedValues: 1, duplicateValues: 0 });
    expect(await run(incoming)).toMatchObject({ updatedValues: 1, createdSessions: 0 });
    expect((await client.execute('SELECT value FROM record')).rows).toEqual([{ value: '150' }]);
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(1);
  });

  it('updates provenance when a different source produces the same total', async () => {
    await run(activity(100));
    expect((await preview(activity(100, 'Phone'))).counts.updatedValues).toBe(1);
    expect(await run(activity(100, 'Phone'))).toMatchObject({ updatedValues: 1 });
    const row = (await client.execute('SELECT extra_data FROM record')).rows[0];
    expect(importMetadata(row.extra_data).dailySummary).toMatchObject({ source: 'Phone' });
  });

  it('keeps activity records separate from lab and hand-entered body records', async () => {
    await run(activity()); await run([session]);
    const rows = (await client.execute('SELECT * FROM report')).rows;
    expect(rows.some((row) => isLabReport({ kind: String(row.kind) }))).toBe(false);
    expect(rows.map((row) => row.kind).sort()).toEqual(['activity', 'body']);
    const records = (await client.execute('SELECT * FROM record')).rows.map((row) => ({ id: String(row.id), reportId: String(row.report_id), metricName: String(row.metric_name), value: String(row.value), unit: String(row.unit), extraData: row.extra_data }));
    const points = activityPoints(rows.map((row) => ({ id: String(row.id), kind: String(row.kind) })), records);
    expect(points).toHaveLength(1); expect(points[0]).toMatchObject({ key: 'daily-steps', value: 100, date: '2026-10-01' });
  });

  it('selects one stable daily value after overlapping archive restores and updates that value', async () => {
    await run(activity());
    // Archive restores give a report a new ID while retaining import provenance.
    await client.execute("INSERT INTO report SELECT 'zz-archive-report', patient_id, kind, test_date, report_time, raw_data, organized_data, parsed_json_data, extra_data FROM report LIMIT 1");
    await client.execute("INSERT INTO record SELECT 'zz-archive-record', patient_id, 'zz-archive-report', metric_name, '120', unit, ref_range, status, extra_data FROM record LIMIT 1");
    async function displayed() {
      const reports = (await client.execute('SELECT * FROM report')).rows.map((row) => ({ id: String(row.id), kind: String(row.kind) }));
      const records = (await client.execute('SELECT * FROM record')).rows.map((row) => ({ id: String(row.id), reportId: String(row.report_id), metricName: String(row.metric_name), value: String(row.value), unit: String(row.unit), extraData: row.extra_data }));
      const points = activityPoints(reports, records);
      expect(points).toEqual(activityPoints(reports.reverse(), records.reverse()));
      expect(points).toHaveLength(1);
      return points[0].value;
    }
    expect(await displayed()).toBe(120);
    expect((await preview(activity(150))).counts).toEqual({ newValues: 0, updatedValues: 1, duplicateValues: 0 });
    await run(activity(150));
    expect(await displayed()).toBe(150);
    expect(await run(activity(150))).toMatchObject({ writtenValues: 0, duplicateValues: 1 });
  });

  it('protects activity rows from clinical review deletion and update targets', async () => {
    await run(activity());
    const before = (await client.execute('SELECT * FROM record')).rows[0];
    const reports = (await client.execute('SELECT * FROM report')).rows;
    const { saveReviewedReport } = await import('./report-review');
    const result = await saveReviewedReport({
      patientId: 'a', targetReportId: String(before.report_id), deletedRecordIdsStr: JSON.stringify([before.id]),
      metricsStr: JSON.stringify([{ label: before.metric_name, value: 999, unit: 'count', saveMode: 'update', matchedRecordId: before.id }]),
      reportTestDate: '2026-10-02T12:00:00Z', reportTimeZone: 'UTC',
    });
    expect(result).toMatchObject({ createdCount: 1, updatedCount: 0 });
    expect((await client.execute({ sql: 'SELECT * FROM record WHERE id = ?', args: [before.id] })).rows).toEqual([before]);
    expect((await client.execute("SELECT * FROM report WHERE kind = 'activity'")).rows).toEqual(reports);
  });

  it('rejects activity rows with missing metadata, wrong units or mismatched dates', async () => {
    const valid = activity()[0];
    const noMetadata = { ...valid, entries: valid.entries.map(({ dailySummary, ...entry }) => entry) };
    const wrongUnit = { ...valid, entries: valid.entries.map((entry) => ({ ...entry, unit: 'kg' })) };
    const wrongDate = { ...valid, sourceKey: 'activity:2026-10-02' };
    expect(await run([noMetadata, wrongUnit, wrongDate])).toMatchObject({ writtenValues: 0, skippedSessions: 3 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(0);
  });

  it('does not reuse another patient’s activity reports', async () => {
    await run(activity(), 'b');
    expect(await run(activity(), 'a')).toMatchObject({ createdSessions: 1, newValues: 1 });
    expect((await client.execute('SELECT * FROM report')).rows).toHaveLength(2);
  });
});
