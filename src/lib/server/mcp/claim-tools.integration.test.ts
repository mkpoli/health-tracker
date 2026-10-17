import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type { McpContext } from './context';

const databasePath = join(tmpdir(), `health-tracker-mcp-claims-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let claimTools: typeof import('./claim-tools');
let catalogTools: typeof import('./medicine-catalog-tools');
let catalogMutations: typeof import('../medicine-catalog-mutations');
let toolsModule: typeof import('./tools');
let protocolModule: typeof import('./protocol');
let contextModule: typeof import('./context');

const context: McpContext = {
  userId: 'owner-1',
  grant: { id: 'grant-1', lastUsedAt: null },
  clientId: 'assistant-client',
  patientIds: ['profile-1'],
  shareDemographics: false,
  canWriteMeasurements: true,
  canWriteClaims: true,
  origin: 'https://health.example',
  now: Date.parse('2026-08-15T12:34:56.000Z'),
};

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_AUTH_TOKEN = 'local-test-token';
  vi.doMock('$env/dynamic/private', () => ({
    env: {
      DATABASE_URL: databaseUrl,
      DATABASE_AUTH_TOKEN: 'local-test-token',
    },
  }));
  client = createClient({ url: databaseUrl });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE patient (
      id TEXT PRIMARY KEY NOT NULL,
      owner_user_id TEXT,
      name TEXT NOT NULL,
      agab TEXT,
      birthday TEXT,
      extra_data TEXT
    );
    CREATE TABLE medicine_ingredient (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(id, patient_id)
    );
    CREATE TABLE medicine_product (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      product_type TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'active',
      dose_form_text TEXT,
      dose_form_system TEXT,
      dose_form_code TEXT,
      route_text TEXT,
      route_system TEXT,
      route_code TEXT,
      strength_text TEXT,
      manufacturer TEXT,
      marketing_authorization_holder TEXT,
      market_country TEXT,
      package_description TEXT,
      imprint TEXT,
      color TEXT,
      shape TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(id, patient_id)
    );
    CREATE TABLE medicine_catalog_name (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      ingredient_id TEXT,
      product_id TEXT,
      order_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      language_tag TEXT NOT NULL DEFAULT 'und',
      name_type TEXT NOT NULL DEFAULT 'preferred',
      jurisdiction TEXT,
      preferred INTEGER NOT NULL DEFAULT 0,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_provider TEXT,
      source_url TEXT,
      source_retrieved_at TEXT,
      UNIQUE(ingredient_id, order_index),
      UNIQUE(product_id, order_index),
      FOREIGN KEY(ingredient_id, patient_id) REFERENCES medicine_ingredient(id, patient_id) ON DELETE CASCADE,
      FOREIGN KEY(product_id, patient_id) REFERENCES medicine_product(id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE medicine_catalog_identifier (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      ingredient_id TEXT,
      product_id TEXT,
      order_index INTEGER NOT NULL,
      system TEXT NOT NULL,
      code TEXT NOT NULL,
      jurisdiction TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_provider TEXT,
      source_url TEXT,
      source_retrieved_at TEXT,
      UNIQUE(ingredient_id, order_index),
      UNIQUE(product_id, order_index),
      FOREIGN KEY(ingredient_id, patient_id) REFERENCES medicine_ingredient(id, patient_id) ON DELETE CASCADE,
      FOREIGN KEY(product_id, patient_id) REFERENCES medicine_product(id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE medicine_product_ingredient (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      ingredient_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'active',
      numerator_value TEXT,
      numerator_unit TEXT,
      denominator_value TEXT,
      denominator_unit TEXT,
      strength_text TEXT,
      basis_of_strength_text TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_provider TEXT,
      source_url TEXT,
      source_retrieved_at TEXT,
      UNIQUE(product_id, order_index),
      FOREIGN KEY(product_id, patient_id) REFERENCES medicine_product(id, patient_id) ON DELETE CASCADE,
      FOREIGN KEY(ingredient_id, patient_id) REFERENCES medicine_ingredient(id, patient_id)
    );
    CREATE TABLE medicine_catalog_revision (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL DEFAULT 'manual',
      change_origin_provider TEXT
    );
    CREATE UNIQUE INDEX medicine_catalog_revision_entity_idx ON medicine_catalog_revision(entity_kind, entity_id, revision);
    CREATE INDEX medicine_catalog_revision_patient_idx ON medicine_catalog_revision(patient_id);
    CREATE INDEX medicine_catalog_revision_patient_changed_idx ON medicine_catalog_revision(patient_id, changed_at);
    CREATE TABLE medicine_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      product_id TEXT,
      name TEXT NOT NULL,
      generic_name TEXT,
      form TEXT,
      strength TEXT,
      route TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT,
      end_date TEXT,
      purpose TEXT,
      prescriber TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE medicine_course (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      medicine_claim_id TEXT NOT NULL REFERENCES medicine_claim(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'initial',
      status TEXT NOT NULL DEFAULT 'active',
      previous_course_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      end_reason TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE dose_regimen (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES medicine_course(id) ON DELETE CASCADE,
      rule_kind TEXT NOT NULL,
      slots TEXT NOT NULL DEFAULT '[]',
      days_of_week TEXT,
      interval_hours REAL,
      anchor_at TEXT,
      dose_text TEXT,
      route TEXT,
      site TEXT,
      timezone TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      remind_minutes_before INTEGER,
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE energy_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      label TEXT,
      category TEXT,
      energy_kcal REAL,
      occurred_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      timezone TEXT,
      timezone_offset_minutes INTEGER NOT NULL,
      duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'recorded',
      notes TEXT,
      origin_kind TEXT NOT NULL DEFAULT 'manual',
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE UNIQUE INDEX energy_claim_id_patient_idx ON energy_claim(id, patient_id);
    CREATE UNIQUE INDEX energy_claim_external_idx
      ON energy_claim(patient_id, origin_provider, origin_external_id);
    CREATE TABLE energy_food_item (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      energy_claim_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity_value REAL,
      quantity_unit TEXT,
      energy_kcal REAL,
      energy_kcal_min REAL,
      energy_kcal_max REAL,
      protein_g REAL,
      carbohydrate_g REAL,
      fat_g REAL,
      fiber_g REAL,
      sodium_mg REAL,
      data_source TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT,
      origin_external_id TEXT,
      nutrition_data TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (energy_claim_id, patient_id)
        REFERENCES energy_claim(id, patient_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX energy_food_item_order_idx
      ON energy_food_item(energy_claim_id, order_index);
    CREATE UNIQUE INDEX energy_food_item_external_idx
      ON energy_food_item(energy_claim_id, origin_external_id);
    CREATE TABLE energy_source (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      energy_claim_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      file_name TEXT,
      byte_size INTEGER NOT NULL,
      object_etag TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (energy_claim_id, patient_id)
        REFERENCES energy_claim(id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy', 'medicine_course', 'dose_regimen')),
      claim_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL DEFAULT 'manual',
      change_origin_provider TEXT
    );
    CREATE UNIQUE INDEX claim_revision_claim_idx
      ON claim_revision(claim_kind, claim_id, revision);
    INSERT INTO patient (id, owner_user_id, name, extra_data) VALUES
      ('profile-1', 'owner-1', 'Primary', '{"timeZone":"Asia/Tokyo"}'),
      ('profile-2', 'owner-1', 'Outside grant', '{"timeZone":"UTC"}'),
      ('profile-3', 'owner-2', 'Other owner', '{"timeZone":"UTC"}');
  `);
  claimTools = await import('./claim-tools');
  catalogTools = await import('./medicine-catalog-tools');
  const schema = await import('../db/schema');
  const { getTableConfig } = await import('drizzle-orm/sqlite-core');
  for (const table of [schema.medicineIngredient, schema.medicineProduct, schema.medicineCatalogName,
    schema.medicineCatalogIdentifier, schema.medicineProductIngredient, schema.medicineCatalogRevision]) {
    const config = getTableConfig(table);
    for (const index of config.indexes) {
      const columns = index.config.columns.map((column) => '"' + ('name' in column ? column.name : '') + '"');
      await client.execute('CREATE ' + (index.config.unique ? 'UNIQUE ' : '') + 'INDEX IF NOT EXISTS "' +
        index.config.name + '" ON "' + config.name + '" (' + columns.join(', ') + ')');
    }
  }
  catalogMutations = await import('../medicine-catalog-mutations');
  toolsModule = await import('./tools');
  protocolModule = await import('./protocol');
  contextModule = await import('./context');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([
    unlink(databasePath),
    unlink(`${databasePath}-shm`),
    unlink(`${databasePath}-wal`),
  ]);
});

