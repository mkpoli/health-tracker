// Uploads report sources that exist only in the local `wrangler dev` bucket to
// the real one.
//
// Some documents were uploaded while the app was running under `wrangler dev`,
// so the object went to the emulated bucket on that machine while the key was
// recorded in the production database. The row points at nothing, and the app
// answers 404 when the user opens the original.
//
//   bun scripts/restore-report-sources.ts           # dry run
//   bun scripts/restore-report-sources.ts --apply   # uploads what is missing
//
// `wrangler r2 object get` serves cached reads, so it will keep reporting an
// object missing for a while after it has been uploaded. Confirm through the
// running app (`/api/report-source?key=…`), which reads the binding directly.

import { createClient } from '@libsql/client';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'health-tracker-report-sources';
const LOCAL_ROOT = '.wrangler/state/v3/r2';

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function run(command: string, args: string[]) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && !stderr.includes('does not exist')) process.stderr.write(stderr);
      resolve(code ?? 1);
    });
  });
}

async function existsInBucket(key: string) {
  const probe = join(tmpdir(), `probe-${process.pid}`);
  const code = await run('bunx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--file', probe]);

  if (code !== 0) return false;

  const data = await readFile(probe).catch(() => Buffer.alloc(0));
  await unlink(probe).catch(() => {});
  return data.length > 0;
}

async function findLocalBlob(key: string) {
  const indexDir = await readdir(`${LOCAL_ROOT}/miniflare-R2BucketObject`).catch(() => [] as string[]);

  for (const file of indexDir.filter((name) => name.endsWith('.sqlite'))) {
    const db = new Database(`${LOCAL_ROOT}/miniflare-R2BucketObject/${file}`, { readonly: true });
    const row = db.query('select blob_id, size from _mf_objects where key = ?').get(key) as
      | { blob_id?: string; size?: number }
      | null;
    db.close();

    if (!row?.blob_id) continue;

    for (const bucket of await readdir(LOCAL_ROOT)) {
      const data = await readFile(`${LOCAL_ROOT}/${bucket}/blobs/${row.blob_id}`).catch(() => null);
      if (data) return data;
    }
  }

  return null;
}

const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });

const reports = await db.execute(
  "select id, test_date, raw_data from report where raw_data like '%r2-file%' order by test_date desc",
);

console.log(`${reports.rows.length} report(s) reference a stored source.`);
console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: dry run — nothing will be uploaded\n');

let restored = 0;
let lost = 0;
let present = 0;

for (const row of reports.rows) {
  const source = parseJson(row.raw_data);
  const key = String(source.key || '');
  const label = String(row.test_date).slice(0, 10);

  if (!key) continue;

  if (await existsInBucket(key)) {
    present += 1;
    console.log(`- ${label}  already in the bucket`);
    continue;
  }

  const local = await findLocalBlob(key);

  if (!local) {
    lost += 1;
    console.log(`- ${label}  MISSING from the bucket and not on this machine`);
    continue;
  }

  console.log(`- ${label}  missing from the bucket, found locally (${local.length} bytes)`);

  if (APPLY) {
    const staged = join(tmpdir(), `restore-${process.pid}-${restored}`);
    await writeFile(staged, local);

    const code = await run('bunx', [
      'wrangler',
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--remote',
      '--file',
      staged,
      '--content-type',
      String(source.mimeType || 'application/pdf'),
    ]);

    await unlink(staged).catch(() => {});

    if (code !== 0) {
      console.log(`    upload failed`);
      continue;
    }

    console.log(`    uploaded`);
  }

  restored += 1;
}

console.log(
  `\n${present} already present, ${restored} ${APPLY ? 'restored' : 'restorable'}, ${lost} unrecoverable.`,
);
if (!APPLY && restored > 0) console.log('Re-run with --apply to upload.');
