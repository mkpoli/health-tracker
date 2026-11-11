import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

describe('stop medicine schema preparation', () => {
  it('adds only the required schema and preserves related data across retries', async () => {
    const path = join(tmpdir(), `stop-schema-${crypto.randomUUID()}.db`);
    let client = createClient({ url: `file:${path}` });
    const run = (apply: boolean) => spawnSync('bun', ['scripts/prepare-stop-medicine-schema.ts', ...(apply ? ['--apply'] : [])], {
      env: { ...process.env, DATABASE_URL: `file:${path}`, DATABASE_AUTH_TOKEN: '' }, encoding: 'utf8',
    });
    try {
      await client.executeMultiple(`
        PRAGMA foreign_keys=ON;
        CREATE TABLE patient (id TEXT PRIMARY KEY);
        CREATE TABLE medicine_claim (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id));
        CREATE TABLE medicine_course (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id), medicine_claim_id TEXT NOT NULL REFERENCES medicine_claim(id), status TEXT NOT NULL);
        CREATE TABLE dose_regimen (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id), course_id TEXT NOT NULL REFERENCES medicine_course(id));
        CREATE INDEX dose_regimen_course_idx ON dose_regimen(course_id);
        CREATE TABLE dose_occurrence (id TEXT PRIMARY KEY, regimen_id TEXT REFERENCES dose_regimen(id), status TEXT NOT NULL);
        CREATE TABLE claim_revision (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patient(id), snapshot TEXT NOT NULL);
        INSERT INTO patient VALUES ('p');
        INSERT INTO medicine_claim VALUES ('m','p');
        INSERT INTO medicine_course VALUES ('c','p','m','active');
        INSERT INTO dose_regimen VALUES ('r','p','c');
        INSERT INTO dose_occurrence VALUES ('d','r','taken');
        INSERT INTO claim_revision VALUES ('v','p','{}');
      `);
      client.close();
      expect(run(false).status).toBe(0);
      const first = run(true);
      expect(first.status, first.stderr).toBe(0);
      const second = run(true);
      expect(second.status, second.stderr).toBe(0);
      client = createClient({ url: `file:${path}` });
      for (const table of ['patient', 'medicine_claim', 'medicine_course', 'dose_regimen', 'dose_occurrence', 'claim_revision']) {
        expect((await client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n).toBe(1);
      }
      expect((await client.execute('PRAGMA foreign_key_check')).rows).toHaveLength(0);
      expect((await client.execute(`SELECT status FROM dose_occurrence WHERE id='d'`)).rows[0].status).toBe('taken');
      expect((await client.execute(`SELECT name FROM sqlite_schema WHERE name IN ('mcp_write_receipt','mcp_write_receipt_key_idx','medicine_course_active_snapshot_idx')`)).rows).toHaveLength(3);
      await client.execute(`INSERT INTO mcp_write_receipt VALUES ('p','client-a','stop_medicine_courses','key','hash','{}')`);
      await expect(client.execute(`INSERT INTO mcp_write_receipt VALUES ('p','client-b','stop_medicine_courses','key','hash','{}')`)).rejects.toThrow();
    } finally {
      client.close();
      await Promise.allSettled([unlink(path), unlink(`${path}-shm`), unlink(`${path}-wal`)]);
    }
  }, 20_000);

  it('refuses incompatible existing index definitions without changing data', async () => {
    const path = join(tmpdir(), `stop-schema-conflict-${crypto.randomUUID()}.db`);
    let client = createClient({ url: `file:${path}` });
    try {
      await client.executeMultiple(`
        CREATE TABLE patient (id TEXT PRIMARY KEY);
        CREATE TABLE medicine_course (id TEXT, medicine_claim_id TEXT, patient_id TEXT, status TEXT);
        CREATE TABLE dose_regimen (id TEXT, course_id TEXT, patient_id TEXT);
        CREATE INDEX dose_regimen_course_idx ON dose_regimen(course_id);
        CREATE INDEX medicine_course_active_snapshot_idx ON medicine_course(medicine_claim_id);
        INSERT INTO patient VALUES ('p');
      `);
      client.close();
      const result = spawnSync('bun', ['scripts/prepare-stop-medicine-schema.ts', '--apply'], {
        env: { ...process.env, DATABASE_URL: `file:${path}`, DATABASE_AUTH_TOKEN: '' }, encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('incompatible definition');
      client = createClient({ url: `file:${path}` });
      expect((await client.execute(`SELECT count(*) AS n FROM patient`)).rows[0].n).toBe(1);
      expect((await client.execute(`SELECT name FROM sqlite_schema WHERE name='mcp_write_receipt'`)).rows).toHaveLength(0);
    } finally {
      client.close();
      await Promise.allSettled([unlink(path), unlink(`${path}-shm`), unlink(`${path}-wal`)]);
    }
  }, 20_000);
});
