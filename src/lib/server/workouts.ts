import type {
  exerciseDefinition,
  workoutClaim,
  workoutExercise,
  workoutSet,
} from '$lib/server/db/schema';
import { isValidTimeZone, toDateTimeLocal, utcOffsetMinutesAt } from '$lib/time-zone';
import {
  isWorkoutKind,
  isWorkoutPlanStatus,
  isWorkoutSessionStatus,
  isWorkoutSetStatus,
  isWorkoutSetType,
  type ExerciseDefinitionRecord,
  type WorkoutExerciseRecord,
  type WorkoutKind,
  type WorkoutRecord,
  type WorkoutSetRecord,
  type WorkoutSetStatus,
  type WorkoutSetType,
  type WorkoutStatus,
} from '$lib/workout';

const MAX_STRUCTURE_BYTES = 512 * 1024;
const MAX_EXERCISES = 100;
const MAX_SETS_PER_EXERCISE = 100;
const MAX_TOTAL_SETS = 1_000;

const fieldLimits = {
  title: 300,
  timezone: 100,
  notes: 4_000,
  id: 128,
  exerciseName: 300,
  category: 120,
  equipment: 120,
  exerciseNotes: 2_000,
  supersetGroup: 100,
  unit: 32,
  setNotes: 1_000,
} as const;

export type WorkoutSetInput = {
  id: string | null;
  setType: WorkoutSetType;
  status: WorkoutSetStatus;
  weightValue: number | null;
  weightUnit: string | null;
  repetitions: number | null;
  durationSeconds: number | null;
  distanceValue: number | null;
  distanceUnit: string | null;
  rpe: number | null;
  rir: number | null;
  notes: string | null;
};

export type WorkoutExerciseInput = {
  id: string | null;
  exerciseDefinitionId: string | null;
  name: string;
  category: string | null;
  equipment: string | null;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  sets: WorkoutSetInput[];
};

export type WorkoutInput = {
  kind: WorkoutKind;
  title: string;
  status: WorkoutStatus;
  basedOnWorkoutId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  localDate: string | null;
  timezone: string | null;
  timezoneOffsetMinutes: number | null;
  endedTimezoneOffsetMinutes: number | null;
  notes: string | null;
  exercises: WorkoutExerciseInput[];
};

export type WorkoutInputErrorCode =
  | 'field_too_long'
  | 'invalid_end_time'
  | 'invalid_exercise'
  | 'invalid_kind'
  | 'invalid_number'
  | 'invalid_set'
  | 'invalid_status'
  | 'invalid_structure'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'missing_title'
  | 'structure_too_large';

export class InvalidWorkoutInputError extends Error {
  constructor(public readonly code: WorkoutInputErrorCode) {
    super(code);
    this.name = 'InvalidWorkoutInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textValue(
  value: unknown,
  limit: number,
  options: { required?: boolean } = {},
) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length > limit) throw new InvalidWorkoutInputError('field_too_long');
  if (options.required && !normalized) throw new InvalidWorkoutInputError('missing_title');
  return normalized || null;
}

function formText(
  data: FormData,
  key: string,
  limit: number,
  options: { required?: boolean } = {},
) {
  return textValue(data.get(key), limit, options);
}

function optionalId(value: unknown) {
  return textValue(value, fieldLimits.id);
}

function numericValue(
  value: unknown,
  options: { integer?: boolean; min?: number; max?: number } = {},
) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new InvalidWorkoutInputError('invalid_number');
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InvalidWorkoutInputError('invalid_number');
  if (options.integer && !Number.isSafeInteger(parsed)) {
    throw new InvalidWorkoutInputError('invalid_number');
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new InvalidWorkoutInputError('invalid_number');
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new InvalidWorkoutInputError('invalid_number');
  }

  return options.integer ? parsed : Math.round(parsed * 1_000_000) / 1_000_000;
}

