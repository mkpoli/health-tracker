import {
  isMedicineCatalogNameType,
  isMedicineCatalogStatus,
  isMedicineIngredientRole,
  isMedicineProductType,
  normalizedMedicineCatalogName,
  type MedicineCatalogNameType,
  type MedicineCatalogStatus,
  type MedicineIngredientRole,
  type MedicineProductType,
} from '$lib/medicine-catalog';

const MAX_STRUCTURE_BYTES = 256 * 1024;
const MAX_NAMES = 30;
const MAX_IDENTIFIERS = 30;
const MAX_INGREDIENTS = 30;

const limits = {
  id: 128,
  name: 300,
  languageTag: 100,
  sourceKind: 80,
  sourceProvider: 200,
  sourceUrl: 2_000,
  sourceRetrievedAt: 64,
  system: 300,
  code: 500,
  notes: 4_000,
  terminologyText: 300,
  manufacturer: 300,
  packageDescription: 1_000,
  appearance: 200,
  strengthValue: 64,
  strengthUnit: 80,
  strengthText: 300,
} as const;

export type MedicineCatalogSourceInput = {
  sourceKind: string;
  sourceProvider: string | null;
  sourceUrl: string | null;
  sourceRetrievedAt: string | null;
};

export type MedicineCatalogNameInput = MedicineCatalogSourceInput & {
  id: string | null;
  name: string;
  languageTag: string;
  nameType: MedicineCatalogNameType;
  jurisdiction: string | null;
  preferred: boolean;
};

export type MedicineCatalogIdentifierInput = MedicineCatalogSourceInput & {
  id: string | null;
  system: string;
  code: string;
  jurisdiction: string | null;
};

export type MedicineIngredientInput = {
  canonicalName: string;
  status: MedicineCatalogStatus;
  notes: string | null;
  names: MedicineCatalogNameInput[];
  identifiers: MedicineCatalogIdentifierInput[];
};

export type MedicineProductIngredientInput = MedicineCatalogSourceInput & {
  id: string | null;
  ingredientId: string;
  role: MedicineIngredientRole;
  numeratorValue: string | null;
  numeratorUnit: string | null;
  denominatorValue: string | null;
  denominatorUnit: string | null;
  strengthText: string | null;
  basisOfStrengthText: string | null;
};

export type MedicineProductInput = {
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
  names: MedicineCatalogNameInput[];
  identifiers: MedicineCatalogIdentifierInput[];
  ingredients: MedicineProductIngredientInput[];
};

export type MedicineCatalogInputErrorCode =
  | 'field_too_long'
  | 'invalid_country'
  | 'invalid_identifier'
  | 'invalid_ingredient'
  | 'invalid_language'
  | 'invalid_name'
  | 'invalid_product_type'
  | 'invalid_source'
  | 'invalid_status'
  | 'invalid_strength'
  | 'invalid_structure'
  | 'missing_name'
  | 'structure_too_large';

export class InvalidMedicineCatalogInputError extends Error {
  constructor(public readonly code: MedicineCatalogInputErrorCode) {
    super(code);
    this.name = 'InvalidMedicineCatalogInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown, limit: number, required = false) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (normalized.length > limit) throw new InvalidMedicineCatalogInputError('field_too_long');
  if (required && !normalized) throw new InvalidMedicineCatalogInputError('missing_name');
  return normalized || null;
}

function formText(data: FormData, key: string, limit: number, required = false) {
  return textValue(data.get(key), limit, required);
}

function optionalId(value: unknown) {
  const id = textValue(value, limits.id);
  if (id && /[\u0000-\u001f\u007f]/.test(id)) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
  return id;
}

function languageTag(value: unknown) {
  const raw = textValue(value, limits.languageTag) || 'und';
  try {
    const canonical = Intl.getCanonicalLocales(raw);
    if (canonical.length !== 1) throw new Error('invalid');
    return canonical[0];
  } catch {
    throw new InvalidMedicineCatalogInputError('invalid_language');
  }
}

function jurisdiction(value: unknown) {
  const raw = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!raw) return null;
  if (!/^[A-Za-z]{2}$/.test(raw)) {
    throw new InvalidMedicineCatalogInputError('invalid_country');
  }
  return raw.toUpperCase();
}

