import { getMetricDefinition } from './catalog';

// A dashboard shows the most recent reading of every metric side by side, which
// puts a weigh-in from this morning next to a body-fat percentage from five
// years ago at the same size and in the same colour. These helpers give each
// card its age, and say when a reading has outlived what it can describe.

const DAY_MS = 86_400_000;

/** Used when a metric carries no horizon of its own. */
export const DEFAULT_FRESHNESS_DAYS = 180;

export type Freshness = {
  ageDays: number;
  horizonDays: number;
  stale: boolean;
};

export function freshnessHorizon(metricName: string) {
  return getMetricDefinition(metricName).freshnessDays ?? DEFAULT_FRESHNESS_DAYS;
}

export function measureFreshness(date: string | null, horizonDays: number, now: number): Freshness | null {
  if (!date) return null;

  const taken = new Date(date).getTime();
  if (Number.isNaN(taken)) return null;

  const ageDays = Math.max(0, Math.floor((now - taken) / DAY_MS));

  return { ageDays, horizonDays, stale: ageDays > horizonDays };
}

/** "3 days ago", "3年前", "3年前" — the unit grows with the gap. */
export function formatAge(ageDays: number, locale: string) {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (ageDays < 7) return relative.format(-ageDays, 'day');
  if (ageDays < 31) return relative.format(-Math.round(ageDays / 7), 'week');
  if (ageDays < 365) return relative.format(-Math.round(ageDays / 30), 'month');

  return relative.format(-Math.floor(ageDays / 365), 'year');
}
