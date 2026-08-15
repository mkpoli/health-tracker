import { describe, expect, it } from 'vitest';
import {
  isValidTimeZone,
  resolveZonedDateTime,
  timeZoneFromMetadata,
  timeZoneLabel,
  toDateTimeLocal,
  utcOffsetLabel,
} from './time-zone';

describe('time-zone', () => {
  it('resolves a Tokyo wall-clock value to its UTC instant', () => {
    expect(resolveZonedDateTime('2026-08-05T10:13', 'Asia/Tokyo')).toEqual({
      instant: '2026-08-05T01:13:00.000Z',
      ambiguous: false,
    });
  });

  it('renders an instant as a datetime-local value in the selected timezone', () => {
    expect(toDateTimeLocal('2026-08-05T01:13:00.000Z', 'Asia/Tokyo')).toBe(
      '2026-08-05T10:13',
    );
  });

  it('rejects a wall-clock value inside a daylight-saving gap', () => {
    expect(resolveZonedDateTime('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('uses the earlier occurrence of a repeated daylight-saving time', () => {
    expect(resolveZonedDateTime('2026-11-01T01:30', 'America/New_York')).toEqual({
      instant: '2026-11-01T05:30:00.000Z',
      ambiguous: true,
    });
  });

  it('shows the IANA zone and UTC offset', () => {
    expect(timeZoneLabel('Asia/Tokyo', '2026-08-05T01:13:00.000Z', 'ja')).toContain(
      'Asia/Tokyo',
    );
    expect(utcOffsetLabel('2026-08-05T01:13:00.000Z', 'Asia/Tokyo')).toBe('UTC+09:00');
  });

  it('reads a timezone from JSON metadata stored as a JSON string', () => {
    expect(timeZoneFromMetadata(JSON.stringify({ timeZone: 'Asia/Tokyo' }))).toBe(
      'Asia/Tokyo',
    );
  });

  it('rejects unknown timezone identifiers', () => {
    expect(isValidTimeZone('Japan/Toyonaka')).toBe(false);
  });
});