function source(value: Record<string, unknown>): MedicineCatalogSourceInput {
  const sourceKind = textValue(value.sourceKind, limits.sourceKind) || 'manual';
  const sourceProvider = textValue(value.sourceProvider, limits.sourceProvider);
  const sourceUrl = textValue(value.sourceUrl, limits.sourceUrl);
  const retrieved = textValue(value.sourceRetrievedAt, limits.sourceRetrievedAt);

  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('invalid');
    } catch {
      throw new InvalidMedicineCatalogInputError('invalid_source');
    }
  }

  let sourceRetrievedAt: string | null = null;
  if (retrieved) {
    const parsed = new Date(retrieved);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidMedicineCatalogInputError('invalid_source');
    }
    sourceRetrievedAt = parsed.toISOString();
  }

  return { sourceKind, sourceProvider, sourceUrl, sourceRetrievedAt };
}

function parseName(value: unknown): MedicineCatalogNameInput {
  if (!isRecord(value)) throw new InvalidMedicineCatalogInputError('invalid_name');
  const name = textValue(value.name, limits.name);
  const nameTypeValue = textValue(value.nameType, 40) || 'preferred';
  if (!name || !isMedicineCatalogNameType(nameTypeValue)) {
    throw new InvalidMedicineCatalogInputError('invalid_name');
  }

  return {
    id: optionalId(value.id),
    name,
    languageTag: languageTag(value.languageTag),
    nameType: nameTypeValue,
    jurisdiction: jurisdiction(value.jurisdiction),
    preferred: value.preferred === true,
    ...source(value),
  };
}

function parseIdentifier(value: unknown): MedicineCatalogIdentifierInput {
  if (!isRecord(value)) throw new InvalidMedicineCatalogInputError('invalid_identifier');
  const system = textValue(value.system, limits.system);
  const code = textValue(value.code, limits.code);
  if (!system || !code) throw new InvalidMedicineCatalogInputError('invalid_identifier');

  return {
    id: optionalId(value.id),
    system,
    code,
    jurisdiction: jurisdiction(value.jurisdiction),
    ...source(value),
  };
}

function decimal(value: unknown) {
  const raw = textValue(value, limits.strengthValue);
  if (!raw) return null;
  const number = Number(raw);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) || !Number.isFinite(number) || number <= 0) {
    throw new InvalidMedicineCatalogInputError('invalid_strength');
  }
  return raw;
}

function parseProductIngredient(value: unknown): MedicineProductIngredientInput {
  if (!isRecord(value)) throw new InvalidMedicineCatalogInputError('invalid_ingredient');
  const ingredientId = optionalId(value.ingredientId);
  const roleValue = textValue(value.role, 40) || 'active';
  if (!ingredientId || !isMedicineIngredientRole(roleValue)) {
    throw new InvalidMedicineCatalogInputError('invalid_ingredient');
  }

  const numeratorValue = decimal(value.numeratorValue);
  const numeratorUnit = textValue(value.numeratorUnit, limits.strengthUnit);
  const denominatorValue = decimal(value.denominatorValue);
  const denominatorUnit = textValue(value.denominatorUnit, limits.strengthUnit);
  if (
    Boolean(numeratorValue) !== Boolean(numeratorUnit) ||
    Boolean(denominatorValue) !== Boolean(denominatorUnit) ||
    (denominatorValue && !numeratorValue)
  ) {
    throw new InvalidMedicineCatalogInputError('invalid_strength');
  }

  return {
    id: optionalId(value.id),
    ingredientId,
    role: roleValue,
    numeratorValue,
    numeratorUnit,
    denominatorValue,
    denominatorUnit,
    strengthText: textValue(value.strengthText, limits.strengthText),
    basisOfStrengthText: textValue(value.basisOfStrengthText, limits.strengthText),
    ...source(value),
  };
}

