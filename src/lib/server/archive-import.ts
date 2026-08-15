import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
  claimRevision,
  dataImport,
  energyClaim,
  exerciseDefinition,
  medicineClaim,
  patient,
  record,
  report,
  workoutClaim,
  workoutExercise,
  workoutSet,
} from '$lib/server/db/schema';
import { isEnergyDirection, isEnergyStatus, type EnergyClaimRecord } from '$lib/energy';
import { isMedicineStatus, type MedicineClaimRecord } from '$lib/medicine';
import { claimRevisionValues } from '$lib/server/claim-revisions';
import { isValidTimeZone, toDateTimeLocal, utcOffsetMinutesAt } from '$lib/time-zone';
import {
  exerciseDefinitionKey,
  isWorkoutKind,
  isWorkoutSetStatus,
  isWorkoutSetType,
  isWorkoutStatus,
  type ExerciseDefinitionRecord,
  type WorkoutExerciseRecord,
  type WorkoutRecord,
  type WorkoutSetRecord,
} from '$lib/workout';

export const archiveEntityKinds = [
  'profile',
  'reports',
  'records',
  'medicines',
  'energy',
  'dataImports',
  'exerciseDefinitions',
  'workouts',
  'revisions',
] as const;

export type ArchiveEntityKind = (typeof archiveEntityKinds)[number];
type ArchiveIdKind =
  | 'report'
  | 'record'
  | 'medicine'
  | 'energy'
  | 'energy-source'
  | 'data-import'
  | 'exercise-definition'
  | 'workout'
  | 'workout-exercise'
  | 'workout-set';

export type ArchiveImportErrorCode =
  | 'batch_too_large'
  | 'duplicate_source_id'
  | 'invalid_batch'
  | 'invalid_claim_revision'
  | 'invalid_energy'
  | 'invalid_data_import'
  | 'invalid_exercise_definition'
  | 'invalid_medicine'
  | 'invalid_profile'
  | 'invalid_record'
  | 'invalid_report'
  | 'invalid_workout'
  | 'missing_claim'
  | 'missing_exercise_definition'
  | 'missing_report';

export class ArchiveImportError extends Error {
  constructor(public readonly code: ArchiveImportErrorCode) {
    super(code);
    this.name = 'ArchiveImportError';
  }
}

export function isArchiveEntityKind(value: string): value is ArchiveEntityKind {
  return archiveEntityKinds.includes(value as ArchiveEntityKind);
}

function asRecord(value: unknown, code: ArchiveImportErrorCode) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveImportError(code);
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  code: ArchiveImportErrorCode,
  maxLength: number,
) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ArchiveImportError(code);
  }
  return value;
}

function optionalText(
  value: unknown,
  code: ArchiveImportErrorCode,
  maxLength: number,
) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) throw new ArchiveImportError(code);
  return value;
}

function positiveRevision(value: unknown, code: ArchiveImportErrorCode) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ArchiveImportError(code);
  return Number(value);
}

function finiteNumberOrNull(
  value: unknown,
  code: ArchiveImportErrorCode,
  options?: { integer?: boolean; min?: number; max?: number },
) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ArchiveImportError(code);
  if (options?.integer && !Number.isSafeInteger(value)) throw new ArchiveImportError(code);
  if (options?.min !== undefined && value < options.min) throw new ArchiveImportError(code);
  if (options?.max !== undefined && value > options.max) throw new ArchiveImportError(code);
  return value;
}

function requiredInteger(
  value: unknown,
  code: ArchiveImportErrorCode,
  options: { min?: number; max?: number } = {},
) {
  const parsed = finiteNumberOrNull(value, code, { ...options, integer: true });
  if (parsed === null) throw new ArchiveImportError(code);
  return parsed;
}

function optionalDateText(value: unknown, code: ArchiveImportErrorCode, maxLength = 64) {
  const text = optionalText(value, code, maxLength);
  if (text && Number.isNaN(Date.parse(text))) throw new ArchiveImportError(code);
  return text;
}

function validDateText(value: unknown, code: ArchiveImportErrorCode, maxLength = 64) {
  const text = requiredText(value, code, maxLength);
  if (Number.isNaN(Date.parse(text))) throw new ArchiveImportError(code);
  return text;
}

function isIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1];
}

function optionalIsoDateText(value: unknown, code: ArchiveImportErrorCode) {
  const text = optionalText(value, code, 10);
  if (text && !isIsoCalendarDate(text)) throw new ArchiveImportError(code);
  return text;
}

function requiredIsoDateText(value: unknown, code: ArchiveImportErrorCode) {
  const text = requiredText(value, code, 10);
  if (!isIsoCalendarDate(text)) throw new ArchiveImportError(code);
  return text;
}

function jsonValue(value: unknown, code: ArchiveImportErrorCode) {
  if (value === undefined) return null;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 8 * 1024 * 1024) {
      throw new ArchiveImportError(code);
    }
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    if (error instanceof ArchiveImportError) throw error;
    throw new ArchiveImportError(code);
  }
}

function assertSerializedSize(
  value: unknown,
  maxBytes: number,
  code: ArchiveImportErrorCode,
) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxBytes) {
      throw new ArchiveImportError(code);
    }
  } catch (error) {
    if (error instanceof ArchiveImportError) throw error;
    throw new ArchiveImportError(code);
  }
}

function sourceId(row: Record<string, unknown>, code: ArchiveImportErrorCode) {
  return requiredText(row.id, code, 512);
}

function assertUniqueSourceIds(rows: Array<{ sourceId: string }>) {
  if (new Set(rows.map((row) => row.sourceId)).size !== rows.length) {
    throw new ArchiveImportError('duplicate_source_id');
  }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function archiveEntityId(
  patientId: string,
  sourcePatientId: string,
  kind: ArchiveIdKind,
  sourceIdValue: string,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        `health-tracker-archive\0${patientId}\0${sourcePatientId}\0${kind}\0${sourceIdValue}`,
      ),
    ),
  ).slice(0, 16);

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const value = hex(digest);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function resolveArchiveEntityId(
  patientId: string,
  sourcePatientId: string,
  kind: ArchiveIdKind,
  sourceIdValue: string,
) {
  return patientId === sourcePatientId
    ? sourceIdValue
    : archiveEntityId(patientId, sourcePatientId, kind, sourceIdValue);
}

