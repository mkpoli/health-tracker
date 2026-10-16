import { and, eq, inArray } from 'drizzle-orm';
import type {
  MedicineCatalogEntityKind,
  MedicineCatalogRevisionSnapshot,
  MedicineIngredientRecord,
  MedicineProductRecord,
} from '$lib/medicine-catalog';
import { db } from '$lib/server/db';
import {
  claimRevision,
  medicineCatalogIdentifier,
  medicineCatalogName,
  medicineCatalogRevision,
  medicineClaim,
  medicineIngredient,
  medicineProduct,
  medicineProductIngredient,
} from '$lib/server/db/schema';
import type {
  MedicineCatalogIdentifierInput,
  MedicineCatalogNameInput,
  MedicineIngredientInput,
  MedicineProductIngredientInput,
  MedicineProductInput,
} from '$lib/server/medicine-catalog';
import {
  buildMedicineIngredientRecords,
  buildMedicineProductRecords,
} from '$lib/server/medicine-catalog-records';
import { normalizedMedicineCatalogName } from '$lib/medicine-catalog';
import {
  claimRevisionValues,
  StaleClaimRevisionError,
  type ClaimRevisionSource,
} from '$lib/server/claim-revisions';
import { normalizeMedicineClaim } from '$lib/server/claim-mutations';

export interface MedicineCatalogOrigin extends ClaimRevisionSource {
  externalId?: string | null;
  sourceData?: unknown;
}

export class InvalidMedicineCatalogReferenceError extends Error {
  constructor(public readonly code: 'ingredient' | 'name_id' | 'identifier_id' | 'component_id') {
    super(code);
    this.name = 'InvalidMedicineCatalogReferenceError';
  }
}

