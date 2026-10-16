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

function archiveSnapshot(snapshot: MedicineCatalogRevisionSnapshot) {
  if (!('ingredients' in snapshot)) return snapshot;
  return {
    ...snapshot,
    ingredients: snapshot.ingredients.map((component) => {
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
  return json(
    {
      medicineIngredients: catalog.ingredients,
      medicineProducts: catalog.products.map(archiveSnapshot),
      medicineCatalogRevisions: revisions.map((revision) => ({
        ...revision,
        snapshot: archiveSnapshot(revision.snapshot),
      })),
    },
    { headers },
  );
};
