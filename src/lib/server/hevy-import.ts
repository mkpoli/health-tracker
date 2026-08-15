import { and, eq, inArray } from 'drizzle-orm';
import { attachmentContentDisposition } from '$lib/content-disposition';
import { sha256Hex } from '$lib/archive-format';
import type { DataImportRecord } from '$lib/data-import';
import {
  HevyCsvError,
  parseHevyCsv,
  readHevyCsvFile,
  type HevyCsvIssue,
  type HevyCsvParseResult,
  type HevyCsvSummary,
  type HevyCsvWorkout,
} from '$lib/hevy-csv';
import { claimRevisionValues } from '$lib/server/claim-revisions';
import { normalizeDataImport } from '$lib/server/data-imports';
import { db } from '$lib/server/db';
import {
  claimRevision,
  dataImport,
  exerciseDefinition,
  workoutClaim,
  workoutExercise,
  workoutSet,
} from '$lib/server/db/schema';
import { buildWorkoutRecords } from '$lib/server/workouts';
import {
  exerciseDefinitionKey,
  type WorkoutExerciseRecord,
  type WorkoutRecord,
  type WorkoutSetRecord,
} from '$lib/workout';

export const HEVY_IMPORT_PROVIDER = 'hevy';
export const HEVY_IMPORT_FORMAT = 'hevy-csv-v1';

const SOURCE_SCHEMA = 'hevy-csv/v1';
const SUMMARY_SCHEMA = 'hevy-csv-import-summary/v1';
const SELECT_CHUNK = 250;
const INSERT_CHUNK = 250;
const INSERT_CHUNK_BYTES = 1024 * 1024;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type HevyImportErrorCode =
  | 'import_failed'
  | 'invalid_file'
  | 'invalid_rows'
  | 'source_storage_unavailable'
  | 'source_store_failed'
  | 'stale_workout';

export class HevyImportError extends Error {
  constructor(
    public readonly code: HevyImportErrorCode,
    public readonly preview: HevyCsvParseResult | null = null,
  ) {
    super(code);
    this.name = 'HevyImportError';
  }
}

export interface HevyImportCounts {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
}

export interface HevyImportSummary {
  schema: typeof SUMMARY_SCHEMA;
  parsed: HevyCsvSummary;
  result: HevyImportCounts;
  warnings: Record<string, number>;
}

export interface HevyImportResult {
  source: DataImportRecord;
  summary: HevyImportSummary;
  repeated: boolean;
}

export interface PreparedHevyExercise {
  definitionKey: string;
  definitionExternalId: string;
  externalId: string;
  name: string;
  notes: string | null;
  supersetGroup: string | null;
  sourceRows: number[];
  sets: Array<HevyCsvWorkout['exercises'][number]['sets'][number] & { externalId: string }>;
}

