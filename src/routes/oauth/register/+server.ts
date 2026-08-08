import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  clientRedirectUris,
  mcpEnabled,
  pruneUnapprovedClients,
  registerClient,
  unapprovedClientsAtCapacity,
} from '$lib/server/mcp/oauth';

// RFC 7591 dynamic client registration, public clients only. No secret is
// issued: the client proves itself with PKCE and the redirect it registered.

function isUsableRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);
    // Loopback is how a desktop client or a CLI receives the code.
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_LENGTH = 512;
const MAX_NAME_LENGTH = 80;

export const POST: RequestHandler = async ({ request }) => {
  if (!mcpEnabled()) return json({ error: 'temporarily_unavailable' }, { status: 503 });

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const redirectUris = (Array.isArray(body.redirect_uris) ? body.redirect_uris : [])
    .filter(isUsableRedirect)
    .filter((uri) => uri.length <= MAX_REDIRECT_LENGTH)
    .slice(0, MAX_REDIRECT_URIS);

  if (redirectUris.length === 0) {
    return json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  // Registration is open because MCP clients register themselves, so rows a
  // person never approved are swept rather than kept forever.
  await pruneUnapprovedClients();

  if (await unapprovedClientsAtCapacity()) {
    return json({ error: 'temporarily_unavailable' }, { status: 503 });
  }

  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim() : 'AI agent';
  const row = await registerClient({
    name: name.slice(0, MAX_NAME_LENGTH),
    redirectUris,
    uri: typeof body.client_uri === 'string' ? body.client_uri.slice(0, 300) : null,
  });

  return json(
    {
      client_id: row.id,
      client_name: row.name,
      redirect_uris: clientRedirectUris(row),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201 },
  );
};
