export const DEFAULT_TIME_ZONE = 'UTC';

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type ZonedDateTimeResolution = {
  instant: string;
  ambiguous: boolean;
};

function parseLocalDateTime(value: string): DateTimeParts | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
  };
  const check = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );

  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) {
    return null;
  }

  return parts;
}

function partsAt(instant: number, timeZone: string): DateTimeParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function partsAsUtc(parts: DateTimeParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function sameParts(left: DateTimeParts, right: DateTimeParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function offsetMilliseconds(instant: number, timeZone: string) {
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  return partsAsUtc(partsAt(wholeSecond, timeZone)) - wholeSecond;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: unknown, fallback = DEFAULT_TIME_ZONE) {
  if (isValidTimeZone(value)) return value.trim();
  return isValidTimeZone(fallback) ? fallback : DEFAULT_TIME_ZONE;
}

export function timeZoneFromMetadata(value: unknown, fallback = DEFAULT_TIME_ZONE) {
  let parsed = value;

  for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }

  const candidate =
    parsed && typeof parsed === 'object' && 'timeZone' in parsed
      ? (parsed as { timeZone?: unknown }).timeZone
      : null;

  return normalizeTimeZone(candidate, fallback);
}

/**
 * Resolves a wall-clock value in an IANA timezone. A daylight-saving gap is
 * rejected. A repeated time resolves to its earlier occurrence and reports
 * that the wall-clock value was ambiguous.
 */
export function resolveZonedDateTime(
  value: string,
  timeZone: string,
): ZonedDateTimeResolution | null {
  const desired = parseLocalDateTime(value);
  if (!desired || !isValidTimeZone(timeZone)) return null;

  const wallClockAsUtc = partsAsUtc(desired);
  const offsets = new Set<number>();

  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetMilliseconds(wallClockAsUtc + hours * 60 * 60 * 1000, timeZone));
  }

  const matches = [...offsets]
    .map((offset) => wallClockAsUtc - offset)
    .filter((instant) => sameParts(partsAt(instant, timeZone), desired))
    .sort((left, right) => left - right);

  if (matches.length === 0) return null;

  return {
    instant: new Date(matches[0]).toISOString(),
    ambiguous: matches.length > 1,
  };
}

export function toDateTimeLocal(value: string | null | undefined, timeZone: string) {
  const trimmed = value?.trim();
  if (!trimmed) return '';

  const local = parseLocalDateTime(trimmed);
  if (local) {
    const year = String(local.year).padStart(4, '0');
    const month = String(local.month).padStart(2, '0');
    const day = String(local.day).padStart(2, '0');
    const hour = String(local.hour).padStart(2, '0');
    const minute = String(local.minute).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime()) || !isValidTimeZone(timeZone)) return '';

  const parts = partsAt(parsed.getTime(), timeZone);
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function utcOffsetLabel(value: string | Date, timeZone: string) {
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(instant) || !isValidTimeZone(timeZone)) return 'UTC';

  const totalMinutes = utcOffsetMinutesAt(value, timeZone) ?? 0;
  const sign = totalMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(totalMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

export function utcOffsetMinutesAt(value: string | Date, timeZone: string) {
  const instant = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(instant) || !isValidTimeZone(timeZone)) return null;

  return Math.round(offsetMilliseconds(instant, timeZone) / 60_000);
}

export function timeZoneLabel(
  timeZone: string,
  value: string | Date = new Date(),
  locale = 'en',
) {
  const zone = normalizeTimeZone(timeZone);
  const instant = value instanceof Date ? value : new Date(value);
  const validInstant = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const genericName = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    timeZoneName: 'shortGeneric',
  })
    .formatToParts(validInstant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const pieces = [zone, genericName, utcOffsetLabel(validInstant, zone)].filter(
    (piece, index, all) => piece && all.indexOf(piece) === index,
  );

  return pieces.join(' · ');
}

export function timeZoneAbbreviation(
  timeZone: string,
  value: string | Date = new Date(),
) {
  const zone = normalizeTimeZone(timeZone);
  const instant = value instanceof Date ? value : new Date(value);
  const validInstant = Number.isNaN(instant.getTime()) ? new Date() : instant;

  return (
    new Intl.DateTimeFormat('ja', {
      timeZone: zone,
      timeZoneName: 'short',
    })
      .formatToParts(validInstant)
      .find((part) => part.type === 'timeZoneName')?.value || utcOffsetLabel(validInstant, zone)
  );
}

export function supportedTimeZones() {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [
          'Africa/Johannesburg',
          'America/Chicago',
          'America/Los_Angeles',
          'America/New_York',
          'Asia/Dubai',
          'Asia/Hong_Kong',
          'Asia/Seoul',
          'Asia/Shanghai',
          'Asia/Singapore',
          'Asia/Tokyo',
          'Australia/Sydney',
          'Europe/Berlin',
          'Europe/London',
          'Pacific/Auckland',
        ];

  return [DEFAULT_TIME_ZONE, ...zones.filter((zone) => zone !== DEFAULT_TIME_ZONE)];
}
