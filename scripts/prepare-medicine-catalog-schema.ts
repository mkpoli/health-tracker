import { createClient } from '@libsql/client';

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

  const after = tableExists ? await productColumnExists() : false;
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        medicineClaimTable: tableExists ? 'present' : 'absent',
        productIdColumnBefore: before,
        productIdColumnAfter: after,
        nextCommand: !tableExists
          ? 'bun run db:push'
          : after
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
