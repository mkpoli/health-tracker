import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  medicineCatalogStatuses,
  medicineProductTypes,
  normalizedMedicineCatalogName,
  type MedicineCatalogIdentifierRecord,
  type MedicineCatalogNameRecord,
  type MedicineCatalogSource,
  type MedicineIngredientRecord,
  type MedicineProductIngredientRecord,
  type MedicineProductRecord,
} from '$lib/medicine-catalog';
import { db } from '$lib/server/db';
import {
  medicineCatalogIdentifier,
  medicineCatalogName,
  medicineCatalogRevision,
  medicineIngredient,
  medicineProduct,
  medicineProductIngredient,
} from '$lib/server/db/schema';
import {
  InvalidMedicineCatalogInputError,
  parseMedicineIngredientInput,
  parseMedicineProductInput,
} from '$lib/server/medicine-catalog';
import {
  createMedicineIngredient,
  createMedicineProduct,
  getMedicineIngredientRecord,
  getMedicineProductRecord,
  InvalidMedicineCatalogReferenceError,
  updateMedicineIngredient,
  updateMedicineProduct,
} from '$lib/server/medicine-catalog-mutations';
import {
  buildMedicineIngredientRecords,
  buildMedicineProductRecords,
  toMedicineCatalogRevision,
} from '$lib/server/medicine-catalog-records';
import { StaleClaimRevisionError } from '$lib/server/claim-revisions';
import { capResult } from './budget';
import { requirePatient, ToolError, type McpContext } from './context';
import type { ToolDefinition } from './tools';

const MAX_CATALOG_PAGE = 100;
const REQUEST_ID_LIMIT = 128;

const sourceProperties = {
  source_kind: { type: 'string', maxLength: 80 },
  source_provider: { type: ['string', 'null'], maxLength: 200 },
  source_url: { type: ['string', 'null'], maxLength: 2000 },
  source_retrieved_at: { type: ['string', 'null'], format: 'date-time' },
} as const;

const nameSchema = {
  type: 'object',
  properties: {
    name_id: { type: ['string', 'null'], maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 300 },
    language_tag: { type: 'string', maxLength: 100 },
    name_type: { type: 'string', enum: ['preferred', 'brand', 'generic', 'synonym'] },
    jurisdiction: { type: ['string', 'null'], pattern: '^[A-Za-z]{2}$' },
    preferred: { type: 'boolean' },
    ...sourceProperties,
  },
  required: ['name'],
  additionalProperties: false,
} as const;

const identifierSchema = {
  type: 'object',
  properties: {
    identifier_id: { type: ['string', 'null'], maxLength: 128 },
    system: { type: 'string', minLength: 1, maxLength: 300 },
    code: { type: 'string', minLength: 1, maxLength: 500 },
    jurisdiction: { type: ['string', 'null'], pattern: '^[A-Za-z]{2}$' },
    ...sourceProperties,
  },
  required: ['system', 'code'],
  additionalProperties: false,
} as const;

const componentSchema = {
  type: 'object',
  properties: {
    component_id: { type: ['string', 'null'], maxLength: 128 },
    ingredient_id: { type: 'string', minLength: 1, maxLength: 128 },
    role: { type: 'string', enum: ['active', 'inactive', 'unknown'] },
    numerator_value: { type: ['string', 'null'], maxLength: 64 },
    numerator_unit: { type: ['string', 'null'], maxLength: 80 },
    denominator_value: { type: ['string', 'null'], maxLength: 64 },
    denominator_unit: { type: ['string', 'null'], maxLength: 80 },
    strength_text: { type: ['string', 'null'], maxLength: 300 },
    basis_of_strength_text: { type: ['string', 'null'], maxLength: 300 },
    ...sourceProperties,
  },
  required: ['ingredient_id'],
  additionalProperties: false,
} as const;

function owns(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, field: string, limit: number, required = false) {
  if (value === null || value === undefined) {
    if (required) throw new ToolError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ToolError(`${field} must be text`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length > limit) throw new ToolError(`${field} is too long`);
  if (required && !normalized) throw new ToolError(`${field} is required`);
  return normalized || null;
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ToolError(`${field} must be a positive integer`);
  }
  return Number(value);
}

function pageLimit(value: unknown) {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_CATALOG_PAGE) {
    throw new ToolError(`limit must be an integer from 1 through ${MAX_CATALOG_PAGE}`);
  }
  return Number(value);
}

function requestId(value: unknown) {
  const id = text(value, 'request_id', REQUEST_ID_LIMIT, true);
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new ToolError(`request_id must contain 1 to ${REQUEST_ID_LIMIT} visible characters`);
  }
  return id;
}