function readOffset(data: FormData, key: string) {
  const offset = numericValue(data.get(key), { integer: true, min: -840, max: 840 });
  if (offset === null) throw new InvalidWorkoutInputError('invalid_timezone');
  return offset;
}

function localDateTime(
  data: FormData,
  localKey: string,
  offsetKey: string,
  timezone: string,
  required: boolean,
) {
  const raw = data.get(localKey);
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new InvalidWorkoutInputError('invalid_time');
  }

  const offset = readOffset(data, offsetKey);
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    localAsUtc.getUTCFullYear() !== year ||
    localAsUtc.getUTCMonth() !== month - 1 ||
    localAsUtc.getUTCDate() !== day ||
    localAsUtc.getUTCHours() !== hour ||
    localAsUtc.getUTCMinutes() !== minute
  ) {
    throw new InvalidWorkoutInputError('invalid_time');
  }

  const instant = new Date(localAsUtc.getTime() - offset * 60_000).toISOString();
  if (toDateTimeLocal(instant, timezone) !== value || utcOffsetMinutesAt(instant, timezone) !== offset) {
    throw new InvalidWorkoutInputError('invalid_timezone');
  }

  return { instant, localDate: datePart, offset };
}

function parseSet(value: unknown, kind: WorkoutKind): WorkoutSetInput {
  if (!isRecord(value)) throw new InvalidWorkoutInputError('invalid_set');

  const setTypeValue = typeof value.setType === 'string' ? value.setType : 'normal';
  const statusValue = typeof value.status === 'string'
    ? value.status
    : kind === 'plan'
      ? 'planned'
      : 'completed';
  if (!isWorkoutSetType(setTypeValue) || !isWorkoutSetStatus(statusValue)) {
    throw new InvalidWorkoutInputError('invalid_set');
  }

  return {
    id: optionalId(value.id),
    setType: setTypeValue,
    status: statusValue,
    weightValue: numericValue(value.weightValue, { min: 0, max: 1_000_000 }),
    weightUnit: textValue(value.weightUnit, fieldLimits.unit),
    repetitions: numericValue(value.repetitions, { integer: true, min: 0, max: 1_000_000 }),
    durationSeconds: numericValue(value.durationSeconds, {
      integer: true,
      min: 0,
      max: 2_592_000,
    }),
    distanceValue: numericValue(value.distanceValue, { min: 0, max: 1_000_000_000 }),
    distanceUnit: textValue(value.distanceUnit, fieldLimits.unit),
    rpe: numericValue(value.rpe, { min: 0, max: 10 }),
    rir: numericValue(value.rir, { min: 0, max: 10 }),
    notes: textValue(value.notes, fieldLimits.setNotes),
  };
}

function parseExercise(value: unknown, kind: WorkoutKind): WorkoutExerciseInput {
  if (!isRecord(value)) throw new InvalidWorkoutInputError('invalid_exercise');
  const name = textValue(value.name, fieldLimits.exerciseName);
  if (!name) throw new InvalidWorkoutInputError('invalid_exercise');
  if (!Array.isArray(value.sets) || value.sets.length > MAX_SETS_PER_EXERCISE) {
    throw new InvalidWorkoutInputError('invalid_structure');
  }

  return {
    id: optionalId(value.id),
    exerciseDefinitionId: optionalId(value.exerciseDefinitionId),
    name,
    category: textValue(value.category, fieldLimits.category),
    equipment: textValue(value.equipment, fieldLimits.equipment),
    notes: textValue(value.notes, fieldLimits.exerciseNotes),
    restSeconds: numericValue(value.restSeconds, { integer: true, min: 0, max: 86_400 }),
    supersetGroup: textValue(value.supersetGroup, fieldLimits.supersetGroup),
    sets: value.sets.map((set) => parseSet(set, kind)),
  };
}

