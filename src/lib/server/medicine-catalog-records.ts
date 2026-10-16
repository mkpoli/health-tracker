import {
  isMedicineCatalogEntityKind,
  isMedicineCatalogNameType,
  isMedicineCatalogStatus,
  isMedicineIngredientRole,
  isMedicineProductType,
  type MedicineCatalogIdentifierRecord,
  type MedicineCatalogNameRecord,
  type MedicineCatalogRevisionRecord,
  type MedicineIngredientRecord,
  type MedicineProductIngredientRecord,
  type MedicineProductRecord,
} from '$lib/medicine-catalog';
import type {
  medicineCatalogIdentifier,
  medicineCatalogName,
  medicineCatalogRevision,
  medicineIngredient,
  medicineProduct,
  medicineProductIngredient,
} from '$lib/server/db/schema';

function normalizeName(
  value: typeof medicineCatalogName.$inferSelect,
): MedicineCatalogNameRecord {
  return {
    id: value.id,
    ingredientId: value.ingredientId,
    productId: value.productId,
    orderIndex: value.orderIndex,
    name: value.name,
    normalizedName: value.normalizedName,
    languageTag: value.languageTag,
    nameType: isMedicineCatalogNameType(value.nameType) ? value.nameType : 'synonym',
    jurisdiction: value.jurisdiction,
    preferred: value.preferred,
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider,
    sourceUrl: value.sourceUrl,
    sourceRetrievedAt: value.sourceRetrievedAt,
  };
}

function normalizeIdentifier(
  value: typeof medicineCatalogIdentifier.$inferSelect,
): MedicineCatalogIdentifierRecord {
  return {
    id: value.id,
    ingredientId: value.ingredientId,
    productId: value.productId,
    orderIndex: value.orderIndex,
    system: value.system,
    code: value.code,
    jurisdiction: value.jurisdiction,
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider,
    sourceUrl: value.sourceUrl,
    sourceRetrievedAt: value.sourceRetrievedAt,
  };
}

export function buildMedicineIngredientRecords(
  roots: Array<typeof medicineIngredient.$inferSelect>,
  names: Array<typeof medicineCatalogName.$inferSelect>,
  identifiers: Array<typeof medicineCatalogIdentifier.$inferSelect>,
): MedicineIngredientRecord[] {
  const namesByIngredient = new Map<string, MedicineCatalogNameRecord[]>();
  const identifiersByIngredient = new Map<string, MedicineCatalogIdentifierRecord[]>();

  for (const value of names) {
    if (!value.ingredientId) continue;
    const rows = namesByIngredient.get(value.ingredientId) || [];
    rows.push(normalizeName(value));
    namesByIngredient.set(value.ingredientId, rows);
  }
  for (const value of identifiers) {
    if (!value.ingredientId) continue;
    const rows = identifiersByIngredient.get(value.ingredientId) || [];
    rows.push(normalizeIdentifier(value));
    identifiersByIngredient.set(value.ingredientId, rows);
  }

  return roots.map((value) => ({
    id: value.id,
    patientId: value.patientId,
    canonicalName: value.canonicalName,
    normalizedName: value.normalizedName,
    status: isMedicineCatalogStatus(value.status) ? value.status : 'archived',
    notes: value.notes,
    originKind: value.originKind,
    originProvider: value.originProvider,
    originExternalId: value.originExternalId,
    sourceData: value.sourceData ?? null,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    names: (namesByIngredient.get(value.id) || []).sort((a, b) => a.orderIndex - b.orderIndex),
    identifiers: (identifiersByIngredient.get(value.id) || []).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
  }));
}

