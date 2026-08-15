import {
  isValidTimeZone,
  resolveZonedDateTime,
  utcOffsetMinutesAt,
} from '$lib/time-zone';
import type { WorkoutSetType } from '$lib/workout';

export const MAX_HEVY_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_HEVY_CSV_ROWS = 10_000;

const MAX_COLUMNS = 64;
const MAX_FIELD_CHARS = 100_000;
const MAX_EXERCISES_PER_WORKOUT = 100;
const MAX_SETS_PER_EXERCISE = 100;
const MAX_SETS_PER_WORKOUT = 1_000;
const MAX_WORKOUT_SOURCE_BYTES = 1024 * 1024;

const requiredHeaders = ['title', 'start_time', 'exercise_title', 'set_index'] as const;
const knownHeaders = new Set([
  ...requiredHeaders,
  'end_time',
  'description',
  'superset_id',
  'exercise_notes',
  'set_type',
  'weight_kg',
  'weight_lbs',
  'reps',
  'distance_km',
  'distance_meters',
  'distance_miles',
  'distance_yards',
  'duration_seconds',
  'rpe',
]);

export type HevyCsvIssueSeverity = 'error' | 'warning';

export type HevyCsvIssueCode =
  | 'ambiguous_time'
  | 'column_count'
  | 'conflicting_units'
  | 'duplicate_header'
  | 'duplicate_set_index'
  | 'empty_file'
  | 'field_too_long'
  | 'file_too_large'
  | 'invalid_csv'
  | 'invalid_encoding'
  | 'invalid_end_time'
  | 'invalid_number'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'missing_header'
  | 'missing_set_type'
  | 'missing_value'
  | 'too_many_columns'
  | 'too_many_rows'
  | 'unknown_set_type'
  | 'workout_too_large';

export interface HevyCsvIssue {
  severity: HevyCsvIssueSeverity;
  code: HevyCsvIssueCode;
  row: number | null;
  column: string | null;
}

export class HevyCsvError extends Error {
  constructor(public readonly code: HevyCsvIssueCode) {
    super(code);
    this.name = 'HevyCsvError';
  }
}

export interface HevyCsvSet {
  sourceRow: number;
  sourceOrder: number;
  sourceSetIndex: number;
  setType: WorkoutSetType;
  weightValue: number | null;
  weightUnit: 'kg' | 'lb' | null;
  repetitions: number | null;
  durationSeconds: number | null;
  distanceValue: number | null;
  distanceUnit: 'km' | 'm' | 'mi' | 'yd' | null;
  rpe: number | null;
  raw: Record<string, string>;
}

export interface HevyCsvExercise {
  name: string;
  notes: string | null;
  supersetGroup: string | null;
  sourceRows: number[];
  sets: HevyCsvSet[];
}

export interface HevyCsvWorkout {
  title: string;
  description: string | null;
  startLocal: string;
  endLocal: string | null;
  startedAt: string;
  endedAt: string | null;
  localDate: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  endedTimezoneOffsetMinutes: number | null;
  sourceRows: number[];
  exercises: HevyCsvExercise[];
}

export interface HevyCsvSummary {
  rowCount: number;
  workoutCount: number;
  exerciseCount: number;
  setCount: number;
  errorCount: number;
  warningCount: number;
  firstLocalDate: string | null;
  lastLocalDate: string | null;
  weightUnits: Array<'kg' | 'lb'>;
  distanceUnits: Array<'km' | 'm' | 'mi' | 'yd'>;
  unknownHeaders: string[];
}

export interface HevyCsvParseResult {
  headers: string[];
  workouts: HevyCsvWorkout[];
  issues: HevyCsvIssue[];
  summary: HevyCsvSummary;
  canImport: boolean;
}

type CsvRow = { line: number; values: string[] };

