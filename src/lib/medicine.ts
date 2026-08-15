export const medicineStatuses = ['active', 'planned', 'paused', 'completed', 'stopped'] as const;

export type MedicineStatus = (typeof medicineStatuses)[number];

export interface MedicineClaimRecord {
  id: string;
  patientId: string;
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  route: string | null;
  schedule: string | null;
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
