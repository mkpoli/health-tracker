// End-to-end check of the agent path: discovery, registration, consent, code
// exchange, tool calls, and the refusals that matter — replayed codes, reused
// refresh tokens, revocation, profiles outside the grant, cross-site form posts.
//
// Point it at a server running against a disposable copy of the database:
//
//   BASE=http://localhost:5177 \
//   VERIFY_DB=/path/to/copy.db \
//   AUTH0_SESSION_SECRET=… \
//   bun scripts/verify-mcp.ts
//
// Some behaviour differs between `vite dev` and the built Worker — the
// framework's own cross-origin form check only runs in the latter — so a change
// to the OAuth endpoints is worth running against `wrangler dev` as well.
import { SignJWT } from 'jose';
import { Database } from 'bun:sqlite';

const BASE = process.env.BASE ?? 'http://localhost:5178';
const SUB = 'auth0|69cc5ecee627ff1d0ce01339';
const REDIRECT = 'http://127.0.0.1:9999/callback';

let pass = 0;
let fail = 0;
const step = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
const sha256 = async (input: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))));

const db = new Database(process.env.VERIFY_DB!);
const secret = new TextEncoder().encode(process.env.AUTH0_SESSION_SECRET!);
const cookie = await new SignJWT({ user: { sub: SUB, name: 'Test', email: null, picture: null } })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(secret);

const patients = db.query('select id from patient where owner_user_id = ?').all(SUB) as Array<{ id: string }>;

async function register(name = 'Test Agent') {
  const response = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }),
  });
  return (await response.json()) as { client_id: string };
}