export async function resolveArchiveEnergyClaimId(input: {
  patientId: string;
  sourcePatientId: string;
  sourceId: string;
  originProvider?: string | null;
  originExternalId?: string | null;
}) {
  const candidateId = await resolveArchiveEntityId(
    input.patientId,
    input.sourcePatientId,
    'energy',
    input.sourceId,
  );

  if (!input.originProvider || !input.originExternalId) return candidateId;

  const existing = await db
    .select({
      id: energyClaim.id,
      originProvider: energyClaim.originProvider,
      originExternalId: energyClaim.originExternalId,
    })
    .from(energyClaim)
    .where(
      and(
        eq(energyClaim.patientId, input.patientId),
        or(
          eq(energyClaim.id, candidateId),
          and(
            eq(energyClaim.originProvider, input.originProvider),
            eq(energyClaim.originExternalId, input.originExternalId),
          ),
        ),
      ),
    );
  const candidate = existing.find((row) => row.id === candidateId);
  if (candidate) return candidate.id;

  return existing[0]?.id || candidateId;
}

export async function resolveArchiveDataImportId(input: {
  patientId: string;
  sourcePatientId: string;
  sourceId: string;
  provider: string;
  format: string;
  contentSha256: string;
  interpretationKey: string;
}) {
  const candidateId = await resolveArchiveEntityId(
    input.patientId,
    input.sourcePatientId,
    'data-import',
    input.sourceId,
  );
  const existing = await db
    .select({ id: dataImport.id })
    .from(dataImport)
    .where(
      and(
        eq(dataImport.patientId, input.patientId),
        or(
          eq(dataImport.id, candidateId),
          and(
            eq(dataImport.provider, input.provider),
            eq(dataImport.format, input.format),
            eq(dataImport.contentSha256, input.contentSha256),
            eq(dataImport.interpretationKey, input.interpretationKey),
          ),
        ),
      ),
    );
  return existing.find((row) => row.id === candidateId)?.id || existing[0]?.id || candidateId;
}

async function resolveArchiveExerciseDefinitionId(input: {
  patientId: string;
  sourcePatientId: string;
  sourceId: string;
  name: string;
  equipment: string | null;
  originProvider?: string | null;
  originExternalId?: string | null;
}) {
  const candidateId = await resolveArchiveEntityId(
    input.patientId,
    input.sourcePatientId,
    'exercise-definition',
    input.sourceId,
  );
  const normalizedKey = exerciseDefinitionKey(input.name, input.equipment);
  const identity = input.originProvider && input.originExternalId
    ? or(
        eq(exerciseDefinition.id, candidateId),
        eq(exerciseDefinition.normalizedKey, normalizedKey),
        and(
          eq(exerciseDefinition.originProvider, input.originProvider),
          eq(exerciseDefinition.originExternalId, input.originExternalId),
        ),
      )
    : or(
        eq(exerciseDefinition.id, candidateId),
        eq(exerciseDefinition.normalizedKey, normalizedKey),
      );
  const existing = await db
    .select({
      id: exerciseDefinition.id,
      normalizedKey: exerciseDefinition.normalizedKey,
      originProvider: exerciseDefinition.originProvider,
      originExternalId: exerciseDefinition.originExternalId,
    })
    .from(exerciseDefinition)
    .where(and(eq(exerciseDefinition.patientId, input.patientId), identity));

  return (
    existing.find((row) => row.id === candidateId)?.id ||
    existing.find(
      (row) =>
        input.originProvider &&
        input.originExternalId &&
        row.originProvider === input.originProvider &&
        row.originExternalId === input.originExternalId,
    )?.id ||
    existing.find((row) => row.normalizedKey === normalizedKey)?.id ||
    candidateId
  );
}

async function resolveArchiveWorkoutClaimId(input: {
  patientId: string;
  sourcePatientId: string;
  sourceId: string;
  kind: 'session' | 'plan';
  originProvider?: string | null;
  originExternalId?: string | null;
}) {
  const candidateId = await resolveArchiveEntityId(
    input.patientId,
    input.sourcePatientId,
    'workout',
    input.sourceId,
  );
  if (!input.originProvider || !input.originExternalId) return candidateId;

  const existing = await db
    .select({ id: workoutClaim.id })
    .from(workoutClaim)
    .where(
      and(
        eq(workoutClaim.patientId, input.patientId),
        eq(workoutClaim.kind, input.kind),
        or(
          eq(workoutClaim.id, candidateId),
          and(
            eq(workoutClaim.originProvider, input.originProvider),
            eq(workoutClaim.originExternalId, input.originExternalId),
          ),
        ),
      ),
    );
  return existing.find((row) => row.id === candidateId)?.id || existing[0]?.id || candidateId;
}

function importedRawData(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 32 * 1024 * 1024) {
    throw new ArchiveImportError('invalid_report');
  }

  try {
    const descriptor = JSON.parse(value) as Record<string, unknown>;
    if (descriptor.kind === 'r2-file') {
      return JSON.stringify({
        kind: 'archive-pending-file',
        fileName: typeof descriptor.fileName === 'string' ? descriptor.fileName : null,
        mimeType: typeof descriptor.mimeType === 'string' ? descriptor.mimeType : null,
      });
    }
  } catch {
    return value;
  }

  return value;
}

function parseReport(value: unknown) {
  const row = asRecord(value, 'invalid_report');
  return {
    sourceId: sourceId(row, 'invalid_report'),
    kind: requiredText(row.kind, 'invalid_report', 64),
    testDate: validDateText(row.testDate, 'invalid_report'),
    reportTime: optionalText(row.reportTime, 'invalid_report', 64),
    rawData: importedRawData(row.rawData),
    organizedData: jsonValue(row.organizedData, 'invalid_report'),
    parsedJsonData: jsonValue(row.parsedJsonData, 'invalid_report'),
    extraData: jsonValue(row.extraData, 'invalid_report'),
  };
}

function parseProfile(value: unknown) {
  const row = asRecord(value, 'invalid_profile');

  return {
    name: requiredText(row.name, 'invalid_profile', 200),
    agab: optionalText(row.agab, 'invalid_profile', 100),
    birthday: optionalIsoDateText(row.birthday, 'invalid_profile'),
    extraData: jsonValue(row.extraData, 'invalid_profile'),
  };
}