export interface PreparedHevyWorkout {
  externalId: string;
  fingerprint: string;
  workout: HevyCsvWorkout;
  exercises: PreparedHevyExercise[];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function insertChunks<T>(values: T[]) {
  const result: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const value of values) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (
      current.length > 0 &&
      (current.length >= INSERT_CHUNK || currentBytes + bytes > INSERT_CHUNK_BYTES)
    ) {
      result.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(value);
    currentBytes += bytes;
  }
  if (current.length > 0) result.push(current);
  return result;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function hashText(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

function identityName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function fingerprintValue(workout: HevyCsvWorkout) {
  return {
    title: workout.title,
    description: workout.description,
    startLocal: workout.startLocal,
    endLocal: workout.endLocal,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    timezone: workout.timezone,
    timezoneOffsetMinutes: workout.timezoneOffsetMinutes,
    endedTimezoneOffsetMinutes: workout.endedTimezoneOffsetMinutes,
    exercises: workout.exercises.map((exercise) => ({
      name: exercise.name,
      notes: exercise.notes,
      supersetGroup: exercise.supersetGroup,
      sets: exercise.sets.map((set) => ({
        sourceSetIndex: set.sourceSetIndex,
        setType: set.setType,
        weightValue: set.weightValue,
        weightUnit: set.weightUnit,
        repetitions: set.repetitions,
        durationSeconds: set.durationSeconds,
        distanceValue: set.distanceValue,
        distanceUnit: set.distanceUnit,
        rpe: set.rpe,
        raw: set.raw,
      })),
    })),
  };
}

export async function prepareHevyWorkouts(workouts: HevyCsvWorkout[]) {
  return Promise.all(
    workouts.map(async (workout) => {
      const externalId = `csv-workout:${await hashText(JSON.stringify([
        SOURCE_SCHEMA,
        workout.startLocal,
        identityName(workout.title),
      ]))}`;
      const fingerprint = await hashText(JSON.stringify(fingerprintValue(workout)));
      const definitionKeys = workout.exercises.map((exercise) =>
        exerciseDefinitionKey(exercise.name, null),
      );
      const definitionExternalIds = await Promise.all(
        definitionKeys.map(async (key) => `csv-exercise:${await hashText(key)}`),
      );

      return {
        externalId,
        fingerprint,
        workout,
        exercises: workout.exercises.map((exercise, exerciseIndex) => ({
          definitionKey: definitionKeys[exerciseIndex],
          definitionExternalId: definitionExternalIds[exerciseIndex],
          externalId: `${externalId}:exercise:${exerciseIndex}`,
          name: exercise.name,
          notes: exercise.notes,
          supersetGroup: exercise.supersetGroup,
          sourceRows: exercise.sourceRows,
          sets: exercise.sets.map((set, setIndex) => ({
            ...set,
            externalId: `${externalId}:exercise:${exerciseIndex}:set:${setIndex}`,
          })),
        })),
      } satisfies PreparedHevyWorkout;
    }),
  );
}

function warningCounts(issues: HevyCsvIssue[]) {
  const counts: Record<string, number> = {};
  for (const item of issues) {
    if (item.severity !== 'warning') continue;
    counts[item.code] = (counts[item.code] || 0) + 1;
  }
  return counts;
}

function emptySummary(parsed: HevyCsvSummary): HevyImportSummary {
  return {
    schema: SUMMARY_SCHEMA,
    parsed,
    result: { created: 0, updated: 0, unchanged: 0, conflicts: 0 },
    warnings: {},
  };
}

function storedSummary(value: unknown, parsed: HevyCsvSummary): HevyImportSummary {
  const row = plainRecord(value);
  const result = plainRecord(row?.result);
  if (row?.schema !== SUMMARY_SCHEMA || !result) return emptySummary(parsed);
  const count = (key: string) => {
    const value = result[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  return {
    schema: SUMMARY_SCHEMA,
    parsed: plainRecord(row.parsed) as unknown as HevyCsvSummary || parsed,
    result: {
      created: count('created'),
      updated: count('updated'),
      unchanged: count('unchanged'),
      conflicts: count('conflicts'),
    },
    warnings: (plainRecord(row.warnings) as Record<string, number> | null) || {},
  };
}

function importMetadata(value: unknown) {
  const row = plainRecord(value);
  if (
    row?.schema !== SOURCE_SCHEMA ||
    typeof row.sourceFingerprint !== 'string' ||
    !Number.isSafeInteger(row.importedRevision) ||
    Number(row.importedRevision) < 1
  ) {
    return null;
  }
  return {
    sourceFingerprint: row.sourceFingerprint,
    importedRevision: Number(row.importedRevision),
  };
}

function rootSourceData(
  prepared: PreparedHevyWorkout,
  importId: string,
  fileSha256: string,
  importedRevision: number,
) {
  return {
    schema: SOURCE_SCHEMA,
    importId,
    fileSha256,
    sourceFingerprint: prepared.fingerprint,
    importedRevision,
    sourceRows: prepared.workout.sourceRows,
    source: {
      title: prepared.workout.title,
      startLocal: prepared.workout.startLocal,
      endLocal: prepared.workout.endLocal,
      description: prepared.workout.description,
    },
  };
}

function buildSnapshot(options: {
  prepared: PreparedHevyWorkout;
  patientId: string;
  workoutId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  importId: string;
  fileSha256: string;
  definitionIds: Map<string, string>;
}) {
  const exerciseValues: Array<typeof workoutExercise.$inferInsert> = [];
  const setValues: Array<typeof workoutSet.$inferInsert> = [];
  const exercises: WorkoutExerciseRecord[] = [];

  for (const [exerciseIndex, exercise] of options.prepared.exercises.entries()) {
    const exerciseId = crypto.randomUUID();
    const definitionId = options.definitionIds.get(exercise.definitionKey) || null;
    const exerciseSource = {
      schema: SOURCE_SCHEMA,
      importId: options.importId,
      sourceRows: exercise.sourceRows,
      source: {
        exerciseTitle: exercise.name,
        exerciseNotes: exercise.notes,
        supersetId: exercise.supersetGroup,
      },
    };
    exerciseValues.push({
      id: exerciseId,
      patientId: options.patientId,
      workoutClaimId: options.workoutId,
      exerciseDefinitionId: definitionId,
      orderIndex: exerciseIndex,
      name: exercise.name,
      category: null,
      equipment: null,
      notes: exercise.notes,
      restSeconds: null,
      supersetGroup: exercise.supersetGroup,
      originExternalId: exercise.externalId,
      sourceData: exerciseSource,
    });

    const sets: WorkoutSetRecord[] = [];
    for (const [setIndex, set] of exercise.sets.entries()) {
      const setId = crypto.randomUUID();
      const setSource = {
        schema: SOURCE_SCHEMA,
        importId: options.importId,
        sourceRow: set.sourceRow,
        sourceSetIndex: set.sourceSetIndex,
        raw: set.raw,
      };
      setValues.push({
        id: setId,
        patientId: options.patientId,
        workoutClaimId: options.workoutId,
        workoutExerciseId: exerciseId,
        orderIndex: setIndex,
        setType: set.setType,
        status: 'completed',
        weightValue: set.weightValue,
        weightUnit: set.weightUnit,
        repetitions: set.repetitions,
        durationSeconds: set.durationSeconds,
        distanceValue: set.distanceValue,
        distanceUnit: set.distanceUnit,
        rpe: set.rpe,
        rir: null,
        notes: null,
        originExternalId: set.externalId,
        sourceData: setSource,
      });
      sets.push({
        id: setId,
        workoutExerciseId: exerciseId,
        orderIndex: setIndex,
        setType: set.setType,
        status: 'completed',
        weightValue: set.weightValue,
        weightUnit: set.weightUnit,
        repetitions: set.repetitions,
        durationSeconds: set.durationSeconds,
        distanceValue: set.distanceValue,
        distanceUnit: set.distanceUnit,
        rpe: set.rpe,
        rir: null,
        notes: null,
        originExternalId: set.externalId,
        sourceData: setSource,
      });
    }

    exercises.push({
      id: exerciseId,
      workoutId: options.workoutId,
      exerciseDefinitionId: definitionId,
      orderIndex: exerciseIndex,
      name: exercise.name,
      category: null,
      equipment: null,
      notes: exercise.notes,
      restSeconds: null,
      supersetGroup: exercise.supersetGroup,
      originExternalId: exercise.externalId,
      sourceData: exerciseSource,
      sets,
    });
  }

  const workout = options.prepared.workout;
  const snapshot: WorkoutRecord = {
    id: options.workoutId,
    patientId: options.patientId,
    kind: 'session',
    title: workout.title,
    status: 'completed',
    basedOnWorkoutId: null,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    localDate: workout.localDate,
    timezone: workout.timezone,
    timezoneOffsetMinutes: workout.timezoneOffsetMinutes,
    endedTimezoneOffsetMinutes: workout.endedTimezoneOffsetMinutes,
    notes: workout.description,
    originKind: 'import',
    originProvider: HEVY_IMPORT_PROVIDER,
    originExternalId: options.prepared.externalId,
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    sourceData: rootSourceData(
      options.prepared,
      options.importId,
      options.fileSha256,
      options.revision,
    ),
    revision: options.revision,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    exercises,
  };

  return { snapshot, exerciseValues, setValues };
}

async function selectExistingWorkouts(
  tx: Transaction,
  patientId: string,
  externalIds: string[],
) {
  const rows: Array<typeof workoutClaim.$inferSelect> = [];
  for (const values of chunks(externalIds, SELECT_CHUNK)) {
    rows.push(
      ...(await tx
        .select()
        .from(workoutClaim)
        .where(
          and(
            eq(workoutClaim.patientId, patientId),
            eq(workoutClaim.kind, 'session'),
            eq(workoutClaim.originProvider, HEVY_IMPORT_PROVIDER),
            inArray(workoutClaim.originExternalId, values),
          ),
        )),
    );
  }
  return rows;
}

async function selectWorkoutStructures(
  tx: Transaction,
  patientId: string,
  workoutIds: string[],
) {
  const exercises: Array<typeof workoutExercise.$inferSelect> = [];
  const sets: Array<typeof workoutSet.$inferSelect> = [];
  for (const values of chunks(workoutIds, SELECT_CHUNK)) {
    const [exerciseRows, setRows] = await Promise.all([
      tx
        .select()
        .from(workoutExercise)
        .where(
          and(
            eq(workoutExercise.patientId, patientId),
            inArray(workoutExercise.workoutClaimId, values),
          ),
        ),
      tx
        .select()
        .from(workoutSet)
        .where(
          and(eq(workoutSet.patientId, patientId), inArray(workoutSet.workoutClaimId, values)),
        ),
    ]);
    exercises.push(...exerciseRows);
    sets.push(...setRows);
  }
  return { exercises, sets };
}

async function definitionMap(
  tx: Transaction,
  patientId: string,
  prepared: PreparedHevyWorkout[],
  importId: string,
  now: string,
) {
  const requested = new Map<string, PreparedHevyExercise>();
  for (const workout of prepared) {
    for (const exercise of workout.exercises) {
      if (!requested.has(exercise.definitionKey)) requested.set(exercise.definitionKey, exercise);
    }
  }
  const keys = [...requested.keys()];
  const existing: Array<typeof exerciseDefinition.$inferSelect> = [];
  for (const values of chunks(keys, SELECT_CHUNK)) {
    existing.push(
      ...(await tx
        .select()
        .from(exerciseDefinition)
        .where(
          and(
            eq(exerciseDefinition.patientId, patientId),
            inArray(exerciseDefinition.normalizedKey, values),
          ),
        )),
    );
  }
  const existingKeys = new Set(existing.map((row) => row.normalizedKey));
  const missing = keys.flatMap((key) => {
    if (existingKeys.has(key)) return [];
    const exercise = requested.get(key)!;
    return [{
      id: crypto.randomUUID(),
      patientId,
      name: exercise.name,
      normalizedKey: key,
      category: null,
      equipment: null,
      notes: null,
      originKind: 'import',
      originProvider: HEVY_IMPORT_PROVIDER,
      originExternalId: exercise.definitionExternalId,
      sourceData: {
        schema: SOURCE_SCHEMA,
        importId,
        sourceName: exercise.name,
      },
      createdAt: now,
      updatedAt: now,
    } satisfies typeof exerciseDefinition.$inferInsert];
  });
  for (const values of insertChunks(missing)) {
    await tx.insert(exerciseDefinition).values(values).onConflictDoNothing();
  }

  const resolved: Array<typeof exerciseDefinition.$inferSelect> = [];
  for (const values of chunks(keys, SELECT_CHUNK)) {
    resolved.push(
      ...(await tx
        .select()
        .from(exerciseDefinition)
        .where(
          and(
            eq(exerciseDefinition.patientId, patientId),
            inArray(exerciseDefinition.normalizedKey, values),
          ),
        )),
    );
  }
  return new Map(resolved.map((row) => [row.normalizedKey, row.id]));
}

async function savePreparedWorkouts(options: {
  patientId: string;
  sourceId: string;
  fileSha256: string;
  prepared: PreparedHevyWorkout[];
  parsed: HevyCsvParseResult;
}) {
  return db.transaction(async (tx) => {
    const sourceRows = await tx
      .select()
      .from(dataImport)
      .where(
        and(eq(dataImport.id, options.sourceId), eq(dataImport.patientId, options.patientId)),
      )
      .limit(1);
    const source = sourceRows[0];
    if (!source) throw new HevyImportError('import_failed');
    if (source.status === 'completed') {
      return {
        summary: storedSummary(source.summaryData, options.parsed.summary),
        repeated: true,
      };
    }

    const existing = await selectExistingWorkouts(
      tx,
      options.patientId,
      options.prepared.map((workout) => workout.externalId),
    );
    const existingByExternalId = new Map(
      existing.flatMap((row) => (row.originExternalId ? [[row.originExternalId, row] as const] : [])),
    );
    const creates: PreparedHevyWorkout[] = [];
    const updates: Array<{ prepared: PreparedHevyWorkout; current: typeof workoutClaim.$inferSelect }> = [];
    let unchanged = 0;
    let conflicts = 0;

    for (const prepared of options.prepared) {
      const current = existingByExternalId.get(prepared.externalId);
      if (!current) {
        creates.push(prepared);
        continue;
      }
      const metadata = importMetadata(current.sourceData);
      if (!metadata || metadata.importedRevision !== current.revision) {
        conflicts += 1;
      } else if (metadata.sourceFingerprint === prepared.fingerprint) {
        unchanged += 1;
      } else {
        updates.push({ prepared, current });
      }
    }

    const now = new Date().toISOString();
    const definitions = await definitionMap(
      tx,
      options.patientId,
      [...creates, ...updates.map((item) => item.prepared)],
      options.sourceId,
      now,
    );
    const updateIds = updates.map((item) => item.current.id);
    const structures = updateIds.length
      ? await selectWorkoutStructures(tx, options.patientId, updateIds)
      : { exercises: [], sets: [] };
    const currentSnapshots = new Map(
      buildWorkoutRecords(
        updates.map((item) => item.current),
        structures.exercises,
        structures.sets,
      ).map((workout) => [workout.id, workout]),
    );

    for (const item of updates) {
      const previous = currentSnapshots.get(item.current.id);
      if (!previous) throw new HevyImportError('import_failed');
      await tx
        .insert(claimRevision)
        .values(claimRevisionValues('workout', previous, {
          kind: 'import',
          provider: HEVY_IMPORT_PROVIDER,
        }))
        .onConflictDoNothing();
    }
    for (const values of chunks(updateIds, SELECT_CHUNK)) {
      await tx
        .delete(workoutSet)
        .where(
          and(
            eq(workoutSet.patientId, options.patientId),
            inArray(workoutSet.workoutClaimId, values),
          ),
        );
      await tx
        .delete(workoutExercise)
        .where(
          and(
            eq(workoutExercise.patientId, options.patientId),
            inArray(workoutExercise.workoutClaimId, values),
          ),
        );
    }

    const rootCreates: Array<typeof workoutClaim.$inferInsert> = [];
    const snapshots: WorkoutRecord[] = [];
    const exerciseValues: Array<typeof workoutExercise.$inferInsert> = [];
    const setValues: Array<typeof workoutSet.$inferInsert> = [];

    for (const prepared of creates) {
      const workoutId = crypto.randomUUID();
      const built = buildSnapshot({
        prepared,
        patientId: options.patientId,
        workoutId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        importId: options.sourceId,
        fileSha256: options.fileSha256,
        definitionIds: definitions,
      });
      rootCreates.push({
        id: workoutId,
        patientId: options.patientId,
        kind: 'session',
        title: built.snapshot.title,
        status: 'completed',
        basedOnWorkoutId: null,
        startedAt: built.snapshot.startedAt,
        endedAt: built.snapshot.endedAt,
        localDate: built.snapshot.localDate,
        timezone: built.snapshot.timezone,
        timezoneOffsetMinutes: built.snapshot.timezoneOffsetMinutes,
        endedTimezoneOffsetMinutes: built.snapshot.endedTimezoneOffsetMinutes,
        notes: built.snapshot.notes,
        originKind: 'import',
        originProvider: HEVY_IMPORT_PROVIDER,
        originExternalId: prepared.externalId,
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        sourceData: built.snapshot.sourceData,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      snapshots.push(built.snapshot);
      exerciseValues.push(...built.exerciseValues);
      setValues.push(...built.setValues);
    }

    for (const item of updates) {
      const nextRevision = item.current.revision + 1;
      const built = buildSnapshot({
        prepared: item.prepared,
        patientId: options.patientId,
        workoutId: item.current.id,
        revision: nextRevision,
        createdAt: item.current.createdAt,
        updatedAt: now,
        importId: options.sourceId,
        fileSha256: options.fileSha256,
        definitionIds: definitions,
      });
      const changed = await tx
        .update(workoutClaim)
        .set({
          title: built.snapshot.title,
          status: 'completed',
          startedAt: built.snapshot.startedAt,
          endedAt: built.snapshot.endedAt,
          localDate: built.snapshot.localDate,
          timezone: built.snapshot.timezone,
          timezoneOffsetMinutes: built.snapshot.timezoneOffsetMinutes,
          endedTimezoneOffsetMinutes: built.snapshot.endedTimezoneOffsetMinutes,
          notes: built.snapshot.notes,
          sourceData: built.snapshot.sourceData,
          revision: nextRevision,
          updatedAt: now,
        })
        .where(
          and(
            eq(workoutClaim.id, item.current.id),
            eq(workoutClaim.patientId, options.patientId),
            eq(workoutClaim.revision, item.current.revision),
          ),
        )
        .returning({ id: workoutClaim.id });
      if (!changed[0]) throw new HevyImportError('stale_workout');
      snapshots.push(built.snapshot);
      exerciseValues.push(...built.exerciseValues);
      setValues.push(...built.setValues);
    }

    for (const values of insertChunks(rootCreates)) {
      await tx.insert(workoutClaim).values(values);
    }
    for (const values of insertChunks(exerciseValues)) {
      await tx.insert(workoutExercise).values(values);
    }
    for (const values of insertChunks(setValues)) {
      await tx.insert(workoutSet).values(values);
    }
    for (const values of insertChunks(
      snapshots.map((snapshot) =>
        claimRevisionValues('workout', snapshot, {
          kind: 'import',
          provider: HEVY_IMPORT_PROVIDER,
        }),
      ),
    )) {
      await tx.insert(claimRevision).values(values);
    }

    const summary: HevyImportSummary = {
      schema: SUMMARY_SCHEMA,
      parsed: options.parsed.summary,
      result: {
        created: creates.length,
        updated: updates.length,
        unchanged,
        conflicts,
      },
      warnings: warningCounts(options.parsed.issues),
    };
    await tx
      .update(dataImport)
      .set({ status: 'completed', summaryData: summary, errorCode: null, updatedAt: now })
      .where(
        and(eq(dataImport.id, options.sourceId), eq(dataImport.patientId, options.patientId)),
      );

    return { summary, repeated: false };
  });
}

function validFileName(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.length > 300 ||
    /[\0-\x1f\x7f]/.test(normalized) ||
    !normalized.toLowerCase().endsWith('.csv')
  ) {
    throw new HevyImportError('invalid_file');
  }
  return normalized;
}

async function sourceRow(options: {
  patientId: string;
  fileName: string;
  byteSize: number;
  fileSha256: string;
  timeZone: string;
}) {
  const id = crypto.randomUUID();
  const interpretationKey = `timezone:${options.timeZone}`;
  await db
    .insert(dataImport)
    .values({
      id,
      patientId: options.patientId,
      provider: HEVY_IMPORT_PROVIDER,
      format: HEVY_IMPORT_FORMAT,
      status: 'pending',
      fileName: options.fileName,
      mimeType: 'text/csv; charset=utf-8',
      byteSize: options.byteSize,
      contentSha256: options.fileSha256,
      interpretationKey,
      storageKey: `import-sources/${options.patientId}/${id}.csv`,
      timezone: options.timeZone,
    })
    .onConflictDoNothing();

  const rows = await db
    .select()
    .from(dataImport)
    .where(
      and(
        eq(dataImport.patientId, options.patientId),
        eq(dataImport.provider, HEVY_IMPORT_PROVIDER),
        eq(dataImport.format, HEVY_IMPORT_FORMAT),
        eq(dataImport.contentSha256, options.fileSha256),
        eq(dataImport.interpretationKey, interpretationKey),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new HevyImportError('import_failed');
  return rows[0];
}

export async function importHevyCsvFile(options: {
  patientId: string;
  file: File;
  timeZone: string;
  bucket?: R2Bucket | null;
}): Promise<HevyImportResult> {
  if (!options.bucket) throw new HevyImportError('source_storage_unavailable');
  const fileName = validFileName(options.file.name);
  const { bytes, text } = await readHevyCsvFile(options.file);
  const parsed = parseHevyCsv(text, options.timeZone);
  if (!parsed.canImport) throw new HevyImportError('invalid_rows', parsed);

  const fileSha256 = await sha256Hex(bytes);
  const source = await sourceRow({
    patientId: options.patientId,
    fileName,
    byteSize: bytes.byteLength,
    fileSha256,
    timeZone: options.timeZone,
  });
  const expectedStorageStatuses = source.status === 'completed'
    ? ['completed']
    : ['pending', 'failed'];
  try {
    const existingObject = await options.bucket.head(source.storageKey);
    const object = existingObject || await options.bucket.put(source.storageKey, bytes, {
      httpMetadata: {
        contentType: 'text/csv; charset=utf-8',
        contentDisposition: attachmentContentDisposition(fileName),
      },
      customMetadata: { sha256: fileSha256 },
    });
    await db
      .update(dataImport)
      .set({
        status: source.status === 'completed' ? 'completed' : 'pending',
        objectEtag: object.httpEtag || null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(dataImport.id, source.id),
          eq(dataImport.patientId, options.patientId),
          inArray(dataImport.status, expectedStorageStatuses),
        ),
      );
  } catch {
    await db
      .update(dataImport)
      .set({
        status: source.status === 'completed' ? 'completed' : 'failed',
        errorCode: 'source_store_failed',
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(dataImport.id, source.id),
          eq(dataImport.patientId, options.patientId),
          inArray(dataImport.status, expectedStorageStatuses),
        ),
      );
    throw new HevyImportError('source_store_failed');
  }

  if (source.status === 'completed') {
    const refreshed = await db
      .select()
      .from(dataImport)
      .where(and(eq(dataImport.id, source.id), eq(dataImport.patientId, options.patientId)))
      .limit(1);
    return {
      source: normalizeDataImport(refreshed[0] || source),
      summary: storedSummary(source.summaryData, parsed.summary),
      repeated: true,
    };
  }

  const prepared = await prepareHevyWorkouts(parsed.workouts);
  try {
    const saved = await savePreparedWorkouts({
      patientId: options.patientId,
      sourceId: source.id,
      fileSha256,
      prepared,
      parsed,
    });
    const storedRows = await db
      .select()
      .from(dataImport)
      .where(and(eq(dataImport.id, source.id), eq(dataImport.patientId, options.patientId)))
      .limit(1);
    if (!storedRows[0]) throw new HevyImportError('import_failed');
    return {
      source: normalizeDataImport(storedRows[0]),
      summary: saved.summary,
      repeated: saved.repeated,
    };
  } catch (error) {
    const code = error instanceof HevyImportError ? error.code : 'import_failed';
    await db
      .update(dataImport)
      .set({ status: 'failed', errorCode: code, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(dataImport.id, source.id),
          eq(dataImport.patientId, options.patientId),
          eq(dataImport.status, 'pending'),
        ),
      );
    if (error instanceof HevyImportError) throw error;
    throw new HevyImportError('import_failed');
  }
}

export function hevyCsvErrorCode(error: unknown) {
  if (error instanceof HevyImportError || error instanceof HevyCsvError) return error.code;
  return null;
}