type ParsedSourceRow = {
  row: number;
  order: number;
  title: string;
  description: string | null;
  startLocal: string;
  endLocal: string | null;
  exerciseName: string;
  exerciseNotes: string | null;
  supersetGroup: string | null;
  sourceSetIndex: number;
  setType: WorkoutSetType;
  weightValue: number | null;
  weightUnit: 'kg' | 'lb' | null;
  repetitions: number | null;
  durationSeconds: number | null;
  distanceValue: number | null;
  distanceUnit: 'km' | 'm' | 'mi' | 'yd' | null;
  rpe: number | null;
  raw: Record<string, string>;
};

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizedIdentity(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseCsv(text: string): CsvRow[] {
  if (!text.length) throw new HevyCsvError('empty_file');
  if (text.includes('\0')) throw new HevyCsvError('invalid_csv');

  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = '';
  let line = 1;
  let rowLine = 1;
  let inQuotes = false;
  let closedQuote = false;

  const append = (value: string) => {
    field += value;
    if (field.length > MAX_FIELD_CHARS) throw new HevyCsvError('field_too_long');
  };
  const finishField = () => {
    values.push(field);
    if (values.length > MAX_COLUMNS) throw new HevyCsvError('too_many_columns');
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push({ line: rowLine, values });
    if (rows.length > MAX_HEVY_CSV_ROWS + 1) throw new HevyCsvError('too_many_rows');
    values = [];
    rowLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else if (character === '\r' && text[index + 1] === '\n') {
        append('\n');
        index += 1;
        line += 1;
      } else {
        append(character);
        if (character === '\n' || character === '\r') line += 1;
      }
      continue;
    }

    if (closedQuote) {
      if (character === ',') {
        finishField();
        continue;
      }
      if (character === '\n' || character === '\r') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        line += 1;
        finishRow();
        rowLine = line;
        continue;
      }
      if (character === ' ' || character === '\t') continue;
      throw new HevyCsvError('invalid_csv');
    }

    if (character === '"') {
      if (field.length > 0) throw new HevyCsvError('invalid_csv');
      inQuotes = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      line += 1;
      finishRow();
      rowLine = line;
    } else {
      append(character);
    }
  }

  if (inQuotes) throw new HevyCsvError('invalid_csv');
  if (field.length > 0 || values.length > 0 || closedQuote) finishRow();

  return rows.filter((row) => row.values.some((value) => value.trim().length > 0));
}

function dateTimeParts(value: string) {
  const monthNumbers: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const hevy = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );

  const parts = hevy
    ? {
        year: Number(hevy[3]),
        month: monthNumbers[hevy[2].toLowerCase()],
        day: Number(hevy[1]),
        hour: Number(hevy[4]),
        minute: Number(hevy[5]),
        second: Number(hevy[6] || 0),
      }
    : iso
      ? {
          year: Number(iso[1]),
          month: Number(iso[2]),
          day: Number(iso[3]),
          hour: Number(iso[4]),
          minute: Number(iso[5]),
          second: Number(iso[6] || 0),
        }
      : null;

  if (!parts || !parts.month) return null;
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

  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

function setTypeFor(value: string): WorkoutSetType | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'normal' || normalized === 'working') return 'normal';
  if (normalized === 'warmup' || normalized === 'warm_up') return 'warmup';
  if (normalized === 'drop' || normalized === 'dropset' || normalized === 'drop_set') return 'drop';
  if (normalized === 'failure' || normalized === 'to_failure') return 'failure';
  if (normalized === 'superset') return 'superset';
  if (normalized === 'rest_pause' || normalized === 'restpause') return 'rest_pause';
  return null;
}

function issue(
  issues: HevyCsvIssue[],
  severity: HevyCsvIssueSeverity,
  code: HevyCsvIssueCode,
  row: number | null = null,
  column: string | null = null,
) {
  issues.push({ severity, code, row, column });
}

function numberValue(
  value: string,
  options: { integer?: boolean; min?: number; max?: number },
  context: { issues: HevyCsvIssue[]; row: number; column: string; invalidate: () => void },
) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (
    !Number.isFinite(parsed) ||
    (options.integer && !Number.isSafeInteger(parsed)) ||
    (options.min !== undefined && parsed < options.min) ||
    (options.max !== undefined && parsed > options.max)
  ) {
    issue(context.issues, 'error', 'invalid_number', context.row, context.column);
    context.invalidate();
    return null;
  }
  return parsed;
}

