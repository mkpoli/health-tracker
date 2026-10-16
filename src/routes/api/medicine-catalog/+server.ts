import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  isMedicineCatalogEntityKind,
  type MedicineCatalogRevisionSnapshot,
} from '$lib/medicine-catalog';
import {
  loadMedicineCatalog,
  loadMedicineCatalogRevisions,
} from '$lib/server/medicine-catalog-load';
import { getOwnedPatient, requireUserId } from '$lib/server/ownership';

function equalSourceData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => equalSourceData(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length && keys.every((key) =>
    Object.hasOwn(rightRecord, key) && equalSourceData(leftRecord[key], rightRecord[key]),
  );
}

function archiveSnapshot(
  snapshot: MedicineCatalogRevisionSnapshot,
  ingredientSourceData: Map<string, unknown>,
) {
  if (!('ingredients' in snapshot) || !Array.isArray(snapshot.ingredients)) return snapshot;
  return {
    ...snapshot,
    ingredients: snapshot.ingredients.map((component) => {
      if (
        !component ||
        typeof component !== 'object' ||
        !component.ingredient ||
        typeof component.ingredient !== 'object' ||
        Array.isArray(component.ingredient) ||
        !ingredientSourceData.has(component.ingredient.id) ||
        !equalSourceData(component.ingredient.sourceData, ingredientSourceData.get(component.ingredient.id))
      ) {
        return component;
      }
      const { sourceData: _sourceData, ...ingredient } = component.ingredient;
      return { ...component, ingredient };
    }),
  };
}

/**
 * The catalogue with its source payloads and saved versions. The dashboard
 * leaves these out of its page data. With `entityKind` and `entityId` the
 * response holds the versions of that one entity.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const userId = requireUserId(locals);
  const patientId = url.searchParams.get('patientId');
  if (!patientId) throw error(400, 'Missing profile');
  if (!(await getOwnedPatient(userId, patientId))) throw error(404, 'Profile not found');

  const headers = { 'cache-control': 'private, no-store' };
  const kind = url.searchParams.get('entityKind');
  const id = url.searchParams.get('entityId');

  if (kind !== null || id !== null) {
    if (!kind || !id || !isMedicineCatalogEntityKind(kind)) throw error(400, 'Invalid entity');
    return json(
      { medicineCatalogRevisions: await loadMedicineCatalogRevisions(patientId, { kind, id }) },
      { headers },
    );
  }

  const catalog = await loadMedicineCatalog(patientId, { sourceData: true });
  const revisions = await loadMedicineCatalogRevisions(patientId);
  const ingredientSourceData = new Map(
    catalog.ingredients
      .filter((ingredient) => ingredient.sourceData != null)
      .map((ingredient) => [ingredient.id, ingredient.sourceData]),
  );
  return json(
    {
      medicineIngredients: catalog.ingredients,
      medicineProducts: catalog.products.map((product) =>
        archiveSnapshot(product, ingredientSourceData),
      ),
      medicineCatalogRevisions: revisions.map((revision) => ({
        ...revision,
        snapshot: archiveSnapshot(revision.snapshot, ingredientSourceData),
      })),
    },
    { headers },
  );
};
