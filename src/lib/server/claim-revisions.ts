import type {
  ClaimKind,
  ClaimRevisionSnapshot,
  EnergyClaimRevisionRecord,
  MedicineClaimRevisionRecord,
} from '$lib/claim-revision';
import {
  isEnergyDirection,
  isEnergyStatus,
  type EnergyClaimRecord,
} from '$lib/energy';
import { isMedicineStatus, type MedicineClaimRecord } from '$lib/medicine';

export interface ClaimRevisionSource {
  kind: string;
  provider: string | null;
}

export class StaleClaimRevisionError extends Error {
  constructor() {
    super('The claim changed before this revision could be saved');
    this.name = 'StaleClaimRevisionError';
  }
}

export function parseExpectedClaimRevision(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;

  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
}

export function claimRevisionValues(
  claimKind: ClaimKind,
  snapshot: ClaimRevisionSnapshot,
  source: ClaimRevisionSource,
) {
  return {
    patientId: snapshot.patientId,
    claimKind,
    claimId: snapshot.id,
    revision: snapshot.revision,
    snapshot,
    changedAt: snapshot.updatedAt,
    changeOriginKind: source.kind,
    changeOriginProvider: source.provider,
  };
}

interface StoredClaimRevision {
  id: string;
  patientId: string;
  claimKind: string;
  claimId: string;
  revision: number;
  snapshot: unknown;
  changedAt: string;
  changeOriginKind: string;
  changeOriginProvider: string | null;
}

export function toMedicineClaimRevision(
  row: StoredClaimRevision,
): MedicineClaimRevisionRecord | null {
  if (row.claimKind !== 'medicine' || !isObject(row.snapshot)) return null;

  const snapshot = row.snapshot as unknown as MedicineClaimRecord;
  if (snapshot.id !== row.claimId || snapshot.patientId !== row.patientId) return null;

  return {
    ...row,
    claimKind: 'medicine',
    snapshot: {
      ...snapshot,
      status: isMedicineStatus(snapshot.status) ? snapshot.status : 'active',
    },
  };
}

export function toEnergyClaimRevision(
  row: StoredClaimRevision,
): EnergyClaimRevisionRecord | null {
  if (row.claimKind !== 'energy' || !isObject(row.snapshot)) return null;

  const snapshot = row.snapshot as unknown as EnergyClaimRecord;
  if (snapshot.id !== row.claimId || snapshot.patientId !== row.patientId) return null;

  return {
    ...row,
    claimKind: 'energy',
    snapshot: {
      ...snapshot,
      direction: isEnergyDirection(snapshot.direction) ? snapshot.direction : 'intake',
      status: isEnergyStatus(snapshot.status) ? snapshot.status : 'draft',
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
