export const energyDirections = ['intake', 'expenditure'] as const;
export const energyStatuses = ['recorded', 'draft', 'excluded'] as const;

export type EnergyDirection = (typeof energyDirections)[number];
export type EnergyStatus = (typeof energyStatuses)[number];

export interface EnergyClaimRecord {
  id: string;
  patientId: string;
  direction: EnergyDirection;
  label: string | null;
  category: string | null;
  energyKcal: number | null;
  occurredAt: string;
  localDate: string;
  timezone: string | null;
  timezoneOffsetMinutes: number;
  durationMinutes: number | null;
  status: EnergyStatus;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EnergySourceRecord {
  id: string;
  energyClaimId: string;
  kind: 'photo';
  mimeType: string;
  fileName: string | null;
  byteSize: number;
  sourceUrl: string;
  createdAt: string;
}

export function isEnergyDirection(value: string): value is EnergyDirection {
  return energyDirections.includes(value as EnergyDirection);
}

export function isEnergyStatus(value: string): value is EnergyStatus {
  return energyStatuses.includes(value as EnergyStatus);
}
