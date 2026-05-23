// Bulk-upload .env entries as Cloudflare Worker secrets via `wrangler secret bulk`.
// Usage:
//   bun run secrets:push                 # uploads to default environment
//   bun run secrets:push -- --env=prod   # forwards flags to wrangler
//   ENV_FILE=.env.production bun run secrets:push
//
// Reads from .env (override with ENV_FILE=path). Skips comment / blank lines.
// Strips matching surrounding "..." or '...' from values. Preserves keys with =, \n, etc.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ENV_FILE = process.env.ENV_FILE ?? '.env';
const forwardedArgs = process.argv.slice(2);

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function runWrangler(jsonPath: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bunx', ['wrangler', 'secret', 'bulk', jsonPath, ...args], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  let text: string;
  try {
    text = await readFile(ENV_FILE, 'utf8');
  } catch (err) {
    console.error(`error: cannot read ${ENV_FILE}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const parsed = parseEnv(text);
  const skipped: string[] = [];
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === '') {
      skipped.push(k);
      continue;
    }
    secrets[k] = v;
  }
  const keys = Object.keys(secrets);
  if (keys.length === 0) {
    console.error(`error: no non-empty secret entries parsed from ${ENV_FILE}`);
    process.exit(1);
  }

  const tmpPath = join(tmpdir(), `wrangler-secrets-${process.pid}-${Date.now()}.json`);
  await writeFile(tmpPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });

  console.log(`Uploading ${keys.length} secrets from ${ENV_FILE} to Cloudflare:`);
  for (const key of keys) console.log(`  • ${key}`);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} empty value(s): ${skipped.join(', ')}`);
  }

  let exitCode = 1;
  try {
    exitCode = await runWrangler(tmpPath, forwardedArgs);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
  process.exit(exitCode);
}

main();