export class MedicineCatalogIngredientInUseError extends Error {
  constructor() {
    super('ingredient_in_use');
    this.name = 'MedicineCatalogIngredientInUseError';
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MedicineCatalogIdentifierCollisionError extends Error {
  constructor() {
    super('Medicine catalog identifier collision');
  }
}

function checkOrigin<T extends typeof medicineIngredient.$inferSelect | typeof medicineProduct.$inferSelect>(
  root: T | undefined,
  origin: MedicineCatalogOrigin,
) {
  if (
    !root ||
    root.originKind !== origin.kind ||
    root.originProvider !== origin.provider ||
    root.originExternalId !== (origin.externalId ?? null)
  ) {
    throw new MedicineCatalogIdentifierCollisionError();
  }
  return root;
}

function revisionValues(
  entityKind: MedicineCatalogEntityKind,
  snapshot: MedicineCatalogRevisionSnapshot,
  source: ClaimRevisionSource,
) {
  return {
    patientId: snapshot.patientId,
    entityKind,
    entityId: snapshot.id,
    revision: snapshot.revision,
    snapshot,
    changedAt: snapshot.updatedAt,
    changeOriginKind: source.kind,
    changeOriginProvider: source.provider,
  };
}

function childId(
  id: string | null,
  allowedIds: Set<string> | undefined,
  field: 'name_id' | 'identifier_id' | 'component_id',
) {
  if (id && !allowedIds?.has(id)) throw new InvalidMedicineCatalogReferenceError(field);
  return id ?? crypto.randomUUID();
}

function nameValues(options: {
  patientId: string;
  ingredientId?: string | null;
  productId?: string | null;
  values: MedicineCatalogNameInput[];
  allowedIds?: Set<string>;
}) {
  return options.values.map((value, orderIndex) => ({
    id: childId(value.id, options.allowedIds, 'name_id'),
    patientId: options.patientId,
    ingredientId: options.ingredientId ?? null,
    productId: options.productId ?? null,
    orderIndex,
    name: value.name,
    normalizedName: normalizedMedicineCatalogName(value.name),
    languageTag: value.languageTag,
    nameType: value.nameType,
    jurisdiction: value.jurisdiction,
    preferred: value.preferred,
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider,
    sourceUrl: value.sourceUrl,
    sourceRetrievedAt: value.sourceRetrievedAt,
  }));
}

function identifierValues(options: {
  patientId: string;
  ingredientId?: string | null;
  productId?: string | null;
  values: MedicineCatalogIdentifierInput[];
  allowedIds?: Set<string>;
}) {
  return options.values.map((value, orderIndex) => ({
    id: childId(value.id, options.allowedIds, 'identifier_id'),
    patientId: options.patientId,
    ingredientId: options.ingredientId ?? null,
    productId: options.productId ?? null,
    orderIndex,
    system: value.system,
    code: value.code,
    jurisdiction: value.jurisdiction,
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider,
    sourceUrl: value.sourceUrl,
    sourceRetrievedAt: value.sourceRetrievedAt,
  }));
}

function componentValues(options: {
  patientId: string;
  productId: string;
  values: MedicineProductIngredientInput[];
  allowedIds?: Set<string>;
}) {
  return options.values.map((value, orderIndex) => ({
    id: childId(value.id, options.allowedIds, 'component_id'),
    patientId: options.patientId,
    productId: options.productId,
    ingredientId: value.ingredientId,
    orderIndex,
    role: value.role,
    numeratorValue: value.numeratorValue,
    numeratorUnit: value.numeratorUnit,
    denominatorValue: value.denominatorValue,
    denominatorUnit: value.denominatorUnit,
    strengthText: value.strengthText,
    basisOfStrengthText: value.basisOfStrengthText,
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider,
    sourceUrl: value.sourceUrl,
    sourceRetrievedAt: value.sourceRetrievedAt,
  }));
}

async function validateIngredientReferences(
  tx: Transaction,
  patientId: string,
  values: MedicineProductIngredientInput[],
) {
  const ids = [...new Set(values.map((value) => value.ingredientId))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: medicineIngredient.id })
    .from(medicineIngredient)
    .where(and(eq(medicineIngredient.patientId, patientId), inArray(medicineIngredient.id, ids)));
  if (rows.length !== ids.length) throw new InvalidMedicineCatalogReferenceError('ingredient');
}

async function ingredientSnapshot(
  tx: Transaction,
  root: typeof medicineIngredient.$inferSelect,
) {
  const names = await tx
    .select()
    .from(medicineCatalogName)
    .where(
      and(
        eq(medicineCatalogName.patientId, root.patientId),
        eq(medicineCatalogName.ingredientId, root.id),
      ),
    );
  const identifiers = await tx
    .select()
    .from(medicineCatalogIdentifier)
    .where(
      and(
        eq(medicineCatalogIdentifier.patientId, root.patientId),
        eq(medicineCatalogIdentifier.ingredientId, root.id),
      ),
    );
  return buildMedicineIngredientRecords([root], names, identifiers)[0];
}

async function productSnapshot(tx: Transaction, root: typeof medicineProduct.$inferSelect) {
  const names = await tx
    .select()
    .from(medicineCatalogName)
    .where(
      and(
        eq(medicineCatalogName.patientId, root.patientId),
        eq(medicineCatalogName.productId, root.id),
      ),
    );
  const identifiers = await tx
    .select()
    .from(medicineCatalogIdentifier)
    .where(
      and(
        eq(medicineCatalogIdentifier.patientId, root.patientId),
        eq(medicineCatalogIdentifier.productId, root.id),
      ),
    );
  const components = await tx
    .select()
    .from(medicineProductIngredient)
    .where(
      and(
        eq(medicineProductIngredient.patientId, root.patientId),
        eq(medicineProductIngredient.productId, root.id),
      ),
    );
  const ingredientIds = [...new Set(components.map((value) => value.ingredientId))];
  const ingredientRoots = ingredientIds.length
    ? await tx
        .select()
        .from(medicineIngredient)
        .where(
          and(
            eq(medicineIngredient.patientId, root.patientId),
            inArray(medicineIngredient.id, ingredientIds),
          ),
        )
    : [];
  const ingredientNames = ingredientIds.length
    ? await tx
        .select()
        .from(medicineCatalogName)
        .where(
          and(
            eq(medicineCatalogName.patientId, root.patientId),
            inArray(medicineCatalogName.ingredientId, ingredientIds),
          ),
        )
    : [];
  const ingredientIdentifiers = ingredientIds.length
    ? await tx
        .select()
        .from(medicineCatalogIdentifier)
        .where(
          and(
            eq(medicineCatalogIdentifier.patientId, root.patientId),
            inArray(medicineCatalogIdentifier.ingredientId, ingredientIds),
          ),
        )
    : [];
  const ingredients = buildMedicineIngredientRecords(
    ingredientRoots,
    ingredientNames,
    ingredientIdentifiers,
  );
  return buildMedicineProductRecords([root], names, identifiers, components, ingredients)[0];
}

export async function getMedicineIngredientRecord(patientId: string, id: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(medicineIngredient)
      .where(and(eq(medicineIngredient.id, id), eq(medicineIngredient.patientId, patientId)))
      .limit(1);
    return rows[0] ? ingredientSnapshot(tx, rows[0]) : null;
  });
}

