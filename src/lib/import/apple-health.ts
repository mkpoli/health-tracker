import { BODY_REPORT_KIND, VITAL_REPORT_KIND, type ReportKind } from '$lib/report-kind';

// Apple Health's "Export All Health Data" produces a zip containing export.xml,
// one <Record> element per sample. A few years of wearable data runs to
// hundreds of megabytes and millions of samples, so the file is parsed in the
// browser and only the mapped measurements are sent to the server.

type AppleMapping = {
  /** Catalog key the sample becomes. */
  key: string;
  kind: ReportKind;
  unit: string;
  /** Apple's unit converted to the catalog unit, when they differ. */
  convert?: (value: number, sourceUnit: string) => number | null;
};

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

function massToKg(value: number, unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'kg') return value;
  if (normalized === 'lb') return value * KG_PER_LB;
  if (normalized === 'g') return value / 1000;
  if (normalized === 'st') return value * 6.35029318;
  return null;
}

function lengthToCm(value: number, unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'cm') return value;
  if (normalized === 'm') return value * 100;
  if (normalized === 'in') return value * CM_PER_IN;
  if (normalized === 'ft') return value * 12 * CM_PER_IN;
  if (normalized === 'mm') return value / 10;
  return null;
}

function percentFromFraction(value: number, unit: string) {
  // Apple writes percentages as a fraction with unit "%" — 0.21 means 21%.
  if (unit.trim() !== '%') return null;
  return value <= 1 ? value * 100 : value;
}

function temperatureToCelsius(value: number, unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'degc' || normalized === '°c') return value;
  if (normalized === 'degf' || normalized === '°f') return ((value - 32) * 5) / 9;
  return null;
}

export const APPLE_HEALTH_MAPPINGS: Record<string, AppleMapping> = {
  HKQuantityTypeIdentifierBodyMass: { key: 'body-weight', kind: BODY_REPORT_KIND, unit: 'kg', convert: massToKg },
  HKQuantityTypeIdentifierHeight: { key: 'height', kind: BODY_REPORT_KIND, unit: 'cm', convert: lengthToCm },
  HKQuantityTypeIdentifierLeanBodyMass: {
    key: 'lean-body-mass',
    kind: BODY_REPORT_KIND,
    unit: 'kg',
    convert: massToKg,
  },
  HKQuantityTypeIdentifierBodyFatPercentage: {
    key: 'body-fat-percentage',
    kind: BODY_REPORT_KIND,
    unit: '%',
    convert: percentFromFraction,
  },
  HKQuantityTypeIdentifierWaistCircumference: {
    key: 'waist-circumference',
    kind: BODY_REPORT_KIND,
    unit: 'cm',
    convert: lengthToCm,
  },

  HKQuantityTypeIdentifierBloodPressureSystolic: {
    key: 'systolic-blood-pressure',
    kind: VITAL_REPORT_KIND,
    unit: 'mmHg',
  },
  HKQuantityTypeIdentifierBloodPressureDiastolic: {
    key: 'diastolic-blood-pressure',
    kind: VITAL_REPORT_KIND,
    unit: 'mmHg',
  },
  HKQuantityTypeIdentifierHeartRate: { key: 'pulse-rate', kind: VITAL_REPORT_KIND, unit: 'bpm' },
  HKQuantityTypeIdentifierRestingHeartRate: {
    key: 'resting-heart-rate',
    kind: VITAL_REPORT_KIND,
    unit: 'bpm',
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    key: 'heart-rate-variability',
    kind: VITAL_REPORT_KIND,
    unit: 'ms',
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    key: 'oxygen-saturation',
    kind: VITAL_REPORT_KIND,
    unit: '%',
    convert: percentFromFraction,
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    key: 'respiratory-rate',
    kind: VITAL_REPORT_KIND,
    unit: '/min',
  },
  HKQuantityTypeIdentifierBodyTemperature: {
    key: 'body-temperature',
    kind: VITAL_REPORT_KIND,
    unit: '°C',
    convert: temperatureToCelsius,
  },
  HKQuantityTypeIdentifierBloodGlucose: {
    key: 'blood-glucose-self-measured',
    kind: VITAL_REPORT_KIND,
    unit: 'mg/dL',
    convert: (value, unit) => {
      const normalized = unit.replace(/\s/g, '').toLowerCase();
      if (normalized.startsWith('mg/dl')) return value;
      if (normalized.startsWith('mmol')) return value * 18.0182;
      return null;
    },
  },
};

export type ImportEntry = { key: string; value: string; unit: string };

export type ImportSession = {
  kind: ReportKind;
  /** ISO instant the samples were taken. */
  measuredAt: string;
  entries: ImportEntry[];
  /** Stable id for this day and kind, so a re-import updates rather than duplicates. */
  sourceKey: string;
};

export type ImportSummary = {
  sessions: ImportSession[];
  /** Samples seen per Apple type, including the ones no catalog metric covers. */
  seen: Record<string, number>;
  mapped: number;
  skipped: number;
  earliest: string | null;
  latest: string | null;
};

/**
 * Apple's date format is "2026-08-06 07:15:00 +0900" — close to ISO but with a
 * space where the T belongs, which Safari and Firefox both refuse to parse.
 */