function parseSourceRows(
  rows: CsvRow[],
  headers: string[],
  normalizedHeaders: string[],
  issues: HevyCsvIssue[],
) {
  const parsed: ParsedSourceRow[] = [];
  const indexByHeader = new Map(normalizedHeaders.map((header, index) => [header, index]));

  for (const [order, csvRow] of rows.entries()) {
    let valid = true;
    const invalidate = () => {
      valid = false;
    };
    if (csvRow.values.length !== headers.length) {
      issue(issues, 'error', 'column_count', csvRow.line);
      continue;
    }

    const value = (header: string) => {
      const index = indexByHeader.get(header);
      return index === undefined ? '' : csvRow.values[index] || '';
    };
    const limited = (header: string, limit: number, required = false) => {
      const text = value(header).trim();
      if (required && !text) {
        issue(issues, 'error', 'missing_value', csvRow.line, header);
        valid = false;
      }
      if (text.length > limit) {
        issue(issues, 'error', 'field_too_long', csvRow.line, header);
        valid = false;
      }
      return text;
    };

    const title = limited('title', 300, true);
    const exerciseName = limited('exercise_title', 300, true);
    const description = limited('description', 4_000) || null;
    const exerciseNotes = limited('exercise_notes', 2_000) || null;
    const supersetGroup = limited('superset_id', 100) || null;
    const startRaw = limited('start_time', 100, true);
    const endRaw = limited('end_time', 100);
    const startLocal = dateTimeParts(startRaw);
    const endLocal = endRaw ? dateTimeParts(endRaw) : null;
    if (startRaw && !startLocal) {
      issue(issues, 'error', 'invalid_time', csvRow.line, 'start_time');
      valid = false;
    }
    if (endRaw && !endLocal) {
      issue(issues, 'error', 'invalid_time', csvRow.line, 'end_time');
      valid = false;
    }

    const numericContext = (column: string) => ({
      issues,
      row: csvRow.line,
      column,
      invalidate,
    });
    const sourceSetIndex = numberValue(
      value('set_index'),
      { integer: true, min: 0, max: 1_000_000 },
      numericContext('set_index'),
    );
    if (!value('set_index').trim()) {
      issue(issues, 'error', 'missing_value', csvRow.line, 'set_index');
      valid = false;
    }

    const rawSetType = value('set_type');
    let setType = setTypeFor(rawSetType);
    if (!rawSetType.trim()) {
      setType = 'normal';
      issue(issues, 'warning', 'missing_set_type', csvRow.line, 'set_type');
    } else if (!setType) {
      setType = 'other';
      issue(issues, 'warning', 'unknown_set_type', csvRow.line, 'set_type');
    }

    const weights = [
      { header: 'weight_kg', unit: 'kg' as const },
      { header: 'weight_lbs', unit: 'lb' as const },
    ].filter(({ header }) => value(header).trim());
    if (weights.length > 1) {
      issue(issues, 'error', 'conflicting_units', csvRow.line, 'weight');
      valid = false;
    }
    const weight = weights[0] || null;
    const weightValue = weight
      ? numberValue(
          value(weight.header),
          { min: 0, max: 1_000_000 },
          numericContext(weight.header),
        )
      : null;

    const distances = [
      { header: 'distance_km', unit: 'km' as const },
      { header: 'distance_meters', unit: 'm' as const },
      { header: 'distance_miles', unit: 'mi' as const },
      { header: 'distance_yards', unit: 'yd' as const },
    ].filter(({ header }) => value(header).trim());
    if (distances.length > 1) {
      issue(issues, 'error', 'conflicting_units', csvRow.line, 'distance');
      valid = false;
    }
    const distance = distances[0] || null;
    const distanceValue = distance
      ? numberValue(
          value(distance.header),
          { min: 0, max: 1_000_000_000 },
          numericContext(distance.header),
        )
      : null;

    const repetitions = numberValue(
      value('reps'),
      { integer: true, min: 0, max: 1_000_000 },
      numericContext('reps'),
    );
    const durationSeconds = numberValue(
      value('duration_seconds'),
      { integer: true, min: 0, max: 2_592_000 },
      numericContext('duration_seconds'),
    );
    const rpe = numberValue(
      value('rpe'),
      { min: 0, max: 10 },
      numericContext('rpe'),
    );

    const raw = Object.create(null) as Record<string, string>;
    headers.forEach((header, index) => {
      raw[header] = csvRow.values[index];
    });

    if (
      valid &&
      startLocal &&
      sourceSetIndex !== null &&
      setType
    ) {
      parsed.push({
        row: csvRow.line,
        order,
        title,
        description,
        startLocal,
        endLocal,
        exerciseName,
        exerciseNotes,
        supersetGroup,
        sourceSetIndex,
        setType,
        weightValue,
        weightUnit: weight?.unit || null,
        repetitions,
        durationSeconds,
        distanceValue,
        distanceUnit: distance?.unit || null,
        rpe,
        raw,
      });
    }
  }

  return parsed;
}