export async function getMedicineProductRecord(patientId: string, id: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(medicineProduct)
      .where(and(eq(medicineProduct.id, id), eq(medicineProduct.patientId, patientId)))
      .limit(1);
    return rows[0] ? productSnapshot(tx, rows[0]) : null;
  });
}

function ingredientRootValues(input: MedicineIngredientInput) {
  return {
    canonicalName: input.canonicalName,
    normalizedName: normalizedMedicineCatalogName(input.canonicalName),
    status: input.status,
    notes: input.notes,
  };
}

function productRootValues(input: MedicineProductInput) {
  return {
    displayName: input.displayName,
    normalizedName: normalizedMedicineCatalogName(input.displayName),
    productType: input.productType,
    status: input.status,
    doseFormText: input.doseFormText,
    doseFormSystem: input.doseFormSystem,
    doseFormCode: input.doseFormCode,
    routeText: input.routeText,
    routeSystem: input.routeSystem,
    routeCode: input.routeCode,
    strengthText: input.strengthText,
    manufacturer: input.manufacturer,
    marketingAuthorizationHolder: input.marketingAuthorizationHolder,
    marketCountry: input.marketCountry,
    packageDescription: input.packageDescription,
    imprint: input.imprint,
    color: input.color,
    shape: input.shape,
    notes: input.notes,
  };
}

export async function createMedicineIngredient(options: {
  patientId: string;
  input: MedicineIngredientInput;
  origin: MedicineCatalogOrigin;
  id?: string;
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(medicineIngredient)
      .values({
        ...(options.id ? { id: options.id } : {}),
        patientId: options.patientId,
        ...ingredientRootValues(options.input),
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
        sourceData: options.origin.sourceData ?? null,
      })
      .onConflictDoNothing({ target: medicineIngredient.id })
      .returning();
    const root = rows[0];
    if (!root) {
      const existing = await tx.select().from(medicineIngredient).where(and(
        eq(medicineIngredient.id, options.id as string),
        eq(medicineIngredient.patientId, options.patientId),
      )).limit(1);
      const stored = checkOrigin(existing[0], options.origin);
      return { ingredient: await ingredientSnapshot(tx, stored), created: false };
    }
    const names = nameValues({
      patientId: options.patientId,
      ingredientId: root.id,
      values: options.input.names,
    });
    const identifiers = identifierValues({
      patientId: options.patientId,
      ingredientId: root.id,
      values: options.input.identifiers,
    });
    if (names.length) await tx.insert(medicineCatalogName).values(names);
    if (identifiers.length) await tx.insert(medicineCatalogIdentifier).values(identifiers);
    const snapshot = await ingredientSnapshot(tx, root);
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('ingredient', snapshot, options.origin));
    return { ingredient: snapshot, created: true };
  });
}

export async function updateMedicineIngredient(options: {
  current: MedicineIngredientRecord;
  input: MedicineIngredientInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
  sourceData?: unknown;
  changedAt?: string;
}) {
  if (options.current.revision !== options.expectedRevision) throw new StaleClaimRevisionError();
  return db.transaction(async (tx) => {
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('ingredient', options.current, options.source))
      .onConflictDoNothing();
    const rows = await tx
      .update(medicineIngredient)
      .set({
        ...ingredientRootValues(options.input),
        ...(options.sourceData === undefined ? {} : { sourceData: options.sourceData }),
        revision: options.expectedRevision + 1,
        updatedAt: options.changedAt ?? new Date().toISOString(),
      })
      .where(
        and(
          eq(medicineIngredient.id, options.current.id),
          eq(medicineIngredient.patientId, options.current.patientId),
          eq(medicineIngredient.revision, options.expectedRevision),
        ),
      )
      .returning();
    if (!rows[0]) throw new StaleClaimRevisionError();
    await tx
      .delete(medicineCatalogName)
      .where(
        and(
          eq(medicineCatalogName.patientId, options.current.patientId),
          eq(medicineCatalogName.ingredientId, options.current.id),
        ),
      );
    await tx
      .delete(medicineCatalogIdentifier)
      .where(
        and(
          eq(medicineCatalogIdentifier.patientId, options.current.patientId),
          eq(medicineCatalogIdentifier.ingredientId, options.current.id),
        ),
      );
    const names = nameValues({
      patientId: options.current.patientId,
      ingredientId: options.current.id,
      values: options.input.names,
      allowedIds: new Set(options.current.names.map((value) => value.id)),
    });
    const identifiers = identifierValues({
      patientId: options.current.patientId,
      ingredientId: options.current.id,
      values: options.input.identifiers,
      allowedIds: new Set(options.current.identifiers.map((value) => value.id)),
    });
    if (names.length) await tx.insert(medicineCatalogName).values(names);
    if (identifiers.length) await tx.insert(medicineCatalogIdentifier).values(identifiers);
    const snapshot = await ingredientSnapshot(tx, rows[0]);
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('ingredient', snapshot, options.source));
    return snapshot;
  });
}

