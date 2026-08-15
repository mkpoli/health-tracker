export const medicineCatalogStatuses = ['active', 'inactive', 'archived'] as const;
export const medicineProductTypes = [
  'branded',
  'generic',
  'compounded',
  'supplement',
  'other',
] as const;
export const medicineCatalogNameTypes = [
  'preferred',
  'brand',
  'generic',
  'synonym',
] as const;
export const medicineIngredientRoles = ['active', 'inactive', 'unknown'] as const;
export const medicineCatalogEntityKinds = ['ingredient', 'product'] as const;

export type MedicineCatalogStatus = (typeof medicineCatalogStatuses)[number];
export type MedicineProductType = (typeof medicineProductTypes)[number];
export type MedicineCatalogNameType = (typeof medicineCatalogNameTypes)[number];
export type MedicineIngredientRole = (typeof medicineIngredientRoles)[number];
export type MedicineCatalogEntityKind = (typeof medicineCatalogEntityKinds)[number];

export interface MedicineCatalogSource {
  sourceKind: string;
  sourceProvider: string | null;
  sourceUrl: string | null;
  sourceRetrievedAt: string | null;
}

export interface MedicineCatalogNameRecord extends MedicineCatalogSource {
  id: string;
  ingredientId: string | null;
  productId: string | null;
  orderIndex: number;
  name: string;
  normalizedName: string;
  languageTag: string;
  nameType: MedicineCatalogNameType;
  jurisdiction: string | null;
  preferred: boolean;
}

export interface MedicineCatalogIdentifierRecord extends MedicineCatalogSource {
  id: string;
  ingredientId: string | null;
  productId: string | null;
  orderIndex: number;
  system: string;
  code: string;
  jurisdiction: string | null;
}

export interface MedicineIngredientRecord {
  id: string;
  patientId: string;
  canonicalName: string;
  normalizedName: string;
  status: MedicineCatalogStatus;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  sourceData: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
  names: MedicineCatalogNameRecord[];
  identifiers: MedicineCatalogIdentifierRecord[];
}

export interface MedicineProductIngredientRecord extends MedicineCatalogSource {
  id: string;
  productId: string;
  ingredientId: string;
  orderIndex: number;
  role: MedicineIngredientRole;
  numeratorValue: string | null;
  numeratorUnit: string | null;
  denominatorValue: string | null;
  denominatorUnit: string | null;
  strengthText: string | null;
  basisOfStrengthText: string | null;
  ingredient: MedicineIngredientRecord;
}

export interface MedicineProductRecord {
  id: string;
  patientId: string;
  displayName: string;
  productType: MedicineProductType;
  status: MedicineCatalogStatus;
  doseFormText: string | null;
  doseFormSystem: string | null;
  doseFormCode: string | null;
  routeText: string | null;
  routeSystem: string | null;
  routeCode: string | null;
  strengthText: string | null;
  manufacturer: string | null;
  marketingAuthorizationHolder: string | null;
  marketCountry: string | null;
  packageDescription: string | null;
  imprint: string | null;
  color: string | null;
  shape: string | null;
  notes: string | null;
  originKind: string;
  originProvider: string | null;
  originExternalId: string | null;
  sourceData: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
  names: MedicineCatalogNameRecord[];
  identifiers: MedicineCatalogIdentifierRecord[];
  ingredients: MedicineProductIngredientRecord[];
}

export type MedicineCatalogRevisionSnapshot =
  | MedicineIngredientRecord
  | MedicineProductRecord;

export interface MedicineCatalogRevisionRecord {
  id: string;
  patientId: string;
  entityKind: MedicineCatalogEntityKind;
  entityId: string;
  revision: number;
  snapshot: MedicineCatalogRevisionSnapshot;
  changedAt: string;
  changeOriginKind: string;
  changeOriginProvider: string | null;
}

export function isMedicineCatalogStatus(value: string): value is MedicineCatalogStatus {
  return medicineCatalogStatuses.includes(value as MedicineCatalogStatus);
}

export function isMedicineProductType(value: string): value is MedicineProductType {
  return medicineProductTypes.includes(value as MedicineProductType);
}

export function isMedicineCatalogNameType(value: string): value is MedicineCatalogNameType {
  return medicineCatalogNameTypes.includes(value as MedicineCatalogNameType);
}

export function isMedicineIngredientRole(value: string): value is MedicineIngredientRole {
  return medicineIngredientRoles.includes(value as MedicineIngredientRole);
}

export function isMedicineCatalogEntityKind(value: string): value is MedicineCatalogEntityKind {
  return medicineCatalogEntityKinds.includes(value as MedicineCatalogEntityKind);
}

export function normalizedMedicineCatalogName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und');
}

function localeCandidates(locale: string) {
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0] || 'und';
    const base = canonical.split('-')[0];
    return base === canonical ? [canonical, 'und'] : [canonical, base, 'und'];
  } catch {
    return ['und'];
  }
}

export function localizedMedicineCatalogName(
  names: MedicineCatalogNameRecord[],
  locale: string,
  fallback: string,
) {
  const candidates = localeCandidates(locale);
  for (const languageTag of candidates) {
    const match = names.find((name) => name.preferred && name.languageTag === languageTag)
      ?? names.find((name) => name.languageTag === languageTag);
    if (match) return match.name;
  }
  return names.find((name) => name.preferred)?.name ?? names[0]?.name ?? fallback;
}

export function medicineIngredientStrength(value: MedicineProductIngredientRecord) {
  if (value.strengthText) return value.strengthText;
  if (!value.numeratorValue && !value.numeratorUnit) return null;

  const numerator = [value.numeratorValue, value.numeratorUnit].filter(Boolean).join(' ');
  const denominator = [value.denominatorValue, value.denominatorUnit].filter(Boolean).join(' ');
  return denominator ? `${numerator} / ${denominator}` : numerator;
}
