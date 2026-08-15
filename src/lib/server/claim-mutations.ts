import { and, eq } from 'drizzle-orm';
import { isEnergyDirection, isEnergyStatus, type EnergyClaimRecord } from '$lib/energy';
import { isMedicineStatus, type MedicineClaimRecord } from '$lib/medicine';
import { db } from '$lib/server/db';
import {
  claimRevision,
  energyClaim,
  energySource,
  medicineClaim,
} from '$lib/server/db/schema';
import type { EnergyInput } from '$lib/server/energy';
import type { MedicineInput } from '$lib/server/medicines';
import {
  claimRevisionValues,
  StaleClaimRevisionError,
  type ClaimRevisionSource,
} from '$lib/server/claim-revisions';

export interface ClaimOrigin extends ClaimRevisionSource {
  externalId?: string | null;
}

export function normalizeMedicineClaim(
  value: typeof medicineClaim.$inferSelect,
): MedicineClaimRecord {
  return {
    ...value,
    status: isMedicineStatus(value.status) ? value.status : 'active',
  };
}

export function normalizeEnergyClaim(
  value: typeof energyClaim.$inferSelect,
): EnergyClaimRecord {
  return {
    ...value,
    direction: isEnergyDirection(value.direction) ? value.direction : 'intake',
    status: isEnergyStatus(value.status) ? value.status : 'draft',
  };
}

function sameOrigin(
  claim: { originKind: string; originProvider: string | null; originExternalId: string | null },
  origin: ClaimOrigin,
) {
  return (
    claim.originKind === origin.kind &&
    claim.originProvider === origin.provider &&
    claim.originExternalId === (origin.externalId ?? null)
  );
}

export async function createMedicineClaim(options: {
  patientId: string;
  input: MedicineInput;
  origin: ClaimOrigin;
  id?: string;
  idempotent?: boolean;
}) {
  return db.transaction(async (tx) => {
    const values = {
      ...(options.id ? { id: options.id } : {}),
      patientId: options.patientId,
      ...options.input,
      originKind: options.origin.kind,
      originProvider: options.origin.provider,
      originExternalId: options.origin.externalId ?? null,
    };
    const inserted = options.id && options.idempotent
      ? await tx.insert(medicineClaim).values(values).onConflictDoNothing().returning()
      : await tx.insert(medicineClaim).values(values).returning();

    if (!inserted[0]) {
      const existing = await tx
        .select()
        .from(medicineClaim)
        .where(
          and(
            eq(medicineClaim.id, options.id as string),
            eq(medicineClaim.patientId, options.patientId),
          ),
        )
        .limit(1);

      if (!existing[0] || !sameOrigin(existing[0], options.origin)) {
        throw new Error('Claim identifier collision');
      }

      return { claim: normalizeMedicineClaim(existing[0]), created: false };
    }

    const snapshot = normalizeMedicineClaim(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine', snapshot, options.origin));

    return { claim: snapshot, created: true };
  });
}

export async function updateMedicineClaim(options: {
  current: typeof medicineClaim.$inferSelect;
  input: MedicineInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
  changedAt?: string;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    const currentSnapshot = normalizeMedicineClaim(options.current);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine', currentSnapshot, options.source))
      .onConflictDoNothing();

    const updated = await tx
      .update(medicineClaim)
      .set({
        ...options.input,
        revision: options.expectedRevision + 1,
        updatedAt: options.changedAt ?? new Date().toISOString(),
      })
      .where(
        and(
          eq(medicineClaim.id, options.current.id),
          eq(medicineClaim.patientId, options.current.patientId),
          eq(medicineClaim.revision, options.expectedRevision),
        ),
      )
      .returning();

    if (!updated[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeMedicineClaim(updated[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('medicine', snapshot, options.source));

    return snapshot;
  });
}

export async function createEnergyClaim(options: {
  patientId: string;
  input: EnergyInput;
  origin: ClaimOrigin;
  id?: string;
  idempotent?: boolean;
  source?: typeof energySource.$inferInsert | null;
}) {
  return db.transaction(async (tx) => {
    const values = {
      ...(options.id ? { id: options.id } : {}),
      patientId: options.patientId,
      ...options.input,
      originKind: options.origin.kind,
      originProvider: options.origin.provider,
      originExternalId: options.origin.externalId ?? null,
    };
    const inserted = options.id && options.idempotent
      ? await tx.insert(energyClaim).values(values).onConflictDoNothing().returning()
      : await tx.insert(energyClaim).values(values).returning();

    if (!inserted[0]) {
      const existing = await tx
        .select()
        .from(energyClaim)
        .where(
          and(
            eq(energyClaim.id, options.id as string),
            eq(energyClaim.patientId, options.patientId),
          ),
        )
        .limit(1);

      if (!existing[0] || !sameOrigin(existing[0], options.origin)) {
        throw new Error('Claim identifier collision');
      }

      return { claim: normalizeEnergyClaim(existing[0]), created: false };
    }

    const snapshot = normalizeEnergyClaim(inserted[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('energy', snapshot, options.origin));

    if (options.source) await tx.insert(energySource).values(options.source);

    return { claim: snapshot, created: true };
  });
}

export async function updateEnergyClaim(options: {
  current: typeof energyClaim.$inferSelect;
  input: EnergyInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
  changedAt?: string;
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    const currentSnapshot = normalizeEnergyClaim(options.current);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('energy', currentSnapshot, options.source))
      .onConflictDoNothing();

    const updated = await tx
      .update(energyClaim)
      .set({
        ...options.input,
        revision: options.expectedRevision + 1,
        updatedAt: options.changedAt ?? new Date().toISOString(),
      })
      .where(
        and(
          eq(energyClaim.id, options.current.id),
          eq(energyClaim.patientId, options.current.patientId),
          eq(energyClaim.revision, options.expectedRevision),
        ),
      )
      .returning();

    if (!updated[0]) throw new StaleClaimRevisionError();

    const snapshot = normalizeEnergyClaim(updated[0]);
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('energy', snapshot, options.source));

    return snapshot;
  });
}