function parseDataImport(value: unknown) {
  assertSerializedSize(value, 2 * 1024 * 1024, 'invalid_data_import');
  const row = asRecord(value, 'invalid_data_import');
  const status = requiredText(row.status, 'invalid_data_import', 32);
  if (status !== 'pending' && status !== 'completed' && status !== 'failed') {
    throw new ArchiveImportError('invalid_data_import');
  }
  const contentSha256 = requiredText(row.contentSha256, 'invalid_data_import', 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
    throw new ArchiveImportError('invalid_data_import');
  }
  const timezone = optionalText(row.timezone, 'invalid_data_import', 100);
  if (timezone && !isValidTimeZone(timezone)) {
    throw new ArchiveImportError('invalid_data_import');
  }

  return {
    sourceId: sourceId(row, 'invalid_data_import'),
    provider: requiredText(row.provider, 'invalid_data_import', 120),
    format: requiredText(row.format, 'invalid_data_import', 120),
    status,
    fileName: optionalText(row.fileName, 'invalid_data_import', 300),
    mimeType: requiredText(row.mimeType, 'invalid_data_import', 200),
    byteSize: requiredInteger(row.byteSize, 'invalid_data_import', {
      min: 1,
      max: 50 * 1024 * 1024,
    }),
    contentSha256,
    interpretationKey: optionalText(row.interpretationKey, 'invalid_data_import', 500) || '',
    timezone,
    summaryData: jsonValue(row.summaryData, 'invalid_data_import'),
    errorCode: optionalText(row.errorCode, 'invalid_data_import', 200),
    createdAt: validDateText(row.createdAt, 'invalid_data_import'),
    updatedAt: validDateText(row.updatedAt, 'invalid_data_import'),
  };
}

function parseRecord(value: unknown) {
  const row = asRecord(value, 'invalid_record');
  return {
    sourceId: sourceId(row, 'invalid_record'),
    sourceReportId: requiredText(row.reportId, 'invalid_record', 512),
    metricName: requiredText(row.metricName, 'invalid_record', 500),
    value: requiredText(row.value, 'invalid_record', 500),
    unit: optionalText(row.unit, 'invalid_record', 120),
    refRange: optionalText(row.refRange, 'invalid_record', 500),
    status: optionalText(row.status, 'invalid_record', 120),
    extraData: jsonValue(row.extraData, 'invalid_record'),
  };
}

function parseMedicine(value: unknown, patientId: string, id: string): MedicineClaimRecord {
  const row = asRecord(value, 'invalid_medicine');
  const status = requiredText(row.status, 'invalid_medicine', 32);
  if (!isMedicineStatus(status)) throw new ArchiveImportError('invalid_medicine');

  const createdAt = validDateText(row.createdAt, 'invalid_medicine');
  const updatedAt = validDateText(row.updatedAt, 'invalid_medicine');

  return {
    id,
    patientId,
    name: requiredText(row.name, 'invalid_medicine', 200),
    genericName: optionalText(row.genericName, 'invalid_medicine', 200),
    form: optionalText(row.form, 'invalid_medicine', 120),
    strength: optionalText(row.strength, 'invalid_medicine', 120),
    route: optionalText(row.route, 'invalid_medicine', 120),
    schedule: optionalText(row.schedule, 'invalid_medicine', 1000),
    status,
    startDate: optionalIsoDateText(row.startDate, 'invalid_medicine'),
    endDate: optionalIsoDateText(row.endDate, 'invalid_medicine'),
    purpose: optionalText(row.purpose, 'invalid_medicine', 500),
    prescriber: optionalText(row.prescriber, 'invalid_medicine', 300),
    notes: optionalText(row.notes, 'invalid_medicine', 4000),
    originKind: optionalText(row.originKind, 'invalid_medicine', 120) || 'manual',
    originProvider: optionalText(row.originProvider, 'invalid_medicine', 300),
    originExternalId: optionalText(row.originExternalId, 'invalid_medicine', 1000),
    revision: positiveRevision(row.revision, 'invalid_medicine'),
    createdAt,
    updatedAt,
  };
}

function parseEnergy(value: unknown, patientId: string, id: string): EnergyClaimRecord {
  const row = asRecord(value, 'invalid_energy');
  const direction = requiredText(row.direction, 'invalid_energy', 32);
  const status = requiredText(row.status, 'invalid_energy', 32);
  if (!isEnergyDirection(direction) || !isEnergyStatus(status)) {
    throw new ArchiveImportError('invalid_energy');
  }

  const timezoneOffsetMinutes = finiteNumberOrNull(row.timezoneOffsetMinutes, 'invalid_energy', {
    integer: true,
    min: -1440,
    max: 1440,
  });
  if (timezoneOffsetMinutes === null) throw new ArchiveImportError('invalid_energy');

  const createdAt = validDateText(row.createdAt, 'invalid_energy');
  const updatedAt = validDateText(row.updatedAt, 'invalid_energy');

  return {
    id,
    patientId,
    direction,
    label: optionalText(row.label, 'invalid_energy', 300),
    category: optionalText(row.category, 'invalid_energy', 120),
    energyKcal: finiteNumberOrNull(row.energyKcal, 'invalid_energy', { min: 0, max: 1_000_000 }),
    occurredAt: validDateText(row.occurredAt, 'invalid_energy'),
    localDate: requiredIsoDateText(row.localDate, 'invalid_energy'),
    timezone: optionalText(row.timezone, 'invalid_energy', 120),
    timezoneOffsetMinutes,
    durationMinutes: finiteNumberOrNull(row.durationMinutes, 'invalid_energy', {
      integer: true,
      min: 0,
      max: 10_080,
    }),
    status,
    notes: optionalText(row.notes, 'invalid_energy', 4000),
    originKind: optionalText(row.originKind, 'invalid_energy', 120) || 'manual',
    originProvider: optionalText(row.originProvider, 'invalid_energy', 300),
    originExternalId: optionalText(row.originExternalId, 'invalid_energy', 1000),
    revision: positiveRevision(row.revision, 'invalid_energy'),
    createdAt,
    updatedAt,
  };
}

