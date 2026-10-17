import { and, eq, inArray } from 'drizzle-orm';
import {
  isEnergyDirection,
  isEnergyFoodDataSource,
  isEnergyStatus,
  type EnergyClaimRecord,
  type EnergyFoodItemRecord,
} from '$lib/energy';
import { isMedicineStatus, type MedicineClaimRecord } from '$lib/medicine';
import { db } from '$lib/server/db';
import {
  claimRevision,
  energyClaim,
  energyFoodItem,
  energySource,
  medicineClaim,
  medicineProduct,
} from '$lib/server/db/schema';
import { planFoodItemChanges, type EnergyFoodItemInput, type EnergyInput } from '$lib/server/energy';
import type { MedicineInput } from '$lib/server/medicines';
import {
  claimRevisionValues,
  StaleClaimRevisionError,
  type ClaimRevisionSource,
} from '$lib/server/claim-revisions';

export interface ClaimOrigin extends ClaimRevisionSource {
  externalId?: string | null;
}

export class InvalidMedicineReferenceError extends Error {
  constructor() {
    super('The medicine product is outside this profile');
    this.name = 'InvalidMedicineReferenceError';
  }
}

/** The handle a transaction body writes through. */
export type WriteTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function validateMedicineProduct(
  tx: WriteTx,
  patientId: string,
  productId: string | null | undefined,
) {
  if (!productId) return;
  const rows = await tx
    .select({ id: medicineProduct.id })
    .from(medicineProduct)
    .where(and(eq(medicineProduct.id, productId), eq(medicineProduct.patientId, patientId)))
    .limit(1);
  if (!rows[0]) throw new InvalidMedicineReferenceError();
}

/** Runs the body in the caller's transaction when one is given, else in its own. */
export function inTransaction<T>(tx: WriteTx | undefined, body: (tx: WriteTx) => Promise<T>) {
  return tx ? body(tx) : db.transaction(body);
}

export function normalizeMedicineClaim(
  value: typeof medicineClaim.$inferSelect,
): MedicineClaimRecord {
  return {
    ...value,
    productId: typeof value.productId === 'string' ? value.productId : null,
    status: isMedicineStatus(value.status) ? value.status : 'active',
  };
}

export function normalizeEnergyClaim(
  value: typeof energyClaim.$inferSelect,
  foodItems: EnergyFoodItemRecord[] = [],
): EnergyClaimRecord {
  return {
    ...value,
    direction: isEnergyDirection(value.direction) ? value.direction : 'intake',
    status: isEnergyStatus(value.status) ? value.status : 'draft',
    foodItems,
  };
}

export function normalizeEnergyFoodItem(
  value: typeof energyFoodItem.$inferSelect,
): EnergyFoodItemRecord {
  return {
    ...value,
    dataSource: isEnergyFoodDataSource(value.dataSource) ? value.dataSource : 'unknown',
    nutritionData:
      value.nutritionData && typeof value.nutritionData === 'object' && !Array.isArray(value.nutritionData)
        ? value.nutritionData
        : null,
  };
}

function foodItemValues(
  patientId: string,
  energyClaimId: string,
  items: EnergyFoodItemInput[],
) {
  return items.map(({ id: _id, nutritionData, originExternalId, ...item }, orderIndex) => ({
    patientId,
    energyClaimId,
    orderIndex,
    ...item,
    originExternalId: originExternalId ?? null,
    nutritionData: nutritionData ?? null,
  }));
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
  tx?: WriteTx;
}) {
  return inTransaction(options.tx, async (tx) => {
    await validateMedicineProduct(tx, options.patientId, options.input.productId);
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

export async function createEnergyClaim(options: {
  patientId: string;
  input: EnergyInput;
  origin: ClaimOrigin;
  id?: string;
  idempotent?: boolean;
  source?: typeof energySource.$inferInsert | null;
  foodItems?: EnergyFoodItemInput[];
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

      const existingItems = await tx
        .select()
        .from(energyFoodItem)
        .where(eq(energyFoodItem.energyClaimId, existing[0].id))
        .orderBy(energyFoodItem.orderIndex);

      return {
        claim: normalizeEnergyClaim(existing[0], existingItems.map(normalizeEnergyFoodItem)),
        created: false,
      };
    }

    let storedItems: typeof energyFoodItem.$inferSelect[] = [];
    if (options.foodItems?.length) {
      storedItems = await tx
        .insert(energyFoodItem)
        .values(foodItemValues(options.patientId, inserted[0].id, options.foodItems))
        .returning();
    }

    const snapshot = normalizeEnergyClaim(inserted[0], storedItems.map(normalizeEnergyFoodItem));
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
  foodItems?: EnergyFoodItemInput[];
}) {
  if (options.current.revision !== options.expectedRevision) {
    throw new StaleClaimRevisionError();
  }

  return db.transaction(async (tx) => {
    const currentItems = await tx
      .select()
      .from(energyFoodItem)
      .where(eq(energyFoodItem.energyClaimId, options.current.id))
      .orderBy(energyFoodItem.orderIndex);
    const currentSnapshot = normalizeEnergyClaim(
      options.current,
      currentItems.map(normalizeEnergyFoodItem),
    );
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

    let updatedItems = currentItems;
    const submitted = options.input.direction === 'intake' ? options.foodItems : [];
    if (submitted) {
      const normalizedCurrent = currentItems.map(normalizeEnergyFoodItem);
      const plan = planFoodItemChanges(normalizedCurrent, submitted);
      const now = options.changedAt ?? new Date().toISOString();
      if (plan.deletes.length) {
        await tx.delete(energyFoodItem).where(inArray(energyFoodItem.id, plan.deletes));
      }
      const moved = plan.updates.filter(
        (update) => normalizedCurrent.find((item) => item.id === update.id)?.orderIndex !== update.orderIndex,
      );
      for (const [index, update] of moved.entries()) {
        await tx.update(energyFoodItem).set({ orderIndex: -(index + 1) }).where(eq(energyFoodItem.id, update.id));
      }
      for (const update of plan.updates) {
        await tx
          .update(energyFoodItem)
          .set({ ...update.values, updatedAt: now })
          .where(eq(energyFoodItem.id, update.id));
      }
      if (plan.inserts.length) {
        await tx
          .insert(energyFoodItem)
          .values(
            plan.inserts.map(({ id: _id, nutritionData, originExternalId, ...item }) => ({
              patientId: options.current.patientId,
              energyClaimId: options.current.id,
              ...item,
              originExternalId: originExternalId ?? null,
              nutritionData: nutritionData ?? null,
            })),
          );
      }
      updatedItems = await tx
        .select()
        .from(energyFoodItem)
        .where(eq(energyFoodItem.energyClaimId, options.current.id))
        .orderBy(energyFoodItem.orderIndex);
    }

    const snapshot = normalizeEnergyClaim(updated[0], updatedItems.map(normalizeEnergyFoodItem));
    await tx
      .insert(claimRevision)
      .values(claimRevisionValues('energy', snapshot, options.source));

    return snapshot;
  });
}
