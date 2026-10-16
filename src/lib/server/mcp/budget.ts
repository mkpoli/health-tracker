// A tool result has to leave room for the conversation it is part of. Trimming
// happens here rather than in each tool so it is one rule, and so a trimmed
// result always says it was trimmed — a health tool that silently drops rows is
// how a reader concludes a metric was never measured.

import { ToolError } from './context';

export const MAX_RESULT_BYTES = 40_000;

function measure(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Shortens the longest array in the payload until the whole thing fits, keeping
 * the head of each list — everything here is ordered newest first.
 */
export function capResult<T extends Record<string, unknown>>(payload: T): T & { truncated?: boolean } {
  if (measure(payload) <= MAX_RESULT_BYTES) return payload;

  const trimmed: Record<string, unknown> = structuredClone(payload);
  let dropped = 0;

  function arraysIn(value: unknown): unknown[][] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return [...(value.length ? [value] : []), ...value.flatMap(arraysIn)];
    }
    return Object.values(value).flatMap(arraysIn);
  }

  function longStringsIn(value: unknown): Array<{ object: Record<string, unknown>; key: string }> {
    if (!value || typeof value !== 'object') return [];
    const object = value as Record<string, unknown>;
    return Object.keys(object).flatMap((key) =>
      typeof object[key] === 'string' && measure(object[key]) > 1_024
        ? [{ object, key }]
        : longStringsIn(object[key]),
    );
  }

  trimmed.truncated = true;
  trimmed.dropped_items = 0;
  trimmed.hint = 'Narrow the request or request fewer entries. For medicine catalog child collections, use get_medicine_catalog_entry with child offsets and limits; for history snapshots, include the saved revision. Lists and text may be shortened; do not write truncated records back.';

  while (measure(trimmed) > MAX_RESULT_BYTES) {
    const arrays = arraysIn(trimmed);

    const multiple = arrays.filter((items) => items.length > 1);
    if (multiple.length === 0) {
      const strings = longStringsIn(trimmed).sort((a, b) => measure(b.object[b.key]) - measure(a.object[a.key]));
      if (strings[0]) {
        const { object, key } = strings[0];
        const characters = Array.from(object[key] as string);
        object[key] = characters.slice(0, Math.floor(characters.length / 2)).join('');
        continue;
      }
      if (arrays.length === 0) throw new ToolError('Tool result cannot fit the response budget');
    }
    const items = (multiple.length ? multiple : arrays).sort((a, b) => measure(b) - measure(a))[0];
    const keep = items.length === 1 ? 0 : Math.max(1, Math.floor(items.length * 0.7));
    dropped += items.length - keep;
    items.splice(keep);
    trimmed.dropped_items = dropped;
  }

  return {
    ...(trimmed as T),
    truncated: true,
    dropped_items: dropped,
  };
}
