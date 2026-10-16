import { and, desc, eq, getTableColumns, gt, gte, inArray, lt, or, sql } from 'drizzle-orm';
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
  parseMedicineCatalogCountry,
  parseMedicineProductInput,
} from '$lib/server/medicine-catalog';
import {
  createMedicineIngredient,
  createMedicineProduct,
  getMedicineIngredientRecord,
  getMedicineProductRecord,
  InvalidMedicineCatalogReferenceError,
  MedicineCatalogIdentifierCollisionError,
  updateMedicineIngredient,
  updateMedicineProduct,
} from '$lib/server/medicine-catalog-mutations';
import {
  buildMedicineIngredientRecords,
  buildMedicineProductRecords,
  toMedicineCatalogRevision,
} from '$lib/server/medicine-catalog-records';
import { StaleClaimRevisionError } from '$lib/server/claim-revisions';
import { capResult, MAX_RESULT_BYTES } from './budget';
import { owns, pageLimit, positiveInteger, requestId, mcpProvider } from './claim-tool-input';
import { stableClaimId, REQUEST_ID_LIMIT } from './claim-ids';
import { requirePatient, ToolError, type McpContext } from './context';
import type { ToolDefinition } from './tools';

const MAX_CATALOG_PAGE = 100;

function readColumns<T extends typeof medicineIngredient | typeof medicineProduct>(table: T) {
  return {
    ...getTableColumns(table),
    sourceData: sql<null>`null`,
    sourceDataBytes: sql<number | null>`length(cast(${table.sourceData} as blob))`,
  };
}

type SourceSize = { sourceDataBytes?: number | null };

function longestCursor(ids: string[]) {
  return ids.reduce<string | null>((longest, id) =>
    new TextEncoder().encode(JSON.stringify(id)).byteLength > new TextEncoder().encode(JSON.stringify(longest)).byteLength
      ? id : longest, null);
}

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
    ingredient: {
      type: 'object',
      description: 'Display reference returned by reads. ingredient_id above determines the link.',
      properties: {
        ingredient_id: { type: 'string', maxLength: 128 },
        canonical_name: { type: 'string', maxLength: 300 },
      },
      required: ['ingredient_id', 'canonical_name'],
      additionalProperties: false,
    },
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
    jurisdiction: parseMedicineCatalogCountry(value.jurisdiction),
    preferred: value.preferred === true,
    ...sourceObject(value),
  };
}

