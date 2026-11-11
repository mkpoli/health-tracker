import { createClient } from '@libsql/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const apply = process.argv.includes('--apply');
const client = createClient({ url: databaseUrl, authToken: process.env.DATABASE_AUTH_TOKEN });
const indexes = [
  { name: 'mcp_write_receipt_key_idx', table: 'mcp_write_receipt', columns: ['patient_id', 'operation', 'request_id'], unique: true },
  { name: 'medicine_course_active_snapshot_idx', table: 'medicine_course', columns: ['medicine_claim_id', 'patient_id', 'status'], unique: false },
  { name: 'dose_regimen_course_idx', table: 'dose_regimen', columns: ['course_id'], unique: false },
] as const;

try {
  const tx = await client.transaction(apply ? 'write' : 'read');
  try {
    for (const name of ['patient', 'medicine_course', 'dose_regimen']) {
      const result = await tx.execute({ sql: `SELECT name FROM sqlite_schema WHERE type='table' AND name=?`, args: [name] });
      if (!result.rows.length) throw new Error(`Required table ${name} is missing`);
    }
    const receiptTable = await tx.execute(`SELECT name FROM sqlite_schema WHERE type='table' AND name='mcp_write_receipt'`);
    if (receiptTable.rows.length) {
      const columns = await tx.execute(`SELECT name, type, "notnull" FROM pragma_table_info('mcp_write_receipt') ORDER BY cid`);
      const expected = ['patient_id', 'client_id', 'operation', 'request_id', 'payload_hash', 'receipt'];
      if (columns.rows.length !== expected.length || columns.rows.some((column, index) => column.name !== expected[index] || String(column.type).toUpperCase() !== 'TEXT' || Number(column.notnull) !== 1)) {
        throw new Error('Existing mcp_write_receipt has an incompatible schema');
      }
      const foreignKeys = await tx.execute(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('mcp_write_receipt')`);
      if (!foreignKeys.rows.some((key) => key.table === 'patient' && key.from === 'patient_id' && key.to === 'id' && key.on_delete === 'CASCADE')) {
        throw new Error('Existing mcp_write_receipt has an incompatible patient foreign key');
      }
    }
    const missingIndexes: string[] = [];
    for (const index of indexes) {
      const existing = await tx.execute({ sql: `SELECT tbl_name FROM sqlite_schema WHERE type='index' AND name=?`, args: [index.name] });
      if (!existing.rows.length) {
        if (index.name === 'dose_regimen_course_idx') throw new Error('Required dose_regimen_course_idx is missing');
        missingIndexes.push(index.name);
        continue;
      }
      const info = await tx.execute({ sql: `SELECT name FROM pragma_index_info(?) ORDER BY seqno`, args: [index.name] });
      const list = await tx.execute({ sql: `SELECT "unique", partial FROM pragma_index_list(?) WHERE name=?`, args: [index.table, index.name] });
      const details = await tx.execute({ sql: `SELECT "desc", coll FROM pragma_index_xinfo(?) WHERE "key"=1`, args: [index.name] });
      if (existing.rows[0].tbl_name !== index.table || info.rows.map((row) => row.name).join('\u001f') !== index.columns.join('\u001f') || Number(list.rows[0]?.unique) !== Number(index.unique) || Number(list.rows[0]?.partial) !== 0 || details.rows.some((row) => Number(row.desc) !== 0 || row.coll !== 'BINARY')) {
        throw new Error(`Existing ${index.name} has an incompatible definition`);
      }
    }
    if (apply) {
      await tx.execute(`CREATE TABLE IF NOT EXISTS mcp_write_receipt (patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE, client_id TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt TEXT NOT NULL)`);
      await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mcp_write_receipt_key_idx ON mcp_write_receipt(patient_id, operation, request_id)`);
      await tx.execute(`CREATE INDEX IF NOT EXISTS medicine_course_active_snapshot_idx ON medicine_course(medicine_claim_id, patient_id, status)`);
    }
    await tx.commit();
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', receiptTableBefore: receiptTable.rows.length ? 'present' : 'absent', missingIndexesBefore: missingIndexes }));
  } finally {
    tx.close();
  }
} finally {
  client.close();
}