function parseExerciseDefinition(
  value: unknown,
  patientId: string,
  id: string,
) {
  assertSerializedSize(value, 256 * 1024, 'invalid_exercise_definition');
  const row = asRecord(value, 'invalid_exercise_definition');
  const name = requiredText(row.name, 'invalid_exercise_definition', 300);
  const equipment = optionalText(row.equipment, 'invalid_exercise_definition', 120);
  const sourceIdValue = sourceId(row, 'invalid_exercise_definition');

  return {
    sourceId: sourceIdValue,
    id,
    patientId,
    name,
    normalizedKey: exerciseDefinitionKey(name, equipment),
    category: optionalText(row.category, 'invalid_exercise_definition', 120),
    equipment,
    notes: optionalText(row.notes, 'invalid_exercise_definition', 2_000),
    originKind:
      optionalText(row.originKind, 'invalid_exercise_definition', 120) || 'manual',
    originProvider: optionalText(row.originProvider, 'invalid_exercise_definition', 300),
    originExternalId: optionalText(
      row.originExternalId,
      'invalid_exercise_definition',
      1_000,
    ),
    sourceData: jsonValue(row.sourceData, 'invalid_exercise_definition'),
    createdAt: validDateText(row.createdAt, 'invalid_exercise_definition'),
    updatedAt: validDateText(row.updatedAt, 'invalid_exercise_definition'),
  };
}

function parseWorkoutSet(
  value: unknown,
  sourceWorkoutId: string,
  sourceExerciseId: string,
) {
  const row = asRecord(value, 'invalid_workout');
  const setType = requiredText(row.setType, 'invalid_workout', 32);
  const status = requiredText(row.status, 'invalid_workout', 32);
  if (!isWorkoutSetType(setType) || !isWorkoutSetStatus(status)) {
    throw new ArchiveImportError('invalid_workout');
  }

  const sourceIdValue = sourceId(row, 'invalid_workout');
  if (
    row.workoutExerciseId !== sourceExerciseId ||
    (row.workoutId !== undefined && row.workoutId !== sourceWorkoutId)
  ) {
    throw new ArchiveImportError('invalid_workout');
  }

  return {
    sourceId: sourceIdValue,
    orderIndex: requiredInteger(row.orderIndex, 'invalid_workout', { min: 0, max: 100_000 }),
    setType,
    status,
    weightValue: finiteNumberOrNull(row.weightValue, 'invalid_workout', {
      min: 0,
      max: 1_000_000,
    }),
    weightUnit: optionalText(row.weightUnit, 'invalid_workout', 32),
    repetitions: finiteNumberOrNull(row.repetitions, 'invalid_workout', {
      integer: true,
      min: 0,
      max: 1_000_000,
    }),
    durationSeconds: finiteNumberOrNull(row.durationSeconds, 'invalid_workout', {
      integer: true,
      min: 0,
      max: 2_592_000,
    }),
    distanceValue: finiteNumberOrNull(row.distanceValue, 'invalid_workout', {
      min: 0,
      max: 1_000_000_000,
    }),
    distanceUnit: optionalText(row.distanceUnit, 'invalid_workout', 32),
    rpe: finiteNumberOrNull(row.rpe, 'invalid_workout', { min: 0, max: 10 }),
    rir: finiteNumberOrNull(row.rir, 'invalid_workout', { min: 0, max: 10 }),
    notes: optionalText(row.notes, 'invalid_workout', 1_000),
    originExternalId: optionalText(row.originExternalId, 'invalid_workout', 1_000),
    sourceData: jsonValue(row.sourceData, 'invalid_workout'),
  };
}

function parseWorkoutExercise(value: unknown, sourceWorkoutId: string) {
  const row = asRecord(value, 'invalid_workout');
  const sourceIdValue = sourceId(row, 'invalid_workout');
  if (row.workoutId !== sourceWorkoutId) throw new ArchiveImportError('invalid_workout');
  if (!Array.isArray(row.sets) || row.sets.length > 100) {
    throw new ArchiveImportError('invalid_workout');
  }
  const sets = row.sets.map((set) => parseWorkoutSet(set, sourceWorkoutId, sourceIdValue));
  assertUniqueSourceIds(sets);
  if (new Set(sets.map((set) => set.orderIndex)).size !== sets.length) {
    throw new ArchiveImportError('invalid_workout');
  }

  return {
    sourceId: sourceIdValue,
    sourceDefinitionId: optionalText(row.exerciseDefinitionId, 'invalid_workout', 512),
    orderIndex: requiredInteger(row.orderIndex, 'invalid_workout', { min: 0, max: 100_000 }),
    name: requiredText(row.name, 'invalid_workout', 300),
    category: optionalText(row.category, 'invalid_workout', 120),
    equipment: optionalText(row.equipment, 'invalid_workout', 120),
    notes: optionalText(row.notes, 'invalid_workout', 2_000),
    restSeconds: finiteNumberOrNull(row.restSeconds, 'invalid_workout', {
      integer: true,
      min: 0,
      max: 86_400,
    }),
    supersetGroup: optionalText(row.supersetGroup, 'invalid_workout', 100),
    originExternalId: optionalText(row.originExternalId, 'invalid_workout', 1_000),
    sourceData: jsonValue(row.sourceData, 'invalid_workout'),
    sets,
  };
}