function sourceObject(value: Record<string, unknown>) {
  return {
    sourceKind: text(value.source_kind, 'source_kind', 80) || 'manual',
    sourceProvider: text(value.source_provider, 'source_provider', 200),
    sourceUrl: text(value.source_url, 'source_url', 2_000),
    sourceRetrievedAt: text(value.source_retrieved_at, 'source_retrieved_at', 64),
  };
}

function objectArray(value: unknown, field: string, maximum: number) {
  if (value === undefined) return [] as Record<string, unknown>[];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ToolError(`${field} must contain at most ${maximum} items`);
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ToolError(`${field} contains an invalid item`);
    }
    return item as Record<string, unknown>;
  });
}

function catalogName(value: Record<string, unknown>) {
  if (owns(value, 'preferred') && typeof value.preferred !== 'boolean') {
    throw new ToolError('names.preferred must be true or false');
  }
  return {
    id: text(value.name_id ?? value.id, 'names.name_id', 128),
    name: text(value.name, 'names.name', 300, true),
    languageTag: text(value.language_tag, 'names.language_tag', 100) || 'und',
    nameType: text(value.name_type, 'names.name_type', 40) || 'preferred',
    jurisdiction: text(value.jurisdiction, 'names.jurisdiction', 2),
    preferred: value.preferred === true,
    ...sourceObject(value),
  };
}

function catalogIdentifier(value: Record<string, unknown>) {
  return {
    id: text(value.identifier_id ?? value.id, 'identifiers.identifier_id', 128),
    system: text(value.system, 'identifiers.system', 300, true),
    code: text(value.code, 'identifiers.code', 500, true),
    jurisdiction: text(value.jurisdiction, 'identifiers.jurisdiction', 2),
    ...sourceObject(value),
  };
}

function productComponent(value: Record<string, unknown>) {
  return {
    id: text(value.component_id ?? value.id, 'ingredients.component_id', 128),
    ingredientId: text(value.ingredient_id, 'ingredients.ingredient_id', 128, true),
    role: text(value.role, 'ingredients.role', 40) || 'active',
    numeratorValue: text(value.numerator_value, 'ingredients.numerator_value', 64),
    numeratorUnit: text(value.numerator_unit, 'ingredients.numerator_unit', 80),
    denominatorValue: text(value.denominator_value, 'ingredients.denominator_value', 64),
    denominatorUnit: text(value.denominator_unit, 'ingredients.denominator_unit', 80),
    strengthText: text(value.strength_text, 'ingredients.strength_text', 300),
    basisOfStrengthText: text(
      value.basis_of_strength_text,
      'ingredients.basis_of_strength_text',
      300,
    ),
    ...sourceObject(value),
  };
}

function setOptional(data: FormData, key: string, value: unknown, limit: number) {
  data.set(key, text(value, key, limit) || '');
}

function ingredientForm(args: Record<string, unknown>) {
  const data = new FormData();
  data.set('canonicalName', text(args.canonical_name, 'canonical_name', 300, true) || '');
  data.set('status', text(args.status, 'status', 40) || 'active');
  setOptional(data, 'notes', args.notes, 4_000);
  data.set(
    'structure',
    JSON.stringify({
      names: objectArray(args.names, 'names', 30).map(catalogName),
      identifiers: objectArray(args.identifiers, 'identifiers', 30).map(catalogIdentifier),
    }),
  );
  return data;
}

function productForm(args: Record<string, unknown>) {
  const data = new FormData();
  data.set('displayName', text(args.display_name, 'display_name', 300, true) || '');
  data.set('productType', text(args.product_type, 'product_type', 40) || 'other');
  data.set('status', text(args.status, 'status', 40) || 'active');
  setOptional(data, 'doseFormText', args.dose_form, 300);
  setOptional(data, 'doseFormSystem', args.dose_form_system, 300);
  setOptional(data, 'doseFormCode', args.dose_form_code, 500);
  setOptional(data, 'routeText', args.route, 300);
  setOptional(data, 'routeSystem', args.route_system, 300);
  setOptional(data, 'routeCode', args.route_code, 500);
  setOptional(data, 'strengthText', args.strength, 300);
  setOptional(data, 'manufacturer', args.manufacturer, 300);
  setOptional(data, 'marketingAuthorizationHolder', args.authorization_holder, 300);
  setOptional(data, 'marketCountry', args.market_country, 2);
  setOptional(data, 'packageDescription', args.package_description, 1_000);
  setOptional(data, 'imprint', args.imprint, 200);
  setOptional(data, 'color', args.color, 200);
  setOptional(data, 'shape', args.shape, 200);
  setOptional(data, 'notes', args.notes, 4_000);
  data.set(
    'structure',
    JSON.stringify({
      names: objectArray(args.names, 'names', 30).map(catalogName),
      identifiers: objectArray(args.identifiers, 'identifiers', 30).map(catalogIdentifier),
      ingredients: objectArray(args.ingredients, 'ingredients', 30).map(productComponent),
    }),
  );
  return data;
}