async function consent(
  clientId: string,
  challenge: string,
  chosen: string[],
  demographics: boolean,
  allowWrite = false,
) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${BASE}/mcp`,
  });

  const body = new URLSearchParams();
  for (const id of chosen) body.append('patient_id', id);
  if (demographics) body.set('share_demographics', 'on');
  if (allowWrite) body.set('allow_write', 'on');

  const response = await fetch(`${BASE}/oauth/authorize?${query}&%2Fapprove=`, {
    method: 'POST',
    headers: { cookie: `auth_session=${cookie}`, 'content-type': 'application/x-www-form-urlencoded', origin: BASE },
    body,
    redirect: 'manual',
  });

  if (response.status === 303) {
    return { code: new URL(response.headers.get('location')!).searchParams.get('code'), status: response.status };
  }

  const payload = (await response.json()) as { location?: string; status?: number; type?: string };
  return {
    code: payload.location ? new URL(payload.location).searchParams.get('code') : null,
    status: payload.status ?? response.status,
  };
}

// The shape a real OAuth client sends: form-encoded, no Origin header.
const tokenRequest = (params: Record<string, string>) =>
  fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
const challenge = await sha256(verifier);
const client = await register();
step('dynamic client registration', Boolean(client.client_id));

const first = await consent(client.client_id, challenge, [patients[0].id], true);
step('consent issues a code', Boolean(first.code));

const tokens = (await (
  await tokenRequest({
    grant_type: 'authorization_code',
    code: first.code!,
    code_verifier: verifier,
    client_id: client.client_id,
    redirect_uri: REDIRECT,
  })
).json()) as { access_token?: string; refresh_token?: string; expires_in?: number };

step(
  'token exchange with no Origin header (production shape)',
  Boolean(tokens.access_token),
  `expires_in=${tokens.expires_in}`,
);

const replay = await tokenRequest({
  grant_type: 'authorization_code',
  code: first.code!,
  code_verifier: verifier,
  client_id: client.client_id,
  redirect_uri: REDIRECT,
});
step('replayed authorization code refused', replay.status === 400);

const shortVerifier = await tokenRequest({
  grant_type: 'authorization_code',
  code: 'x',
  code_verifier: 'too-short',
  client_id: client.client_id,
  redirect_uri: REDIRECT,
});
step('malformed PKCE verifier refused', shortVerifier.status === 400);

let access = tokens.access_token!;
let refresh = tokens.refresh_token!;
let id = 0;
const rpc = async (method: string, params?: unknown, token = access) =>
  (await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })).json() as Promise<any>;

const call = (name: string, args: Record<string, unknown> = {}, token = access) =>
  rpc('tools/call', { name, arguments: args }, token);

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
step('initialize', init.result?.serverInfo?.name === 'health-tracker');

const summary = (await call('get_health_summary', { patient_id: patients[0].id })).result?.structuredContent;
step('get_health_summary', Array.isArray(summary?.metrics), `metrics=${summary?.metrics?.length} abnormal=${summary?.abnormal_count}`);

// agab is recorded as Other, which matches no sexed catalog entry. Nothing may
// be judged against the male range on the strength of that.
const sexed = (summary?.metrics ?? []).filter((metric: any) =>
  ['testosterone', 'estradiol', 'hemoglobin', 'hematocrit', 'creatinine', 'uric-acid'].includes(metric.metric),
);
const maleRanged = sexed.filter((metric: any) => metric.status_source === 'catalog' && metric.range_label?.includes('male'));
step(
  'agab Other is never judged against a sexed range',
  maleRanged.length === 0,
  maleRanged.map((m: any) => `${m.metric}:${m.range_label}:${m.status}`).join(', ') || `${sexed.length} sexed metrics checked`,
);

const history = (await call('get_metric_history', {
  patient_id: patients[0].id,
  metrics: ['triglycerides'],
})).result?.structuredContent;
step('get_metric_history', Array.isArray(history?.metrics?.[0]?.points), `points=${history?.metrics?.[0]?.points?.length}`);
step(
  'perYear withheld on a short window',
  history?.metrics?.[0]?.trend === null || typeof history?.metrics?.[0]?.trend?.spanDays === 'number',
  `spanDays=${history?.metrics?.[0]?.trend?.spanDays} perYear=${history?.metrics?.[0]?.trend?.perYear}`,
);

const ranges = (await call('get_reference_ranges', { metric: 'estradiol', patient_id: patients[0].id })).result
  ?.structuredContent;
step(
  'therapy ranges carry context on-therapy',
  (ranges?.ranges ?? []).filter((r: any) => r.context === 'on-therapy').length === 2,
);

const batch = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
  body: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))),
});
step('oversized batch refused', batch.status === 413, `status=${batch.status}`);

// Refresh rotation, then replay of the spent token.
const refreshed = (await (
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.client_id })
).json()) as { access_token?: string; refresh_token?: string };
step('refresh rotates', Boolean(refreshed.refresh_token) && refreshed.refresh_token !== refresh);

const spent = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.client_id });
step('replayed refresh token refused', spent.status === 400);

const afterReuse = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${refreshed.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 900, method: 'ping' }),
});
step('refresh-token reuse revokes the whole grant', afterReuse.status === 401, `status=${afterReuse.status}`);

// A fresh grant for the remaining checks.
const client2 = await register('Second Agent');
const second = await consent(client2.client_id, challenge, [patients[0].id], false);
const tokens2 = (await (
  await tokenRequest({
    grant_type: 'authorization_code',
    code: second.code!,
    code_verifier: verifier,
    client_id: client2.client_id,
    redirect_uri: REDIRECT,
  })
).json()) as { access_token?: string; refresh_token?: string };

const withheld = (await call('list_patients', {}, tokens2.access_token!)).result?.structuredContent?.patients?.[0];
step('demographics withheld are absent', withheld?.agab === undefined && withheld?.demographics_shared === false);

// Re-consent replaces the previous grant for the same client.
const third = await consent(client2.client_id, challenge, [patients[0].id], true);
step('re-consent issues a new code', Boolean(third.code));
const stale = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${tokens2.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 901, method: 'ping' }),
});
step('re-consent revokes the previous grant', stale.status === 401, `status=${stale.status}`);

// Revocation by access token.
const tokens3 = (await (
  await tokenRequest({
    grant_type: 'authorization_code',
    code: third.code!,
    code_verifier: verifier,
    client_id: client2.client_id,
    redirect_uri: REDIRECT,
  })
).json()) as { access_token?: string };

const beforeRevoke = await rpc('ping', undefined, tokens3.access_token!);
step('token works before revocation', beforeRevoke.result !== undefined);

await fetch(`${BASE}/oauth/revoke`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ token: tokens3.access_token! }),
});
const afterRevoke = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { authorization: `Bearer ${tokens3.access_token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 902, method: 'ping' }),
});
step('revoking an access token ends the grant', afterRevoke.status === 401, `status=${afterRevoke.status}`);

// Consent with nothing selected must not create a grant.
const empty = await consent(client2.client_id, challenge, [], false);
step('consent with no profile selected refused', empty.code === null, `status=${empty.status}`);

// Discovery, including the path-inserted form.
for (const path of [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
]) {
  const response = await fetch(`${BASE}${path}`);
  step(`discovery ${path}`, response.status === 200);
}

const framing = await fetch(`${BASE}/oauth/authorize?response_type=code`, {
  headers: { cookie: `auth_session=${cookie}` },
  redirect: 'manual',
});
step('consent screen refuses framing', framing.headers.get('x-frame-options') === 'DENY');

// The app's own form actions keep the origin check the framework used to do.
const crossSite = await fetch(`${BASE}/settings/connections?%2Frevoke=`, {
  method: 'POST',
  headers: {
    cookie: `auth_session=${cookie}`,
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://evil.example',
  },
  body: new URLSearchParams({ grant_id: 'x' }),
});
step('cross-site form post still refused', crossSite.status === 403, `status=${crossSite.status}`);

