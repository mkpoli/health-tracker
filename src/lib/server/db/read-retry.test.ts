import { describe, expect, it } from 'vitest';
import { isTransientReadError } from './index';

function named(name: string, message = '') {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('isTransientReadError', () => {
  it('recognizes aborted, timed-out, and network failures', () => {
    expect(isTransientReadError(named('AbortError'))).toBe(true);
    expect(isTransientReadError(named('TimeoutError'))).toBe(true);
    expect(isTransientReadError(new TypeError('fetch failed'))).toBe(true);
  });

  it('recognizes an upstream 5xx wherever it sits in the cause chain', () => {
    const inner = Object.assign(new Error('Server returned HTTP status 524'), {
      code: 'SERVER_ERROR',
    });
    const wrapped = new Error('Failed query: select …', { cause: inner });
    expect(isTransientReadError(wrapped)).toBe(true);
  });

  it('refuses errors that repeat identically', () => {
    expect(isTransientReadError(Object.assign(new Error('no such column: x'), { code: 'SQL_INPUT_ERROR' }))).toBe(false);
    expect(isTransientReadError(new Error('URL_SCHEME_NOT_SUPPORTED'))).toBe(false);
    expect(isTransientReadError('not an error')).toBe(false);
  });
});