function parseIngredient(args: Record<string, unknown>) {
  try {
    return parseMedicineIngredientInput(ingredientForm(args));
  } catch (error) {
    if (error instanceof InvalidMedicineCatalogInputError) {
      throw new ToolError(`Invalid medicine ingredient: ${error.code}`);
    }
    throw error;
  }
}

function parseProduct(args: Record<string, unknown>) {
  try {
    return parseMedicineProductInput(productForm(args));
  } catch (error) {
    if (error instanceof InvalidMedicineCatalogInputError) {
      throw new ToolError(`Invalid medicine product: ${error.code}`);
    }
    throw error;
  }
}

function sourceData(value: unknown) {
  if (value === undefined || value === null) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024) {
      throw new Error('large');
    }
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new ToolError('source_data must be valid JSON smaller than 2 MB');
  }
}

function mcpProvider(ctx: McpContext) {
  return `mcp:${ctx.clientId}`.slice(0, 300);
}

async function stableCatalogId(
  ctx: McpContext,
  patientId: string,
  kind: 'ingredient' | 'product',
  key: string,
) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        `health-tracker-mcp-catalog\0${ctx.userId}\0${ctx.clientId}\0${patientId}\0${kind}\0${key}`,
      ),
    ),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function serializeSource(value: MedicineCatalogSource) {
  return {
    source_kind: value.sourceKind,
    source_provider: value.sourceProvider,
    source_url: value.sourceUrl,
    source_retrieved_at: value.sourceRetrievedAt,
  };
}

function serializeName(value: MedicineCatalogNameRecord) {
  return {
    name_id: value.id,
    name: value.name,
    language_tag: value.languageTag,
    name_type: value.nameType,
    jurisdiction: value.jurisdiction,
    preferred: value.preferred,
    ...serializeSource(value),
  };
}

function serializeIdentifier(value: MedicineCatalogIdentifierRecord) {
  return {
    identifier_id: value.id,
    system: value.system,
    code: value.code,
    jurisdiction: value.jurisdiction,
    ...serializeSource(value),
  };
}