export function buildMedicineProductRecords(
  roots: Array<typeof medicineProduct.$inferSelect>,
  names: Array<typeof medicineCatalogName.$inferSelect>,
  identifiers: Array<typeof medicineCatalogIdentifier.$inferSelect>,
  components: Array<typeof medicineProductIngredient.$inferSelect>,
  ingredients: MedicineIngredientRecord[],
): MedicineProductRecord[] {
  const namesByProduct = new Map<string, MedicineCatalogNameRecord[]>();
  const identifiersByProduct = new Map<string, MedicineCatalogIdentifierRecord[]>();
  const ingredientsById = new Map(ingredients.map((value) => [value.id, value]));
  const componentsByProduct = new Map<string, MedicineProductIngredientRecord[]>();

  for (const value of names) {
    if (!value.productId) continue;
    const rows = namesByProduct.get(value.productId) || [];
    rows.push(normalizeName(value));
    namesByProduct.set(value.productId, rows);
  }
  for (const value of identifiers) {
    if (!value.productId) continue;
    const rows = identifiersByProduct.get(value.productId) || [];
    rows.push(normalizeIdentifier(value));
    identifiersByProduct.set(value.productId, rows);
  }
  for (const value of components) {
    const ingredient = ingredientsById.get(value.ingredientId);
    if (!ingredient) {
      throw new Error(
        `Missing ingredient ${value.ingredientId} for medicine product component ${value.id}`,
      );
    }
    const rows = componentsByProduct.get(value.productId) || [];
    rows.push({
      id: value.id,
      productId: value.productId,
      ingredientId: value.ingredientId,
      orderIndex: value.orderIndex,
      role: isMedicineIngredientRole(value.role) ? value.role : 'unknown',
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
      ingredient,
    });
    componentsByProduct.set(value.productId, rows);
  }

  return roots.map((value) => ({
    id: value.id,
    patientId: value.patientId,
    displayName: value.displayName,
    productType: isMedicineProductType(value.productType) ? value.productType : 'other',
    status: isMedicineCatalogStatus(value.status) ? value.status : 'archived',
    doseFormText: value.doseFormText,
    doseFormSystem: value.doseFormSystem,
    doseFormCode: value.doseFormCode,
    routeText: value.routeText,
    routeSystem: value.routeSystem,
    routeCode: value.routeCode,
    strengthText: value.strengthText,
    manufacturer: value.manufacturer,
    marketingAuthorizationHolder: value.marketingAuthorizationHolder,
    marketCountry: value.marketCountry,
    packageDescription: value.packageDescription,
    imprint: value.imprint,
    color: value.color,
    shape: value.shape,
    notes: value.notes,
    originKind: value.originKind,
    originProvider: value.originProvider,
    originExternalId: value.originExternalId,
    sourceData: value.sourceData ?? null,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    names: (namesByProduct.get(value.id) || []).sort((a, b) => a.orderIndex - b.orderIndex),
    identifiers: (identifiersByProduct.get(value.id) || []).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
    ingredients: (componentsByProduct.get(value.id) || []).sort(
      (a, b) => a.orderIndex - b.orderIndex,
    ),
  }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toMedicineCatalogRevision(
  value: typeof medicineCatalogRevision.$inferSelect,
): MedicineCatalogRevisionRecord | null {
  if (!isMedicineCatalogEntityKind(value.entityKind) || !isObject(value.snapshot)) return null;
  if (
    value.snapshot.id !== value.entityId ||
    value.snapshot.patientId !== value.patientId ||
    value.snapshot.revision !== value.revision
  ) {
    return null;
  }
  if (value.entityKind === 'ingredient' && typeof value.snapshot.canonicalName !== 'string') {
    return null;
  }
  if (value.entityKind === 'product' && typeof value.snapshot.displayName !== 'string') {
    return null;
  }

  return {
    id: value.id,
    patientId: value.patientId,
    entityKind: value.entityKind,
    entityId: value.entityId,
    revision: value.revision,
    snapshot: value.snapshot,
    changedAt: value.changedAt,
    changeOriginKind: value.changeOriginKind,
    changeOriginProvider: value.changeOriginProvider,
  } as MedicineCatalogRevisionRecord;
}
