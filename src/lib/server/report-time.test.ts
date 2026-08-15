import { describe, expect, it } from 'vitest';
import { InvalidReportTimeError, resolveReportTime } from './report-time';

describe('resolveReportTime', () => {
  it('resolves a bare wall-clock value in the selected timezone', () => {
    expect(resolveReportTime('2026-08-05T10:13', 'Asia/Tokyo')).toEqual({
      instant: '2026-08-05T01:13:00.000Z',
      timeZone: 'Asia/Tokyo',
      ambiguous: false,
    });
  });

  it('preserves an instant supplied with an explicit offset', () => {
    expect(resolveReportTime('2026-08-05T10:13+09:00', 'Asia/Tokyo').instant).toBe(
      '2026-08-05T01:13:00.000Z',
    );
  });

  it('rejects a daylight-saving gap', () => {
    expect(() => resolveReportTime('2026-03-08T02:30', 'America/New_York')).toThrow(
      InvalidReportTimeError,
    );
  });

  it('uses the current instant when the value is empty', () => {
    const before = Date.now();
    const result = resolveReportTime('', 'Asia/Tokyo');
    const after = Date.now();

    expect(Date.parse(result.instant)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(result.instant)).toBeLessThanOrEqual(after);
    expect(result.timeZone).toBe('Asia/Tokyo');
    expect(result.ambiguous).toBe(false);
  });
});