function groupRows(rows: ParsedSourceRow[], timeZone: string, issues: HevyCsvIssue[]) {
  const grouped = new Map<string, { first: ParsedSourceRow; rows: ParsedSourceRow[] }>();

  for (const row of rows) {
    const key = JSON.stringify([row.startLocal, normalizedIdentity(row.title)]);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { first: row, rows: [row] });
      continue;
    }
    if (current.first.endLocal !== row.endLocal || current.first.description !== row.description) {
      issue(issues, 'error', 'invalid_time', row.row, 'start_time');
    }
    current.rows.push(row);
  }

  const workouts: HevyCsvWorkout[] = [];
  for (const group of grouped.values()) {
    const started = resolveZonedDateTime(group.first.startLocal, timeZone);
    const ended = group.first.endLocal
      ? resolveZonedDateTime(group.first.endLocal, timeZone)
      : null;
    if (!started) {
      issue(issues, 'error', 'invalid_time', group.first.row, 'start_time');
      continue;
    }
    if (group.first.endLocal && !ended) {
      issue(issues, 'error', 'invalid_time', group.first.row, 'end_time');
      continue;
    }
    if (started.ambiguous) {
      issue(issues, 'warning', 'ambiguous_time', group.first.row, 'start_time');
    }
    if (ended?.ambiguous) {
      issue(issues, 'warning', 'ambiguous_time', group.first.row, 'end_time');
    }
    if (ended) {
      const duration = Date.parse(ended.instant) - Date.parse(started.instant);
      if (duration < 0 || duration > 30 * 24 * 60 * 60 * 1_000) {
        issue(issues, 'error', 'invalid_end_time', group.first.row, 'end_time');
        continue;
      }
    }

    const exercises: HevyCsvExercise[] = [];
    for (const row of group.rows) {
      const signature = JSON.stringify([
        normalizedIdentity(row.exerciseName),
        row.exerciseNotes,
        row.supersetGroup,
      ]);
      const previous = exercises.at(-1) as (HevyCsvExercise & { signature?: string }) | undefined;
      const exercise = previous?.signature === signature
        ? previous
        : Object.assign(
            {
              name: row.exerciseName,
              notes: row.exerciseNotes,
              supersetGroup: row.supersetGroup,
              sourceRows: [],
              sets: [],
            } satisfies HevyCsvExercise,
            { signature },
          );
      if (exercise !== previous) exercises.push(exercise);
      if (exercise.sets.some((set) => set.sourceSetIndex === row.sourceSetIndex)) {
        issue(issues, 'error', 'duplicate_set_index', row.row, 'set_index');
      }
      exercise.sourceRows.push(row.row);
      exercise.sets.push({
        sourceRow: row.row,
        sourceOrder: row.order,
        sourceSetIndex: row.sourceSetIndex,
        setType: row.setType,
        weightValue: row.weightValue,
        weightUnit: row.weightUnit,
        repetitions: row.repetitions,
        durationSeconds: row.durationSeconds,
        distanceValue: row.distanceValue,
        distanceUnit: row.distanceUnit,
        rpe: row.rpe,
        raw: row.raw,
      });
    }

    for (const exercise of exercises as Array<HevyCsvExercise & { signature?: string }>) {
      delete exercise.signature;
    }
    const setCount = exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    const sourceBytes = new TextEncoder().encode(
      JSON.stringify({
        title: group.first.title,
        description: group.first.description,
        startLocal: group.first.startLocal,
        endLocal: group.first.endLocal,
        exercises,
      }),
    ).byteLength;
    if (
      exercises.length > MAX_EXERCISES_PER_WORKOUT ||
      exercises.some((exercise) => exercise.sets.length > MAX_SETS_PER_EXERCISE) ||
      setCount > MAX_SETS_PER_WORKOUT ||
      sourceBytes > MAX_WORKOUT_SOURCE_BYTES
    ) {
      issue(issues, 'error', 'workout_too_large', group.first.row);
      continue;
    }

    const timezoneOffsetMinutes = utcOffsetMinutesAt(started.instant, timeZone);
    const endedTimezoneOffsetMinutes = ended
      ? utcOffsetMinutesAt(ended.instant, timeZone)
      : null;
    if (timezoneOffsetMinutes === null || (ended && endedTimezoneOffsetMinutes === null)) {
      issue(issues, 'error', 'invalid_timezone', group.first.row);
      continue;
    }

    workouts.push({
      title: group.first.title,
      description: group.first.description,
      startLocal: group.first.startLocal,
      endLocal: group.first.endLocal,
      startedAt: started.instant,
      endedAt: ended?.instant || null,
      localDate: group.first.startLocal.slice(0, 10),
      timezone: timeZone,
      timezoneOffsetMinutes,
      endedTimezoneOffsetMinutes,
      sourceRows: group.rows.map((row) => row.row),
      exercises,
    });
  }

  return workouts;
}