function parseWorkoutRoot(value: unknown) {
  assertSerializedSize(value, 2 * 1024 * 1024, 'invalid_workout');
  const row = asRecord(value, 'invalid_workout');
  const sourceIdValue = sourceId(row, 'invalid_workout');
  const kind = requiredText(row.kind, 'invalid_workout', 32);
  const status = requiredText(row.status, 'invalid_workout', 32);
  if (!isWorkoutKind(kind) || !isWorkoutStatus(kind, status)) {
    throw new ArchiveImportError('invalid_workout');
  }
  if (!Array.isArray(row.exercises) || row.exercises.length > 100) {
    throw new ArchiveImportError('invalid_workout');
  }
  const exercises = row.exercises.map((exercise) =>
    parseWorkoutExercise(exercise, sourceIdValue),
  );
  assertUniqueSourceIds(exercises);
  if (
    new Set(exercises.map((exercise) => exercise.orderIndex)).size !== exercises.length ||
    exercises.reduce((total, exercise) => total + exercise.sets.length, 0) > 1_000
  ) {
    throw new ArchiveImportError('invalid_workout');
  }

  const startedAt = optionalDateText(row.startedAt, 'invalid_workout');
  const endedAt = optionalDateText(row.endedAt, 'invalid_workout');
  const localDate = optionalIsoDateText(row.localDate, 'invalid_workout');
  const timezone = optionalText(row.timezone, 'invalid_workout', 100);
  const timezoneOffsetMinutes = finiteNumberOrNull(
    row.timezoneOffsetMinutes,
    'invalid_workout',
    { integer: true, min: -840, max: 840 },
  );
  const endedTimezoneOffsetMinutes = finiteNumberOrNull(
    row.endedTimezoneOffsetMinutes,
    'invalid_workout',
    { integer: true, min: -840, max: 840 },
  );
  const sourceBasedOnWorkoutId = optionalText(row.basedOnWorkoutId, 'invalid_workout', 512);

  if (kind === 'session') {
    if (
      !startedAt ||
      !localDate ||
      !timezone ||
      !isValidTimeZone(timezone) ||
      timezoneOffsetMinutes === null ||
      toDateTimeLocal(startedAt, timezone).slice(0, 10) !== localDate ||
      utcOffsetMinutesAt(startedAt, timezone) !== timezoneOffsetMinutes ||
      (endedAt &&
        (endedTimezoneOffsetMinutes === null ||
          utcOffsetMinutesAt(endedAt, timezone) !== endedTimezoneOffsetMinutes ||
          Date.parse(endedAt) < Date.parse(startedAt) ||
          Date.parse(endedAt) - Date.parse(startedAt) > 30 * 24 * 60 * 60 * 1_000)) ||
      (!endedAt && endedTimezoneOffsetMinutes !== null)
    ) {
      throw new ArchiveImportError('invalid_workout');
    }
  } else if (
    startedAt !== null ||
    endedAt !== null ||
    localDate !== null ||
    timezone !== null ||
    timezoneOffsetMinutes !== null ||
    endedTimezoneOffsetMinutes !== null ||
    sourceBasedOnWorkoutId !== null
  ) {
    throw new ArchiveImportError('invalid_workout');
  }

  return {
    sourceId: sourceIdValue,
    kind,
    title: requiredText(row.title, 'invalid_workout', 300),
    status,
    sourceBasedOnWorkoutId,
    startedAt,
    endedAt,
    localDate,
    timezone,
    timezoneOffsetMinutes,
    endedTimezoneOffsetMinutes,
    notes: optionalText(row.notes, 'invalid_workout', 4_000),
    originKind: optionalText(row.originKind, 'invalid_workout', 120) || 'manual',
    originProvider: optionalText(row.originProvider, 'invalid_workout', 300),
    originExternalId: optionalText(row.originExternalId, 'invalid_workout', 1_000),
    sourceCreatedAt: optionalDateText(row.sourceCreatedAt, 'invalid_workout'),
    sourceUpdatedAt: optionalDateText(row.sourceUpdatedAt, 'invalid_workout'),
    sourceData: jsonValue(row.sourceData, 'invalid_workout'),
    revision: positiveRevision(row.revision, 'invalid_workout'),
    createdAt: validDateText(row.createdAt, 'invalid_workout'),
    updatedAt: validDateText(row.updatedAt, 'invalid_workout'),
    exercises,
  };
}

async function planWorkout(
  value: unknown,
  patientId: string,
  sourcePatientId: string,
) {
  const parsed = parseWorkoutRoot(value);
  const id = await resolveArchiveWorkoutClaimId({
    patientId,
    sourcePatientId,
    sourceId: parsed.sourceId,
    kind: parsed.kind,
    originProvider: parsed.originProvider,
    originExternalId: parsed.originExternalId,
  });
  const basedOnWorkoutId = parsed.sourceBasedOnWorkoutId
    ? await resolveArchiveEntityId(
        patientId,
        sourcePatientId,
        'workout',
        parsed.sourceBasedOnWorkoutId,
      )
    : null;

  const exercises: WorkoutExerciseRecord[] = [];
  const allSets: WorkoutSetRecord[] = [];
  for (const exercise of parsed.exercises) {
    const exerciseId = await resolveArchiveEntityId(
      patientId,
      sourcePatientId,
      'workout-exercise',
      exercise.sourceId,
    );
    const exerciseDefinitionId = exercise.sourceDefinitionId
      ? await resolveArchiveExerciseDefinitionId({
          patientId,
          sourcePatientId,
          sourceId: exercise.sourceDefinitionId,
          name: exercise.name,
          equipment: exercise.equipment,
        })
      : null;
    const sets: WorkoutSetRecord[] = [];
    for (const set of exercise.sets) {
      const setId = await resolveArchiveEntityId(
        patientId,
        sourcePatientId,
        'workout-set',
        set.sourceId,
      );
      sets.push({
        id: setId,
        workoutExerciseId: exerciseId,
        orderIndex: set.orderIndex,
        setType: set.setType,
        status: set.status,
        weightValue: set.weightValue,
        weightUnit: set.weightUnit,
        repetitions: set.repetitions,
        durationSeconds: set.durationSeconds,
        distanceValue: set.distanceValue,
        distanceUnit: set.distanceUnit,
        rpe: set.rpe,
        rir: set.rir,
        notes: set.notes,
        originExternalId: set.originExternalId,
        sourceData: set.sourceData,
      });
    }
    allSets.push(...sets);
    exercises.push({
      id: exerciseId,
      workoutId: id,
      exerciseDefinitionId,
      orderIndex: exercise.orderIndex,
      name: exercise.name,
      category: exercise.category,
      equipment: exercise.equipment,
      notes: exercise.notes,
      restSeconds: exercise.restSeconds,
      supersetGroup: exercise.supersetGroup,
      originExternalId: exercise.originExternalId,
      sourceData: exercise.sourceData,
      sets,
    });
  }

  const snapshot: WorkoutRecord = {
    id,
    patientId,
    kind: parsed.kind,
    title: parsed.title,
    status: parsed.status,
    basedOnWorkoutId,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    localDate: parsed.localDate,
    timezone: parsed.timezone,
    timezoneOffsetMinutes: parsed.timezoneOffsetMinutes,
    endedTimezoneOffsetMinutes: parsed.endedTimezoneOffsetMinutes,
    notes: parsed.notes,
    originKind: parsed.originKind,
    originProvider: parsed.originProvider,
    originExternalId: parsed.originExternalId,
    sourceCreatedAt: parsed.sourceCreatedAt,
    sourceUpdatedAt: parsed.sourceUpdatedAt,
    sourceData: parsed.sourceData,
    revision: parsed.revision,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    exercises,
  };
  return { sourceId: parsed.sourceId, snapshot, sets: allSets };
}