export function parseAppleDate(value: string): Date | null {
  const normalized = value.trim().replace(' ', 'T').replace(/ (?=[+-]\d{4}$)/, '');
  const withColon = normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = new Date(withColon);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayKey(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const RECORD_PATTERN = /<Record\b([^>]*?)\/?>/g;
const ATTRIBUTE_PATTERN = /(\w+)="([^"]*)"/g;

function readAttributes(raw: string) {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw))) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

/**
 * Incremental parser: the export is far too large to hold as one string, so it
 * is fed in chunks and only the running per-day totals are kept.
 *
 * Samples are grouped into one session per day per kind, keeping the last
 * reading of each day. A watch records heart rate thousands of times a day;
 * storing every sample would bury the hand-entered measurements this app is
 * built around, so the daily figure is what gets imported.
 */
export function createAppleHealthParser() {
  const seen: Record<string, number> = {};
  const byDay = new Map<string, { kind: ReportKind; measuredAt: Date; entries: Map<string, ImportEntry> }>();

  let buffer = '';
  let mapped = 0;
  let skipped = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;

  function consume(raw: string) {
    const attributes = readAttributes(raw);
    const type = attributes.type;
    if (!type) return;

    seen[type] = (seen[type] || 0) + 1;

    const mapping = APPLE_HEALTH_MAPPINGS[type];
    if (!mapping) {
      skipped += 1;
      return;
    }

    const rawValue = Number(attributes.value);
    if (!Number.isFinite(rawValue)) {
      skipped += 1;
      return;
    }

    const converted = mapping.convert ? mapping.convert(rawValue, attributes.unit || mapping.unit) : rawValue;
    if (converted === null || !Number.isFinite(converted)) {
      skipped += 1;
      return;
    }

    const date = parseAppleDate(attributes.startDate || attributes.creationDate || '');
    if (!date) {
      skipped += 1;
      return;
    }

    const key = `${mapping.kind}:${dayKey(date)}`;
    const session = byDay.get(key) || { kind: mapping.kind, measuredAt: date, entries: new Map() };

    // Last reading of the day wins, and carries the session's timestamp.
    if (date.getTime() >= session.measuredAt.getTime()) session.measuredAt = date;

    session.entries.set(mapping.key, {
      key: mapping.key,
      value: String(Number(converted.toFixed(2))),
      unit: mapping.unit,
    });

    byDay.set(key, session);
    mapped += 1;

    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
  }

  return {
    push(chunk: string) {
      buffer += chunk;

      RECORD_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      let consumedTo = 0;

      while ((match = RECORD_PATTERN.exec(buffer))) {
        consume(match[1]);
        consumedTo = match.index + match[0].length;
      }

      // Keep whatever follows the last complete element; a record split across
      // a chunk boundary is completed by the next push.
      buffer = buffer.slice(consumedTo);

      // A buffer this large means no closing bracket was found — the file is
      // not an Apple export, so stop it growing without bound.
      if (buffer.length > 1_000_000) buffer = buffer.slice(-1000);
    },

    finish(): ImportSummary {
      const sessions = Array.from(byDay.entries())
        .map(([sourceKey, session]) => ({
          kind: session.kind,
          measuredAt: session.measuredAt.toISOString(),
          entries: Array.from(session.entries.values()),
          sourceKey,
        }))
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));

      return {
        sessions,
        seen,
        mapped,
        skipped,
        earliest: earliest ? (earliest as Date).toISOString() : null,
        latest: latest ? (latest as Date).toISOString() : null,
      };
    },
  };
}

/** Convenience wrapper for a whole document held in memory (tests, small files). */
export function parseAppleHealthExport(xml: string): ImportSummary {
  const parser = createAppleHealthParser();
  parser.push(xml);
  return parser.finish();
}

/** Streams an .xml or .zip export, reporting bytes read as it goes. */
export async function readAppleHealthFile(
  file: File,
  onProgress?: (bytesRead: number, totalBytes: number) => void,
): Promise<ImportSummary> {
  const parser = createAppleHealthParser();
  const decoder = new TextDecoder();
  let bytesRead = 0;

  const handleBytes = (bytes: Uint8Array) => {
    bytesRead += bytes.byteLength;
    parser.push(decoder.decode(bytes, { stream: true }));
    onProgress?.(bytesRead, file.size);
  };

  if (file.name.toLowerCase().endsWith('.zip')) {
    const { Unzip, AsyncUnzipInflate } = await import('fflate');

    await new Promise<void>((resolve, reject) => {
      let pending = 0;
      let sourceDone = false;

      const finishIfDone = () => {
        if (sourceDone && pending === 0) resolve();
      };

      const unzip = new Unzip((stream) => {
        // Apple nests it as apple_health_export/export.xml.
        if (!/(^|\/)export\.xml$/i.test(stream.name)) return;

        pending += 1;
        stream.ondata = (error, chunk, final) => {
          if (error) {
            reject(error);
            return;
          }

          handleBytes(chunk);

          if (final) {
            pending -= 1;
            finishIfDone();
          }
        };
        stream.start();
      });

      unzip.register(AsyncUnzipInflate);

      const reader = file.stream().getReader();

      const pump = (): Promise<void> =>
        reader.read().then(({ done, value }) => {
          if (done) {
            unzip.push(new Uint8Array(0), true);
            sourceDone = true;
            finishIfDone();
            return;
          }

          unzip.push(value, false);
          return pump();
        });

      pump().catch(reject);
    });
  } else {
    const reader = file.stream().getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handleBytes(value);
    }
  }

  parser.push(decoder.decode());
  return parser.finish();
}
