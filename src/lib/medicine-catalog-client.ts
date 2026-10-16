import type { MedicineCatalogRevisionRecord } from '$lib/medicine-catalog';

async function getCatalog<T>(patientId: string, extra: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ patientId, ...extra });
  const response = await fetch(`/api/medicine-catalog?${query}`);
  if (!response.ok) throw new Error(`Medicine catalogue request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

/** The catalogue as the archive stores it, with source payloads and saved versions. */
export function fetchMedicineCatalogArchive(patientId: string) {
  return getCatalog<{
    medicineIngredients: unknown[];
    medicineProducts: unknown[];
    medicineCatalogRevisions: unknown[];
  }>(patientId);
}

export async function fetchMedicineCatalogRevisions(
  patientId: string,
  entityKind: 'ingredient' | 'product',
  entityId: string,
) {
  const result = await getCatalog<{ medicineCatalogRevisions: MedicineCatalogRevisionRecord[] }>(
    patientId,
    { entityKind, entityId },
  );
  return result.medicineCatalogRevisions;
}