function parseStructure(data: FormData, kind: WorkoutKind) {
  const raw = data.get('structure');
  if (typeof raw !== 'string') throw new InvalidWorkoutInputError('invalid_structure');
  if (new TextEncoder().encode(raw).byteLength > MAX_STRUCTURE_BYTES) {
    throw new InvalidWorkoutInputError('structure_too_large');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InvalidWorkoutInputError('invalid_structure');
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_EXERCISES) {
    throw new InvalidWorkoutInputError('invalid_structure');
  }

  const exercises = parsed.map((exercise) => parseExercise(exercise, kind));
  if (exercises.reduce((total, exercise) => total + exercise.sets.length, 0) > MAX_TOTAL_SETS) {
    throw new InvalidWorkoutInputError('invalid_structure');
  }

  const exerciseIds = exercises.flatMap((exercise) => (exercise.id ? [exercise.id] : []));
  const setIds = exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) => (set.id ? [set.id] : [])),
  );
  if (new Set(exerciseIds).size !== exerciseIds.length || new Set(setIds).size !== setIds.length) {
    throw new InvalidWorkoutInputError('invalid_structure');
  }

  return exercises;
}

export function parseWorkoutInput(data: FormData): WorkoutInput {
  const kindValue = data.get('kind');
  const kind = typeof kindValue === 'string' ? kindValue : '';
  if (!isWorkoutKind(kind)) throw new InvalidWorkoutInputError('invalid_kind');

  const statusValue = data.get('status');
  const rawStatus = typeof statusValue === 'string' ? statusValue : '';
  let status: WorkoutStatus;
  if (kind === 'session') {
    if (!isWorkoutSessionStatus(rawStatus)) {
      throw new InvalidWorkoutInputError('invalid_status');
    }
    status = rawStatus;
  } else {
    if (!isWorkoutPlanStatus(rawStatus)) {
      throw new InvalidWorkoutInputError('invalid_status');
    }
    status = rawStatus;
  }

  const title = formText(data, 'title', fieldLimits.title, { required: true });
  if (!title) throw new InvalidWorkoutInputError('missing_title');
  const exercises = parseStructure(data, kind);
  const notes = formText(data, 'notes', fieldLimits.notes);
  const basedOnWorkoutId = formText(data, 'basedOnWorkoutId', fieldLimits.id);

  if (kind === 'plan') {
    return {
      kind,
      title,
      status,
      basedOnWorkoutId: null,
      startedAt: null,
      endedAt: null,
      localDate: null,
      timezone: null,
      timezoneOffsetMinutes: null,
      endedTimezoneOffsetMinutes: null,
      notes,
      exercises,
    };
  }

  const timezone = formText(data, 'timezone', fieldLimits.timezone);
  if (!timezone || !isValidTimeZone(timezone)) {
    throw new InvalidWorkoutInputError('invalid_timezone');
  }
  const started = localDateTime(
    data,
    'startedLocal',
    'timezoneOffsetMinutes',
    timezone,
    true,
  );
  if (!started) throw new InvalidWorkoutInputError('invalid_time');
  const ended = localDateTime(
    data,
    'endedLocal',
    'endedTimezoneOffsetMinutes',
    timezone,
    false,
  );

  if (ended) {
    const duration = Date.parse(ended.instant) - Date.parse(started.instant);
    if (duration < 0 || duration > 30 * 24 * 60 * 60 * 1_000) {
      throw new InvalidWorkoutInputError('invalid_end_time');
    }
  }

  return {
    kind,
    title,
    status,
    basedOnWorkoutId,
    startedAt: started.instant,
    endedAt: ended?.instant ?? null,
    localDate: started.localDate,
    timezone,
    timezoneOffsetMinutes: started.offset,
    endedTimezoneOffsetMinutes: ended?.offset ?? null,
    notes,
    exercises,
  };
}