function serializeIngredient(value: MedicineIngredientRecord) {
  return {
    ingredient_id: value.id,
    patient_id: value.patientId,
    canonical_name: value.canonicalName,
    status: value.status,
    notes: value.notes,
    names: value.names.map(serializeName),
    identifiers: value.identifiers.map(serializeIdentifier),
    origin: {
      kind: value.originKind,
      provider: value.originProvider,
      external_id: value.originExternalId,
    },
    source_data: sourceDataSummary(value.sourceData),
    revision: value.revision,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function serializeComponent(value: MedicineProductIngredientRecord) {
  return {
    component_id: value.id,
    ingredient_id: value.ingredientId,
    ingredient: serializeIngredient(value.ingredient),
    role: value.role,
    numerator_value: value.numeratorValue,
    numerator_unit: value.numeratorUnit,
    denominator_value: value.denominatorValue,
    denominator_unit: value.denominatorUnit,
    strength_text: value.strengthText,
    basis_of_strength_text: value.basisOfStrengthText,
    ...serializeSource(value),
  };
}

function serializeProduct(value: MedicineProductRecord) {
  return {
    product_id: value.id,
    patient_id: value.patientId,
    display_name: value.displayName,
    product_type: value.productType,
    status: value.status,
    dose_form: value.doseFormText,
    dose_form_code: value.doseFormCode
      ? { system: value.doseFormSystem, code: value.doseFormCode }
      : null,
    route: value.routeText,
    route_code: value.routeCode ? { system: value.routeSystem, code: value.routeCode } : null,
    strength: value.strengthText,
    manufacturer: value.manufacturer,
    authorization_holder: value.marketingAuthorizationHolder,
    market_country: value.marketCountry,
    package_description: value.packageDescription,
    appearance: { imprint: value.imprint, color: value.color, shape: value.shape },
    notes: value.notes,
    names: value.names.map(serializeName),
    identifiers: value.identifiers.map(serializeIdentifier),
    ingredients: value.ingredients.map(serializeComponent),
    origin: {
      kind: value.originKind,
      provider: value.originProvider,
      external_id: value.originExternalId,
    },
    source_data: sourceDataSummary(value.sourceData),
    revision: value.revision,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function sourceDataSummary(value: unknown) {
  if (value === null || value === undefined) return { available: false, byte_size: 0 };
  const serialized = JSON.stringify(value);
  return {
    available: true,
    byte_size: new TextEncoder().encode(serialized).byteLength,
  };
}

function inputSource(value: MedicineCatalogSource) {
  return serializeSource(value);
}

function inputName(value: MedicineCatalogNameRecord) {
  return {
    name_id: value.id,
    name: value.name,
    language_tag: value.languageTag,
    name_type: value.nameType,
    jurisdiction: value.jurisdiction,
    preferred: value.preferred,
    ...inputSource(value),
  };
}

function inputIdentifier(value: MedicineCatalogIdentifierRecord) {
  return {
    identifier_id: value.id,
    system: value.system,
    code: value.code,
    jurisdiction: value.jurisdiction,
    ...inputSource(value),
  };
}

function inputComponent(value: MedicineProductIngredientRecord) {
  return {
    component_id: value.id,
    ingredient_id: value.ingredientId,
    role: value.role,
    numerator_value: value.numeratorValue,
    numerator_unit: value.numeratorUnit,
    denominator_value: value.denominatorValue,
    denominator_unit: value.denominatorUnit,
    strength_text: value.strengthText,
    basis_of_strength_text: value.basisOfStrengthText,
    ...inputSource(value),
  };
}

function mergedIngredientArgs(current: MedicineIngredientRecord, args: Record<string, unknown>) {
  return {
    ...args,
    canonical_name: owns(args, 'canonical_name') ? args.canonical_name : current.canonicalName,
    status: owns(args, 'status') ? args.status : current.status,
    notes: owns(args, 'notes') ? args.notes : current.notes,
    names: owns(args, 'names') ? args.names : current.names.map(inputName),
    identifiers: owns(args, 'identifiers')
      ? args.identifiers
      : current.identifiers.map(inputIdentifier),
  };
}

function mergedProductArgs(current: MedicineProductRecord, args: Record<string, unknown>) {
  const fallback: Record<string, unknown> = {
    display_name: current.displayName,
    product_type: current.productType,
    status: current.status,
    dose_form: current.doseFormText,
    dose_form_system: current.doseFormSystem,
    dose_form_code: current.doseFormCode,
    route: current.routeText,
    route_system: current.routeSystem,
    route_code: current.routeCode,
    strength: current.strengthText,
    manufacturer: current.manufacturer,
    authorization_holder: current.marketingAuthorizationHolder,
    market_country: current.marketCountry,
    package_description: current.packageDescription,
    imprint: current.imprint,
    color: current.color,
    shape: current.shape,
    notes: current.notes,
    names: current.names.map(inputName),
    identifiers: current.identifiers.map(inputIdentifier),
    ingredients: current.ingredients.map(inputComponent),
  };
  for (const key of Object.keys(fallback)) {
    if (owns(args, key)) fallback[key] = args[key];
  }
  return { ...args, ...fallback };
}

async function loadIngredientRecords(
  patientId: string,
  roots: Array<typeof medicineIngredient.$inferSelect>,
) {
  if (roots.length === 0) return [];
  const ids = roots.map((root) => root.id);
  const names = await db
    .select()
    .from(medicineCatalogName)
    .where(
      and(
        eq(medicineCatalogName.patientId, patientId),
        inArray(medicineCatalogName.ingredientId, ids),
      ),
    );
  const identifiers = await db
    .select()
    .from(medicineCatalogIdentifier)
    .where(
      and(
        eq(medicineCatalogIdentifier.patientId, patientId),
        inArray(medicineCatalogIdentifier.ingredientId, ids),
      ),
    );
  return buildMedicineIngredientRecords(roots, names, identifiers);
}

async function loadProductRecords(
  patientId: string,
  roots: Array<typeof medicineProduct.$inferSelect>,
) {
  if (roots.length === 0) return [];
  const ids = roots.map((root) => root.id);
  const names = await db
    .select()
    .from(medicineCatalogName)
    .where(
      and(
        eq(medicineCatalogName.patientId, patientId),
        inArray(medicineCatalogName.productId, ids),
      ),
    );
  const identifiers = await db
    .select()
    .from(medicineCatalogIdentifier)
    .where(
      and(
        eq(medicineCatalogIdentifier.patientId, patientId),
        inArray(medicineCatalogIdentifier.productId, ids),
      ),
    );
  const components = await db
    .select()
    .from(medicineProductIngredient)
    .where(
      and(
        eq(medicineProductIngredient.patientId, patientId),
        inArray(medicineProductIngredient.productId, ids),
      ),
    );
  const ingredientIds = [...new Set(components.map((component) => component.ingredientId))];
  const ingredientRoots = ingredientIds.length
    ? await db
        .select()
        .from(medicineIngredient)
        .where(
          and(
            eq(medicineIngredient.patientId, patientId),
            inArray(medicineIngredient.id, ingredientIds),
          ),
        )
    : [];
  const ingredients = await loadIngredientRecords(patientId, ingredientRoots);
  return buildMedicineProductRecords(roots, names, identifiers, components, ingredients);
}

const listMedicineCatalog: ToolDefinition = {
  name: 'list_medicine_catalog',
  title: 'List medicine catalog entries',
  description:
    'Packaged medicine products and their ingredients, localized names, identifiers, strengths, routes, appearance, provenance, and current revisions.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      query: { type: 'string', maxLength: 200 },
      status: { type: 'string', enum: medicineCatalogStatuses },
      limit: { type: 'integer', minimum: 1, maximum: MAX_CATALOG_PAGE },
    },
    required: ['patient_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const query = text(args.query, 'query', 200);
    const normalizedQuery = query ? normalizedMedicineCatalogName(query) : null;
    const status = text(args.status, 'status', 40);
    if (status && !medicineCatalogStatuses.includes(status as never)) {
      throw new ToolError('status is invalid');
    }
    const limit = pageLimit(args.limit);
    const ingredientConditions = [eq(medicineIngredient.patientId, profile.id)];
    const productConditions = [eq(medicineProduct.patientId, profile.id)];
    if (status) {
      ingredientConditions.push(eq(medicineIngredient.status, status));
      productConditions.push(eq(medicineProduct.status, status));
    }
    if (query && normalizedQuery) {
      // SQLite's lower() folds ASCII only, so display names are folded here.
      const displayNames = await db
        .select({ id: medicineProduct.id, displayName: medicineProduct.displayName })
        .from(medicineProduct)
        .where(eq(medicineProduct.patientId, profile.id));
      const matchedProductIds = displayNames
        .filter((row) => normalizedMedicineCatalogName(row.displayName).includes(normalizedQuery))
        .map((row) => row.id);
      ingredientConditions.push(
        or(
          sql`instr(${medicineIngredient.normalizedName}, ${normalizedQuery}) > 0`,
          sql`exists (select 1 from medicine_catalog_name where medicine_catalog_name.patient_id = ${profile.id} and medicine_catalog_name.ingredient_id = ${medicineIngredient.id} and instr(medicine_catalog_name.normalized_name, ${normalizedQuery}) > 0)`,
        ) as typeof ingredientConditions[number],
      );
      productConditions.push(
        or(
          matchedProductIds.length ? inArray(medicineProduct.id, matchedProductIds) : sql`0`,
          sql`exists (select 1 from medicine_catalog_name where medicine_catalog_name.patient_id = ${profile.id} and medicine_catalog_name.product_id = ${medicineProduct.id} and instr(medicine_catalog_name.normalized_name, ${normalizedQuery}) > 0)`,
        ) as typeof productConditions[number],
      );
    }

    const ingredientWhere = and(...ingredientConditions);
    const productWhere = and(...productConditions);
    const ingredientRoots = await db
      .select()
      .from(medicineIngredient)
      .where(ingredientWhere)
      .orderBy(desc(medicineIngredient.updatedAt))
      .limit(limit);
    const productRoots = await db
      .select()
      .from(medicineProduct)
      .where(productWhere)
      .orderBy(desc(medicineProduct.updatedAt))
      .limit(limit);
    const ingredientTotal = await db
      .select({ value: count() })
      .from(medicineIngredient)
      .where(ingredientWhere);
    const productTotal = await db
      .select({ value: count() })
      .from(medicineProduct)
      .where(productWhere);
    const ingredients = await loadIngredientRecords(profile.id, ingredientRoots);
    const products = await loadProductRecords(profile.id, productRoots);
    return capResult({
      patient_id: profile.id,
      ingredient_total: ingredientTotal[0]?.value ?? 0,
      product_total: productTotal[0]?.value ?? 0,
      ingredients: ingredients.map(serializeIngredient),
      products: products.map(serializeProduct),
      truncated:
        Number(ingredientTotal[0]?.value ?? 0) > ingredients.length ||
        Number(productTotal[0]?.value ?? 0) > products.length,
    });
  },
};

const getMedicineCatalogHistory: ToolDefinition = {
  name: 'get_medicine_catalog_history',
  title: 'Get medicine catalog history',
  description:
    'Saved versions of one medicine ingredient or product, newest first. Each version includes its complete snapshot and change source.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      entity_kind: { type: 'string', enum: ['ingredient', 'product'] },
      entity_id: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_CATALOG_PAGE },
    },
    required: ['patient_id', 'entity_kind', 'entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const kind = text(args.entity_kind, 'entity_kind', 40, true);
    if (kind !== 'ingredient' && kind !== 'product') {
      throw new ToolError('entity_kind must be ingredient or product');
    }
    const id = text(args.entity_id, 'entity_id', 128, true) || '';
    const current = kind === 'ingredient'
      ? await getMedicineIngredientRecord(profile.id, id)
      : await getMedicineProductRecord(profile.id, id);
    if (!current) throw new ToolError('No such medicine catalog entry');
    const limit = pageLimit(args.limit);
    const where = and(
      eq(medicineCatalogRevision.patientId, profile.id),
      eq(medicineCatalogRevision.entityKind, kind),
      eq(medicineCatalogRevision.entityId, id),
    );
    const rows = await db
      .select()
      .from(medicineCatalogRevision)
      .where(where)
      .orderBy(desc(medicineCatalogRevision.revision))
      .limit(limit);
    const totals = await db
      .select({ value: count() })
      .from(medicineCatalogRevision)
      .where(where);
    const revisions = rows.flatMap((row) => {
      const revision = toMedicineCatalogRevision(row);
      if (!revision) return [];
      return [{
        revision: revision.revision,
        changed_at: revision.changedAt,
        change_source: {
          kind: revision.changeOriginKind,
          provider: revision.changeOriginProvider,
        },
        snapshot: revision.entityKind === 'ingredient'
          ? serializeIngredient(revision.snapshot as MedicineIngredientRecord)
          : serializeProduct(revision.snapshot as MedicineProductRecord),
      }];
    });
    return capResult({
      patient_id: profile.id,
      entity_kind: kind,
      entity_id: id,
      current: kind === 'ingredient'
        ? serializeIngredient(current as MedicineIngredientRecord)
        : serializeProduct(current as MedicineProductRecord),
      total: totals[0]?.value ?? 0,
      revisions,
      truncated: Number(totals[0]?.value ?? 0) > revisions.length,
    });
  },
};

const readMedicineCatalogSource: ToolDefinition = {
  name: 'read_medicine_catalog_source',
  title: 'Read medicine catalog source data',
  description:
    'Read a bounded JSON chunk from the current or saved-version source payload of one medicine ingredient or product. Continue from next_offset until complete.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      entity_kind: { type: 'string', enum: ['ingredient', 'product'] },
      entity_id: { type: 'string' },
      revision: { type: 'integer', minimum: 1 },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Zero-based Unicode code-point offset returned by the previous call.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10_000,
        description: 'Maximum number of Unicode code points to return.',
      },
    },
    required: ['patient_id', 'entity_kind', 'entity_id'],
    additionalProperties: false,
  },
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const kind = text(args.entity_kind, 'entity_kind', 40, true);
    if (kind !== 'ingredient' && kind !== 'product') {
      throw new ToolError('entity_kind must be ingredient or product');
    }
    const id = text(args.entity_id, 'entity_id', 128, true) || '';
    const current = kind === 'ingredient'
      ? await getMedicineIngredientRecord(profile.id, id)
      : await getMedicineProductRecord(profile.id, id);
    if (!current) throw new ToolError('No such medicine catalog entry');
    const requestedRevision = args.revision === undefined
      ? null
      : positiveInteger(args.revision, 'revision');
    let selected = current;
    if (requestedRevision !== null) {
      const rows = await db
        .select()
        .from(medicineCatalogRevision)
        .where(
          and(
            eq(medicineCatalogRevision.patientId, profile.id),
            eq(medicineCatalogRevision.entityKind, kind),
            eq(medicineCatalogRevision.entityId, id),
            eq(medicineCatalogRevision.revision, requestedRevision),
          ),
        )
        .limit(1);
      const saved = rows[0] ? toMedicineCatalogRevision(rows[0]) : null;
      if (!saved) throw new ToolError('No such medicine catalog revision');
      selected = saved.snapshot as typeof current;
    }
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    const limit = args.limit === undefined ? 8_000 : Number(args.limit);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new ToolError('offset must be a non-negative integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new ToolError('limit must be an integer from 1 through 10000');
    }
    const serialized = JSON.stringify(selected.sourceData ?? null);
    const characters = Array.from(serialized);
    if (offset > characters.length) throw new ToolError('offset is past the source payload');
    const chunk = characters.slice(offset, offset + limit).join('');
    const nextOffset = offset + Array.from(chunk).length;
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized)),
    );
    return {
      patient_id: profile.id,
      entity_kind: kind,
      entity_id: id,
      revision: selected.revision,
      encoding: 'json',
      offset_unit: 'unicode_code_point',
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      total_characters: characters.length,
      offset,
      chunk,
      next_offset: nextOffset < characters.length ? nextOffset : null,
      complete: nextOffset >= characters.length,
    };
  },
};

