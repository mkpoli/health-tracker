import { error, fail, redirect } from '@sveltejs/kit';
import { eq, desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { patient } from '$lib/server/db/schema';
import { requireUserId } from '$lib/server/ownership';
import {
  CLAIM_WRITE_SCOPE,
  clientRedirectUris,
  createGrant,
  getClient,
  issueAuthCode,
  READ_SCOPE,
  WRITE_SCOPE,
  mcpEnabled,
  resourceUrl,
  revokePriorGrants,
} from '$lib/server/mcp/oauth';

// The consent screen. Auth0 has already established who the person is; what is
// decided here is which profiles this particular agent may read, which is a
// question no identity provider can answer.

type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string | null;
};

function readParams(url: URL): AuthorizeParams | { invalid: string } {
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');

  if (url.searchParams.get('response_type') !== 'code') return { invalid: 'unsupported_response_type' };
  if (!clientId || !redirectUri) return { invalid: 'invalid_request' };
  if (!codeChallenge || url.searchParams.get('code_challenge_method') !== 'S256') {
    return { invalid: 'invalid_request' };
  }

  return {
    clientId,
    redirectUri,
    codeChallenge,
    state: url.searchParams.get('state'),
    resource: url.searchParams.get('resource'),
  };
}

export const load: PageServerLoad = async ({ url, locals }) => {
  if (!mcpEnabled()) throw error(503, 'Agent connections are not configured on this server');

  const userId = requireUserId(locals);
  const params = readParams(url);

  if ('invalid' in params) throw error(400, params.invalid);
  if (params.resource && params.resource !== resourceUrl(url.origin)) throw error(400, 'invalid_target');

  const client = await getClient(params.clientId);
  if (!client) throw error(400, 'unknown_client');

  // An unregistered redirect could route a stolen code elsewhere. This request
  // ends here without sending any response parameters to that address.
  if (!clientRedirectUris(client).includes(params.redirectUri)) throw error(400, 'invalid_redirect_uri');

  const patients = await db
    .select({ id: patient.id, name: patient.name })
    .from(patient)
    .where(eq(patient.ownerUserId, userId))
    .orderBy(desc(patient.id));

  return {
    client: {
      id: client.id,
      name: client.name,
      uri: client.uri,
      // Where the authorization code is sent. With open registration the name
      // is whatever the client called itself; this is the part that says who
      // actually receives the access.
      redirectOrigin: new URL(params.redirectUri).origin,
    },
    patients,
    scope: READ_SCOPE,
    query: url.search,
  };
};

export const actions: Actions = {
  approve: async ({ request, url, locals }) => {
    const userId = requireUserId(locals);
    const params = readParams(url);

    if ('invalid' in params) return fail(400, { error: params.invalid });

    const client = await getClient(params.clientId);
    if (!client || !clientRedirectUris(client).includes(params.redirectUri)) {
      return fail(400, { error: 'invalid_redirect_uri' });
    }

    const form = await request.formData();
    const selected = form.getAll('patient_id').map((value) => value.toString());

    if (selected.length === 0) return fail(400, { error: 'no_patient_selected' });

    const owned = await db
      .select({ id: patient.id })
      .from(patient)
      .where(eq(patient.ownerUserId, userId));
    const ownedIds = new Set(owned.map((row) => row.id));
    const patientIds = selected.filter((id) => ownedIds.has(id));

    if (patientIds.length === 0) return fail(400, { error: 'no_patient_selected' });

    // Approving a client again replaces what it had. Without this the access it
    // holds is the union of every past approval, and unticking a profile here
    // would not take it away.
    await revokePriorGrants(userId, client.id);

    const scopes = [READ_SCOPE];
    if (form.get('allow_measurement_write') === 'on') scopes.push(WRITE_SCOPE);
    if (form.get('allow_claim_write') === 'on') scopes.push(CLAIM_WRITE_SCOPE);

    const grant = await createGrant({
      ownerUserId: userId,
      clientId: client.id,
      patientIds,
      shareDemographics: form.get('share_demographics') === 'on',
      scope: scopes.join(' '),
    });

    const code = await issueAuthCode({
      grantId: grant.id,
      clientId: client.id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      resource: params.resource || resourceUrl(url.origin),
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state) target.searchParams.set('state', params.state);

    throw redirect(303, target.toString());
  },

  deny: async ({ url }) => {
    const params = readParams(url);
    if ('invalid' in params) return fail(400, { error: params.invalid });

    const client = await getClient(params.clientId);
    if (!client || !clientRedirectUris(client).includes(params.redirectUri)) {
      return fail(400, { error: 'invalid_redirect_uri' });
    }

    const target = new URL(params.redirectUri);
    target.searchParams.set('error', 'access_denied');
    if (params.state) target.searchParams.set('state', params.state);

    throw redirect(303, target.toString());
  },
};