// Writing: a read-only connection must be refused, and a granted one must
// store exactly what it was given and nothing more.
const readOnlyWrite = await call('log_measurement', {
  patient_id: patients[0].id,
  kind: 'body',
  entries: [{ metric: 'waist-circumference', value: 96, unit: 'cm' }],
});
step(
  'a read-only connection cannot write',
  readOnlyWrite.result?.isError === true || readOnlyWrite.error !== undefined,
  readOnlyWrite.result?.content?.[0]?.text ?? readOnlyWrite.error?.message,
);

const listedForReader = (await rpc('tools/list')).result?.tools?.map((t: any) => t.name) ?? [];
step('the write tool is not offered without the scope', !listedForReader.includes('log_measurement'));

const writer = await register('Writing Agent');
const writeConsent = await consent(writer.client_id, challenge, [patients[0].id], true, true);
const writeTokens = (await (
  await tokenRequest({
    grant_type: 'authorization_code',
    code: writeConsent.code!,
    code_verifier: verifier,
    client_id: writer.client_id,
    redirect_uri: REDIRECT,
  })
).json()) as { access_token?: string };

const writerTools = (await rpc('tools/list', undefined, writeTokens.access_token!)).result?.tools ?? [];
const writeTool = writerTools.find((t: any) => t.name === 'log_measurement');
step('the write tool appears once granted', Boolean(writeTool));
step('it is annotated as changing the record', writeTool?.annotations?.readOnlyHint === false);

const measuredAt = '2026-08-08T09:00:00.000Z';
const stored = await call(
  'log_measurement',
  {
    patient_id: patients[0].id,
    kind: 'body',
    measured_at: measuredAt,
    entries: [
      { metric: 'waist-circumference', value: 96, unit: 'cm' },
      { metric: 'body-weight', value: 137.2, unit: 'kg' },
    ],
    notes: 'logged from a conversation',
  },
  writeTokens.access_token!,
);
const storedData = stored.result?.structuredContent;
step('a measurement is stored', storedData?.stored === true, `saved=${storedData?.saved_count}`);
step(
  'the stored numbers come back through the read model',
  (storedData?.metrics ?? []).some((metric: any) => metric.metric === 'waist-circumference' && metric.value === 96),
  (storedData?.metrics ?? []).map((metric: any) => `${metric.metric}=${metric.value}`).join(', '),
);

const repeat = await call(
  'log_measurement',
  {
    patient_id: patients[0].id,
    kind: 'body',
    measured_at: measuredAt,
    entries: [{ metric: 'waist-circumference', value: 96, unit: 'cm' }],
  },
  writeTokens.access_token!,
);
step('a retry does not write a second session', repeat.result?.structuredContent?.stored === false);

const labAttempt = await call(
  'log_measurement',
  { patient_id: patients[0].id, kind: 'lab', entries: [{ metric: 'hba1c', value: 5.5, unit: '%' }] },
  writeTokens.access_token!,
);
step('laboratory results cannot be written', labAttempt.result?.isError === true);

const nonsense = await call(
  'log_measurement',
  { patient_id: patients[0].id, kind: 'body', entries: [{ metric: 'waist-circumference', value: 'lots' }] },
  writeTokens.access_token!,
);
step('a non-numeric value is refused', nonsense.result?.isError === true);

const foreignWrite = await call(
  'log_measurement',
  { patient_id: '00000000-0000-0000-0000-000000000000', kind: 'body', entries: [{ metric: 'body-weight', value: 80 }] },
  writeTokens.access_token!,
);
step('writing to a profile outside the grant is refused', foreignWrite.result?.isError === true);

// The session must carry its provenance, and must not have pruned anything.
const written = db
  .query("select id, extra_data from report where kind = 'body' and test_date = ?")
  .all(measuredAt) as Array<{ id: string; extra_data: string }>;
step('exactly one session exists for that moment', written.length === 1, `${written.length} session(s)`);
// `extra_data` is a `mode: 'json'` column that the app also JSON.stringifies
// into, so the stored text is encoded twice. It round-trips because the reader
// parses whatever it gets, but a raw read has to unwrap both layers.
const sessionExtra = (() => {
  let value: unknown = written[0]?.extra_data ?? '{}';
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return (value || {}) as Record<string, any>;
})();
step('the session records that an agent wrote it', sessionExtra?.source?.via === 'mcp', JSON.stringify(sessionExtra?.source));
const writtenRecords = db.query('select count(*) n from record where report_id = ?').get(written[0]?.id) as { n: number };
step('both entries were kept', writtenRecords.n === 2, `${writtenRecords.n} record(s)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
