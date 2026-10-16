import { createClient } from '@libsql/client';
import { normalizedMedicineCatalogName } from '../src/lib/medicine-catalog';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function medicineClaimExists() {
  const result = await client.execute({
    sql: `SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1`,
    args: ['medicine_claim'],
  });
  return result.rows.length > 0;
}

async function productColumnExists() {
  const result = await client.execute(
    `SELECT 1 FROM pragma_table_info('medicine_claim') WHERE name = 'product_id' LIMIT 1`,
  );
  return result.rows.length > 0;
}

try {
  const apply = process.argv.includes('--apply');
  const tableExists = await medicineClaimExists();
  const before = tableExists ? await productColumnExists() : false;

  if (apply && tableExists && !before) {
    await client.execute('ALTER TABLE medicine_claim ADD COLUMN product_id text');
  }

  const products = await client.execute(
    `SELECT name FROM pragma_table_info('medicine_product')`,
  );
  const needsProductNames = products.rows.length > 0 &&
    !products.rows.some((row) => row.name === 'normalized_name');
  if (apply && products.rows.length > 0) {
    if (needsProductNames) {
      await client.execute(`ALTER TABLE medicine_product ADD COLUMN normalized_name text NOT NULL DEFAULT ''`);
    }
    // Keyset batches also finish a backfill interrupted after adding the column.
    let afterId = '';
    while (true) {
      const batch = await client.execute({
        sql: 'SELECT id, display_name FROM medicine_product WHERE id > ? ORDER BY id LIMIT 100',
        args: [afterId],
      });
      if (!batch.rows.length) break;
      await client.batch(batch.rows.map((row) => ({
        sql: 'UPDATE medicine_product SET normalized_name = ? WHERE id = ?',
        args: [normalizedMedicineCatalogName(String(row.display_name)), row.id],
      })), 'write');
      afterId = String(batch.rows[batch.rows.length - 1].id);
    }
    await client.batch([
      'DROP INDEX IF EXISTS medicine_product_patient_name_idx',
      'CREATE INDEX medicine_product_patient_name_idx ON medicine_product(patient_id, normalized_name)',
    ], 'write');
  }

  const after = tableExists ? await productColumnExists() : false;
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        medicineClaimTable: tableExists ? 'present' : 'absent',
        productIdColumnBefore: before,
        productIdColumnAfter: after,
        productNamesNeedPreparation: needsProductNames,
        nextCommand: !tableExists
          ? 'bun run db:push'
          : after && (!needsProductNames || apply)
            ? 'bun run db:push'
            : 'bun run db:prepare:medicine-catalog -- --apply',
      },
      null,
      2,
    ),
  );
} finally {
  client.close();
}