function insertResult(received: number, inserted: number, skipped = 0) {
  return {
    received,
    inserted,
    existing: Math.max(0, received - inserted - skipped),
    skipped,
  };
}

async function importProfile(patientId: string, items: unknown[]) {
  if (items.length !== 1) throw new ArchiveImportError('invalid_profile');
  const profile = parseProfile(items[0]);
  const updated = await db
    .update(patient)
    .set(profile)
    .where(eq(patient.id, patientId))
    .returning({ id: patient.id });
  return insertResult(1, updated.length);
}

async function importReports(patientId: string, sourcePatientId: string, items: unknown[]) {
  const parsed = items.map(parseReport);
  assertUniqueSourceIds(parsed);
  const values = await Promise.all(
    parsed.map(async (item) => ({
      id: await resolveArchiveEntityId(patientId, sourcePatientId, 'report', item.sourceId),
      patientId,
      kind: item.kind,
      testDate: item.testDate,
      reportTime: item.reportTime,
      rawData: item.rawData,
      organizedData: item.organizedData,
      parsedJsonData: item.parsedJsonData,
      extraData: item.extraData,
    })),
  );
  const inserted = await db.insert(report).values(values).onConflictDoNothing().returning({ id: report.id });
  return insertResult(items.length, inserted.length);
}

async function importRecords(patientId: string, sourcePatientId: string, items: unknown[]) {
  const parsed = items.map(parseRecord);
  assertUniqueSourceIds(parsed);
  const values = await Promise.all(
    parsed.map(async (item) => ({
      id: await resolveArchiveEntityId(patientId, sourcePatientId, 'record', item.sourceId),
      patientId,
      reportId: await resolveArchiveEntityId(patientId, sourcePatientId, 'report', item.sourceReportId),
      metricName: item.metricName,
      value: item.value,
      unit: item.unit,
      refRange: item.refRange,
      status: item.status,
      extraData: item.extraData,
    })),
  );

  const reportIds = [...new Set(values.map((item) => item.reportId))];
  const parents = reportIds.length
    ? await db
        .select({ id: report.id })
        .from(report)
        .where(and(eq(report.patientId, patientId), inArray(report.id, reportIds)))
    : [];
  if (parents.length !== reportIds.length) throw new ArchiveImportError('missing_report');

  const inserted = await db.insert(record).values(values).onConflictDoNothing().returning({ id: record.id });
  return insertResult(items.length, inserted.length);
}

async function importDataImports(patientId: string, sourcePatientId: string, items: unknown[]) {
  const parsed = items.map(parseDataImport);
  assertUniqueSourceIds(parsed);
  const values = await Promise.all(
    parsed.map(async (item) => {
      const id = await resolveArchiveDataImportId({
        patientId,
        sourcePatientId,
        sourceId: item.sourceId,
        provider: item.provider,
        format: item.format,
        contentSha256: item.contentSha256,
        interpretationKey: item.interpretationKey,
      });
      return {
        id,
        patientId,
        provider: item.provider,
        format: item.format,
        status: item.status,
        fileName: item.fileName,
        mimeType: item.mimeType,
        byteSize: item.byteSize,
        contentSha256: item.contentSha256,
        interpretationKey: item.interpretationKey,
        storageKey: `import-sources/${patientId}/archive-${id}`,
        objectEtag: null,
        timezone: item.timezone,
        summaryData: item.summaryData,
        errorCode: item.errorCode,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }),
  );
  const inserted = await db
    .insert(dataImport)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: dataImport.id });
  return insertResult(items.length, inserted.length);
}

async function importMedicines(patientId: string, sourcePatientId: string, items: unknown[]) {
  const sourceRows = items.map((value) => ({ value, row: asRecord(value, 'invalid_medicine') }));
  const planned = await Promise.all(
    sourceRows.map(async ({ value, row }) => {
      const sourceIdValue = sourceId(row, 'invalid_medicine');
      const id = await resolveArchiveEntityId(patientId, sourcePatientId, 'medicine', sourceIdValue);
      return { sourceId: sourceIdValue, snapshot: parseMedicine(value, patientId, id) };
    }),
  );
  assertUniqueSourceIds(planned);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(medicineClaim)
      .values(planned.map(({ snapshot }) => snapshot))
      .onConflictDoNothing()
      .returning({ id: medicineClaim.id });
    const ids = planned.map(({ snapshot }) => snapshot.id);
    const stored = await tx
      .select()
      .from(medicineClaim)
      .where(and(eq(medicineClaim.patientId, patientId), inArray(medicineClaim.id, ids)));

    if (stored.length > 0) {
      await tx
        .insert(claimRevision)
        .values(
          stored.map((snapshot) =>
            claimRevisionValues('medicine', snapshot as MedicineClaimRecord, {
              kind: snapshot.originKind,
              provider: snapshot.originProvider,
            }),
          ),
        )
        .onConflictDoNothing();
    }

    return insertResult(items.length, inserted.length, planned.length - stored.length);
  });
}

