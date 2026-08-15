import type { EnergyClaimRecord } from '$lib/energy';
import type { MedicineClaimRecord } from '$lib/medicine';
import type { WorkoutRecord } from '$lib/workout';

export const claimKinds = ['medicine', 'energy', 'workout'] as const;

export type ClaimKind = (typeof claimKinds)[number];
export type ClaimRevisionSnapshot = MedicineClaimRecord | EnergyClaimRecord | WorkoutRecord;

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

export type ClaimRevisionRecord =
  | MedicineClaimRevisionRecord
  | EnergyClaimRevisionRecord
  | WorkoutClaimRevisionRecord;

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