function catalogIdentifier(value: Record<string, unknown>) {
  return {
    id: text(value.identifier_id ?? value.id, 'identifiers.identifier_id', 128),
    system: text(value.system, 'identifiers.system', 300, true),
    code: text(value.code, 'identifiers.code', 500, true),
    jurisdiction: parseMedicineCatalogCountry(value.jurisdiction),
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
  data.set('marketCountry', parseMedicineCatalogCountry(args.market_country) || '');
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

function catalogReferenceError(error: InvalidMedicineCatalogReferenceError) {
  return new ToolError(error.code === 'ingredient'
    ? 'A medicine ingredient does not belong to this profile'
    : `Unknown ${error.code}; use an existing child id or omit it for a new row`);
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

function serializeSource(value: MedicineCatalogSource) {
  return {
    source_kind: value.sourceKind,
    source_provider: value.sourceProvider,
    source_url: value.sourceUrl,
    source_retrieved_at: value.sourceRetrievedAt,
  };
}

function serializeIngredient(value: MedicineIngredientRecord & SourceSize) {
  return {
    ingredient_id: value.id,
    patient_id: value.patientId,
    canonical_name: value.canonicalName,
    status: value.status,
    notes: value.notes,
    names: value.names.map(inputName),
    identifiers: value.identifiers.map(inputIdentifier),
    origin: {
      kind: value.originKind,
      provider: value.originProvider,
      external_id: value.originExternalId,
    },
    source_data_summary: sourceDataSummary(value),
    revision: value.revision,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function serializeComponent(value: MedicineProductIngredientRecord) {
  return {
    ...inputComponent(value),
    ingredient: { ingredient_id: value.ingredient.id, canonical_name: value.ingredient.canonicalName },
  };
}

function serializeProduct(value: MedicineProductRecord & SourceSize) {
  return {
    product_id: value.id,
    patient_id: value.patientId,
    display_name: value.displayName,
    product_type: value.productType,
    status: value.status,
    dose_form: value.doseFormText,
    dose_form_system: value.doseFormSystem,
    dose_form_code: value.doseFormCode,
    route: value.routeText,
    route_system: value.routeSystem,
    route_code: value.routeCode,
    strength: value.strengthText,
    manufacturer: value.manufacturer,
    authorization_holder: value.marketingAuthorizationHolder,
    market_country: value.marketCountry,
    package_description: value.packageDescription,
    imprint: value.imprint,
    color: value.color,
    shape: value.shape,
    notes: value.notes,
    names: value.names.map(inputName),
    identifiers: value.identifiers.map(inputIdentifier),
    ingredients: value.ingredients.map(serializeComponent),
    origin: {
      kind: value.originKind,
      provider: value.originProvider,
      external_id: value.originExternalId,
    },
    source_data_summary: sourceDataSummary(value),
    revision: value.revision,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
  };
}

function sourceDataSummary(record: { sourceData: unknown } & SourceSize) {
  if (record.sourceDataBytes !== undefined) {
    return { available: record.sourceDataBytes !== null, byte_size: record.sourceDataBytes ?? 0 };
  }
  const value = record.sourceData;
  if (value === null || value === undefined) return { available: false, byte_size: 0 };
  const serialized = JSON.stringify(value);
  return {
    available: true,
    byte_size: new TextEncoder().encode(serialized).byteLength,
  };
}

function inputName(value: MedicineCatalogNameRecord) {
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

function inputIdentifier(value: MedicineCatalogIdentifierRecord) {
  return {
    identifier_id: value.id,
    system: value.system,
    code: value.code,
    jurisdiction: value.jurisdiction,
    ...serializeSource(value),
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
    ...serializeSource(value),
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
  roots: Array<typeof medicineIngredient.$inferSelect & SourceSize>,
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
  return buildMedicineIngredientRecords(roots, names, identifiers).map((record, index) => ({
    ...record,
    sourceDataBytes: roots[index].sourceDataBytes,
  }));
}

async function loadProductRecords(
  patientId: string,
  roots: Array<typeof medicineProduct.$inferSelect & SourceSize>,
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
    .select({
      ...getTableColumns(medicineProductIngredient),
      ingredient: readColumns(medicineIngredient),
    })
    .from(medicineProductIngredient)
    .innerJoin(medicineIngredient, and(
      eq(medicineIngredient.id, medicineProductIngredient.ingredientId),
      eq(medicineIngredient.patientId, medicineProductIngredient.patientId),
    ))
    .where(and(
      eq(medicineProductIngredient.patientId, patientId),
      inArray(medicineProductIngredient.productId, ids),
    ));
  const ingredients = buildMedicineIngredientRecords(
    components.map((component) => component.ingredient), [], [],
  );
  return buildMedicineProductRecords(roots, names, identifiers, components, ingredients).map((record, index) => ({
    ...record,
    sourceDataBytes: roots[index].sourceDataBytes,
  }));
}

function isPair(value: string, index: number) {
  const high = value.charCodeAt(index);
  if (high < 0xd800 || high > 0xdbff || index + 1 >= value.length) return false;
  const low = value.charCodeAt(index + 1);
  return low >= 0xdc00 && low <= 0xdfff;
}

/** Counts code points in one pass without allocating an array of them. */
function countCodePoints(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index += isPair(value, index) ? 2 : 1) total += 1;
  return total;
}

/** Slices by code point, reading only up to the end of the requested range. */
function sliceCodePoints(value: string, offset: number, limit: number) {
  let index = 0;
  for (let skipped = 0; skipped < offset && index < value.length; skipped += 1) {
    index += isPair(value, index) ? 2 : 1;
  }
  const start = index;
  let length = 0;
  while (length < limit && index < value.length) {
    index += isPair(value, index) ? 2 : 1;
    length += 1;
  }
  return { chunk: value.slice(start, index), length };
}

const listMedicineCatalog: ToolDefinition = {
  name: 'list_medicine_catalog',
  title: 'List medicine catalog entries',
  description:
    'Scan a bounded page of medicine ingredients and products in ID order. Search matches normalized names within that page. Continue with next_ingredient_id and next_product_id, even when a page has no matches. Counts describe this page only.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      query: { type: 'string', maxLength: 200 },
      status: { type: 'string', enum: medicineCatalogStatuses },
      after_ingredient_id: { type: ['string', 'null'], maxLength: 128, description: 'Omit for the first page; null skips this exhausted stream.' },
      after_product_id: { type: ['string', 'null'], maxLength: 128, description: 'Omit for the first page; null skips this exhausted stream.' },
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
    const limit = pageLimit(args.limit, 50, MAX_CATALOG_PAGE);
    // These covering indexes bound candidates before substring/status filtering:
    // medicine_ingredient_patient_cursor_idx and medicine_product_patient_cursor_idx.
    const afterIngredient = text(args.after_ingredient_id, 'after_ingredient_id', 128);
    const afterProduct = text(args.after_product_id, 'after_product_id', 128);
    const ingredientPage = args.after_ingredient_id === null ? [] : await db.select({ id: medicineIngredient.id }).from(medicineIngredient)
      .where(and(eq(medicineIngredient.patientId, profile.id),
        afterIngredient ? gt(medicineIngredient.id, afterIngredient) : undefined))
      .orderBy(medicineIngredient.id).limit(limit + 1);
    const productPage = args.after_product_id === null ? [] : await db.select({ id: medicineProduct.id }).from(medicineProduct)
      .where(and(eq(medicineProduct.patientId, profile.id),
        afterProduct ? gt(medicineProduct.id, afterProduct) : undefined))
      .orderBy(medicineProduct.id).limit(limit + 1);
    const ingredientIds = ingredientPage.slice(0, limit).map((row) => row.id);
    const productIds = productPage.slice(0, limit).map((row) => row.id);
    const ingredientConditions = [eq(medicineIngredient.patientId, profile.id)];
    const productConditions = [eq(medicineProduct.patientId, profile.id)];
    ingredientConditions.push(ingredientIds.length ? inArray(medicineIngredient.id, ingredientIds) : sql`0`);
    productConditions.push(productIds.length ? inArray(medicineProduct.id, productIds) : sql`0`);
    if (status) {
      ingredientConditions.push(eq(medicineIngredient.status, status));
      productConditions.push(eq(medicineProduct.status, status));
    }
    if (query && normalizedQuery) {
      ingredientConditions.push(
        or(
          sql`instr(${medicineIngredient.normalizedName}, ${normalizedQuery}) > 0`,
          sql`exists (select 1 from medicine_catalog_name where medicine_catalog_name.patient_id = ${profile.id} and medicine_catalog_name.ingredient_id = ${medicineIngredient.id} and instr(medicine_catalog_name.normalized_name, ${normalizedQuery}) > 0)`,
        ) as typeof ingredientConditions[number],
      );
      productConditions.push(
        or(
          sql`instr(${medicineProduct.normalizedName}, ${normalizedQuery}) > 0`,
          sql`exists (select 1 from medicine_catalog_name where medicine_catalog_name.patient_id = ${profile.id} and medicine_catalog_name.product_id = ${medicineProduct.id} and instr(medicine_catalog_name.normalized_name, ${normalizedQuery}) > 0)`,
        ) as typeof productConditions[number],
      );
    }

    const ingredientWhere = and(...ingredientConditions);
    const productWhere = and(...productConditions);
    const ingredientRoots = await db
      .select(readColumns(medicineIngredient))
      .from(medicineIngredient)
      .where(ingredientWhere)
      .orderBy(medicineIngredient.id);
    const productRoots = await db
      .select(readColumns(medicineProduct))
      .from(medicineProduct)
      .where(productWhere)
      .orderBy(medicineProduct.id);
    const ingredients = await loadIngredientRecords(profile.id, ingredientRoots);
    const products = await loadProductRecords(profile.id, productRoots);
    const result = capResult({
      patient_id: profile.id,
      ingredient_count: ingredientRoots.length,
      product_count: productRoots.length,
      next_ingredient_id: longestCursor(ingredientIds) as string | null,
      next_product_id: longestCursor(productIds) as string | null,
      ingredients: ingredients.map(serializeIngredient),
      products: products.map(serializeProduct),
      truncated:
        ingredientPage.length > limit || productPage.length > limit,
    });
    // Resume after the last returned match, or the candidate bound if all were trimmed.
    result.next_ingredient_id = result.ingredients.length < ingredients.length
      ? result.ingredients.at(-1)?.ingredient_id ?? ingredientIds.at(-1) ?? null
      : ingredientPage.length > limit ? ingredientIds.at(-1) ?? null : null;
    result.next_product_id = result.products.length < products.length
      ? result.products.at(-1)?.product_id ?? productIds.at(-1) ?? null
      : productPage.length > limit ? productIds.at(-1) ?? null : null;
    return result;
  },
};

const childCollections = ['names', 'identifiers', 'ingredients'] as const;

function childPage(args: Record<string, unknown>, collection: typeof childCollections[number]) {
  const offset = args[`${collection}_offset`] ?? 0;
  const limit = args[`${collection}_limit`] ?? 5;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ToolError(`${collection}_offset must be a non-negative integer`);
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || limit > 30) {
    throw new ToolError(`${collection}_limit must be an integer from 0 through 30`);
  }
  return { offset, limit };
}

const getMedicineCatalogEntry: ToolDefinition = {
  name: 'get_medicine_catalog_entry',
  title: 'Get medicine catalog entry',
  description:
    'Read the identity, revision and complete child rows of one current ingredient or product in bounded pages. Use list_medicine_catalog for root fields. Continue each collection using its next offset. Offsets are zero-based stored positions; a limit of zero skips a collection. Check that revision stays the same while assembling pages.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      entity_kind: { type: 'string', enum: ['ingredient', 'product'] },
      entity_id: { type: 'string', maxLength: 128 },
      ...Object.fromEntries(childCollections.flatMap((collection) => [
        [`${collection}_offset`, { type: 'integer', minimum: 0 }],
        [`${collection}_limit`, { type: 'integer', minimum: 0, maximum: 30 }],
      ])),
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
    const pages = {
      names: childPage(args, 'names'),
      identifiers: childPage(args, 'identifiers'),
      ingredients: childPage(args, 'ingredients'),
    };
    const ingredientRoots = kind === 'ingredient' ? await db.select(readColumns(medicineIngredient))
      .from(medicineIngredient).where(and(eq(medicineIngredient.patientId, profile.id), eq(medicineIngredient.id, id))).limit(1) : [];
    const productRoots = kind === 'product' ? await db.select(readColumns(medicineProduct))
      .from(medicineProduct).where(and(eq(medicineProduct.patientId, profile.id), eq(medicineProduct.id, id))).limit(1) : [];
    const root = ingredientRoots[0] ?? productRoots[0];
    if (!root) throw new ToolError('No such medicine catalog entry');
    // Owner/order indexes bound each child query, including large continuation offsets.
    const names = await db.select().from(medicineCatalogName).where(and(
      eq(medicineCatalogName.patientId, profile.id),
      eq(kind === 'ingredient' ? medicineCatalogName.ingredientId : medicineCatalogName.productId, id),
      gte(medicineCatalogName.orderIndex, pages.names.offset),
    )).orderBy(medicineCatalogName.orderIndex).limit(pages.names.limit + 1);
    const identifiers = await db.select().from(medicineCatalogIdentifier).where(and(
      eq(medicineCatalogIdentifier.patientId, profile.id),
      eq(kind === 'ingredient' ? medicineCatalogIdentifier.ingredientId : medicineCatalogIdentifier.productId, id),
      gte(medicineCatalogIdentifier.orderIndex, pages.identifiers.offset),
    )).orderBy(medicineCatalogIdentifier.orderIndex).limit(pages.identifiers.limit + 1);
    const components = kind === 'product' ? await db.select({
      ...getTableColumns(medicineProductIngredient), ingredient: readColumns(medicineIngredient),
    }).from(medicineProductIngredient).innerJoin(medicineIngredient, and(
      eq(medicineIngredient.id, medicineProductIngredient.ingredientId),
      eq(medicineIngredient.patientId, medicineProductIngredient.patientId),
    )).where(and(
      eq(medicineProductIngredient.patientId, profile.id), eq(medicineProductIngredient.productId, id),
      gte(medicineProductIngredient.orderIndex, pages.ingredients.offset),
    )).orderBy(medicineProductIngredient.orderIndex).limit(pages.ingredients.limit + 1) : [];
    const table = kind === 'ingredient' ? medicineIngredient : medicineProduct;
    const latest = await db.select({ revision: table.revision }).from(table)
      .where(and(eq(table.patientId, profile.id), eq(table.id, id))).limit(1);
    if (latest[0]?.revision !== root.revision) {
      throw new ToolError('Medicine catalog entry changed while reading; restart child pagination');
    }
    const record = kind === 'ingredient'
      ? { ...serializeIngredient({ ...buildMedicineIngredientRecords(ingredientRoots,
        names.slice(0, pages.names.limit), identifiers.slice(0, pages.identifiers.limit))[0],
        sourceDataBytes: root.sourceDataBytes }), ingredients: [] }
      : serializeProduct({ ...buildMedicineProductRecords(productRoots,
        names.slice(0, pages.names.limit), identifiers.slice(0, pages.identifiers.limit),
        components.slice(0, pages.ingredients.limit),
        buildMedicineIngredientRecords(components.map((row) => row.ingredient), [], []))[0],
        sourceDataBytes: root.sourceDataBytes });
    // Root notes and product descriptions can exceed the whole response budget.
    // Keep this projection small so every child remains reachable independently.
    const entry = {
      ...(kind === 'ingredient'
        ? { ingredient_id: id, canonical_name: ingredientRoots[0].canonicalName }
        : { product_id: id, display_name: productRoots[0].displayName }),
      revision: root.revision,
      source_data_summary: sourceDataSummary(root),
      names: record.names,
      identifiers: record.identifiers,
      ingredients: record.ingredients,
    };
    const fetched = { names, identifiers, ingredients: components };
    const result = {
      patient_id: profile.id, entity_kind: kind, entity_id: id, entry,
      next_names_offset: null as number | null,
      next_identifiers_offset: null as number | null,
      next_ingredients_offset: null as number | null,
    };
    function updateOffsets() {
      for (const collection of childCollections) {
        const count = entry[collection].length;
        result[`next_${collection}_offset`] = fetched[collection].length > count
          ? count ? fetched[collection][count - 1].orderIndex + 1 : pages[collection].offset
          : null;
      }
    }
    updateOffsets();
    // Remove only whole child rows. Never shorten their text or lose a continuation.
    while (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) {
      const collection = childCollections.filter((key) => entry[key].length > 0)
        .sort((a, b) => JSON.stringify(entry[b]).length - JSON.stringify(entry[a]).length)[0];
      if (!collection || childCollections.reduce((count, key) => count + entry[key].length, 0) <= 1) {
        throw new ToolError('Medicine catalog child exceeds the response budget');
      }
      entry[collection].pop();
      updateOffsets();
    }
    return result;
  },
};

const getMedicineCatalogHistory: ToolDefinition = {
  name: 'get_medicine_catalog_history',
  title: 'Get medicine catalog history',
  description:
    'Saved versions of one medicine ingredient or product, newest first. Each version includes its snapshot and change source, with source payloads available separately. Continue with next_before_revision.',
  inputSchema: {
    type: 'object',
    properties: {
      patient_id: { type: 'string' },
      entity_kind: { type: 'string', enum: ['ingredient', 'product'] },
      entity_id: { type: 'string' },
      before_revision: { type: 'integer', minimum: 1 },
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
    const table = kind === 'ingredient' ? medicineIngredient : medicineProduct;
    const currentRows = await db.select({ revision: table.revision }).from(table)
      .where(and(eq(table.patientId, profile.id), eq(table.id, id))).limit(1);
    const current = currentRows[0];
    if (!current) throw new ToolError('No such medicine catalog entry');
    const limit = pageLimit(args.limit, 50, MAX_CATALOG_PAGE);
    const before = args.before_revision === undefined ? null : positiveInteger(args.before_revision, 'before_revision');
    // medicine_catalog_revision_entity_idx serves the entity/revision range and ordering.
    const where = and(
      eq(medicineCatalogRevision.patientId, profile.id),
      eq(medicineCatalogRevision.entityKind, kind),
      eq(medicineCatalogRevision.entityId, id),
      before === null ? undefined : lt(medicineCatalogRevision.revision, before),
    );
    const rows = await db
      .select({
        ...getTableColumns(medicineCatalogRevision),
        // Keep large source payloads inside SQLite, including ingredient snapshots.
        snapshot: sql<string>`json_set(json_remove(${medicineCatalogRevision.snapshot}, '$.sourceData'),
          '$.ingredients', json(coalesce((select json_group_array(json_set(value, '$.ingredient',
            json_object('id', json_extract(value, '$.ingredient.id'),
              'canonicalName', json_extract(value, '$.ingredient.canonicalName'))))
            from json_each(${medicineCatalogRevision.snapshot}, '$.ingredients')), '[]')))`,
        sourceDataBytes: sql<number | null>`case
          when json_type(${medicineCatalogRevision.snapshot}, '$.sourceData') in ('null') then null
          else length(cast(${medicineCatalogRevision.snapshot} -> '$.sourceData' as blob)) end`,
      })
      .from(medicineCatalogRevision)
      .where(where)
      .orderBy(desc(medicineCatalogRevision.revision))
      .limit(limit + 1);
    const revisions = rows.slice(0, limit).flatMap((row) => {
      const revision = toMedicineCatalogRevision({ ...row, snapshot: JSON.parse(row.snapshot) });
      if (!revision) return [];
      return [{
        revision: revision.revision,
        changed_at: revision.changedAt,
        change_source: {
          kind: revision.changeOriginKind,
          provider: revision.changeOriginProvider,
        },
        snapshot: revision.entityKind === 'ingredient'
          ? serializeIngredient({ ...revision.snapshot as MedicineIngredientRecord, sourceDataBytes: row.sourceDataBytes })
          : serializeProduct({ ...revision.snapshot as MedicineProductRecord, sourceDataBytes: row.sourceDataBytes }),
      }];
    });
    const result = capResult({
      patient_id: profile.id,
      entity_kind: kind,
      entity_id: id,
      current_revision: current.revision,
      revisions,
      // Reserve the longest possible cursor before enforcing the byte budget.
      next_before_revision: Number.MAX_SAFE_INTEGER as number | null,
      truncated: rows.length > revisions.length,
    });
    result.next_before_revision = rows.length > result.revisions.length
      ? result.revisions.at(-1)?.revision ?? rows.slice(0, limit).at(-1)?.revision ?? null
      : null;
    return result;
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
    const table = kind === 'ingredient' ? medicineIngredient : medicineProduct;
    const currentRows = await db.select({ sourceData: table.sourceData, revision: table.revision })
      .from(table).where(and(eq(table.patientId, profile.id), eq(table.id, id))).limit(1);
    const current = currentRows[0];
    if (!current) throw new ToolError('No such medicine catalog entry');
    const requestedRevision = args.revision === undefined
      ? null
      : positiveInteger(args.revision, 'revision');
    let selected = current;
    if (requestedRevision !== null) {
      const rows = await db
        .select({
          sourceData: sql<string>`${medicineCatalogRevision.snapshot} -> '$.sourceData'`,
          revision: medicineCatalogRevision.revision,
        })
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
      const saved = rows[0];
      if (!saved) throw new ToolError('No such medicine catalog revision');
      selected = { sourceData: JSON.parse(saved.sourceData ?? 'null'), revision: saved.revision };
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
    const totalCharacters = countCodePoints(serialized);
    if (offset > totalCharacters) throw new ToolError('offset is past the source payload');
    const { chunk, length: chunkLength } = sliceCodePoints(serialized, offset, limit);
    const nextOffset = offset + chunkLength;
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized)),
    );
    const result = {
      patient_id: profile.id,
      entity_kind: kind,
      entity_id: id,
      revision: selected.revision,
      encoding: 'json',
      offset_unit: 'unicode_code_point',
      sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      total_characters: totalCharacters,
      offset,
      chunk,
      next_offset: nextOffset < totalCharacters ? nextOffset : null,
      complete: nextOffset >= totalCharacters,
    };
    // The JSON envelope escapes quotes and controls; count its UTF-8 bytes too.
    let low = 0;
    let high = chunkLength;
    while (low < high) {
      const length = Math.ceil((low + high) / 2);
      const candidate = sliceCodePoints(chunk, 0, length).chunk;
      const candidateNext = offset + length < totalCharacters ? offset + length : null;
      if (new TextEncoder().encode(JSON.stringify({
        ...result, chunk: candidate, next_offset: candidateNext, complete: candidateNext === null,
      })).byteLength <= MAX_RESULT_BYTES) {
        low = length;
      } else {
        high = length - 1;
      }
    }
    result.chunk = sliceCodePoints(chunk, 0, low).chunk;
    result.next_offset = offset + low < totalCharacters ? offset + low : null;
    result.complete = result.next_offset === null;
    return result;
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
    const id = await stableClaimId(ctx, profile.id, 'ingredient', key);
    try {
      const { ingredient, created } = await createMedicineIngredient({
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
      return capResult({ created, ingredient: serializeIngredient(ingredient) });
    } catch (error) {
      if (error instanceof MedicineCatalogIdentifierCollisionError) throw new ToolError(error.message);
      if (error instanceof InvalidMedicineCatalogReferenceError) throw catalogReferenceError(error);
      throw error;
    }
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
      return capResult({ updated: true, ingredient: serializeIngredient(ingredient) });
    } catch (error) {
      if (error instanceof InvalidMedicineCatalogReferenceError) throw catalogReferenceError(error);
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
    const id = await stableClaimId(ctx, profile.id, 'product', key);
    try {
      const { product, created } = await createMedicineProduct({
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
      return capResult({ created, product: serializeProduct(product) });
    } catch (error) {
      if (error instanceof MedicineCatalogIdentifierCollisionError) throw new ToolError(error.message);
      if (error instanceof InvalidMedicineCatalogReferenceError) throw catalogReferenceError(error);
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
      return capResult({ updated: true, product: serializeProduct(product) });
    } catch (error) {
      if (error instanceof MedicineCatalogIdentifierCollisionError) throw new ToolError(error.message);
      if (error instanceof InvalidMedicineCatalogReferenceError) throw catalogReferenceError(error);
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
  getMedicineCatalogEntry,
  getMedicineCatalogHistory,
  readMedicineCatalogSource,
  createMedicineIngredientTool,
  updateMedicineIngredientTool,
  createMedicineProductTool,
  updateMedicineProductTool,
];
