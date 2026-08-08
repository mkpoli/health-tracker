// Reads the draw condition out of already-stored report sources and writes it
// onto the records that were parsed before the field existed.
//
// Narrow on purpose: it asks the document one question — was this drawn fasting
// or after a meal — and writes only `collectionContext` and `hoursSinceMeal`
// into a record's extraData. Values, units, reference ranges and statuses are
// never touched, so a wrong answer here cannot corrupt a measurement.
//
//   bun scripts/backfill-collection-context.ts            # dry run, prints the plan
//   bun scripts/backfill-collection-context.ts --apply    # writes
//
// Needs DATABASE_URL, DATABASE_AUTH_TOKEN, OPENAI_API_KEY, and a wrangler login
// for the R2 bucket holding the sources.

import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'health-tracker-report-sources';
const MODEL = process.env.OPENAI_API_MODEL || 'gpt-5.6-sol';

/** Metrics whose published interval only describes a fasting draw. */
const FASTING_DEPENDENT = new Set(['blood glucose', 'serum glucose', 'triglycerides']);

type DrawContext = 'fasting' | 'post-meal' | 'random' | null;

function readContext(value: unknown): DrawContext {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text === 'fasting' || text === 'post-meal' || text === 'random' ? text : null;
}

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
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * R2 objects are only reachable through the account, so wrangler fetches them.
 * Some sources were uploaded while the app was running under `wrangler dev` and
 * exist only in the emulated bucket on this machine, so that is tried second.
 */
async function fetchSource(key: string) {
  const path = join(tmpdir(), `report-source-${process.pid}-${Math.abs(hash(key))}`);
  const code = await run('bunx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--file', path]);

  if (code === 0) {
    const data = await readFile(path);
    await unlink(path).catch(() => {});
    if (data.length > 0) return { data, origin: 'r2' as const };
  }

  const local = await readLocalObject(key);
  return local ? { data: local, origin: 'local dev bucket' as const } : null;
}

async function readLocalObject(key: string) {
  const { Database } = await import('bun:sqlite');
  const { readdir } = await import('node:fs/promises');
  const root = '.wrangler/state/v3/r2';

  let indexDir: string[];
  try {
    indexDir = await readdir(`${root}/miniflare-R2BucketObject`);
  } catch {
    return null;
  }

  for (const file of indexDir.filter((name) => name.endsWith('.sqlite'))) {
    const db = new Database(`${root}/miniflare-R2BucketObject/${file}`, { readonly: true });
    const row = db.query('select blob_id from _mf_objects where key = ?').get(key) as { blob_id?: string } | null;
    db.close();

    if (!row?.blob_id) continue;

    for (const bucket of await readdir(root)) {
      try {
        return await readFile(`${root}/${bucket}/blobs/${row.blob_id}`);
      } catch {
        continue;
      }
    }
  }

  return null;
}

function hash(value: string) {
  let out = 0;
  for (let i = 0; i < value.length; i++) out = (out * 31 + value.charCodeAt(i)) | 0;
  return out;
}

const PROMPT = `You are reading a laboratory report to answer one question: under what conditions was the blood drawn?

Return only this JSON, with no markdown fence:
{
  "panelContext": "fasting" | "post-meal" | "random" | "",
  "hoursSinceMeal": number or "",
  "perMetric": [ { "label": "test name exactly as printed", "context": "fasting" | "post-meal" | "random", "hoursSinceMeal": number or "" } ],
  "evidence": "the exact wording in the document that says so, or empty"
}

"fasting" for 空腹時, 絶食, FBS, fasting. "post-meal" for 食後, 食後2時間, PPBS, postprandial, non-fasting. "random" for 随時 or casual with no meal stated.
Use "perMetric" only when the document states a different condition for particular tests; otherwise leave it empty and use "panelContext".
If the document does not say, return empty strings. Never infer the condition from the values themselves — an unstated condition must come back empty.`;

const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const reports = await db.execute(`
  select r.id, r.test_date, r.raw_data
  from report r
  where r.raw_data is not null and r.raw_data != ''
    and exists (
      select 1 from record rec
      where rec.report_id = r.id and lower(rec.metric_name) in ('blood glucose', 'serum glucose', 'triglycerides')
    )
  order by r.test_date desc
`);

console.log(`${reports.rows.length} report(s) carry a fasting-dependent metric and a stored source.`);
console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: dry run — nothing will be written\n');

let updated = 0;
let unknown = 0;

for (const row of reports.rows) {
  const reportId = String(row.id);
  const source = parseJson(row.raw_data);
  const label = `${row.test_date}`.slice(0, 10);

  if (source.kind !== 'r2-file' || typeof source.key !== 'string') {
    console.log(`- ${label}  source is not an R2 object (${String(source.kind)}); skipped`);
    continue;
  }

  const fetched = await fetchSource(source.key);

  if (!fetched) {
    console.log(`- ${label}  source could not be fetched; skipped`);
    continue;
  }

  const bytes = fetched.data;

  const mime = typeof source.mimeType === 'string' ? source.mimeType : 'application/octet-stream';
  const base64 = Buffer.from(bytes).toString('base64');
  const content: unknown[] = [{ type: 'text', text: 'Here is the report.' }];

  if (mime === 'application/pdf') {
    content.push({
      type: 'file',
      file: { file_data: `data:application/pdf;base64,${base64}`, filename: String(source.fileName || 'report.pdf') },
    });
  } else {
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
  }

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: content as never },
    ],
  });

  const answer = parseJson(completion.choices[0]?.message?.content?.replace(/^```(json)?|```$/g, '').trim());
  const panel = readContext(answer.panelContext);
  const perMetric = Array.isArray(answer.perMetric) ? answer.perMetric : [];
  const panelHours = Number(answer.hoursSinceMeal);

  const records = await db.execute({
    sql: 'select id, metric_name, extra_data from record where report_id = ?',
    args: [reportId],
  });

  const targets = records.rows.filter((rec) => FASTING_DEPENDENT.has(String(rec.metric_name).toLowerCase()));

  if (!panel && perMetric.length === 0) {
    unknown += targets.length;
    console.log(`- ${label}  document does not state the condition; ${targets.length} record(s) left unset`);
    continue;
  }

  console.log(
    `- ${label}  ${panel ?? 'per-metric'}${answer.evidence ? `  ("${String(answer.evidence).slice(0, 60)}")` : ''}` +
      (fetched.origin === 'r2' ? '' : `  [read from ${fetched.origin}]`),
  );

  for (const rec of targets) {
    const extra = parseJson(rec.extra_data);
    const original = String(extra.originalLabel || rec.metric_name).toLowerCase();
    const specific = perMetric.find(
      (item: Record<string, unknown>) => String(item.label || '').toLowerCase() === original,
    );

    const context = readContext(specific?.context) ?? panel;
    if (!context) continue;

    const hoursRaw = Number(specific?.hoursSinceMeal ?? panelHours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw >= 0 && hoursRaw <= 24 ? hoursRaw : null;

    console.log(`    ${rec.metric_name}: ${context}${hours === null ? '' : ` (+${hours}h)`}`);

    if (APPLY) {
      await db.execute({
        sql: 'update record set extra_data = ? where id = ?',
        args: [JSON.stringify({ ...extra, collectionContext: context, hoursSinceMeal: hours }), rec.id],
      });
    }

    updated += 1;
  }
}

console.log(`\n${updated} record(s) ${APPLY ? 'updated' : 'would be updated'}, ${unknown} left unset.`);
if (!APPLY) console.log('Re-run with --apply to write.');
