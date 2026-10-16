import { describe, expect, it } from 'vitest';
import { capResult, MAX_RESULT_BYTES } from './budget';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe('MCP response budget', () => {
  it('bounds a single record with nested lists without mutating its input', () => {
    const input = { product: { product_id: 'product', revision: 1,
      names: Array.from({ length: 30 }, () => ({ name: '語'.repeat(300), source_url: 'x'.repeat(2_000) })) } };
    const output = capResult(input);
    expect(bytes(output)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    expect(output.truncated).toBe(true);
    expect(input.product.names).toHaveLength(30);
    expect(output.product).toMatchObject({ product_id: 'product', revision: 1 });
  });

  it('keeps the last record reachable when its text alone exceeds the budget', () => {
    const output = capResult({ revisions: [{ revision: 123, snapshot: { notes: '😀'.repeat(20_000) } }] });
    expect(bytes(output)).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    expect(output.revisions).toHaveLength(1);
    expect(output.revisions[0].revision).toBe(123);
    expect(output.truncated).toBe(true);
  });
});
