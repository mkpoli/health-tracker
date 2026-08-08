// A tool result has to leave room for the conversation it is part of. Trimming
// happens here rather than in each tool so it is one rule, and so a trimmed
// result always says it was trimmed — a health tool that silently drops rows is
// how a reader concludes a metric was never measured.

const MAX_RESULT_BYTES = 40_000;

function measure(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Shortens the longest array in the payload until the whole thing fits, keeping
 * the head of each list — everything here is ordered newest first.
 */
export function capResult<T extends Record<string, unknown>>(payload: T): T & { truncated?: boolean } {
  if (measure(payload) <= MAX_RESULT_BYTES) return payload;

  const trimmed: Record<string, unknown> = { ...payload };
  let dropped = 0;

  while (measure(trimmed) > MAX_RESULT_BYTES) {
    const arrays = Object.entries(trimmed).filter(
      (entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && entry[1].length > 1,
    );

    if (arrays.length === 0) break;

    const [key, items] = arrays.sort((a, b) => measure(b[1]) - measure(a[1]))[0];
    const keep = Math.max(1, Math.floor(items.length * 0.7));
    dropped += items.length - keep;
    trimmed[key] = items.slice(0, keep);
  }

  return {
    ...(trimmed as T),
    truncated: true,
    dropped_items: dropped,
    hint: 'Narrow the request with a date window, fewer metrics, or a coarser granularity.',
  };
}