const ingredientProperties = {
  canonical_name: { type: 'string', minLength: 1, maxLength: 300 },
  status: { type: 'string', enum: medicineCatalogStatuses },
  notes: { type: ['string', 'null'], maxLength: 4000 },
  names: { type: 'array', maxItems: 30, items: nameSchema },
  identifiers: { type: 'array', maxItems: 30, items: identifierSchema },
  source_data: {},
} as const;

const ingredientUpdateFields = Object.keys(ingredientProperties);

const productProperties = {
  display_name: { type: 'string', minLength: 1, maxLength: 300 },
  product_type: { type: 'string', enum: medicineProductTypes },
  status: { type: 'string', enum: medicineCatalogStatuses },
  dose_form: { type: ['string', 'null'], maxLength: 300 },
  dose_form_system: { type: ['string', 'null'], maxLength: 300 },
  dose_form_code: { type: ['string', 'null'], maxLength: 500 },
  route: { type: ['string', 'null'], maxLength: 300 },
  route_system: { type: ['string', 'null'], maxLength: 300 },
  route_code: { type: ['string', 'null'], maxLength: 500 },
  strength: { type: ['string', 'null'], maxLength: 300 },
  manufacturer: { type: ['string', 'null'], maxLength: 300 },
  authorization_holder: { type: ['string', 'null'], maxLength: 300 },
  market_country: { type: ['string', 'null'], pattern: '^[A-Za-z]{2}$' },
  package_description: { type: ['string', 'null'], maxLength: 1000 },
  imprint: { type: ['string', 'null'], maxLength: 200 },
  color: { type: ['string', 'null'], maxLength: 200 },
  shape: { type: ['string', 'null'], maxLength: 200 },
  notes: { type: ['string', 'null'], maxLength: 4000 },
  names: { type: 'array', maxItems: 30, items: nameSchema },
  identifiers: { type: 'array', maxItems: 30, items: identifierSchema },
  ingredients: { type: 'array', maxItems: 30, items: componentSchema },
  source_data: {},
} as const;

