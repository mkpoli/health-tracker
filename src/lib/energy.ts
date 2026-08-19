export const energyDirections = ['intake', 'expenditure'] as const;
export const energyStatuses = ['recorded', 'draft', 'excluded'] as const;
export const energyFoodDataSources = ['label', 'database', 'estimated', 'unknown'] as const;
export const ENERGY_DIARY_DAY_START_HOUR = 5;

export type EnergyDirection = (typeof energyDirections)[number];
export type EnergyStatus = (typeof energyStatuses)[number];
export type EnergyFoodDataSource = (typeof energyFoodDataSources)[number];

export interface EnergyFoodItemRecord {
  id: string;
  patientId: string;
  energyClaimId: string;
  orderIndex: number;
  name: string;
  quantityValue: number | null;
  quantityUnit: string | null;
  energyKcal: number | null;
  energyKcalMin: number | null;
  energyKcalMax: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  dataSource: EnergyFoodDataSource;
  notes: string | null;
  originExternalId: string | null;
  nutritionData: Record<string, number> | null;
  createdAt: string;
  updatedAt: string;
}

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
  foodItems: EnergyFoodItemRecord[];
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

export function isEnergyFoodDataSource(value: string): value is EnergyFoodDataSource {
  return energyFoodDataSources.includes(value as EnergyFoodDataSource);
}

export function energyDiaryDateFromLocalDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (hour < ENERGY_DIARY_DAY_START_HOUR) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
