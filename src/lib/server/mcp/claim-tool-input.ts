import { ToolError, type McpContext } from './context';
import { REQUEST_ID_LIMIT } from './claim-ids';

export function owns(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function pageLimit(value: unknown, fallback: number, maximum = 100) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new ToolError(`limit must be an integer from 1 through ${maximum}`);
  }

  return Number(value);
}

export function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ToolError(`${field} must be a positive integer`);
  }

  return Number(value);
}

export function requestId(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : null;
  if (
    !normalized ||
    normalized.length > REQUEST_ID_LIMIT ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ToolError(`request_id must contain 1 to ${REQUEST_ID_LIMIT} visible characters`);
  }

  return normalized;
}

export function mcpProvider(ctx: McpContext) {
  return `mcp:${ctx.clientId}`;
}