function structure(data: FormData) {
  const raw = data.get('structure');
  if (typeof raw !== 'string') throw new InvalidMedicineCatalogInputError('invalid_structure');
  if (new TextEncoder().encode(raw).byteLength > MAX_STRUCTURE_BYTES) {
    throw new InvalidMedicineCatalogInputError('structure_too_large');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
}

function childRows(value: Record<string, unknown>) {
  if (!Array.isArray(value.names) || value.names.length > MAX_NAMES) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
  if (!Array.isArray(value.identifiers) || value.identifiers.length > MAX_IDENTIFIERS) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
  const names = value.names.map(parseName);
  const identifiers = value.identifiers.map(parseIdentifier);
  const ids = [...names, ...identifiers].flatMap((item) => (item.id ? [item.id] : []));
  if (new Set(ids).size !== ids.length) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
  return { names, identifiers };
}

function status(data: FormData) {
  const value = formText(data, 'status', 40) || 'active';
  if (!isMedicineCatalogStatus(value)) {
    throw new InvalidMedicineCatalogInputError('invalid_status');
  }
  return value;
}

export function parseMedicineIngredientInput(data: FormData): MedicineIngredientInput {
  const canonicalName = formText(data, 'canonicalName', limits.name, true);
  if (!canonicalName) throw new InvalidMedicineCatalogInputError('missing_name');
  const children = childRows(structure(data));
  return {
    canonicalName,
    status: status(data),
    notes: formText(data, 'notes', limits.notes),
    names: children.names.length
      ? children.names
      : [{
          id: null,
          name: canonicalName,
          languageTag: 'und',
          nameType: 'preferred',
          jurisdiction: null,
          preferred: true,
          sourceKind: 'manual',
          sourceProvider: null,
          sourceUrl: null,
          sourceRetrievedAt: null,
        }],
    identifiers: children.identifiers,
  };
}

export function parseMedicineProductInput(data: FormData): MedicineProductInput {
  const displayName = formText(data, 'displayName', limits.name, true);
  if (!displayName) throw new InvalidMedicineCatalogInputError('missing_name');
  const productTypeValue = formText(data, 'productType', 40) || 'other';
  if (!isMedicineProductType(productTypeValue)) {
    throw new InvalidMedicineCatalogInputError('invalid_product_type');
  }
  const parsedStructure = structure(data);
  const children = childRows(parsedStructure);
  if (!Array.isArray(parsedStructure.ingredients) || parsedStructure.ingredients.length > MAX_INGREDIENTS) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }
  const ingredients = parsedStructure.ingredients.map(parseProductIngredient);
  if (new Set(ingredients.map((item) => item.ingredientId)).size !== ingredients.length) {
    throw new InvalidMedicineCatalogInputError('invalid_ingredient');
  }
  const ingredientRowIds = ingredients.flatMap((item) => (item.id ? [item.id] : []));
  if (new Set(ingredientRowIds).size !== ingredientRowIds.length) {
    throw new InvalidMedicineCatalogInputError('invalid_structure');
  }

  return {
    displayName,
    productType: productTypeValue,
    status: status(data),
    doseFormText: formText(data, 'doseFormText', limits.terminologyText),
    doseFormSystem: formText(data, 'doseFormSystem', limits.system),
    doseFormCode: formText(data, 'doseFormCode', limits.code),
    routeText: formText(data, 'routeText', limits.terminologyText),
    routeSystem: formText(data, 'routeSystem', limits.system),
    routeCode: formText(data, 'routeCode', limits.code),
    strengthText: formText(data, 'strengthText', limits.strengthText),
    manufacturer: formText(data, 'manufacturer', limits.manufacturer),
    marketingAuthorizationHolder: formText(
      data,
      'marketingAuthorizationHolder',
      limits.manufacturer,
    ),
    marketCountry: jurisdiction(data.get('marketCountry')),
    packageDescription: formText(data, 'packageDescription', limits.packageDescription),
    imprint: formText(data, 'imprint', limits.appearance),
    color: formText(data, 'color', limits.appearance),
    shape: formText(data, 'shape', limits.appearance),
    notes: formText(data, 'notes', limits.notes),
    names: children.names.length
      ? children.names
      : [{
          id: null,
          name: displayName,
          languageTag: 'und',
          nameType: 'preferred',
          jurisdiction: null,
          preferred: true,
          sourceKind: 'manual',
          sourceProvider: null,
          sourceUrl: null,
          sourceRetrievedAt: null,
        }],
    identifiers: children.identifiers,
    ingredients,
  };
}

export { normalizedMedicineCatalogName };
