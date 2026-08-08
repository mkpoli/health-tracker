import type { RequestHandler } from './$types';
import { resolveContext } from '$lib/server/mcp/context';
import { batchTooLarge, dispatch, parseError, type JsonRpcRequest } from '$lib/server/mcp/protocol';
import { mcpEnabled } from '$lib/server/mcp/oauth';

// Streamable HTTP, stateless: one POST carries one JSON-RPC message and gets
// one JSON body back. GET would open a server-to-client stream and DELETE would
// end a session; this server has neither.

const JSON_HEADERS = { 'content-type': 'application/json' };
const MAX_BATCH = 16;

function unauthorized(origin: string) {
  return new Response(JSON.stringify({ error: 'invalid_token' }), {
    status: 401,
    headers: {
      ...JSON_HEADERS,
      // What turns a 401 into a sign-in prompt in the client rather than an
      // error the user has to interpret.
      'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!mcpEnabled()) {
    return new Response(JSON.stringify({ error: 'server_not_configured' }), { status: 503, headers: JSON_HEADERS });
  }

  const ctx = await resolveContext(request, url.origin);
  if (!ctx) return unauthorized(url.origin);

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(parseError()), { status: 400, headers: JSON_HEADERS });
  }

  const messages = Array.isArray(body) ? body : [body];

  // One POST should not be able to queue an unbounded run of tool calls, each
  // of which reaches the database.
  if (messages.length > MAX_BATCH) {
    return new Response(JSON.stringify(batchTooLarge()), { status: 413, headers: JSON_HEADERS });
  }

  const answers = [];

  for (const message of messages) {
    const answer = await dispatch(message as JsonRpcRequest, ctx);
    if (answer) answers.push(answer);
  }

  if (answers.length === 0) return new Response(null, { status: 202 });

  return new Response(JSON.stringify(Array.isArray(body) ? answers : answers[0]), { headers: JSON_HEADERS });
};

export const GET: RequestHandler = async () =>
  new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: JSON_HEADERS });

export const DELETE = GET;
