export const medicineStatuses = ['active', 'planned', 'paused', 'completed', 'stopped'] as const;

/** Longest text, in UTF-16 code units, that a medicine plan stores per field. */
export const medicineFieldLimits = {
  productId: 128,
  name: 200,
  genericName: 200,
  form: 120,
  strength: 120,
  route: 120,
  purpose: 500,
  prescriber: 200,
  notes: 4000,
} as const;

export type MedicineStatus = (typeof medicineStatuses)[number];

export interface MedicineClaimRecord {
  id: string;
  patientId: string;
  productId: string | null;
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  route: string | null;
  status: MedicineStatus;
  startDate: string | null;
  endDate: string | null;
  purpose: string | null;
  prescriber: string | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function isMedicineStatus(value: string): value is MedicineStatus {
  return medicineStatuses.includes(value as MedicineStatus);
}

/** Cuts text to a plan field's limit without splitting a surrogate pair. */
export function fitMedicineField(value: string, limit: number) {
  if (value.length <= limit) return value;
  const end = value.charCodeAt(limit - 1) >= 0xd800 && value.charCodeAt(limit - 1) <= 0xdbff ? limit - 1 : limit;
  return value.slice(0, end).trimEnd();
}
