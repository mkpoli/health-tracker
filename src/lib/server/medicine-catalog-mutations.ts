import { and, eq, inArray } from 'drizzle-orm';
import type {
  MedicineCatalogEntityKind,
  MedicineCatalogRevisionSnapshot,
  MedicineIngredientRecord,
  MedicineProductRecord,
} from '$lib/medicine-catalog';
import { db } from '$lib/server/db';
import {
  medicineCatalogIdentifier,
  medicineCatalogName,
  medicineCatalogRevision,
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
import { StaleClaimRevisionError, type ClaimRevisionSource } from '$lib/server/claim-revisions';

export interface MedicineCatalogOrigin extends ClaimRevisionSource {
  externalId?: string | null;
  sourceData?: unknown;
}

export class InvalidMedicineCatalogReferenceError extends Error {
  constructor(public readonly code: 'ingredient') {
    super(code);
    this.name = 'InvalidMedicineCatalogReferenceError';
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function nameValues(options: {
  patientId: string;
  ingredientId?: string | null;
  productId?: string | null;
  values: MedicineCatalogNameInput[];
  allowedIds?: Set<string>;
}) {
  return options.values.map((value, orderIndex) => ({
    id: value.id && options.allowedIds?.has(value.id) ? value.id : crypto.randomUUID(),
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
    id: value.id && options.allowedIds?.has(value.id) ? value.id : crypto.randomUUID(),
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
    id: value.id && options.allowedIds?.has(value.id) ? value.id : crypto.randomUUID(),
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
  const [names, identifiers] = await Promise.all([
    tx
      .select()
      .from(medicineCatalogName)
      .where(
        and(
          eq(medicineCatalogName.patientId, root.patientId),
          eq(medicineCatalogName.ingredientId, root.id),
        ),
      ),
    tx
      .select()
      .from(medicineCatalogIdentifier)
      .where(
        and(
          eq(medicineCatalogIdentifier.patientId, root.patientId),
          eq(medicineCatalogIdentifier.ingredientId, root.id),
        ),
      ),
  ]);
  return buildMedicineIngredientRecords([root], names, identifiers)[0];
}

async function productSnapshot(tx: Transaction, root: typeof medicineProduct.$inferSelect) {
  const [names, identifiers, components] = await Promise.all([
    tx
      .select()
      .from(medicineCatalogName)
      .where(
        and(
          eq(medicineCatalogName.patientId, root.patientId),
          eq(medicineCatalogName.productId, root.id),
        ),
      ),
    tx
      .select()
      .from(medicineCatalogIdentifier)
      .where(
        and(
          eq(medicineCatalogIdentifier.patientId, root.patientId),
          eq(medicineCatalogIdentifier.productId, root.id),
        ),
      ),
    tx
      .select()
      .from(medicineProductIngredient)
      .where(
        and(
          eq(medicineProductIngredient.patientId, root.patientId),
          eq(medicineProductIngredient.productId, root.id),
        ),
      ),
  ]);
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
  const [ingredientNames, ingredientIdentifiers] = ingredientIds.length
    ? await Promise.all([
        tx
          .select()
          .from(medicineCatalogName)
          .where(
            and(
              eq(medicineCatalogName.patientId, root.patientId),
              inArray(medicineCatalogName.ingredientId, ingredientIds),
            ),
          ),
        tx
          .select()
          .from(medicineCatalogIdentifier)
          .where(
            and(
              eq(medicineCatalogIdentifier.patientId, root.patientId),
              inArray(medicineCatalogIdentifier.ingredientId, ingredientIds),
            ),
          ),
      ])
    : [[], []];
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
      .returning();
    const root = rows[0];
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
    return snapshot;
  });
}

export async function updateMedicineIngredient(options: {
  current: MedicineIngredientRecord;
  input: MedicineIngredientInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
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
    await Promise.all([
      tx
        .delete(medicineCatalogName)
        .where(
          and(
            eq(medicineCatalogName.patientId, options.current.patientId),
            eq(medicineCatalogName.ingredientId, options.current.id),
          ),
        ),
      tx
        .delete(medicineCatalogIdentifier)
        .where(
          and(
            eq(medicineCatalogIdentifier.patientId, options.current.patientId),
            eq(medicineCatalogIdentifier.ingredientId, options.current.id),
          ),
        ),
    ]);
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
    await validateIngredientReferences(tx, options.patientId, options.input.ingredients);
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
      .returning();
    const root = rows[0];
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
    return snapshot;
  });
}

export async function updateMedicineProduct(options: {
  current: MedicineProductRecord;
  input: MedicineProductInput;
  expectedRevision: number;
  source: ClaimRevisionSource;
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
    await Promise.all([
      tx
        .delete(medicineCatalogName)
        .where(
          and(
            eq(medicineCatalogName.patientId, options.current.patientId),
            eq(medicineCatalogName.productId, options.current.id),
          ),
        ),
      tx
        .delete(medicineCatalogIdentifier)
        .where(
          and(
            eq(medicineCatalogIdentifier.patientId, options.current.patientId),
            eq(medicineCatalogIdentifier.productId, options.current.id),
          ),
        ),
      tx
        .delete(medicineProductIngredient)
        .where(
          and(
            eq(medicineProductIngredient.patientId, options.current.patientId),
            eq(medicineProductIngredient.productId, options.current.id),
          ),
        ),
    ]);
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