export function parseHevyCsv(text: string, timeZone: string): HevyCsvParseResult {
  if (!isValidTimeZone(timeZone)) throw new HevyCsvError('invalid_timezone');
  const rows = parseCsv(text);
  if (rows.length === 0) throw new HevyCsvError('empty_file');

  const headerRow = rows[0];
  const headers = headerRow.values.map((header) => header.replace(/^\uFEFF/, '').trim());
  const normalizedHeaders = headers.map(normalizedHeader);
  const issues: HevyCsvIssue[] = [];

  if (headers.length > MAX_COLUMNS) throw new HevyCsvError('too_many_columns');
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    issue(issues, 'error', 'duplicate_header', headerRow.line);
  }
  for (const header of requiredHeaders) {
    if (!normalizedHeaders.includes(header)) {
      issue(issues, 'error', 'missing_header', headerRow.line, header);
    }
  }

  const sourceRows = parseSourceRows(rows.slice(1), headers, normalizedHeaders, issues);
  const workouts = groupRows(sourceRows, timeZone, issues);
  if (rows.length === 1) issue(issues, 'error', 'empty_file');

  const localDates = workouts.map((workout) => workout.localDate).sort();
  const weightUnits = [...new Set(
    workouts.flatMap((workout) =>
      workout.exercises.flatMap((exercise) =>
        exercise.sets.flatMap((set) => (set.weightUnit ? [set.weightUnit] : [])),
      ),
    ),
  )].sort() as Array<'kg' | 'lb'>;
  const distanceUnits = [...new Set(
    workouts.flatMap((workout) =>
      workout.exercises.flatMap((exercise) =>
        exercise.sets.flatMap((set) => (set.distanceUnit ? [set.distanceUnit] : [])),
      ),
    ),
  )].sort() as Array<'km' | 'm' | 'mi' | 'yd'>;
  const errorCount = issues.filter((item) => item.severity === 'error').length;
  const warningCount = issues.length - errorCount;

  return {
    headers,
    workouts,
    issues,
    summary: {
      rowCount: Math.max(0, rows.length - 1),
      workoutCount: workouts.length,
      exerciseCount: workouts.reduce((total, workout) => total + workout.exercises.length, 0),
      setCount: workouts.reduce(
        (total, workout) =>
          total + workout.exercises.reduce((count, exercise) => count + exercise.sets.length, 0),
        0,
      ),
      errorCount,
      warningCount,
      firstLocalDate: localDates[0] || null,
      lastLocalDate: localDates.at(-1) || null,
      weightUnits,
      distanceUnits,
      unknownHeaders: headers.filter((_, index) => !knownHeaders.has(normalizedHeaders[index])),
    },
    canImport: errorCount === 0 && workouts.length > 0,
  };
}

export async function readHevyCsvFile(file: File) {
  if (file.size === 0) throw new HevyCsvError('empty_file');
  if (file.size > MAX_HEVY_CSV_BYTES) throw new HevyCsvError('file_too_large');

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return {
      bytes,
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    };
  } catch {
    throw new HevyCsvError('invalid_encoding');
  }
}