export function normalizeExerciseDefinition(
  value: typeof exerciseDefinition.$inferSelect,
): ExerciseDefinitionRecord {
  return {
    id: value.id,
    patientId: value.patientId,
    name: value.name,
    category: value.category,
    equipment: value.equipment,
    notes: value.notes,
    originKind: value.originKind,
    originProvider: value.originProvider,
    originExternalId: value.originExternalId,
    sourceData: value.sourceData ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalizeSet(value: typeof workoutSet.$inferSelect): WorkoutSetRecord {
  return {
    id: value.id,
    workoutExerciseId: value.workoutExerciseId,
    orderIndex: value.orderIndex,
    setType: isWorkoutSetType(value.setType) ? value.setType : 'other',
    status: isWorkoutSetStatus(value.status) ? value.status : 'unknown',
    weightValue: value.weightValue,
    weightUnit: value.weightUnit,
    repetitions: value.repetitions,
    durationSeconds: value.durationSeconds,
    distanceValue: value.distanceValue,
    distanceUnit: value.distanceUnit,
    rpe: value.rpe,
    rir: value.rir,
    notes: value.notes,
    originExternalId: value.originExternalId,
    sourceData: value.sourceData ?? null,
  };
}

export function buildWorkoutRecords(
  claims: Array<typeof workoutClaim.$inferSelect>,
  exerciseRows: Array<typeof workoutExercise.$inferSelect>,
  setRows: Array<typeof workoutSet.$inferSelect>,
): WorkoutRecord[] {
  const setsByExercise = new Map<string, WorkoutSetRecord[]>();
  for (const row of setRows) {
    const values = setsByExercise.get(row.workoutExerciseId) || [];
    values.push(normalizeSet(row));
    setsByExercise.set(row.workoutExerciseId, values);
  }
  for (const values of setsByExercise.values()) {
    values.sort((left, right) => left.orderIndex - right.orderIndex);
  }

  const exercisesByWorkout = new Map<string, WorkoutExerciseRecord[]>();
  for (const row of exerciseRows) {
    const values = exercisesByWorkout.get(row.workoutClaimId) || [];
    values.push({
      id: row.id,
      workoutId: row.workoutClaimId,
      exerciseDefinitionId: row.exerciseDefinitionId,
      orderIndex: row.orderIndex,
      name: row.name,
      category: row.category,
      equipment: row.equipment,
      notes: row.notes,
      restSeconds: row.restSeconds,
      supersetGroup: row.supersetGroup,
      originExternalId: row.originExternalId,
      sourceData: row.sourceData ?? null,
      sets: setsByExercise.get(row.id) || [],
    });
    exercisesByWorkout.set(row.workoutClaimId, values);
  }
  for (const values of exercisesByWorkout.values()) {
    values.sort((left, right) => left.orderIndex - right.orderIndex);
  }

  return claims.flatMap((claim) => {
    if (!isWorkoutKind(claim.kind)) return [];
    let status: WorkoutStatus;
    if (claim.kind === 'session') {
      if (!isWorkoutSessionStatus(claim.status)) return [];
      status = claim.status;
    } else {
      if (!isWorkoutPlanStatus(claim.status)) return [];
      status = claim.status;
    }

    return [{
      id: claim.id,
      patientId: claim.patientId,
      kind: claim.kind,
      title: claim.title,
      status,
      basedOnWorkoutId: claim.basedOnWorkoutId,
      startedAt: claim.startedAt,
      endedAt: claim.endedAt,
      localDate: claim.localDate,
      timezone: claim.timezone,
      timezoneOffsetMinutes: claim.timezoneOffsetMinutes,
      endedTimezoneOffsetMinutes: claim.endedTimezoneOffsetMinutes,
      notes: claim.notes,
      originKind: claim.originKind,
      originProvider: claim.originProvider,
      originExternalId: claim.originExternalId,
      sourceCreatedAt: claim.sourceCreatedAt,
      sourceUpdatedAt: claim.sourceUpdatedAt,
      sourceData: claim.sourceData ?? null,
      revision: claim.revision,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      exercises: exercisesByWorkout.get(claim.id) || [],
    }];
  });
}