async function importEnergy(patientId: string, sourcePatientId: string, items: unknown[]) {
  const sourceRows = items.map((value) => ({ value, row: asRecord(value, 'invalid_energy') }));
  const planned = await Promise.all(
    sourceRows.map(async ({ value, row }) => {
      const sourceIdValue = sourceId(row, 'invalid_energy');
      const originProvider = optionalText(row.originProvider, 'invalid_energy', 300);
      const originExternalId = optionalText(row.originExternalId, 'invalid_energy', 1000);
      const id = await resolveArchiveEnergyClaimId({
        patientId,
        sourcePatientId,
        sourceId: sourceIdValue,
        originProvider,
        originExternalId,
      });
      return { sourceId: sourceIdValue, snapshot: parseEnergy(value, patientId, id) };
    }),
  );
  assertUniqueSourceIds(planned);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(energyClaim)
      .values(planned.map(({ snapshot }) => snapshot))
      .onConflictDoNothing()
      .returning({ id: energyClaim.id });
    const ids = planned.map(({ snapshot }) => snapshot.id);
    const stored = await tx
      .select()
      .from(energyClaim)
      .where(and(eq(energyClaim.patientId, patientId), inArray(energyClaim.id, ids)));

    if (stored.length > 0) {
      await tx
        .insert(claimRevision)
        .values(
          stored.map((snapshot) =>
            claimRevisionValues('energy', snapshot as EnergyClaimRecord, {
              kind: snapshot.originKind,
              provider: snapshot.originProvider,
            }),
          ),
        )
        .onConflictDoNothing();
    }

    return insertResult(items.length, inserted.length, planned.length - stored.length);
  });
}

async function importExerciseDefinitions(
  patientId: string,
  sourcePatientId: string,
  items: unknown[],
) {
  const planned = await Promise.all(
    items.map(async (value) => {
      const provisional = parseExerciseDefinition(value, patientId, 'provisional');
      const id = await resolveArchiveExerciseDefinitionId({
        patientId,
        sourcePatientId,
        sourceId: provisional.sourceId,
        name: provisional.name,
        equipment: provisional.equipment,
        originProvider: provisional.originProvider,
        originExternalId: provisional.originExternalId,
      });
      return { ...provisional, id };
    }),
  );
  assertUniqueSourceIds(planned);
  const values = planned.map(({ sourceId: _sourceId, ...value }) => value);
  const inserted = await db
    .insert(exerciseDefinition)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: exerciseDefinition.id });
  const ids = [...new Set(values.map((value) => value.id))];
  const stored = ids.length
    ? await db
        .select({ id: exerciseDefinition.id })
        .from(exerciseDefinition)
        .where(and(eq(exerciseDefinition.patientId, patientId), inArray(exerciseDefinition.id, ids)))
    : [];
  return insertResult(items.length, inserted.length, planned.length - stored.length);
}

async function importWorkouts(patientId: string, sourcePatientId: string, items: unknown[]) {
  const planned = await Promise.all(
    items.map((value) => planWorkout(value, patientId, sourcePatientId)),
  );
  assertUniqueSourceIds(planned);
  const exerciseIds = planned.flatMap(({ snapshot }) =>
    snapshot.exercises.map((exercise) => exercise.id),
  );
  const setIds = planned.flatMap(({ snapshot }) =>
    snapshot.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)),
  );
  if (
    new Set(exerciseIds).size !== exerciseIds.length ||
    new Set(setIds).size !== setIds.length
  ) {
    throw new ArchiveImportError('duplicate_source_id');
  }

  const definitionIds = [...new Set(
    planned.flatMap(({ snapshot }) =>
      snapshot.exercises.flatMap((exercise) =>
        exercise.exerciseDefinitionId ? [exercise.exerciseDefinitionId] : [],
      ),
    ),
  )];
  const definitions = definitionIds.length
    ? await db
        .select({ id: exerciseDefinition.id })
        .from(exerciseDefinition)
        .where(
          and(
            eq(exerciseDefinition.patientId, patientId),
            inArray(exerciseDefinition.id, definitionIds),
          ),
        )
    : [];
  if (definitions.length !== definitionIds.length) {
    throw new ArchiveImportError('missing_exercise_definition');
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workoutClaim)
      .values(
        planned.map(({ snapshot }) => ({
          id: snapshot.id,
          patientId: snapshot.patientId,
          kind: snapshot.kind,
          title: snapshot.title,
          status: snapshot.status,
          basedOnWorkoutId: snapshot.basedOnWorkoutId,
          startedAt: snapshot.startedAt,
          endedAt: snapshot.endedAt,
          localDate: snapshot.localDate,
          timezone: snapshot.timezone,
          timezoneOffsetMinutes: snapshot.timezoneOffsetMinutes,
          endedTimezoneOffsetMinutes: snapshot.endedTimezoneOffsetMinutes,
          notes: snapshot.notes,
          originKind: snapshot.originKind,
          originProvider: snapshot.originProvider,
          originExternalId: snapshot.originExternalId,
          sourceCreatedAt: snapshot.sourceCreatedAt,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          sourceData: snapshot.sourceData,
          revision: snapshot.revision,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: workoutClaim.id });
    const insertedIds = new Set(inserted.map((row) => row.id));
    const insertedSnapshots = planned
      .map(({ snapshot }) => snapshot)
      .filter((snapshot) => insertedIds.has(snapshot.id));
    const planReferenceIds = [...new Set(
      planned.flatMap(({ snapshot }) =>
        snapshot.basedOnWorkoutId ? [snapshot.basedOnWorkoutId] : [],
      ),
    )];
    const planReferences = planReferenceIds.length
      ? await tx
          .select({ id: workoutClaim.id })
          .from(workoutClaim)
          .where(
            and(
              eq(workoutClaim.patientId, patientId),
              eq(workoutClaim.kind, 'plan'),
              inArray(workoutClaim.id, planReferenceIds),
            ),
          )
      : [];
    if (planReferences.length !== planReferenceIds.length) {
      throw new ArchiveImportError('invalid_workout');
    }
    const exerciseValues = insertedSnapshots.flatMap((snapshot) =>
      snapshot.exercises.map((exercise) => ({
        id: exercise.id,
        patientId,
        workoutClaimId: snapshot.id,
        exerciseDefinitionId: exercise.exerciseDefinitionId,
        orderIndex: exercise.orderIndex,
        name: exercise.name,
        category: exercise.category,
        equipment: exercise.equipment,
        notes: exercise.notes,
        restSeconds: exercise.restSeconds,
        supersetGroup: exercise.supersetGroup,
        originExternalId: exercise.originExternalId,
        sourceData: exercise.sourceData,
      })),
    );
    const setValues = insertedSnapshots.flatMap((snapshot) =>
      snapshot.exercises.flatMap((exercise) =>
        exercise.sets.map((set) => ({
          id: set.id,
          patientId,
          workoutClaimId: snapshot.id,
          workoutExerciseId: exercise.id,
          orderIndex: set.orderIndex,
          setType: set.setType,
          status: set.status,
          weightValue: set.weightValue,
          weightUnit: set.weightUnit,
          repetitions: set.repetitions,
          durationSeconds: set.durationSeconds,
          distanceValue: set.distanceValue,
          distanceUnit: set.distanceUnit,
          rpe: set.rpe,
          rir: set.rir,
          notes: set.notes,
          originExternalId: set.originExternalId,
          sourceData: set.sourceData,
        })),
      ),
    );
    if (exerciseValues.length > 0) await tx.insert(workoutExercise).values(exerciseValues);
    if (setValues.length > 0) await tx.insert(workoutSet).values(setValues);
    if (insertedSnapshots.length > 0) {
      await tx.insert(claimRevision).values(
        insertedSnapshots.map((snapshot) =>
          claimRevisionValues('workout', snapshot, {
            kind: snapshot.originKind,
            provider: snapshot.originProvider,
          }),
        ),
      );
    }

    return insertResult(items.length, inserted.length);
  });
}

