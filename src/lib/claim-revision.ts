import type { EnergyClaimRecord } from '$lib/energy';
import type { MedicineClaimRecord } from '$lib/medicine';
import type {
  DoseOccurrenceRecord,
  DoseRegimenRecord,
  MedicineCourseRecord,
} from '$lib/medicine-plan';
import type { WorkoutRecord } from '$lib/workout';

export const claimKinds = [
  'medicine',
  'energy',
  'workout',
  'medicine_course',
  'dose_regimen',
  'dose_occurrence',
] as const;

export type ClaimKind = (typeof claimKinds)[number];
export type ClaimRevisionSnapshot =
  | MedicineClaimRecord
  | EnergyClaimRecord
  | WorkoutRecord
  | MedicineCourseRecord
  | DoseRegimenRecord
  | DoseOccurrenceRecord;

interface ClaimRevisionBase {
  id: string;
  patientId: string;
  claimId: string;
  revision: number;
  changedAt: string;
  changeOriginKind: string;
  changeOriginProvider: string | null;
}

export type MedicineClaimRevisionRecord = ClaimRevisionBase & {
  claimKind: 'medicine';
  snapshot: MedicineClaimRecord;
};

export type EnergyClaimRevisionRecord = ClaimRevisionBase & {
  claimKind: 'energy';
  snapshot: EnergyClaimRecord;
};

export type WorkoutClaimRevisionRecord = ClaimRevisionBase & {
  claimKind: 'workout';
  snapshot: WorkoutRecord;
};

export type MedicineCourseRevisionRecord = ClaimRevisionBase & {
  claimKind: 'medicine_course';
  snapshot: MedicineCourseRecord;
};

export type DoseRegimenRevisionRecord = ClaimRevisionBase & {
  claimKind: 'dose_regimen';
  snapshot: DoseRegimenRecord;
};

export type DoseOccurrenceRevisionRecord = ClaimRevisionBase & {
  claimKind: 'dose_occurrence';
  snapshot: DoseOccurrenceRecord;
};

export type ClaimRevisionRecord =
  | MedicineClaimRevisionRecord
  | EnergyClaimRevisionRecord
  | WorkoutClaimRevisionRecord
  | MedicineCourseRevisionRecord
  | DoseRegimenRevisionRecord
  | DoseOccurrenceRevisionRecord;

const revisionMetadataFields = new Set([
  'id',
  'patientId',
  'revision',
  'createdAt',
  'updatedAt',
]);

export function isClaimKind(value: string): value is ClaimKind {
  return claimKinds.includes(value as ClaimKind);
}

export function changedClaimFields<T extends object>(current: T, previous: T | null) {
  if (!previous) return [];

  const currentRecord = current as Record<string, unknown>;
  const previousRecord = previous as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(currentRecord), ...Object.keys(previousRecord)])];

  return keys.filter((key) => {
    if (revisionMetadataFields.has(key)) return false;
    return !Object.is(currentRecord[key] ?? null, previousRecord[key] ?? null);
  });
}