const productUpdateFields = Object.keys(productProperties);

const createMedicineIngredientTool: ToolDefinition = {
  name: 'create_medicine_ingredient',
  title: 'Create a medicine ingredient',
  description:
    'Create a reusable ingredient with localized names, terminology identifiers, provenance, and an editable revision history. Reuse request_id when retrying.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      request_id: { type: 'string', minLength: 1, maxLength: REQUEST_ID_LIMIT },
      ...ingredientProperties,
    },
    required: ['patient_id', 'request_id', 'canonical_name'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const key = requestId(args.request_id);
    const provider = mcpProvider(ctx);
    const id = await stableCatalogId(ctx, profile.id, 'ingredient', key);
    const existing = await getMedicineIngredientRecord(profile.id, id);
    if (existing) {
      if (
        existing.originKind !== 'mcp' ||
        existing.originProvider !== provider ||
        existing.originExternalId !== key
      ) {
        throw new ToolError('Ingredient identifier collision');
      }
      return { created: false, ingredient: serializeIngredient(existing) };
    }
    const ingredient = await createMedicineIngredient({
      id,
      patientId: profile.id,
      input: parseIngredient(args),
      origin: {
        kind: 'mcp',
        provider,
        externalId: key,
        sourceData: sourceData(args.source_data),
      },
    });
    return { created: true, ingredient: serializeIngredient(ingredient) };
  },
};