async function importRevisions(patientId: string, sourcePatientId: string, items: unknown[]) {
  const planned = await Promise.all(
    items.map(async (value) => {
      const row = asRecord(value, 'invalid_claim_revision');
      const claimKind = row.claimKind;
      if (claimKind !== 'medicine' && claimKind !== 'energy' && claimKind !== 'workout') {
        throw new ArchiveImportError('invalid_claim_revision');
      }

      const sourceClaimId = requiredText(row.claimId, 'invalid_claim_revision', 512);
      const revision = positiveRevision(row.revision, 'invalid_claim_revision');
      const snapshotRow = asRecord(row.snapshot, 'invalid_claim_revision');
      if (snapshotRow.id !== sourceClaimId || snapshotRow.revision !== revision) {
        throw new ArchiveImportError('invalid_claim_revision');
      }

      const workoutPlan = claimKind === 'workout'
        ? await planWorkout(snapshotRow, patientId, sourcePatientId)
        : null;
      const localClaimId = workoutPlan
        ? workoutPlan.snapshot.id
        : claimKind === 'energy'
          ? await resolveArchiveEnergyClaimId({
              patientId,
              sourcePatientId,
              sourceId: sourceClaimId,
              originProvider: optionalText(snapshotRow.originProvider, 'invalid_claim_revision', 300),
              originExternalId: optionalText(snapshotRow.originExternalId, 'invalid_claim_revision', 1000),
            })
          : await resolveArchiveEntityId(patientId, sourcePatientId, claimKind, sourceClaimId);
      const snapshot = workoutPlan
        ? workoutPlan.snapshot
        : claimKind === 'medicine'
          ? parseMedicine(snapshotRow, patientId, localClaimId)
          : parseEnergy(snapshotRow, patientId, localClaimId);

      return {
        patientId,
        claimKind,
        claimId: localClaimId,
        revision,
        snapshot,
        changedAt: validDateText(row.changedAt, 'invalid_claim_revision'),
        changeOriginKind: optionalText(row.changeOriginKind, 'invalid_claim_revision', 120) || 'manual',
        changeOriginProvider: optionalText(row.changeOriginProvider, 'invalid_claim_revision', 300),
      };
    }),
  );

  const medicineIds = [...new Set(planned.filter((row) => row.claimKind === 'medicine').map((row) => row.claimId))];
  const energyIds = [...new Set(planned.filter((row) => row.claimKind === 'energy').map((row) => row.claimId))];
  const workoutIds = [...new Set(planned.filter((row) => row.claimKind === 'workout').map((row) => row.claimId))];
  const [medicines, energyEntries, workoutEntries] = await Promise.all([
    medicineIds.length
      ? db
          .select({ id: medicineClaim.id })
          .from(medicineClaim)
          .where(and(eq(medicineClaim.patientId, patientId), inArray(medicineClaim.id, medicineIds)))
      : [],
    energyIds.length
      ? db
          .select({ id: energyClaim.id })
          .from(energyClaim)
          .where(and(eq(energyClaim.patientId, patientId), inArray(energyClaim.id, energyIds)))
      : [],
    workoutIds.length
      ? db
          .select({ id: workoutClaim.id })
          .from(workoutClaim)
          .where(and(eq(workoutClaim.patientId, patientId), inArray(workoutClaim.id, workoutIds)))
      : [],
  ]);
  const existingIds = new Set([...medicines, ...energyEntries, ...workoutEntries].map((row) => row.id));
  const eligible = planned.filter((row) => existingIds.has(row.claimId));

  const inserted = eligible.length
    ? await db.insert(claimRevision).values(eligible).onConflictDoNothing().returning({ id: claimRevision.id })
    : [];
  return insertResult(items.length, inserted.length, planned.length - eligible.length);
}

export async function importArchiveBatch(input: {
  patientId: string;
  sourcePatientId: string;
  kind: ArchiveEntityKind;
  items: unknown[];
}) {
  if (input.items.length === 0 || input.items.length > 250) {
    throw new ArchiveImportError(input.items.length > 250 ? 'batch_too_large' : 'invalid_batch');
  }

  if (!input.sourcePatientId || input.sourcePatientId.length > 512) {
    throw new ArchiveImportError('invalid_batch');
  }

  if (input.kind === 'profile') return importProfile(input.patientId, input.items);
  if (input.kind === 'reports') return importReports(input.patientId, input.sourcePatientId, input.items);
  if (input.kind === 'records') return importRecords(input.patientId, input.sourcePatientId, input.items);
  if (input.kind === 'medicines') return importMedicines(input.patientId, input.sourcePatientId, input.items);
  if (input.kind === 'energy') return importEnergy(input.patientId, input.sourcePatientId, input.items);
  if (input.kind === 'dataImports') {
    return importDataImports(input.patientId, input.sourcePatientId, input.items);
  }
  if (input.kind === 'exerciseDefinitions') {
    return importExerciseDefinitions(input.patientId, input.sourcePatientId, input.items);
  }
  if (input.kind === 'workouts') {
    return importWorkouts(input.patientId, input.sourcePatientId, input.items);
  }
  return importRevisions(input.patientId, input.sourcePatientId, input.items);
}
