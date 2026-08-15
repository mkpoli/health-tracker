import {
  normalizeTimeZone,
  resolveZonedDateTime,
  type ZonedDateTimeResolution,
} from '$lib/time-zone';

const EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export class InvalidReportTimeError extends Error {
  constructor() {
    super('The report time is invalid in the selected timezone');
    this.name = 'InvalidReportTimeError';
  }
}

export function resolveReportTime(
  value: string | null | undefined,
  timeZone: string | null | undefined,
): ZonedDateTimeResolution & { timeZone: string } {
  const zone = normalizeTimeZone(timeZone);
  const trimmed = value?.trim();

  if (!trimmed) {
    return {
      instant: new Date().toISOString(),
      timeZone: zone,
      ambiguous: false,
    };
  }

  if (EXPLICIT_OFFSET.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new InvalidReportTimeError();

    return {
      instant: parsed.toISOString(),
      timeZone: zone,
      ambiguous: false,
    };
  }

  const resolved = resolveZonedDateTime(trimmed, zone);
  if (!resolved) throw new InvalidReportTimeError();

  return { ...resolved, timeZone: zone };
}