export async function createMedicineProduct(options: {
  patientId: string;
  input: MedicineProductInput;
  origin: MedicineCatalogOrigin;
  id?: string;
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(medicineProduct)
      .values({
        ...(options.id ? { id: options.id } : {}),
        patientId: options.patientId,
        ...productRootValues(options.input),
        originKind: options.origin.kind,
        originProvider: options.origin.provider,
        originExternalId: options.origin.externalId ?? null,
        sourceData: options.origin.sourceData ?? null,
      })
      .onConflictDoNothing({ target: medicineProduct.id })
      .returning();
    const root = rows[0];
    if (!root) {
      const existing = await tx.select().from(medicineProduct).where(and(
        eq(medicineProduct.id, options.id as string),
        eq(medicineProduct.patientId, options.patientId),
      )).limit(1);
      const stored = checkOrigin(existing[0], options.origin);
      return { product: await productSnapshot(tx, stored), created: false };
    }
    await validateIngredientReferences(tx, options.patientId, options.input.ingredients);
    const names = nameValues({
      patientId: options.patientId,
      productId: root.id,
      values: options.input.names,
    });
    const identifiers = identifierValues({
      patientId: options.patientId,
      productId: root.id,
      values: options.input.identifiers,
    });
    const components = componentValues({
      patientId: options.patientId,
      productId: root.id,
      values: options.input.ingredients,
    });
    if (names.length) await tx.insert(medicineCatalogName).values(names);
    if (identifiers.length) await tx.insert(medicineCatalogIdentifier).values(identifiers);
    if (components.length) await tx.insert(medicineProductIngredient).values(components);
    const snapshot = await productSnapshot(tx, root);
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('product', snapshot, options.origin));
    return { product: snapshot, created: true };
  });
}

export async function updateMedicineProduct(options: {
  current: MedicineProductRecord;
  input: MedicineProductInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
  sourceData?: unknown;
  changedAt?: string;
}) {
  if (options.current.revision !== options.expectedRevision) throw new StaleClaimRevisionError();
  return db.transaction(async (tx) => {
    await validateIngredientReferences(tx, options.current.patientId, options.input.ingredients);
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('product', options.current, options.source))
      .onConflictDoNothing();
    const rows = await tx
      .update(medicineProduct)
      .set({
        ...productRootValues(options.input),
        ...(options.sourceData === undefined ? {} : { sourceData: options.sourceData }),
        revision: options.expectedRevision + 1,
        updatedAt: options.changedAt ?? new Date().toISOString(),
      })
      .where(
        and(
          eq(medicineProduct.id, options.current.id),
          eq(medicineProduct.patientId, options.current.patientId),
          eq(medicineProduct.revision, options.expectedRevision),
        ),
      )
      .returning();
    if (!rows[0]) throw new StaleClaimRevisionError();
    await tx
      .delete(medicineCatalogName)
      .where(
        and(
          eq(medicineCatalogName.patientId, options.current.patientId),
          eq(medicineCatalogName.productId, options.current.id),
        ),
      );
    await tx
      .delete(medicineCatalogIdentifier)
      .where(
        and(
          eq(medicineCatalogIdentifier.patientId, options.current.patientId),
          eq(medicineCatalogIdentifier.productId, options.current.id),
        ),
      );
    await tx
      .delete(medicineProductIngredient)
      .where(
        and(
          eq(medicineProductIngredient.patientId, options.current.patientId),
          eq(medicineProductIngredient.productId, options.current.id),
        ),
      );
    const names = nameValues({
      patientId: options.current.patientId,
      productId: options.current.id,
      values: options.input.names,
      allowedIds: new Set(options.current.names.map((value) => value.id)),
    });
    const identifiers = identifierValues({
      patientId: options.current.patientId,
      productId: options.current.id,
      values: options.input.identifiers,
      allowedIds: new Set(options.current.identifiers.map((value) => value.id)),
    });
    const components = componentValues({
      patientId: options.current.patientId,
      productId: options.current.id,
      values: options.input.ingredients,
      allowedIds: new Set(options.current.ingredients.map((value) => value.id)),
    });
    if (names.length) await tx.insert(medicineCatalogName).values(names);
    if (identifiers.length) await tx.insert(medicineCatalogIdentifier).values(identifiers);
    if (components.length) await tx.insert(medicineProductIngredient).values(components);
    const snapshot = await productSnapshot(tx, rows[0]);
    await tx
      .insert(medicineCatalogRevision)
      .values(revisionValues('product', snapshot, options.source));
    return snapshot;
  });
}