const updateMedicineIngredientTool: ToolDefinition = {
  name: 'update_medicine_ingredient',
  title: 'Update a medicine ingredient',
  description:
    'Change selected ingredient fields. Omitted fields keep their current values. expected_revision protects a newer human or agent edit from being overwritten.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      ingredient_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      ...ingredientProperties,
    },
    required: ['patient_id', 'ingredient_id', 'expected_revision'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.ingredient_id, 'ingredient_id', 128, true) || '';
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    const current = await getMedicineIngredientRecord(profile.id, id);
    if (!current) throw new ToolError('No such medicine ingredient');
    if (!ingredientUpdateFields.some((field) => owns(args, field))) {
      throw new ToolError('Provide at least one ingredient field to change');
    }
    try {
      const ingredient = await updateMedicineIngredient({
        current,
        input: parseIngredient(mergedIngredientArgs(current, args)),
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
        ...(owns(args, 'source_data') ? { sourceData: sourceData(args.source_data) } : {}),
        changedAt: new Date(ctx.now).toISOString(),
      });
      return { updated: true, ingredient: serializeIngredient(ingredient) };
    } catch (error) {
      if (error instanceof StaleClaimRevisionError) {
        const latest = await getMedicineIngredientRecord(profile.id, id);
        throw new ToolError(`Revision conflict; current_revision is ${latest?.revision ?? 'unknown'}`);
      }
      throw error;
    }
  },
};

