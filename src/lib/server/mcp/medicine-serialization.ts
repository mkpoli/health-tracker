import type { MedicineClaimRecord } from '$lib/medicine';

export function serializeMedicine(claim: MedicineClaimRecord) {
  return {
    medicine_id: claim.id,
    patient_id: claim.patientId,
    product_id: claim.productId,
    name: claim.name,
    generic_name: claim.genericName,
    form: claim.form,
    strength: claim.strength,
    route: claim.route,
    status: claim.status,
    start_date: claim.startDate,
    end_date: claim.endDate,
    purpose: claim.purpose,
    prescriber: claim.prescriber,
    notes: claim.notes,
    origin: {
      kind: claim.originKind,
      provider: claim.originProvider,
      external_id: claim.originExternalId,
    },
    revision: claim.revision,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
  };
}
