import { and, asc, eq } from 'drizzle-orm';
import type { ClaimRevisionSource } from '$lib/server/claim-revisions';
import { claimRevisionValues, StaleClaimRevisionError } from '$lib/server/claim-revisions';
import { db } from '$lib/server/db';
import {
  claimRevision,
  exerciseDefinition,
  workoutClaim,
  workoutExercise,
  workoutSet,
} from '$lib/server/db/schema';
import type { WorkoutInput, WorkoutExerciseInput } from '$lib/server/workouts';
import { buildWorkoutRecords } from '$lib/server/workouts';
import { exerciseDefinitionKey, type WorkoutRecord } from '$lib/workout';

export interface WorkoutOrigin extends ClaimRevisionSource {
  externalId?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  sourceData?: unknown;
}

export class InvalidWorkoutReferenceError extends Error {
  constructor(public readonly code: 'exercise_definition' | 'plan') {
    super(code);
    this.name = 'InvalidWorkoutReferenceError';
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function rootValues(input: WorkoutInput) {
  return {
    kind: input.kind,
    title: input.title,
    status: input.status,
    basedOnWorkoutId: input.basedOnWorkoutId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    localDate: input.localDate,
    timezone: input.timezone,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    endedTimezoneOffsetMinutes: input.endedTimezoneOffsetMinutes,
    notes: input.notes,
  };
}

async function validatePlanReference(
  tx: Transaction,
  patientId: string,
  basedOnWorkoutId: string | null,
) {
  if (!basedOnWorkoutId) return;

  const rows = await tx
    .select({ id: workoutClaim.id })
    .from(workoutClaim)
    .where(
      and(
        eq(workoutClaim.id, basedOnWorkoutId),
        eq(workoutClaim.patientId, patientId),
        eq(workoutClaim.kind, 'plan'),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new InvalidWorkoutReferenceError('plan');
}

async function resolveExerciseDefinition(
  tx: Transaction,
  patientId: string,
  exercise: WorkoutExerciseInput,
  origin: WorkoutOrigin,
) {
  const normalizedKey = exerciseDefinitionKey(exercise.name, exercise.equipment);
  if (exercise.exerciseDefinitionId) {
    const rows = await tx
      .select({ id: exerciseDefinition.id, normalizedKey: exerciseDefinition.normalizedKey })
      .from(exerciseDefinition)
      .where(
        and(
          eq(exerciseDefinition.id, exercise.exerciseDefinitionId),
          eq(exerciseDefinition.patientId, patientId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new InvalidWorkoutReferenceError('exercise_definition');
    if (rows[0].normalizedKey === normalizedKey) return rows[0].id;
  }

  const id = crypto.randomUUID();
  await tx
    .insert(exerciseDefinition)
    .values({
      id,
      patientId,
      name: exercise.name,
      normalizedKey,
      category: exercise.category,
      equipment: exercise.equipment,
      notes: exercise.notes,
      originKind: origin.kind,
      originProvider: origin.provider,
      originExternalId: null,
      sourceData: null,
    })
    .onConflictDoNothing();

  const rows = await tx
    .select({ id: exerciseDefinition.id })
    .from(exerciseDefinition)
    .where(
      and(
        eq(exerciseDefinition.patientId, patientId),
        eq(exerciseDefinition.normalizedKey, normalizedKey),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new InvalidWorkoutReferenceError('exercise_definition');
  return rows[0].id;
}

async function insertWorkoutStructure(options: {
  tx: Transaction;
  patientId: string;
  workoutId: string;
  exercises: WorkoutExerciseInput[];
  origin: WorkoutOrigin;
  allowedExerciseIds?: Set<string>;
  allowedSetIds?: Set<string>;
}) {
  const exerciseRows: Array<typeof workoutExercise.$inferSelect> = [];
  const setRows: Array<typeof workoutSet.$inferSelect> = [];

  for (const [exerciseIndex, exercise] of options.exercises.entries()) {
    const definitionId = await resolveExerciseDefinition(
      options.tx,
      options.patientId,
      exercise,
      options.origin,
    );
    const exerciseId =
      exercise.id && options.allowedExerciseIds?.has(exercise.id)
        ? exercise.id
        : crypto.randomUUID();
    const insertedExercise = await options.tx
      .insert(workoutExercise)
      .values({
        id: exerciseId,
        patientId: options.patientId,
        workoutClaimId: options.workoutId,
        exerciseDefinitionId: definitionId,
        orderIndex: exerciseIndex,
        name: exercise.name,
        category: exercise.category,
        equipment: exercise.equipment,
        notes: exercise.notes,
        restSeconds: exercise.restSeconds,
        supersetGroup: exercise.supersetGroup,
        originExternalId: null,
        sourceData: null,
      })
      .returning();
    exerciseRows.push(insertedExercise[0]);

    for (const [setIndex, set] of exercise.sets.entries()) {
      const setId = set.id && options.allowedSetIds?.has(set.id) ? set.id : crypto.randomUUID();
      const insertedSet = await options.tx
        .insert(workoutSet)
        .values({
          id: setId,
          patientId: options.patientId,
          workoutClaimId: options.workoutId,
          workoutExerciseId: exerciseId,
          orderIndex: setIndex,
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
          originExternalId: null,
          sourceData: null,
        })
        .returning();
      setRows.push(insertedSet[0]);
    }
  }

  return { exerciseRows, setRows };
}

export async function getWorkoutRecord(patientId: string, workoutId: string) {
  const claims = await db
    .select()
    .from(workoutClaim)
    .where(and(eq(workoutClaim.id, workoutId), eq(workoutClaim.patientId, patientId)))
    .limit(1);
  if (!claims[0]) return null;

  const [exerciseRows, setRows] = await Promise.all([
    db
      .select()
      .from(workoutExercise)
      .where(
        and(
          eq(workoutExercise.workoutClaimId, workoutId),
          eq(workoutExercise.patientId, patientId),
        ),
      )
      .orderBy(asc(workoutExercise.orderIndex)),
    db
      .select()
      .from(workoutSet)
      .where(
        and(eq(workoutSet.workoutClaimId, workoutId), eq(workoutSet.patientId, patientId)),
      )
      .orderBy(asc(workoutSet.orderIndex)),
  ]);

  return buildWorkoutRecords(claims, exerciseRows, setRows)[0] || null;
}

export async function createWorkoutClaim(options: {
  patientId: string;
  input: WorkoutInput;
  origin: WorkoutOrigin;
  id?: string;
}) {
  return db.transaction(async (tx) => {
    await validatePlanReference(tx, options.patientId, options.input.basedOnWorkoutId);
    const rootRows = await tx
      .insert(workoutClaim)
      .values({
        ...(options.id ? { id: options.id } : {}),
        patientId: options.patientId,
        ...rootValues(options.input),
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
        sourceCreatedAt: options.origin.sourceCreatedAt ?? null,
        sourceUpdatedAt: options.origin.sourceUpdatedAt ?? null,
        sourceData: options.origin.sourceData ?? null,
      })
      .returning();
    const root = rootRows[0];
    const structure = await insertWorkoutStructure({
      tx,
      patientId: options.patientId,
      workoutId: root.id,
      exercises: options.input.exercises,
      origin: options.origin,
    });
    const snapshot = buildWorkoutRecords([root], structure.exerciseRows, structure.setRows)[0];
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('workout', snapshot, options.origin));

    return snapshot;
  });
}

export async function updateWorkoutClaim(options: {
  current: WorkoutRecord;
  input: WorkoutInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
  changedAt?: string;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    await validatePlanReference(tx, options.current.patientId, options.input.basedOnWorkoutId);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('workout', options.current, options.source))
      .onConflictDoNothing();

    const updatedRows = await tx
      .update(workoutClaim)
      .set({
        ...rootValues(options.input),
        revision: options.expectedRevision + 1,
        updatedAt: options.changedAt ?? new Date().toISOString(),
      })
      .where(
        and(
          eq(workoutClaim.id, options.current.id),
          eq(workoutClaim.patientId, options.current.patientId),
          eq(workoutClaim.revision, options.expectedRevision),
        ),
      )
      .returning();
    if (!updatedRows[0]) throw new StaleClaimRevisionError();

    await tx
      .delete(workoutExercise)
      .where(
        and(
          eq(workoutExercise.workoutClaimId, options.current.id),
          eq(workoutExercise.patientId, options.current.patientId),
        ),
      );

    const structure = await insertWorkoutStructure({
      tx,
      patientId: options.current.patientId,
      workoutId: options.current.id,
      exercises: options.input.exercises,
      origin: options.source,
      allowedExerciseIds: new Set(options.current.exercises.map((exercise) => exercise.id)),
      allowedSetIds: new Set(
        options.current.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)),
      ),
    });
    const snapshot = buildWorkoutRecords(
      [updatedRows[0]],
      structure.exerciseRows,
      structure.setRows,
    )[0];
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('workout', snapshot, options.source));

    return snapshot;
  });
}
