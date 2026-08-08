import { ToolError, type McpContext } from './context';
import { serverInstructions, tools, toolsFor } from './tools';
import { touchGrant } from './oauth';

// Model Context Protocol over JSON-RPC 2.0. Only the stateless half is served:
// four methods, no session id, no server-initiated stream. Nothing this server
// does needs to speak first, so there is nothing for a long-lived session to
// carry.

const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * What a client shows next to the connection. `serverInfo` gained `icons`,
 * `title` and `websiteUrl` in 2025-11-25; a client reading an older revision
 * ignores the extra fields. PNG rather than the app's SVG because PNG is the
 * format clients are required to render — SVG support is only recommended.
 */
function serverIdentity(origin: string) {
  return {
    name: 'health-tracker',
    title: 'Health Tracker',
    version: '1.0.0',
    description: "Lab results and body measurements from this account holder's own records.",
    websiteUrl: origin,
    icons: [
      { src: `${origin}/icon-48.png`, mimeType: 'image/png', sizes: ['48x48'] },
      { src: `${origin}/icon-96.png`, mimeType: 'image/png', sizes: ['96x96'] },
      { src: `${origin}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
      { src: `${origin}/favicon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
    ],
  };
}

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function describeTools(ctx: McpContext) {
  // Only what this connection may call: a tool listed and then refused is a
  // worse experience than one that was never offered.
  return toolsFor(ctx).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.writes
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}

/**
 * Answers one message. A notification (no id) produces nothing, which is what
 * the caller turns into a 202.
 */
export async function dispatch(message: JsonRpcRequest, ctx: McpContext): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;

  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return fail(id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  }

  if (message.id === undefined || message.id === null) {
    // initialized, cancelled, progress: nothing to answer.
    return null;
  }

  switch (message.method) {
    case 'initialize': {
      const asked = message.params?.protocolVersion;
      const version = typeof asked === 'string' && SUPPORTED_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSION;

      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: serverIdentity(ctx.origin),
        instructions: serverInstructions,
      });
    }

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: describeTools(ctx) });

    case 'tools/call': {
      const name = message.params?.name;
      const tool = tools.find((candidate) => candidate.name === name);

      if (!tool) return fail(id, INVALID_PARAMS, `No tool named ${String(name)}`);

      if (tool.writes && !ctx.canWrite) {
        return ok(id, {
          content: [
            {
              type: 'text',
              text: 'This connection may only read. Writing needs the write permission, which the account holder grants on the connection screen.',
            },
          ],
          isError: true,
        });
      }

      const args = (message.params?.arguments as Record<string, unknown>) || {};

      try {
        const result = await tool.handler(ctx, args);
        await touchGrant(ctx.grant);

        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        });
      } catch (error) {
        if (error instanceof ToolError) {
          // A refused argument is the model's problem to fix, so it comes back
          // as a tool result rather than a protocol error.
          return ok(id, { content: [{ type: 'text', text: error.message }], isError: true });
        }

        // The message of a driver error carries the failed statement, and the
        // statement carries patient ids. Only the shape of the failure is logged.
        console.error('[mcp] tool failed', tool.name, error instanceof Error ? error.name : 'unknown');
        return fail(id, INTERNAL_ERROR, 'Tool failed');
      }
    }

    default:
      return fail(id, METHOD_NOT_FOUND, `Unsupported method ${message.method}`);
  }
}

export function parseError(id: string | number | null = null) {
  return fail(id, PARSE_ERROR, 'Invalid JSON');
}

export function batchTooLarge() {
  return fail(null, INVALID_REQUEST, 'Too many messages in one request');
}
