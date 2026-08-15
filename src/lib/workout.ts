export const workoutKinds = ['session', 'plan'] as const;
export const workoutSessionStatuses = ['completed', 'draft', 'excluded'] as const;
export const workoutPlanStatuses = ['active', 'archived'] as const;
export const workoutSetTypes = [
  'normal',
  'warmup',
  'drop',
  'failure',
  'superset',
  'rest_pause',
  'other',
] as const;
export const workoutSetStatuses = ['completed', 'planned', 'skipped', 'failed', 'unknown'] as const;

export type WorkoutKind = (typeof workoutKinds)[number];
export type WorkoutSessionStatus = (typeof workoutSessionStatuses)[number];
export type WorkoutPlanStatus = (typeof workoutPlanStatuses)[number];
export type WorkoutStatus = WorkoutSessionStatus | WorkoutPlanStatus;
export type WorkoutSetType = (typeof workoutSetTypes)[number];
export type WorkoutSetStatus = (typeof workoutSetStatuses)[number];

export interface ExerciseDefinitionRecord {
  id: string;
  patientId: string;
  name: string;
  category: string | null;
  equipment: string | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  sourceData: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutSetRecord {
  id: string;
  workoutExerciseId: string;
  orderIndex: number;
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
  originExternalId: string | null;
  sourceData: unknown;
}

export interface WorkoutExerciseRecord {
  id: string;
  workoutId: string;
  exerciseDefinitionId: string | null;
  orderIndex: number;
  name: string;
  category: string | null;
  equipment: string | null;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  originExternalId: string | null;
  sourceData: unknown;
  sets: WorkoutSetRecord[];
}

export interface WorkoutRecord {
  id: string;
  patientId: string;
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
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceData: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
  exercises: WorkoutExerciseRecord[];
}

export function isWorkoutKind(value: string): value is WorkoutKind {
  return workoutKinds.includes(value as WorkoutKind);
}

export function isWorkoutSessionStatus(value: string): value is WorkoutSessionStatus {
  return workoutSessionStatuses.includes(value as WorkoutSessionStatus);
}

export function isWorkoutPlanStatus(value: string): value is WorkoutPlanStatus {
  return workoutPlanStatuses.includes(value as WorkoutPlanStatus);
}

export function isWorkoutStatus(kind: WorkoutKind, value: string): value is WorkoutStatus {
  return kind === 'session' ? isWorkoutSessionStatus(value) : isWorkoutPlanStatus(value);
}

export function isWorkoutSetType(value: string): value is WorkoutSetType {
  return workoutSetTypes.includes(value as WorkoutSetType);
}

export function isWorkoutSetStatus(value: string): value is WorkoutSetStatus {
  return workoutSetStatuses.includes(value as WorkoutSetStatus);
}

export function exerciseDefinitionKey(name: string, equipment: string | null) {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

  return JSON.stringify([normalize(name), equipment ? normalize(equipment) : '']);
}