export async function deleteMedicineIngredient(options: {
  patientId: string;
  id: string;
  expectedRevision: number;
}) {
  return db.transaction(async (tx) => {
    const roots = await tx
      .select({ revision: medicineIngredient.revision })
      .from(medicineIngredient)
      .where(
        and(
          eq(medicineIngredient.id, options.id),
          eq(medicineIngredient.patientId, options.patientId),
        ),
      )
      .limit(1);
    if (roots[0]?.revision !== options.expectedRevision) throw new StaleClaimRevisionError();

    const used = await tx
      .select({ id: medicineProductIngredient.id })
      .from(medicineProductIngredient)
      .where(
        and(
          eq(medicineProductIngredient.patientId, options.patientId),
          eq(medicineProductIngredient.ingredientId, options.id),
        ),
      )
      .limit(1);
    if (used[0]) throw new MedicineCatalogIngredientInUseError();

    await tx
      .delete(medicineCatalogRevision)
      .where(
        and(
          eq(medicineCatalogRevision.patientId, options.patientId),
          eq(medicineCatalogRevision.entityKind, 'ingredient'),
          eq(medicineCatalogRevision.entityId, options.id),
        ),
      );
    const deleted = await tx
      .delete(medicineIngredient)
      .where(
        and(
          eq(medicineIngredient.id, options.id),
          eq(medicineIngredient.patientId, options.patientId),
          eq(medicineIngredient.revision, options.expectedRevision),
        ),
      )
      .returning({ id: medicineIngredient.id });
    if (!deleted[0]) throw new StaleClaimRevisionError();
  });
}

export async function deleteMedicineProduct(options: {
  patientId: string;
  id: string;
  expectedRevision: number;
  source: ClaimRevisionSource;
  changedAt?: string;
}) {
  return db.transaction(async (tx) => {
    const roots = await tx
      .select({ revision: medicineProduct.revision })
      .from(medicineProduct)
      .where(
        and(eq(medicineProduct.id, options.id), eq(medicineProduct.patientId, options.patientId)),
      )
      .limit(1);
    if (roots[0]?.revision !== options.expectedRevision) throw new StaleClaimRevisionError();

    const linkedClaims = await tx
      .select()
      .from(medicineClaim)
      .where(
        and(eq(medicineClaim.patientId, options.patientId), eq(medicineClaim.productId, options.id)),
      );
    const changedAt = options.changedAt ?? new Date().toISOString();
    for (const linkedClaim of linkedClaims) {
      const previous = normalizeMedicineClaim(linkedClaim);
      await tx
        .insert(claimRevision)
        .values(claimRevisionValues('medicine', previous, options.source))
        .onConflictDoNothing();
      const updated = await tx
        .update(medicineClaim)
        .set({
          productId: null,
          revision: linkedClaim.revision + 1,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(medicineClaim.id, linkedClaim.id),
            eq(medicineClaim.patientId, options.patientId),
            eq(medicineClaim.revision, linkedClaim.revision),
          ),
        )
        .returning();
      if (!updated[0]) throw new StaleClaimRevisionError();
      await tx
        .insert(claimRevision)
        .values(
          claimRevisionValues('medicine', normalizeMedicineClaim(updated[0]), options.source),
        );
    }

    await tx
      .delete(medicineCatalogRevision)
      .where(
        and(
          eq(medicineCatalogRevision.patientId, options.patientId),
          eq(medicineCatalogRevision.entityKind, 'product'),
          eq(medicineCatalogRevision.entityId, options.id),
        ),
      );
    const deleted = await tx
      .delete(medicineProduct)
      .where(
        and(
          eq(medicineProduct.id, options.id),
          eq(medicineProduct.patientId, options.patientId),
          eq(medicineProduct.revision, options.expectedRevision),
        ),
      )
      .returning({ id: medicineProduct.id });
    if (!deleted[0]) throw new StaleClaimRevisionError();
    return { detachedClaimIds: linkedClaims.map((claim) => claim.id) };
  });
}
