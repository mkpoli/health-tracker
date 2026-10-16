import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import { readDb, withReadRetry } from '$lib/server/db';
import {
  medicineCatalogIdentifier,
  medicineCatalogName,
  medicineCatalogRevision,
  medicineIngredient,
  medicineProduct,
  medicineProductIngredient,
} from '$lib/server/db/schema';
import type { MedicineCatalogEntityKind } from '$lib/medicine-catalog';
import {
  buildMedicineIngredientRecords,
  buildMedicineProductRecords,
  toMedicineCatalogRevision,
} from '$lib/server/medicine-catalog-records';

const { sourceData: _ingredientSource, ...ingredientColumns } = getTableColumns(medicineIngredient);
const { sourceData: _productSource, ...productColumns } = getTableColumns(medicineProduct);

/**
 * Reads a profile's catalogue. A source payload can reach 2 MB per entry, so
 * the dashboard asks for the records without it and only the archive export
 * reads it.
 */
export async function loadMedicineCatalog(patientId: string, options: { sourceData: boolean }) {
  const [ingredients, products, names, identifiers, components] = await withReadRetry(() =>
    Promise.all([
      options.sourceData
        ? readDb
            .select()
            .from(medicineIngredient)
            .where(eq(medicineIngredient.patientId, patientId))
            .orderBy(medicineIngredient.updatedAt, medicineIngredient.id)
        : readDb
            .select(ingredientColumns)
            .from(medicineIngredient)
            .where(eq(medicineIngredient.patientId, patientId))
            .orderBy(medicineIngredient.canonicalName)
            .then((rows) => rows.map((row) => ({ ...row, sourceData: null }))),
      options.sourceData
        ? readDb
            .select()
            .from(medicineProduct)
            .where(eq(medicineProduct.patientId, patientId))
            .orderBy(medicineProduct.updatedAt, medicineProduct.id)
        : readDb
            .select(productColumns)
            .from(medicineProduct)
            .where(eq(medicineProduct.patientId, patientId))
            .orderBy(desc(medicineProduct.updatedAt))
            .then((rows) => rows.map((row) => ({ ...row, sourceData: null }))),
      readDb
        .select()
        .from(medicineCatalogName)
        .where(eq(medicineCatalogName.patientId, patientId))
        .orderBy(medicineCatalogName.orderIndex),
      readDb
        .select()
        .from(medicineCatalogIdentifier)
        .where(eq(medicineCatalogIdentifier.patientId, patientId))
        .orderBy(medicineCatalogIdentifier.orderIndex),
      readDb
        .select()
        .from(medicineProductIngredient)
        .where(eq(medicineProductIngredient.patientId, patientId))
        .orderBy(medicineProductIngredient.orderIndex),
    ]),
  );

  const ingredientRecords = buildMedicineIngredientRecords(ingredients, names, identifiers);
  return {
    ingredients: ingredientRecords,
    products: buildMedicineProductRecords(products, names, identifiers, components, ingredientRecords),
  };
}

/** Saved versions per entity, as `kind:id` to count, without the snapshots. */
export async function loadMedicineCatalogRevisionCounts(patientId: string) {
  const rows = await withReadRetry(() =>
    readDb
      .select({
        entityKind: medicineCatalogRevision.entityKind,
        entityId: medicineCatalogRevision.entityId,
        versions: count(),
      })
      .from(medicineCatalogRevision)
      .where(eq(medicineCatalogRevision.patientId, patientId))
      .groupBy(medicineCatalogRevision.entityKind, medicineCatalogRevision.entityId),
  );
  return Object.fromEntries(rows.map((row) => [`${row.entityKind}:${row.entityId}`, row.versions]));
}

/** Saved versions with their snapshots, for one entity or for the whole profile. */
export async function loadMedicineCatalogRevisions(
  patientId: string,
  entity?: { kind: MedicineCatalogEntityKind; id: string },
) {
  const rows = await withReadRetry(() =>
    readDb
      .select()
      .from(medicineCatalogRevision)
      .where(
        entity
          ? and(
              eq(medicineCatalogRevision.patientId, patientId),
              eq(medicineCatalogRevision.entityKind, entity.kind),
              eq(medicineCatalogRevision.entityId, entity.id),
            )
          : eq(medicineCatalogRevision.patientId, patientId),
      )
      .orderBy(desc(medicineCatalogRevision.changedAt)),
  );
  return rows.flatMap((row) => {
    const revision = toMedicineCatalogRevision(row);
    return revision ? [revision] : [];
  });
}