function tool(name: string) {
  const definition = claimTools.healthClaimTools.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

function catalogTool(name: string) {
  const definition = catalogTools.medicineCatalogTools.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool ${name}`);
  return definition;
}

describe('MCP medicine catalog', () => {
  it('creates reusable ingredients and packaged products with retry-safe identifiers', async () => {
    const createIngredient = catalogTool('create_medicine_ingredient');
    const first = (await createIngredient.handler(context, {
      patient_id: 'profile-1',
      request_id: 'ingredient-semaglutide',
      canonical_name: 'Semaglutide',
      names: [
        {
          name: 'Semaglutide',
          language_tag: 'en',
          name_type: 'generic',
          preferred: true,
          source_kind: 'terminology',
          source_provider: 'RxNorm',
        },
        {
          name: 'セマグルチド',
          language_tag: 'ja',
          name_type: 'generic',
          preferred: true,
          source_kind: 'regulator',
          source_provider: 'PMDA',
        },
      ],
      identifiers: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1991302' }],
      source_data: { source: 'test-fixture' },
    })) as any;
    const retry = (await createIngredient.handler(context, {
      patient_id: 'profile-1',
      request_id: 'ingredient-semaglutide',
      canonical_name: 'Changed retry payload',
    })) as any;
    expect(first.created).toBe(true);
    expect(retry).toMatchObject({
      created: false,
      ingredient: { ingredient_id: first.ingredient.ingredient_id, canonical_name: 'Semaglutide' },
    });
    const sourceChunk = (await catalogTool('read_medicine_catalog_source').handler(context, {
      patient_id: 'profile-1',
      entity_kind: 'ingredient',
      entity_id: first.ingredient.ingredient_id,
      revision: 1,
      limit: 5,
    })) as any;
    expect(sourceChunk).toMatchObject({
      offset: 0,
      revision: 1,
      complete: false,
      next_offset: 5,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const product = (await catalogTool('create_medicine_product').handler(context, {
      patient_id: 'profile-1',
      request_id: 'product-wegovy-025',
      display_name: 'Wegovy 0.25 mg',
      product_type: 'branded',
      dose_form: 'injection',
      route: 'subcutaneous',
      strength: '0.25 mg per dose',
      market_country: 'JP',
      names: [{ name: 'ウゴービ皮下注 0.25 mg', language_tag: 'ja', name_type: 'brand', preferred: true }],
      identifiers: [{ system: 'YJ', code: '2499418G1020', jurisdiction: 'JP' }],
      ingredients: [
        {
          ingredient_id: first.ingredient.ingredient_id,
          role: 'active',
          numerator_value: '0.25',
          numerator_unit: 'mg',
          strength_text: '0.25 mg per dose',
        },
      ],
    })) as any;
    expect(product).toMatchObject({
      created: true,
      product: {
        display_name: 'Wegovy 0.25 mg',
        route: 'subcutaneous',
        ingredients: [{ ingredient_id: first.ingredient.ingredient_id }],
      },
    });

    const listed = (await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1',
      query: 'ウゴービ',
    })) as any;
    expect(listed.product_count).toBe(1);
    expect(listed.products[0].identifiers[0]).toMatchObject({ system: 'YJ', code: '2499418G1020' });
    const normalizedSearch = (await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1',
      query: 'Ｗｅｇｏｖｙ',
    })) as any;
    expect(normalizedSearch.product_count).toBe(1);

    const medicine = (await tool('create_medicine').handler(context, {
      patient_id: 'profile-1',
      request_id: 'wegovy-plan',
      product_id: product.product.product_id,
      name: 'Wegovy',
      strength: '0.25 mg',
      status: 'active',
      start_date: '2026-08-15',
      regimen: { rule: 'as_needed' },
    })) as any;
    expect(medicine.medicine.product_id).toBe(product.product.product_id);

    await expect(
      tool('create_medicine').handler(context, {
        patient_id: 'profile-1',
        request_id: 'unknown-product-plan',
        product_id: 'missing-product',
        name: 'Unknown product plan',
        status: 'active',
        start_date: '2026-08-15',
        regimen: { rule: 'as_needed' },
      }),
    ).rejects.toThrow('does not identify a catalog product in this profile');
  });

  it('keeps catalog revisions and rejects cross-profile ingredient references', async () => {
    const catalog = (await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1',
      query: 'Wegovy',
    })) as any;
    const product = catalog.products[0];
    const ingredient = product.ingredients[0].ingredient;
    const changed = (await catalogTool('update_medicine_product').handler(context, {
      patient_id: 'profile-1',
      product_id: product.product_id,
      expected_revision: product.revision,
      display_name: 'Wegovy 0.25 mg single-dose pen',
    })) as any;
    expect(changed.product.revision).toBe(2);
    expect(changed.product.ingredients[0].ingredient_id).toBe(ingredient.ingredient_id);
    const history = (await catalogTool('get_medicine_catalog_history').handler(context, {
      patient_id: 'profile-1',
      entity_kind: 'product',
      entity_id: product.product_id,
    })) as any;
    expect(history.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect(history.revisions[0].change_source).toEqual({
      kind: 'mcp',
      provider: 'mcp:assistant-client',
    });
    const revisions = await client.execute({
      sql: 'SELECT revision FROM medicine_catalog_revision WHERE entity_kind = ? AND entity_id = ? ORDER BY revision',
      args: ['product', product.product_id],
    });
    expect(revisions.rows.map((row) => row.revision)).toEqual([1, 2]);

    await client.execute({
      sql: `INSERT INTO medicine_ingredient
        (id, patient_id, canonical_name, normalized_name, status, origin_kind, revision)
        VALUES (?, ?, ?, ?, 'active', 'manual', 1)`,
      args: ['outside-ingredient', 'profile-2', 'Outside', 'outside'],
    });
    await expect(
      catalogTool('create_medicine_product').handler(context, {
        patient_id: 'profile-1',
        request_id: 'cross-profile-product',
        display_name: 'Invalid product',
        ingredients: [{ ingredient_id: 'outside-ingredient' }],
      }),
    ).rejects.toThrow('does not belong to this profile');
  });

  it('guards catalog deletion and preserves detached medicine-plan history', async () => {
    const catalog = (await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1',
    })) as any;
    const product = catalog.products[0];
    const ingredient = product.ingredients[0].ingredient;

    await expect(
      catalogMutations.deleteMedicineIngredient({
        patientId: 'profile-1',
        id: ingredient.ingredient_id,
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(catalogMutations.MedicineCatalogIngredientInUseError);
    await expect(
      catalogMutations.deleteMedicineProduct({
        patientId: 'profile-1',
        id: product.product_id,
        expectedRevision: product.revision - 1,
        source: { kind: 'manual', provider: null },
      }),
    ).rejects.toMatchObject({ name: 'StaleClaimRevisionError' });

    const deleted = await catalogMutations.deleteMedicineProduct({
      patientId: 'profile-1',
      id: product.product_id,
      expectedRevision: product.revision,
      source: { kind: 'manual', provider: null },
      changedAt: '2026-08-15T13:00:00.000Z',
    });
    expect(deleted.detachedClaimIds).toHaveLength(1);

    const detached = await client.execute({
      sql: `SELECT product_id, revision, updated_at FROM medicine_claim WHERE id = ?`,
      args: [deleted.detachedClaimIds[0]],
    });
    expect(detached.rows[0]).toMatchObject({
      product_id: null,
      revision: 2,
      updated_at: '2026-08-15T13:00:00.000Z',
    });
    const planHistory = await client.execute({
      sql: `SELECT revision, json_extract(snapshot, '$.productId') AS product_id
        FROM claim_revision WHERE claim_kind = 'medicine' AND claim_id = ? ORDER BY revision`,
      args: [deleted.detachedClaimIds[0]],
    });
    expect(planHistory.rows).toEqual([
      { revision: 1, product_id: product.product_id },
      { revision: 2, product_id: null },
    ]);
    const productRows = await client.execute({
      sql: `SELECT
        (SELECT count(*) FROM medicine_product WHERE id = ?) AS products,
        (SELECT count(*) FROM medicine_catalog_revision
          WHERE entity_kind = 'product' AND entity_id = ?) AS revisions`,
      args: [product.product_id, product.product_id],
    });
    expect(productRows.rows[0]).toMatchObject({ products: 0, revisions: 0 });

    await catalogMutations.deleteMedicineIngredient({
      patientId: 'profile-1',
      id: ingredient.ingredient_id,
      expectedRevision: 1,
    });
    const ingredientRows = await client.execute({
      sql: `SELECT
        (SELECT count(*) FROM medicine_ingredient WHERE id = ?) AS ingredients,
        (SELECT count(*) FROM medicine_catalog_revision
          WHERE entity_kind = 'ingredient' AND entity_id = ?) AS revisions`,
      args: [ingredient.ingredient_id, ingredient.ingredient_id],
    });
    expect(ingredientRows.rows[0]).toMatchObject({ ingredients: 0, revisions: 0 });
  });

  it('folds non-ASCII display names when searching and slices source payloads by code point', async () => {
    const created = (await catalogTool('create_medicine_product').handler(context, {
      patient_id: 'profile-1',
      request_id: 'product-unicode',
      display_name: 'Ärzteprobe Tablette',
      source_data: { mark: '😀😀😀' },
    })) as any;
    const found = (await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1',
      query: 'ärzteprobe',
    })) as any;
    expect(found.products.map((row: any) => row.product_id)).toEqual([created.product.product_id]);

    const read = async (offset: number, limit: number) =>
      (await catalogTool('read_medicine_catalog_source').handler(context, {
        patient_id: 'profile-1',
        entity_kind: 'product',
        entity_id: created.product.product_id,
        offset,
        limit,
      })) as any;
    // {"mark":"😀😀😀"} is 9 + 3 + 2 = 14 code points.
    const head = await read(0, 10);
    expect(head).toMatchObject({ total_characters: 14, chunk: '{"mark":"😀', next_offset: 10 });
    const tail = await read(10, 10);
    expect(tail).toMatchObject({ chunk: '😀😀"}', next_offset: null, complete: true });
  });
});

describe('MCP medicine claims', () => {
  it('uses request IDs for retry safety and keeps every saved revision', async () => {
    const create = tool('create_medicine');
    const first = (await create.handler(context, {
      patient_id: 'profile-1',
      request_id: 'medicine-chat-1',
      name: 'Amoxicillin',
      form: 'capsule',
      strength: '500 mg',
      status: 'active',
      start_date: '2026-08-15',
      regimen: {
        rule: 'fixed_slots',
        slots: [
          { label: '朝食後', anchor: { kind: 'meal', meal: 'breakfast' }, amount_value: 1, amount_unit: '錠' },
          { label: '就寝前', anchor: { kind: 'bedtime' }, amount_value: 1, amount_unit: '錠' },
        ],
      },
    })) as any;
    const retry = (await create.handler(context, {
      patient_id: 'profile-1',
      request_id: 'medicine-chat-1',
      name: 'Changed retry payload',
      status: 'stopped',
      start_date: '2026-08-16',
      end_date: '2026-08-20',
      regimen: { rule: 'as_needed' },
    })) as any;

    expect(first.created).toBe(true);
    expect(first.course).toMatchObject({
      medicine_id: first.medicine.medicine_id,
      kind: 'initial',
      status: 'active',
      start_date: '2026-08-15',
    });
    expect(first.regimen).toMatchObject({
      course_id: first.course.course_id,
      rule: 'fixed_slots',
      timezone: 'Asia/Tokyo',
      effective_from: '2026-08-15',
      slots: [
        { key: 0, label: '朝食後', anchor: { kind: 'meal', meal: 'breakfast', offset_minutes: null }, amount_value: 1, amount_unit: '錠' },
        { key: 1, label: '就寝前', anchor: { kind: 'bedtime', meal: null, offset_minutes: null } },
      ],
    });
    expect(retry.created).toBe(false);
    expect(retry.medicine).toMatchObject({
      medicine_id: first.medicine.medicine_id,
      name: 'Amoxicillin',
      revision: 1,
    });
    expect(retry.regimen).toMatchObject({ regimen_id: first.regimen.regimen_id, rule: 'fixed_slots' });

    const update = tool('update_medicine');
    const changed = (await update.handler(context, {
      patient_id: 'profile-1',
      medicine_id: first.medicine.medicine_id,
      expected_revision: 1,
      purpose: 'Ear infection',
      notes: 'Confirmed in chat',
    })) as any;
    expect(changed.medicine).toMatchObject({
      name: 'Amoxicillin',
      purpose: 'Ear infection',
      revision: 2,
    });

    await expect(
      update.handler(context, {
        patient_id: 'profile-1',
        medicine_id: first.medicine.medicine_id,
        expected_revision: 1,
        purpose: 'Stale edit',
      }),
    ).rejects.toThrow('current_revision is 2');

    const history = (await tool('get_claim_history').handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'medicine',
      claim_id: first.medicine.medicine_id,
    })) as any;
    expect(history.total).toBe(2);
    expect(history.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect(history.revisions[0].change_source).toEqual({
      kind: 'mcp',
      provider: 'mcp:assistant-client',
    });

    const counts = await client.execute({
      sql: `SELECT
        (SELECT count(*) FROM medicine_claim WHERE name = ?) AS medicines,
        (SELECT count(*) FROM claim_revision
          WHERE claim_kind = 'medicine' AND claim_id = ?) AS revisions`,
      args: ['Amoxicillin', first.medicine.medicine_id],
    });
    expect(counts.rows[0]).toMatchObject({ medicines: 1, revisions: 2 });
  });

  it('refuses a medicine without a start date or a valid regimen', async () => {
    const create = tool('create_medicine');
    const base = { patient_id: 'profile-1', request_id: 'unscheduled', name: 'Loose tablet', status: 'active' };

    await expect(
      create.handler(context, { ...base, regimen: { rule: 'as_needed' } }),
    ).rejects.toThrow('start_date is required');
    await expect(
      create.handler(context, { ...base, status: 'stopped', start_date: '2026-09-01', regimen: { rule: 'as_needed' } }),
    ).rejects.toThrow('end_date is required');
    await expect(
      create.handler(context, { ...base, start_date: '2026-09-01', regimen: { rule: 'fixed_slots', slots: [] } }),
    ).rejects.toThrow('Invalid regimen: fixed_slots needs one to twelve slots');
    await expect(
      create.handler(context, {
        ...base,
        start_date: '2026-09-01',
        regimen: { rule: 'fixed_slots', slots: [{ anchor: { kind: 'meal' } }] },
      }),
    ).rejects.toThrow('Invalid regimen');
    await expect(
      create.handler(context, {
        ...base,
        start_date: '2026-09-01',
        regimen: { rule: 'interval', interval_hours: 48 },
      }),
    ).rejects.toThrow('Invalid regimen: an interval rule needs interval_hours');
    await expect(
      create.handler(context, {
        ...base,
        start_date: '2026-09-01',
        regimen: { rule: 'as_needed', effective_from: '2026-08-20' },
      }),
    ).rejects.toThrow('the rule must start inside the course');
    await expect(
      create.handler(context, { ...base, start_date: '2026-09-10', end_date: '2026-09-01', regimen: { rule: 'as_needed' } }),
    ).rejects.toThrow('end_date must not fall before start_date');

    const absent = await client.execute({
      sql: 'SELECT count(*) AS count FROM medicine_claim WHERE name = ?',
      args: ['Loose tablet'],
    });
    expect(absent.rows[0]?.count).toBe(0);
  });

  it('filters the current catalog and enforces the selected-profile grant', async () => {
    const listed = (await tool('list_medicines').handler(context, {
      patient_id: 'profile-1',
      query: 'amoxi',
      status: 'active',
    })) as any;
    expect(listed.total).toBe(1);
    expect(listed.medicines[0].name).toBe('Amoxicillin');

    await expect(
      tool('list_medicines').handler(context, { patient_id: 'profile-2' }),
    ).rejects.toThrow('No such patient');
    await expect(
      tool('list_medicines').handler(context, {
        patient_id: 'profile-1',
        status: 7,
      }),
    ).rejects.toThrow('status must be text');
  });
});

describe('MCP energy claims', () => {
  it('separates intake and expenditure while retaining local time and source counts', async () => {
    const log = tool('log_energy_entry');
    const meal = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'meal-1',
      direction: 'intake',
      label: 'Lunch bowl',
      category: 'lunch',
      food_items: [
        {
          name: 'Rice',
          quantity_value: 180,
          quantity_unit: 'g',
          energy_kcal: 281,
          data_source: 'database',
        },
        {
          name: 'Beef and vegetables',
          quantity_value: 1,
          quantity_unit: 'bowl',
          energy_kcal: 359,
          data_source: 'estimated',
        },
      ],
      occurred_at: '2026-08-15T12:15:00+09:00',
      diary_date: '2026-08-14',
      timezone: 'Asia/Tokyo',
    })) as any;
    const exercise = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'exercise-1',
      direction: 'expenditure',
      label: 'Strength training',
      energy_kcal: 300,
      duration_minutes: 50,
      occurred_at: '2026-08-15T18:00:00+09:00',
      timezone: 'Asia/Tokyo',
    })) as any;
    const retry = (await log.handler(context, {
      patient_id: 'profile-1',
      request_id: 'meal-1',
      direction: 'intake',
      label: 'Duplicate',
      energy_kcal: 999,
    })) as any;

    expect(meal.created).toBe(true);
    expect(exercise.created).toBe(true);
    expect(retry).toMatchObject({
      created: false,
      entry: { energy_entry_id: meal.entry.energy_entry_id, energy_kcal: 640 },
    });
    expect(meal.entry).toMatchObject({
      occurred_at: '2026-08-15T03:15:00.000Z',
      diary_date: '2026-08-14',
      local_date: '2026-08-14',
      timezone_offset_minutes: 540,
      energy_kcal: 640,
      food_items: [
        { name: 'Rice', energy_kcal: 281, data_source: 'database' },
        { name: 'Beef and vegetables', energy_kcal: 359, data_source: 'estimated' },
      ],
    });

    await client.execute({
      sql: `INSERT INTO energy_source
        (patient_id, energy_claim_id, storage_key, mime_type, file_name, byte_size)
        VALUES (?, ?, ?, 'image/jpeg', 'meal.jpg', 1234)`,
      args: ['profile-1', meal.entry.energy_entry_id, 'energy/profile-1/meal.jpg'],
    });

    const listed = (await tool('list_energy_entries').handler(context, {
      patient_id: 'profile-1',
      from: '2026-08-14',
      to: '2026-08-15',
    })) as any;
    expect(listed.total).toBe(2);
    expect(listed.totals_kcal).toEqual({ intake: 640, expenditure: 300, net: 340 });
    expect(
      listed.entries.find((entry: any) => entry.energy_entry_id === meal.entry.energy_entry_id),
    ).toMatchObject({ retained_file_count: 1 });
    expect(listed.entries.every((entry: any) => !('source_url' in entry))).toBe(true);
    await expect(
      tool('list_energy_entries').handler(context, {
        patient_id: 'profile-1',
        query: { value: 'rice' },
      }),
    ).rejects.toThrow('query must be text');
  });

  it('updates a claim optimistically and accepts a labeled draft', async () => {
    const listed = (await tool('list_energy_entries').handler(context, {
      patient_id: 'profile-1',
      query: 'rice',
    })) as any;
    const meal = listed.entries[0];
    const changed = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: meal.energy_entry_id,
      expected_revision: meal.revision,
      food_items: [
        {
          name: 'Rice',
          quantity_value: 180,
          quantity_unit: 'g',
          energy_kcal: 281,
          data_source: 'database',
        },
        {
          name: 'Beef and vegetables',
          quantity_value: 1,
          quantity_unit: 'bowl',
          energy_kcal: 394,
          data_source: 'estimated',
        },
      ],
      notes: 'Estimate corrected',
    })) as any;
    expect(changed.entry).toMatchObject({
      energy_kcal: 675,
      diary_date: '2026-08-14',
      revision: 2,
      retained_file_count: 1,
      food_items: [
        { name: 'Rice', energy_kcal: 281 },
        { name: 'Beef and vegetables', energy_kcal: 394 },
      ],
    });

    await expect(
      tool('update_energy_entry').handler(context, {
        patient_id: 'profile-1',
        energy_entry_id: meal.energy_entry_id,
        expected_revision: 1,
        food_items: [{ name: 'Rice', energy_kcal: 700, data_source: 'estimated' }],
      }),
    ).rejects.toThrow('current_revision is 2');

    const draft = (await tool('log_energy_entry').handler(context, {
      patient_id: 'profile-1',
      request_id: 'unestimated-meal',
      direction: 'intake',
      label: 'Meal photo to review later',
      food_items: [{ name: 'Unidentified meal', data_source: 'unknown' }],
      occurred_at: '2026-08-16T08:00:00+09:00',
    })) as any;
    expect(draft.entry).toMatchObject({
      energy_kcal: null,
      status: 'draft',
      food_items: [{ name: 'Unidentified meal', energy_kcal: null }],
    });

    const history = (await tool('get_claim_history').handler(context, {
      patient_id: 'profile-1',
      claim_kind: 'energy',
      claim_id: meal.energy_entry_id,
    })) as any;
    expect(history.revisions.map((revision: any) => revision.revision)).toEqual([2, 1]);
    expect(history.current.retained_file_count).toBe(1);
    expect(history.revisions[0].snapshot.retained_file_count).toBe(1);
  });

  it('edits foods in place and drops them when the meal becomes expenditure', async () => {
    const created = (await tool('log_energy_entry').handler(context, {
      patient_id: 'profile-1',
      request_id: 'in-place-foods',
      direction: 'intake',
      label: 'In place',
      food_items: [
        { name: 'Rice', energy_kcal: 281, data_source: 'database' },
        { name: 'Tea', energy_kcal: 0, data_source: 'database' },
      ],
      occurred_at: '2026-08-17T08:00:00+09:00',
    })) as any;
    const [rice, tea] = created.entry.food_items;
    await client.execute({
      sql: `UPDATE energy_food_item SET origin_external_id = 'ext-rice', nutrition_data = '{"potassiumMg":35}' WHERE id = ?`,
      args: [rice.food_item_id],
    });

    const edited = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: created.entry.energy_entry_id,
      expected_revision: created.entry.revision,
      food_items: [
        { food_item_id: rice.food_item_id, name: 'Rice', energy_kcal: 300, data_source: 'database' },
        { name: 'Natto', energy_kcal: 90, data_source: 'label' },
      ],
    })) as any;
    expect(edited.entry.food_items.map((item: any) => item.name)).toEqual(['Rice', 'Natto']);
    expect(edited.entry.food_items[0].food_item_id).toBe(rice.food_item_id);
    expect(edited.entry.energy_kcal).toBe(390);
    const kept = await client.execute({
      sql: 'SELECT origin_external_id, nutrition_data, created_at FROM energy_food_item WHERE id = ?',
      args: [rice.food_item_id],
    });
    expect(kept.rows[0].origin_external_id).toBe('ext-rice');
    expect(JSON.parse(String(kept.rows[0].nutrition_data))).toEqual({ potassiumMg: 35 });
    const gone = await client.execute({
      sql: 'SELECT id FROM energy_food_item WHERE id = ?',
      args: [tea.food_item_id],
    });
    expect(gone.rows).toHaveLength(0);

    const burned = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: created.entry.energy_entry_id,
      expected_revision: edited.entry.revision,
      direction: 'expenditure',
      energy_kcal: 120,
    })) as any;
    expect(burned.entry.food_items).toEqual([]);
    const left = await client.execute({
      sql: 'SELECT id FROM energy_food_item WHERE energy_claim_id = ?',
      args: [created.entry.energy_entry_id],
    });
    expect(left.rows).toHaveLength(0);
  });

  it('re-suggests the diary date when an entry moves to another day', async () => {
    const created = (await tool('log_energy_entry').handler(context, {
      patient_id: 'profile-1',
      request_id: 'moved-breakfast',
      direction: 'intake',
      category: 'breakfast',
      label: 'Toast',
      energy_kcal: 200,
      occurred_at: '2026-10-16T08:00:00+09:00',
    })) as any;
    expect(created.entry.local_date).toBe('2026-10-16');

    const moved = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: created.entry.energy_entry_id,
      expected_revision: created.entry.revision,
      occurred_at: '2026-10-19T08:00:00+09:00',
    })) as any;
    expect(moved.entry.local_date).toBe('2026-10-19');

    const named = (await tool('update_energy_entry').handler(context, {
      patient_id: 'profile-1',
      energy_entry_id: created.entry.energy_entry_id,
      expected_revision: moved.entry.revision,
      occurred_at: '2026-10-20T08:00:00+09:00',
      diary_date: '2026-10-19',
    })) as any;
    expect(named.entry.local_date).toBe('2026-10-19');
  });
});

describe('MCP claim permissions', () => {
  it('requires the token and stored grant to carry the same write scope', () => {
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:claims:write',
        'health:read health:claims:write',
        'health:claims:write',
      ),
    ).toBe(true);
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:claims:write',
        'health:read health:write',
        'health:claims:write',
      ),
    ).toBe(false);
    expect(
      contextModule.credentialsCarryScope(
        'health:read health:write',
        'health:read health:claims:write',
        'health:claims:write',
      ),
    ).toBe(false);
  });

  it('hides writes from read grants and advertises retry-safe creation', async () => {
    const readContext = {
      ...context,
      canWriteMeasurements: false,
      canWriteClaims: false,
    };
    const names = toolsModule.toolsFor(readContext).map((definition) => definition.name);
    expect(names).toContain('list_medicine_catalog');
    expect(names).toContain('get_medicine_catalog_entry');
    expect(names).toContain('get_medicine_catalog_history');
    expect(names).toContain('read_medicine_catalog_source');
    expect(names).toContain('list_medicines');
    expect(names).toContain('list_energy_entries');
    expect(names).toContain('get_claim_history');
    expect(names).not.toContain('create_medicine');
    expect(names).not.toContain('create_medicine_product');
    expect(names).not.toContain('log_energy_entry');

    const measurementNames = toolsModule
      .toolsFor({ ...context, canWriteMeasurements: true, canWriteClaims: false })
      .map((definition) => definition.name);
    expect(measurementNames).toContain('log_measurement');
    expect(measurementNames).not.toContain('create_medicine');

    const claimNames = toolsModule
      .toolsFor({ ...context, canWriteMeasurements: false, canWriteClaims: true })
      .map((definition) => definition.name);
    expect(claimNames).not.toContain('log_measurement');
    expect(claimNames).toContain('create_medicine');
    expect(claimNames).toContain('create_medicine_product');

    const response = (await protocolModule.dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      context,
    )) as any;
    const definitions = response.result.tools as any[];
    expect(definitions.find((definition) => definition.name === 'create_medicine').annotations)
      .toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });

    const refused = (await protocolModule.dispatch(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_medicine',
          arguments: {
            patient_id: 'profile-1',
            request_id: 'read-only-attempt',
            name: 'Should stay absent',
          },
        },
      },
      readContext,
    )) as any;
    expect(refused.result.isError).toBe(true);
    const absent = await client.execute({
      sql: 'SELECT count(*) AS count FROM medicine_claim WHERE name = ?',
      args: ['Should stay absent'],
    });
    expect(absent.rows[0]?.count).toBe(0);
  });
});

describe('MCP catalog review regressions', () => {
  async function ingredient(key: string, extra: Record<string, unknown> = {}) {
    return await catalogTool('create_medicine_ingredient').handler(context, {
      patient_id: 'profile-1', request_id: key, canonical_name: key, ...extra,
    }) as any;
  }

  async function product(key: string, extra: Record<string, unknown> = {}) {
    return await catalogTool('create_medicine_product').handler(context, {
      patient_id: 'profile-1', request_id: key, display_name: key, ...extra,
    }) as any;
  }

  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

  it('updates ingredients, retains omitted fields, and rejects stale revisions', async () => {
    const first = await ingredient('ingredient-update', {
      names: [{ name: 'Original name', language_tag: 'en' }],
      identifiers: [{ system: 'test', code: '123' }],
      source_data: { retained: '原文' },
    });
    const changed = await catalogTool('update_medicine_ingredient').handler(context, {
      patient_id: 'profile-1', ingredient_id: first.ingredient.ingredient_id,
      expected_revision: 1, canonical_name: 'Updated ingredient', notes: 'Correction',
    }) as any;
    expect(changed.ingredient).toMatchObject({
      canonical_name: 'Updated ingredient', revision: 2,
      names: first.ingredient.names, identifiers: first.ingredient.identifiers,
      source_data_summary: first.ingredient.source_data_summary,
    });
    await expect(catalogTool('update_medicine_ingredient').handler(context, {
      patient_id: 'profile-1', ingredient_id: first.ingredient.ingredient_id,
      expected_revision: 1, notes: 'Stale change',
    })).rejects.toThrow('Revision conflict; current_revision is 2');
    const history = await catalogTool('get_medicine_catalog_history').handler(context, {
      patient_id: 'profile-1', entity_kind: 'ingredient', entity_id: first.ingredient.ingredient_id,
    }) as any;
    expect(history.revisions.map((row: any) => row.revision)).toEqual([2, 1]);
    expect(history.revisions[0].snapshot.source_data_summary).toEqual(first.ingredient.source_data_summary);
    expect(JSON.stringify(history)).not.toContain('原文');
  });

  it('preserves ingredient source data through a full read and update', async () => {
    const first = await ingredient('source-round-trip', { source_data: { retained: 'Original ingredient payload' } });
    const read = await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1', query: 'source-round-trip',
    }) as any;
    const record = read.ingredients.find((row: any) => row.ingredient_id === first.ingredient.ingredient_id);
    expect(record).not.toHaveProperty('source_data');
    await catalogTool('update_medicine_ingredient').handler(context, { ...record, expected_revision: record.revision });
    expect((await catalogMutations.getMedicineIngredientRecord('profile-1', record.ingredient_id))?.sourceData)
      .toEqual({ retained: 'Original ingredient payload' });
  });

  it.each(['ingredient', 'product'] as const)('resolves overlapping %s creates inside the transaction', async (kind) => {
    const name = kind === 'ingredient' ? 'canonical_name' : 'display_name';
    const args = { patient_id: 'profile-1', request_id: 'overlap-' + kind, [name]: 'Original' };
    const create = catalogTool('create_medicine_' + kind);
    const results = await Promise.all([
      create.handler(context, args),
      create.handler(context, { ...args, [name]: 'Concurrent retry' }),
    ]) as any[];
    expect(results.map((row) => row.created).sort()).toEqual([false, true]);
    expect(results[0][kind]).toEqual(results[1][kind]);
    const id = results[0][kind][kind + '_id'];
    const revisions = await client.execute({
      sql: 'SELECT count(*) AS count FROM medicine_catalog_revision WHERE entity_kind = ? AND entity_id = ?',
      args: [kind, id],
    });
    expect(revisions.rows[0].count).toBe(1);
    await client.execute({ sql: 'UPDATE medicine_' + kind + ' SET origin_provider = ? WHERE id = ?', args: ['other-client', id] });
    await expect(create.handler(context, args)).rejects.toThrow('identifier collision');
  });

  it.each(['name_id', 'identifier_id', 'component_id'] as const)('rejects an unknown %s without advancing the revision', async (field) => {
    const base = await ingredient('child-reference-' + field);
    const first = await product('child-reference-product-' + field, {
      names: [{ name: 'Existing name' }],
      identifiers: [{ system: 'test', code: 'existing' }],
      ingredients: [{ ingredient_id: base.ingredient.ingredient_id }],
    });
    const fields = field === 'name_id' ? { names: [{ name_id: 'missing', name: 'Invalid' }] }
      : field === 'identifier_id' ? { identifiers: [{ identifier_id: 'missing', system: 'test', code: '123' }] }
      : { ingredients: [{ component_id: 'missing', ingredient_id: base.ingredient.ingredient_id }] };
    await expect(catalogTool('update_medicine_product').handler(context, {
      patient_id: 'profile-1', product_id: first.product.product_id, expected_revision: 1, ...fields,
    })).rejects.toThrow('Unknown ' + field);
    const stored = await catalogMutations.getMedicineProductRecord('profile-1', first.product.product_id);
    expect(stored?.revision).toBe(1);
    expect(stored?.names[0].id).toBe(first.product.names[0].name_id);
    if (field !== 'component_id') {
      await expect(catalogTool('update_medicine_ingredient').handler(context, {
        patient_id: 'profile-1', ingredient_id: base.ingredient.ingredient_id, expected_revision: 1, ...fields,
      })).rejects.toThrow('Unknown ' + field);
    }
  });

  it.each([
    { market_country: 'JPN' },
    { names: [{ name: 'Country', jurisdiction: 'JPN' }] },
    { identifiers: [{ system: 'test', code: '123', jurisdiction: 'JPN' }] },
  ])('reports invalid_country before field length for %j', async (fields) => {
    await expect(product('invalid-country-' + JSON.stringify(fields), fields)).rejects.toThrow('invalid_country');
  });

  it('round-trips product form, route, appearance, names, and identifiers', async () => {
    const linked = await ingredient('round-trip-component');
    const first = await product('round-trip', {
      source_data: { retained: 'Original product payload' },
      dose_form: 'Tablet', dose_form_system: 'form-system', dose_form_code: 'tablet',
      route: 'Oral', route_system: 'route-system', route_code: 'oral',
      imprint: 'A1', color: 'white', shape: 'round', market_country: 'jp',
      names: [{ name: 'Read and write', jurisdiction: 'jp' }],
      identifiers: [{ system: 'test', code: 'abc', jurisdiction: 'jp' }],
      ingredients: [{ ingredient_id: linked.ingredient.ingredient_id }],
    });
    const read = await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1', query: 'round-trip',
    }) as any;
    const record = read.products[0];
    expect(record).toMatchObject({
      dose_form_code: 'tablet', dose_form_system: 'form-system',
      route_code: 'oral', route_system: 'route-system',
      imprint: 'A1', color: 'white', shape: 'round', market_country: 'JP',
    });
    expect(record).not.toHaveProperty('appearance');
    expect(record).not.toHaveProperty('source_data');
    const schema = catalogTool('update_medicine_product').inputSchema as any;
    expect(Object.keys(record.ingredients[0]).every((key) => key in schema.properties.ingredients.items.properties)).toBe(true);
    const fields = Object.fromEntries(Object.keys(catalogTool('update_medicine_product').inputSchema.properties as object)
      .filter((key) => key in record).map((key) => [key, record[key]]));
    const changed = await catalogTool('update_medicine_product').handler(context, {
      ...fields, patient_id: 'profile-1', product_id: first.product.product_id, expected_revision: 1,
    }) as any;
    expect(changed.product).toMatchObject({ ...record, revision: 2, updated_at: expect.any(String) });
    expect((await catalogMutations.getMedicineProductRecord('profile-1', record.product_id))?.sourceData)
      .toEqual({ retained: 'Original product payload' });
  });

  it.each([
    ['ingredient', undefined], ['product', undefined], ['ingredient', 1], ['product', 1],
  ] as const)('pages complete %s names and identifiers at revision %s', async (kind, revision) => {
    const fields = {
      names: Array.from({ length: 30 }, (_, i) => ({ name: `Name ${i}`, source_url: 'https://example.com/' + 'a'.repeat(1_900) })),
      identifiers: Array.from({ length: 30 }, (_, i) => ({ system: 'test', code: String(i), source_url: 'https://example.com/' + 'b'.repeat(1_900) })),
    };
    const created = await (kind === 'ingredient' ? ingredient : product)('child-pages-' + kind + '-' + revision, fields);
    const args = { patient_id: 'profile-1', entity_kind: kind, entity_id: created[kind][kind + '_id'], revision };
    if (revision !== undefined) {
      await catalogTool('update_medicine_' + kind).handler(context, {
        patient_id: 'profile-1', [kind + '_id']: args.entity_id, expected_revision: 1,
        names: [{ name: 'Current name' }], identifiers: [],
        [kind === 'ingredient' ? 'canonical_name' : 'display_name']: 'Current identity',
      });
      const history = await catalogTool('get_medicine_catalog_history').handler(context, {
        ...args, before_revision: 2,
      }) as any;
      expect(history.truncated).toBe(true);
      expect(history.revisions[0].snapshot.names.length).toBeLessThan(30);
      expect(history.hint).toContain('get_medicine_catalog_entry');
      expect(history.hint).toContain('saved revision');
    }
    const names: any[] = [];
    const identifiers: any[] = [];
    let namesOffset: number | null = 0;
    let identifiersOffset: number | null = 0;
    do {
      const page = await catalogTool('get_medicine_catalog_entry').handler(context, {
        ...args, names_offset: namesOffset, identifiers_offset: identifiersOffset,
        names_limit: 30, identifiers_limit: 30,
      }) as any;
      expect(bytes(page)).toBeLessThanOrEqual(40_000);
      expect(page.entry.revision).toBe(1);
      expect(page.entry[kind === 'ingredient' ? 'canonical_name' : 'display_name']).toBe('child-pages-' + kind + '-' + revision);
      if (names.length === 0) expect(page.truncated).toBe(true);
      names.push(...page.entry.names);
      identifiers.push(...page.entry.identifiers);
      expect(names.length).toBeLessThanOrEqual(30);
      expect(identifiers.length).toBeLessThanOrEqual(30);
      namesOffset = page.next_names_offset;
      identifiersOffset = page.next_identifiers_offset;
    } while (namesOffset !== null || identifiersOffset !== null);
    expect(names.map(({ name, source_url }) => ({ name, source_url }))).toEqual(fields.names);
    expect(identifiers.map(({ system, code, source_url }) => ({ system, code, source_url }))).toEqual(fields.identifiers);
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, { ...args, names_offset: -1 })).rejects.toThrow('names_offset');
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, { ...args, identifiers_limit: 31 })).rejects.toThrow('identifiers_limit');
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, { ...args, entity_kind: 'invalid' })).rejects.toThrow('entity_kind');
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, { ...args, entity_id: 'missing' })).rejects.toThrow('No such');
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, { ...args, patient_id: 'profile-2' })).rejects.toThrow();
  });

  it.each(['ingredient', 'product'] as const)('pages unordered saved %s children by stored position', async (kind) => {
    const linked: Array<{ ingredient: { ingredient_id: string } }> = [];
    if (kind === 'product') {
      for (let i = 0; i < 3; i += 1) linked.push(await ingredient('unordered-component-' + i));
    }
    const created = await (kind === 'ingredient' ? ingredient : product)('unordered-' + kind, {
      names: [0, 1, 2].map((i) => ({ name: 'Name ' + i })),
      identifiers: [0, 1, 2].map((i) => ({ system: 'test', code: String(i) })),
      ...(kind === 'product' ? { ingredients: linked.map((value) => ({ ingredient_id: value.ingredient.ingredient_id })) } : {}),
    });
    const id = created[kind][kind + '_id'];
    const rows = await client.execute({
      sql: 'SELECT snapshot FROM medicine_catalog_revision WHERE patient_id = ? AND entity_kind = ? AND entity_id = ? AND revision = 1',
      args: ['profile-1', kind, id],
    });
    const snapshot = JSON.parse(String(rows.rows[0].snapshot));
    for (const collection of ['names', 'identifiers', ...(kind === 'product' ? ['ingredients'] : [])]) {
      snapshot[collection].forEach((row: any, i: number) => { row.orderIndex = [8, 2, 5][i]; });
    }
    await client.execute({
      sql: 'UPDATE medicine_catalog_revision SET snapshot = ? WHERE patient_id = ? AND entity_kind = ? AND entity_id = ? AND revision = 1',
      args: [JSON.stringify(snapshot), 'profile-1', kind, id],
    });
    const seen: Record<string, any[]> = { names: [], identifiers: [], ingredients: [] };
    const offsets: Record<string, number | null> = { names: 0, identifiers: 0, ingredients: 0 };
    for (const next of [3, 6, null]) {
      const page = await catalogTool('get_medicine_catalog_entry').handler(context, {
        patient_id: 'profile-1', entity_kind: kind, entity_id: id, revision: 1,
        ...Object.fromEntries(Object.keys(offsets).flatMap((key) => [[key + '_offset', offsets[key]], [key + '_limit', 1]])),
      }) as any;
      for (const key of Object.keys(offsets)) {
        seen[key].push(...page.entry[key]);
        offsets[key] = page['next_' + key + '_offset'];
        expect(offsets[key]).toBe(key === 'ingredients' && kind === 'ingredient' ? null : next);
      }
    }
    expect(seen.names.map((row) => row.name)).toEqual(['Name 1', 'Name 2', 'Name 0']);
    expect(seen.identifiers.map((row) => row.code)).toEqual(['1', '2', '0']);
    expect(seen.ingredients.map((row) => row.ingredient_id)).toEqual(kind === 'product'
      ? [1, 2, 0].map((i) => linked[i].ingredient.ingredient_id) : []);
  });

  it.each([undefined, 1])('skips child queries for null offsets and zero limits at revision %s', async (revision) => {
    const linked = await ingredient('skip-component-' + revision);
    const created = await product('skip-children-' + revision, {
      names: [{ name: 'Name' }], identifiers: [{ system: 'test', code: 'skip' }],
      ingredients: [{ ingredient_id: linked.ingredient.ingredient_id }],
    });
    const { db } = await import('../db');
    const ormClient = (db as any).session.client as Client;
    const spy = vi.spyOn(ormClient, 'execute');
    try {
      for (const skip of ['offset', 'limit']) {
        spy.mockClear();
        const page = await catalogTool('get_medicine_catalog_entry').handler(context, {
          patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id, revision,
          ...Object.fromEntries(['names', 'identifiers', 'ingredients'].map((key) => [key + '_' + skip, skip === 'offset' ? null : 0])),
        }) as any;
        expect(page.entry).toMatchObject({ names: [], identifiers: [], ingredients: [] });
        expect(page).toMatchObject({ next_names_offset: null, next_identifiers_offset: null, next_ingredients_offset: null, truncated: false });
        const statements = spy.mock.calls.map(([statement]: any) => statement.sql).join('\n');
        expect(statements).not.toMatch(/from "medicine_catalog_name"|from "medicine_catalog_identifier"|from "medicine_product_ingredient"|json_each/i);
      }
    } finally {
      spy.mockRestore();
    }
    const schema = catalogTool('get_medicine_catalog_entry').inputSchema as any;
    for (const key of ['names', 'identifiers', 'ingredients']) {
      expect(schema.properties[key + '_offset'].type).toEqual(['integer', 'null']);
    }
    for (const invalid of [0, -1, 1.5]) {
      await expect(catalogTool('get_medicine_catalog_entry').handler(context, {
        patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id, revision: invalid,
      })).rejects.toThrow('revision');
    }
    await expect(catalogTool('get_medicine_catalog_entry').handler(context, {
      patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id, revision: 99,
    })).rejects.toThrow('No such medicine catalog revision');
    await expect(catalogTool('get_medicine_catalog_entry').handler({ ...context, patientIds: ['profile-2'] }, {
      patient_id: 'profile-2', entity_kind: 'product', entity_id: created.product.product_id, revision: 1,
    })).rejects.toThrow('No such medicine catalog revision');
  });

  it('marks an emptied collection truncated and keeps its continuation recoverable', async () => {
    const created = await ingredient('emptied-collection', {
      names: [{ name: 'Large name' }], identifiers: [{ system: 'test', code: 'large' }],
    });
    const id = created.ingredient.ingredient_id;
    for (const table of ['medicine_catalog_name', 'medicine_catalog_identifier']) {
      await client.execute({
        sql: 'UPDATE ' + table + ' SET source_provider = ? WHERE patient_id = ? AND ingredient_id = ?',
        args: ['x'.repeat(22_000), 'profile-1', id],
      });
    }
    const args = { patient_id: 'profile-1', entity_kind: 'ingredient', entity_id: id };
    const page = await catalogTool('get_medicine_catalog_entry').handler(context, args) as any;
    expect(bytes(page)).toBeLessThanOrEqual(40_000);
    expect(page.truncated).toBe(true);
    const empty = page.entry.names.length === 0 ? 'names' : 'identifiers';
    const other = empty === 'names' ? 'identifiers' : 'names';
    expect(page.entry[empty]).toEqual([]);
    expect(page['next_' + empty + '_offset']).toBe(0);
    const recovered = await catalogTool('get_medicine_catalog_entry').handler(context, {
      ...args, [empty + '_offset']: page['next_' + empty + '_offset'], [other + '_offset']: null,
    }) as any;
    expect(recovered.entry[empty]).toHaveLength(1);
    expect(recovered.entry[empty][0].source_provider).toBe('x'.repeat(22_000));
    expect(recovered['next_' + empty + '_offset']).toBeNull();
    expect(recovered.truncated).toBe(false);
  });

  it('keeps children reachable when root text exceeds the response budget', async () => {
    const text = '\u0001';
    const created = await product('large-root-details', {
      notes: text.repeat(4_000), package_description: text.repeat(1_000),
      ...Object.fromEntries(['dose_form', 'dose_form_system', 'route', 'route_system', 'strength',
        'manufacturer', 'authorization_holder'].map((key) => [key, text.repeat(300)])),
      dose_form_code: text.repeat(500), route_code: text.repeat(500),
      names: [{ name: 'Complete child', source_url: 'https://example.com/' + 'a'.repeat(1_900) }],
    });
    expect(created.truncated).toBe(true);
    const page = await catalogTool('get_medicine_catalog_entry').handler(context, {
      patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id,
    }) as any;
    expect(bytes(page)).toBeLessThanOrEqual(40_000);
    expect(page.entry.names[0]).toMatchObject({ name: 'Complete child', source_url: 'https://example.com/' + 'a'.repeat(1_900) });
    expect(page.next_names_offset).toBeNull();
  });

  it('rejects a detail page when the entry changes between its queries', async () => {
    const created = await product('detail-concurrent', { names: [{ name: 'Before' }] });
    const { db } = await import('../db');
    const ormClient = (db as any).session.client as Client;
    const execute = ormClient.execute.bind(ormClient);
    let changed = false;
    const spy = vi.spyOn(ormClient, 'execute').mockImplementation(async (statement: any) => {
      const result = await execute(statement);
      if (!changed && typeof statement === 'object' && /from "medicine_catalog_name"/.test(statement.sql)) {
        changed = true;
        await catalogTool('update_medicine_product').handler(context, {
          patient_id: 'profile-1', product_id: created.product.product_id, expected_revision: 1,
          names: [{ name: 'After' }],
        });
      }
      return result;
    });
    try {
      await expect(catalogTool('get_medicine_catalog_entry').handler(context, {
        patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id,
      })).rejects.toThrow('changed while reading');
      expect(changed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects source_data over 2 MB before inserting', async () => {
    await expect(ingredient('oversized-ingredient', { source_data: 'x'.repeat(2 * 1024 * 1024) }))
      .rejects.toThrow('source_data must be valid JSON smaller than 2 MB');
    await expect(product('oversized-product', { source_data: '語'.repeat(700_000) }))
      .rejects.toThrow('source_data must be valid JSON smaller than 2 MB');
    const absent = await client.execute({
      sql: 'SELECT id FROM medicine_ingredient WHERE patient_id = ? AND normalized_name = ?',
      args: ['profile-1', 'oversized-ingredient'],
    });
    expect(absent.rows).toHaveLength(0);
  });

  it('keeps source chunks within the byte budget and reconstructs Unicode and escaped JSON', async () => {
    const source = { text: '😀'.repeat(21_000) + '"\n\\'.repeat(6_000) + '終わり' };
    const first = await product('source-byte-budget', { source_data: source });
    const args = { patient_id: 'profile-1', entity_kind: 'product', entity_id: first.product.product_id };
    let offset = 0;
    let reconstructed = '';
    let checksum: string | null = null;
    for (;;) {
      const part = await catalogTool('read_medicine_catalog_source').handler(context, {
        ...args, offset, limit: 10_000, revision: 1,
      }) as any;
      expect(bytes(part)).toBeLessThanOrEqual(40_000);
      expect(part.chunk).not.toMatch(/[\ud800-\udbff]$/u);
      expect(part.sha256).toBe(checksum ?? part.sha256);
      checksum = part.sha256;
      reconstructed += part.chunk;
      if (part.complete) break;
      expect(part.next_offset).toBeGreaterThan(offset);
      offset = part.next_offset;
    }
    expect(JSON.parse(reconstructed)).toEqual(source);
    const end = Array.from(reconstructed).length;
    const atEnd = await catalogTool('read_medicine_catalog_source').handler(context, { ...args, offset: end }) as any;
    expect(atEnd).toMatchObject({ chunk: '', complete: true, next_offset: null });
    await expect(catalogTool('read_medicine_catalog_source').handler(context, { ...args, offset: end + 1 }))
      .rejects.toThrow('offset is past the source payload');
  });

  it('budgets continuation metadata when an otherwise final chunk must be clipped', async () => {
    const first = await product('source-final-chunk', { source_data: '😀'.repeat(9_998) });
    const args = { patient_id: 'profile-1', entity_kind: 'product', entity_id: first.product.product_id, limit: 10_000 };
    const part = await catalogTool('read_medicine_catalog_source').handler(context, args) as any;
    expect(bytes(part)).toBeLessThanOrEqual(40_000);
    expect(part.complete).toBe(false);
    const last = await catalogTool('read_medicine_catalog_source').handler(context, { ...args, offset: part.next_offset }) as any;
    expect(last.complete).toBe(true);
    expect(JSON.parse(part.chunk + last.chunk)).toBe('😀'.repeat(9_998));
  });

  it('lets a read-only grant reach the source reader through the protocol', async () => {
    const first = await ingredient('read-only-source', { source_data: { value: 'readable' } });
    const readContext = { ...context, canWriteClaims: false, canWriteMeasurements: false,
      grant: { ...context.grant, lastUsedAt: new Date().toISOString() } };
    const response = await protocolModule.dispatch({
      jsonrpc: '2.0', id: 101, method: 'tools/call',
      params: { name: 'read_medicine_catalog_source', arguments: {
        patient_id: 'profile-1', entity_kind: 'ingredient', entity_id: first.ingredient.ingredient_id,
      } },
    }, readContext) as any;
    expect(response.result.isError).toBe(false);
    expect(JSON.parse(response.result.structuredContent.chunk)).toEqual({ value: 'readable' });
  });

  it('reaches every revision beyond the first 100, including budget-trimmed pages', async () => {
    const first = await ingredient('history-pagination');
    const id = first.ingredient.ingredient_id;
    await client.batch(Array.from({ length: 124 }, (_, index) => ({
      sql: `INSERT INTO medicine_catalog_revision
        (id, patient_id, entity_kind, entity_id, revision, snapshot, changed_at, change_origin_kind)
        SELECT ?, patient_id, entity_kind, entity_id, ?, json_set(snapshot, '$.revision', ?, '$.notes', ?), changed_at, change_origin_kind
        FROM medicine_catalog_revision WHERE entity_kind = 'ingredient' AND entity_id = ? AND revision = 1`,
      args: [crypto.randomUUID(), index + 2, index + 2, '履歴'.repeat(1_000), id],
    })), 'write');
    await client.execute({ sql: 'UPDATE medicine_ingredient SET revision = 125 WHERE id = ?', args: [id] });
    const seen: number[] = [];
    let before: number | undefined;
    do {
      const page = await catalogTool('get_medicine_catalog_history').handler(context, {
        patient_id: 'profile-1', entity_kind: 'ingredient', entity_id: id, limit: 100,
        ...(before === undefined ? {} : { before_revision: before }),
      }) as any;
      expect(bytes(page)).toBeLessThanOrEqual(40_000);
      expect(page.revisions.length).toBeGreaterThan(0);
      seen.push(...page.revisions.map((row: any) => row.revision));
      if (page.next_before_revision === null) break;
      expect(page.next_before_revision).toBe(page.revisions.at(-1).revision);
      before = page.next_before_revision;
    } while (seen.length <= 125);
    expect(seen).toEqual(Array.from({ length: 125 }, (_, index) => 125 - index));
  });

  it('bounds single-entry create, update, list, and history results with large components', async () => {
    const first = await ingredient('large-linked-ingredient', {
      names: Array.from({ length: 30 }, (_, i) => ({ name: String(i) + '語'.repeat(290), source_url: 'https://example.com/' + 'a'.repeat(1_900) })),
      notes: '語'.repeat(4_000), source_data: { secret_payload: 'x'.repeat(100_000) },
    });
    expect(bytes(first)).toBeLessThanOrEqual(40_000);
    const others = [];
    for (let i = 1; i < 30; i += 1) others.push(await ingredient(`large-linked-ingredient-${i}`));
    const ingredientIds = [first, ...others].map((value) => value.ingredient.ingredient_id);
    const created = await product('large-single-product', {
      ingredients: ingredientIds.map((ingredient_id) => ({ ingredient_id,
        strength_text: '語'.repeat(300), source_url: 'https://example.com/' + 'a'.repeat(1_900) })),
      notes: '語'.repeat(4_000), source_data: { secret_product_payload: 'x'.repeat(100_000) },
    });
    expect(bytes(created)).toBeLessThanOrEqual(40_000);
    expect(created.truncated).toBe(true);
    const completeComponents: any[] = [];
    let offset: number | null = 0;
    do {
      const page = await catalogTool('get_medicine_catalog_entry').handler({
        ...context, canWriteClaims: false, canWriteMeasurements: false,
      }, {
        patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id,
        ingredients_offset: offset, ingredients_limit: 30, names_limit: 0, identifiers_limit: 0,
      }) as any;
      expect(bytes(page)).toBeLessThanOrEqual(40_000);
      expect(page.entry.revision).toBe(1);
      expect(page.entry.ingredients.length).toBeGreaterThan(0);
      for (const component of page.entry.ingredients) {
        expect(component.strength_text).toBe('語'.repeat(300));
        expect(component.source_url).toBe('https://example.com/' + 'a'.repeat(1_900));
      }
      completeComponents.push(...page.entry.ingredients);
      expect(completeComponents.length).toBeLessThanOrEqual(30);
      offset = page.next_ingredients_offset;
    } while (offset !== null);
    expect(completeComponents.map((row) => row.ingredient_id)).toEqual(ingredientIds);
    expect(new Set(completeComponents.map((row) => row.component_id)).size).toBe(30);

    expect(created.product.ingredients[0].ingredient).toEqual({
      ingredient_id: first.ingredient.ingredient_id, canonical_name: 'large-linked-ingredient',
    });
    const changed = await catalogTool('update_medicine_product').handler(context, {
      patient_id: 'profile-1', product_id: created.product.product_id, expected_revision: 1, color: 'white', ingredients: [],
    }) as any;
    expect(bytes(changed)).toBeLessThanOrEqual(40_000);
    const savedComponents: any[] = [];
    offset = 0;
    do {
      const page = await catalogTool('get_medicine_catalog_entry').handler(context, {
        patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id, revision: 1,
        ingredients_offset: offset, ingredients_limit: 30, names_offset: null, identifiers_offset: null,
      }) as any;
      expect(bytes(page)).toBeLessThanOrEqual(40_000);
      expect(page.entry.revision).toBe(1);
      expect(page.entry.ingredients.length).toBeGreaterThan(0);
      expect(JSON.stringify(page)).not.toContain('secret_payload');
      savedComponents.push(...page.entry.ingredients);
      expect(savedComponents.length).toBeLessThanOrEqual(30);
      offset = page.next_ingredients_offset;
    } while (offset !== null);
    expect(savedComponents).toEqual(completeComponents);
    const listed = await catalogTool('list_medicine_catalog').handler(context, {
      patient_id: 'profile-1', query: 'large-single-product',
    }) as any;
    expect(bytes(listed)).toBeLessThanOrEqual(40_000);
    expect(listed.products).toHaveLength(1);
    const history = await catalogTool('get_medicine_catalog_history').handler(context, {
      patient_id: 'profile-1', entity_kind: 'product', entity_id: created.product.product_id,
    }) as any;
    expect(bytes(history)).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(history)).not.toContain('secret_payload');
    expect(JSON.stringify(history)).not.toContain('secret_product_payload');
    expect(history.revisions[0].snapshot.source_data_summary).toEqual(created.product.source_data_summary);
  });
});

describe('MCP catalog query costs', () => {
  it('uses schema indexes for bounded candidate pages and every catalogue read shape', async () => {
    const { db } = await import('../db');
    const ormClient = (db as any).session.client as Client;
    const execute = ormClient.execute.bind(ormClient);
    const queries: Array<{ sql: string; args: any }> = [];
    const spy = vi.spyOn(ormClient, 'execute').mockImplementation(async (statement: any) => {
      if (typeof statement === 'object' && /^select /i.test(statement.sql)) queries.push(statement);
      return execute(statement);
    });
    try {
      for (const query of [undefined, 'large', 'no-such-catalog-name']) {
        for (const status of [undefined, 'active', 'archived']) {
          await catalogTool('list_medicine_catalog').handler(context, {
            patient_id: 'profile-1', query, status, limit: 100,
          });
          await catalogTool('list_medicine_catalog').handler(context, {
            patient_id: 'profile-1', query, status, limit: 100,
            after_ingredient_id: '0', after_product_id: '0',
          });
        }
      }
      const roots = await client.execute("SELECT id FROM medicine_product WHERE normalized_name = 'source-byte-budget'");
      for (const kind of ['ingredient', 'product']) {
        const rows = await client.execute({
          sql: 'SELECT id FROM medicine_' + kind + ' WHERE patient_id = ? LIMIT 1',
          args: ['profile-1'],
        });
        for (const revision of [undefined, 1]) {
          await catalogTool('get_medicine_catalog_entry').handler(context, {
            patient_id: 'profile-1', entity_kind: kind, entity_id: rows.rows[0].id, revision,
            names_offset: 1, identifiers_offset: 1, ingredients_offset: 1,
          });
        }
      }
      for (const before of [undefined, 2]) {
        await catalogTool('get_medicine_catalog_history').handler(context, {
          patient_id: 'profile-1', entity_kind: 'product', entity_id: roots.rows[0].id,
          before_revision: before,
        });
      }
      for (const revision of [undefined, 1]) {
        await catalogTool('read_medicine_catalog_source').handler(context, {
          patient_id: 'profile-1', entity_kind: 'product', entity_id: roots.rows[0].id, revision,
        });
      }
    } finally {
      spy.mockRestore();
    }
    expect(queries.length).toBeGreaterThan(20);
    for (const query of queries) {
      expect(query.args.length).toBeLessThanOrEqual(110);
      const plan = await client.execute({ sql: 'EXPLAIN QUERY PLAN ' + query.sql, args: query.args });
      const details = plan.rows.map((row) => String(row.detail));
      const snapshotCollections = query.sql.match(/from json_each\("snapshot", \?\)/g) || [];
      if (snapshotCollections.length) {
        // Each sort is confined to one saved collection (at most 30 children).
        expect(details.filter((detail) => detail.includes('USE TEMP B-TREE FOR ORDER BY')).length)
          .toBeLessThanOrEqual(snapshotCollections.length);
      } else {
        expect(details.join('\n'), query.sql).not.toContain('USE TEMP B-TREE FOR ORDER BY');
      }
      for (const detail of details) {
        if (/^SCAN \(subquery-\d+\)$/.test(detail)) {
          // Snapshot aggregation scans only the bounded JSON child projection.
          expect(query.sql).toContain('from json_each("snapshot", ?)');
          expect(query.sql).toMatch(/where json_extract\(value, '\$\.orderIndex'\) >= \?\s+order by json_extract\(value, '\$\.orderIndex'\)\s+limit \?/);
          expect(details.join('\n')).toContain('medicine_catalog_revision_entity_idx');
          continue;
        }
        if (detail.startsWith('SCAN ') && !detail.includes('VIRTUAL TABLE')) {
          expect(detail, query.sql).toMatch(/USING (COVERING )?INDEX/);
        }
        if (/SEARCH (medicine_catalog_name|medicine_catalog_identifier|medicine_product_ingredient) /.test(detail)) {
          expect(detail, query.sql).toMatch(/(?:ingredient_id|product_id)=\?/);
        }
      }
    }
    for (const table of ['medicine_ingredient', 'medicine_product']) {
      const query = queries.find((entry) => entry.sql.startsWith('select "id" from "' + table + '"') && entry.sql.includes(' > '));
      expect(query).toBeDefined();
      const index = table + '_patient_cursor_idx';
      const assertCursorPlan = (details: string) => {
        if (!details.includes(index) || details.includes('USE TEMP B-TREE')) throw new Error('missing cursor index');
      };
      const path = join(tmpdir(), 'catalog-query-plan-' + crypto.randomUUID() + '.db');
      let isolated = createClient({ url: 'file:' + path });
      try {
        const schema = await client.execute({ sql: 'SELECT sql FROM sqlite_schema WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type DESC', args: [table] });
        for (const row of schema.rows) await isolated.execute(String(row.sql));
        const plan = async () => (await isolated.execute({ sql: 'EXPLAIN QUERY PLAN ' + query!.sql, args: query!.args }))
          .rows.map((row) => String(row.detail)).join('\n');
        assertCursorPlan(await plan());
        // Closing finalizes EXPLAIN's prepared statements before changing the schema.
        isolated.close();
        isolated = createClient({ url: 'file:' + path });
        await isolated.execute('DROP INDEX ' + index);
        const withoutIndex = await plan();
        expect(() => assertCursorPlan(withoutIndex)).toThrow('missing cursor index');
      } finally {
        isolated.close();
        await unlink(path);
      }
    }
  });

  it('continues at the fetched bound when the budget removes every root or revision', async () => {
    const budget = await import('./budget');
    const cap = budget.capResult;
    const spy = vi.spyOn(budget, 'capResult').mockImplementation((payload) => {
      const result = cap(payload);
      for (const key of ['ingredients', 'products', 'revisions']) {
        if (key in result) (result as Record<string, unknown>)[key] = [];
      }
      return result;
    });
    try {
      const roots = await client.execute('SELECT id FROM medicine_product ORDER BY id LIMIT 2');
      const ingredients = await client.execute('SELECT id FROM medicine_ingredient ORDER BY id LIMIT 2');
      const page = await catalogTool('list_medicine_catalog').handler(context, {
        patient_id: 'profile-1', limit: 1,
      }) as any;
      expect(page.products).toEqual([]);
      expect(page.ingredients).toEqual([]);
      expect(page.next_product_id).toBe(roots.rows[0].id);
      expect(page.next_ingredient_id).toBe(ingredients.rows[0].id);
      const next = await catalogTool('list_medicine_catalog').handler(context, {
        patient_id: 'profile-1', limit: 1,
        after_product_id: page.next_product_id, after_ingredient_id: page.next_ingredient_id,
      }) as any;
      expect(next.next_product_id).toBe(roots.rows[1].id);
      expect(next.next_ingredient_id).toBe(ingredients.rows[1].id);
      const history = await catalogTool('get_medicine_catalog_history').handler(context, {
        patient_id: 'profile-1', entity_kind: 'product', entity_id: roots.rows[0].id, limit: 1,
      }) as any;
      const revisions = await client.execute({
        sql: 'SELECT revision FROM medicine_catalog_revision WHERE entity_kind = ? AND entity_id = ? ORDER BY revision DESC LIMIT 1',
        args: ['product', roots.rows[0].id],
      });
      expect(history.revisions).toEqual([]);
      expect(history.next_before_revision).toBe(revisions.rows[0].revision);
    } finally {
      spy.mockRestore();
    }
  });

  it('continues through empty search pages without scanning past the candidate bound', async () => {
    const seen: string[] = [];
    let ingredientCursor: string | null | undefined;
    let productCursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await catalogTool('list_medicine_catalog').handler(context, {
        patient_id: 'profile-1', query: 'round-trip', limit: 1,
        after_ingredient_id: ingredientCursor, after_product_id: productCursor,
      }) as any;
      expect(page.products.length).toBeLessThanOrEqual(1);
      seen.push(...page.products.map((entry: any) => entry.display_name));
      ingredientCursor = page.next_ingredient_id;
      productCursor = page.next_product_id;
      pages += 1;
      expect(pages).toBeLessThan(100);
    } while (ingredientCursor !== null || productCursor !== null);
    expect(seen).toEqual(['round-trip']);
    expect(pages).toBeGreaterThan(1);
  });
});
