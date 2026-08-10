import { describe, expect, it } from 'vitest';
import { DEFAULT_FRESHNESS_DAYS, formatAge, freshnessHorizon, measureFreshness } from './freshness';

// A dashboard puts this morning's weigh-in beside a body-fat percentage from
// five years ago at the same size. Age and staleness are what keep the second
// one from being read as current.

const NOW = Date.parse('2026-08-08T00:00:00.000Z');
const DAY = 86_400_000;

describe('measureFreshness', () => {
  it('reports the age in whole days', () => {
    expect(measureFreshness('2026-07-09T00:00:00.000Z', 90, NOW)?.ageDays).toBe(30);
  });

  it('calls a reading inside its horizon current', () => {
    expect(measureFreshness('2026-07-09T00:00:00.000Z', 90, NOW)?.stale).toBe(false);
  });

  it('calls a reading past its horizon stale', () => {
    expect(measureFreshness('2026-07-09T00:00:00.000Z', 20, NOW)?.stale).toBe(true);
  });

  it('treats the horizon itself as still current', () => {
    const exactly = new Date(NOW - 90 * DAY).toISOString();

    expect(measureFreshness(exactly, 90, NOW)?.stale).toBe(false);
  });

  it('does not report a negative age for a future date', () => {
    expect(measureFreshness('2026-09-01T00:00:00.000Z', 90, NOW)?.ageDays).toBe(0);
  });

  it('answers nothing for a missing or unreadable date', () => {
    expect(measureFreshness(null, 90, NOW)).toBeNull();
    expect(measureFreshness('not a date', 90, NOW)).toBeNull();
  });
});

describe('freshnessHorizon', () => {
  it('takes the horizon a metric declares', () => {
    expect(freshnessHorizon('Body Weight')).toBe(90);
  });

  it('falls back for a metric that declares none', () => {
    expect(freshnessHorizon('Something Nobody Has Catalogued')).toBe(DEFAULT_FRESHNESS_DAYS);
  });

  it('resolves through an alias the way the rest of the app does', () => {
    expect(freshnessHorizon('Weight')).toBe(freshnessHorizon('Body Weight'));
  });
});

describe('formatAge', () => {
  it('grows the unit with the gap', () => {
    expect(formatAge(3, 'en')).toBe('3 days ago');
    expect(formatAge(10, 'en')).toBe('last week');
    expect(formatAge(60, 'en')).toBe('2 months ago');
    expect(formatAge(400, 'en')).toBe('last year');
  });

  it('speaks the locale it is given', () => {
    expect(formatAge(3, 'ja')).toContain('3');
    expect(formatAge(400, 'ja')).not.toBe(formatAge(400, 'en'));
  });
});