const createMedicineProductTool: ToolDefinition = {
  name: 'create_medicine_product',
  title: 'Create a medicine product',
  description:
    'Create a packaged or compounded product linked to reusable ingredients. Names, identifiers, route, form, strength, package, appearance, and source details are retained.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      request_id: { type: 'string', minLength: 1, maxLength: REQUEST_ID_LIMIT },
      ...productProperties,
    },
    required: ['patient_id', 'request_id', 'display_name'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const key = requestId(args.request_id);
    const provider = mcpProvider(ctx);
    const id = await stableCatalogId(ctx, profile.id, 'product', key);
    const existing = await getMedicineProductRecord(profile.id, id);
    if (existing) {
      if (
        existing.originKind !== 'mcp' ||
        existing.originProvider !== provider ||
        existing.originExternalId !== key
      ) {
        throw new ToolError('Product identifier collision');
      }
      return { created: false, product: serializeProduct(existing) };
    }
    try {
      const product = await createMedicineProduct({
        id,
        patientId: profile.id,
        input: parseProduct(args),
        origin: {
          kind: 'mcp',
          provider,
          externalId: key,
          sourceData: sourceData(args.source_data),
        },
      });
      return { created: true, product: serializeProduct(product) };
    } catch (error) {
      if (error instanceof InvalidMedicineCatalogReferenceError) {
        throw new ToolError('A medicine ingredient does not belong to this profile');
      }
      throw error;
    }
  },
};

const updateMedicineProductTool: ToolDefinition = {
  name: 'update_medicine_product',
  title: 'Update a medicine product',
  description:
    'Change selected product fields or its ingredient composition. Omitted fields keep their current values. expected_revision protects a newer edit from being overwritten.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      product_id: { type: 'string' },
      expected_revision: { type: 'integer', minimum: 1 },
      ...productProperties,
    },
    required: ['patient_id', 'product_id', 'expected_revision'],
    additionalProperties: false,
  },
  writes: true,
  writeCapability: 'claims',
  idempotent: true,
  handler: async (ctx, args) => {
    const profile = await requirePatient(ctx, args.patient_id);
    const id = text(args.product_id, 'product_id', 128, true) || '';
    const expectedRevision = positiveInteger(args.expected_revision, 'expected_revision');
    const current = await getMedicineProductRecord(profile.id, id);
    if (!current) throw new ToolError('No such medicine product');
    if (!productUpdateFields.some((field) => owns(args, field))) {
      throw new ToolError('Provide at least one product field to change');
    }
    try {
      const product = await updateMedicineProduct({
        current,
        input: parseProduct(mergedProductArgs(current, args)),
        expectedRevision,
        source: { kind: 'mcp', provider: mcpProvider(ctx) },
        ...(owns(args, 'source_data') ? { sourceData: sourceData(args.source_data) } : {}),
        changedAt: new Date(ctx.now).toISOString(),
      });
      return { updated: true, product: serializeProduct(product) };
    } catch (error) {
      if (error instanceof InvalidMedicineCatalogReferenceError) {
        throw new ToolError('A medicine ingredient does not belong to this profile');
      }
      if (error instanceof StaleClaimRevisionError) {
        const latest = await getMedicineProductRecord(profile.id, id);
        throw new ToolError(`Revision conflict; current_revision is ${latest?.revision ?? 'unknown'}`);
      }
      throw error;
    }
  },
};

export const medicineCatalogTools: ToolDefinition[] = [
  listMedicineCatalog,
  getMedicineCatalogHistory,
  readMedicineCatalogSource,
  createMedicineIngredientTool,
  updateMedicineIngredientTool,
  createMedicineProductTool,
  updateMedicineProductTool,
];
