import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

describe('medicine catalog schema preparation', () => {
  it('prepares and resumes normalized product names in keyset batches', async () => {
    const path = join(tmpdir(), 'catalog-schema-' + crypto.randomUUID() + '.db');
    const client = createClient({ url: 'file:' + path });
    const run = (apply: boolean) => {
      const result = spawnSync('bun', ['scripts/prepare-medicine-catalog-schema.ts', ...(apply ? ['--apply'] : [])], {
        env: { ...process.env, DATABASE_URL: 'file:' + path, DATABASE_AUTH_TOKEN: '' },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    try {
      await client.executeMultiple(`
        CREATE TABLE medicine_claim (id TEXT PRIMARY KEY, product_id TEXT);
        CREATE TABLE medicine_product (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, display_name TEXT NOT NULL);
        CREATE INDEX medicine_product_patient_name_idx ON medicine_product(patient_id, display_name);
      `);
      await client.batch(Array.from({ length: 205 }, (_, index) => ({
        sql: 'INSERT INTO medicine_product VALUES (?, ?, ?)',
        args: [String(index).padStart(4, '0'), 'profile', index % 2 ? 'ＡＢＣ' : 'ÄRZTE'],
      })), 'write');
      expect(run(false)).toMatchObject({
        productNamesNeedPreparation: true, nextCommand: 'bun run db:prepare:medicine-catalog -- --apply',
      });
      expect(run(true)).toMatchObject({ nextCommand: 'bun run db:push' });
      const names = await client.execute('SELECT DISTINCT normalized_name FROM medicine_product ORDER BY normalized_name');
      expect(names.rows.map((row) => row.normalized_name)).toEqual(['abc', 'ärzte']);
      const columns = await client.execute("PRAGMA index_info('medicine_product_patient_name_idx')");
      expect(columns.rows.map((row) => row.name)).toEqual(['patient_id', 'normalized_name']);
      await client.execute("UPDATE medicine_product SET normalized_name = '' WHERE id = '0204'");
      run(true);
      const repaired = await client.execute("SELECT normalized_name FROM medicine_product WHERE id = '0204'");
      expect(repaired.rows[0].normalized_name).toBe('ärzte');
      expect(run(false)).toMatchObject({ productNamesNeedPreparation: false, nextCommand: 'bun run db:push' });
    } finally {
      client.close();
      await unlink(path);
    }
  });
});
