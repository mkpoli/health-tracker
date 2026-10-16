import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { sha256Hex } from '$lib/archive-format';

const databasePath = join(tmpdir(), `health-tracker-archive-import-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let client: Client;
let archiveModule: typeof import('./archive-import');
let archiveMediaModule: typeof import('./archive-media');
let workoutModule: typeof import('./workout-mutations');

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
    CREATE TABLE report (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'lab',
      test_date TEXT NOT NULL,
      report_time TEXT,
      raw_data TEXT,
      organized_data TEXT,
      parsed_json_data TEXT,
      extra_data TEXT
    );
    CREATE TABLE record (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
      metric_name TEXT NOT NULL,
      value TEXT NOT NULL,
      unit TEXT,
      ref_range TEXT,
      status TEXT,
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
      change_origin_provider TEXT,
      UNIQUE(entity_kind, entity_id, revision)
    );
    CREATE TABLE medicine_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      product_id TEXT,
      name TEXT NOT NULL,
      generic_name TEXT,
      form TEXT,
      strength TEXT,
      route TEXT,
      status TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      purpose TEXT,
      prescriber TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      status TEXT NOT NULL,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE exercise_definition (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      category TEXT,
      equipment TEXT,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(patient_id, normalized_key),
      UNIQUE(patient_id, origin_provider, origin_external_id),
      UNIQUE(id, patient_id)
    );
    CREATE TABLE workout_claim (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('session', 'plan')),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      based_on_workout_id TEXT,
      started_at TEXT,
      ended_at TEXT,
      local_date TEXT,
      timezone TEXT,
      timezone_offset_minutes INTEGER,
      ended_timezone_offset_minutes INTEGER,
      notes TEXT,
      origin_kind TEXT NOT NULL,
      origin_provider TEXT,
      origin_external_id TEXT,
      source_created_at TEXT,
      source_updated_at TEXT,
      source_data TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(id, patient_id),
      UNIQUE(patient_id, kind, origin_provider, origin_external_id)
    );
    CREATE TABLE workout_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      workout_claim_id TEXT NOT NULL,
      exercise_definition_id TEXT,
      order_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      equipment TEXT,
      notes TEXT,
      rest_seconds INTEGER,
      superset_group TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      UNIQUE(id, workout_claim_id, patient_id),
      UNIQUE(workout_claim_id, order_index),
      FOREIGN KEY(workout_claim_id, patient_id)
        REFERENCES workout_claim(id, patient_id) ON DELETE CASCADE,
      FOREIGN KEY(exercise_definition_id, patient_id)
        REFERENCES exercise_definition(id, patient_id)
    );
    CREATE TABLE workout_set (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      workout_claim_id TEXT NOT NULL,
      workout_exercise_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      set_type TEXT NOT NULL,
      status TEXT NOT NULL,
      weight_value REAL,
      weight_unit TEXT,
      repetitions INTEGER,
      duration_seconds INTEGER,
      distance_value REAL,
      distance_unit TEXT,
      rpe REAL,
      rir REAL,
      notes TEXT,
      origin_external_id TEXT,
      source_data TEXT,
      UNIQUE(workout_exercise_id, order_index),
      FOREIGN KEY(workout_exercise_id, workout_claim_id, patient_id)
        REFERENCES workout_exercise(id, workout_claim_id, patient_id) ON DELETE CASCADE
    );
    CREATE TABLE claim_revision (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      claim_kind TEXT NOT NULL CHECK(claim_kind IN ('medicine', 'energy', 'workout')),
      claim_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      change_origin_kind TEXT NOT NULL,
      change_origin_provider TEXT
    );
    CREATE UNIQUE INDEX claim_revision_claim_idx
      ON claim_revision(claim_kind, claim_id, revision);
    CREATE TABLE energy_source (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      energy_claim_id TEXT NOT NULL REFERENCES energy_claim(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'photo',
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      file_name TEXT,
      byte_size INTEGER NOT NULL,
      object_etag TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE data_import (
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed')),
      file_name TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      interpretation_key TEXT NOT NULL DEFAULT '',
      storage_key TEXT NOT NULL UNIQUE,
      object_etag TEXT,
      timezone TEXT,
      summary_data TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(patient_id, provider, format, content_sha256, interpretation_key)
    );
    INSERT INTO patient (id, owner_user_id, name)
      VALUES ('destination-patient', 'owner-1', 'Destination');
    INSERT INTO energy_claim (
      id, patient_id, direction, label, category, energy_kcal, occurred_at,
      local_date, timezone, timezone_offset_minutes, duration_minutes, status,
      notes, origin_kind, origin_provider, origin_external_id, revision, created_at, updated_at
    ) VALUES (
      'existing-energy', 'destination-patient', 'intake', 'Existing entry', 'lunch', 500,
      '2026-08-02T03:00:00.000Z', '2026-08-02', 'Asia/Tokyo', 540, NULL,
      'recorded', NULL, 'connector', 'connector-a', 'entry-42', 1,
      '2026-08-02T03:00:00.000Z', '2026-08-02T03:00:00.000Z'
    );
  `);

  archiveModule = await import('./archive-import');
  archiveMediaModule = await import('./archive-media');
  workoutModule = await import('./workout-mutations');
});

afterAll(async () => {
  client.close();
  await Promise.allSettled([
    unlink(databasePath),
    unlink(`${databasePath}-shm`),
    unlink(`${databasePath}-wal`),
  ]);
});

const medicineCurrent = {
  id: 'source-medicine',
  patientId: 'source-patient',
  productId: 'source-product',
  name: 'Example medicine',
  genericName: null,
  form: 'tablet',
  strength: '10 mg',
  route: 'oral',
  status: 'active',
  startDate: '2026-08-01',
  endDate: null,
  purpose: null,
  prescriber: null,
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  revision: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const medicineFirst = {
  ...medicineCurrent,
  revision: 1,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const catalogSource = {
  sourceKind: 'manual',
  sourceProvider: null,
  sourceUrl: null,
  sourceRetrievedAt: null,
};

const medicineIngredientCurrent = {
  id: 'source-ingredient',
  patientId: 'source-patient',
  canonicalName: 'Example ingredient',
  normalizedName: 'example ingredient',
  status: 'active',
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  sourceData: { retained: true },
  revision: 1,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  names: [
    {
      id: 'source-ingredient-name',
      ingredientId: 'source-ingredient',
      productId: null,
      orderIndex: 0,
      name: 'Example ingredient',
      normalizedName: 'example ingredient',
      languageTag: 'en',
      nameType: 'generic',
      jurisdiction: null,
      preferred: true,
      ...catalogSource,
    },
  ],
  identifiers: [
    {
      id: 'source-ingredient-identifier',
      ingredientId: 'source-ingredient',
      productId: null,
      orderIndex: 0,
      system: 'RxNorm',
      code: '12345',
      jurisdiction: null,
      ...catalogSource,
    },
  ],
};

const medicineProductCurrent = {
  id: 'source-product',
  patientId: 'source-patient',
  displayName: 'Example medicine 10 mg',
  productType: 'branded',
  status: 'active',
  doseFormText: 'tablet',
  doseFormSystem: null,
  doseFormCode: null,
  routeText: 'oral',
  routeSystem: null,
  routeCode: null,
  strengthText: '10 mg',
  manufacturer: 'Example manufacturer',
  marketingAuthorizationHolder: null,
  marketCountry: 'JP',
  packageDescription: '30 tablets',
  imprint: 'EX10',
  color: 'white',
  shape: 'round',
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  sourceData: { label: 'retained' },
  revision: 2,
  createdAt: '2026-07-31T01:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
  names: [
    {
      id: 'source-product-name',
      ingredientId: null,
      productId: 'source-product',
      orderIndex: 0,
      name: 'Example medicine 10 mg',
      normalizedName: 'example medicine 10 mg',
      languageTag: 'en',
      nameType: 'brand',
      jurisdiction: 'JP',
      preferred: true,
      ...catalogSource,
    },
  ],
  identifiers: [
    {
      id: 'source-product-identifier',
      ingredientId: null,
      productId: 'source-product',
      orderIndex: 0,
      system: 'YJ',
      code: '123456789',
      jurisdiction: 'JP',
      ...catalogSource,
    },
  ],
  ingredients: [
    {
      id: 'source-product-ingredient',
      productId: 'source-product',
      ingredientId: 'source-ingredient',
      orderIndex: 0,
      role: 'active',
      numeratorValue: '10',
      numeratorUnit: 'mg',
      denominatorValue: '1',
      denominatorUnit: 'tablet',
      strengthText: '10 mg per tablet',
      basisOfStrengthText: null,
      ...catalogSource,
      ingredient: medicineIngredientCurrent,
    },
  ],
};

const medicineProductFirst = {
  ...medicineProductCurrent,
  packageDescription: '14 tablets',
  revision: 1,
  updatedAt: '2026-07-31T01:00:00.000Z',
};

const energyCurrent = {
  id: 'source-energy',
  patientId: 'source-patient',
  direction: 'intake',
  label: 'Example meal',
  category: 'lunch',
  energyKcal: 540,
  occurredAt: '2026-08-02T03:00:00.000Z',
  localDate: '2026-08-02',
  timezone: 'Asia/Tokyo',
  timezoneOffsetMinutes: 540,
  durationMinutes: null,
  status: 'recorded',
  notes: null,
  originKind: 'manual',
  originProvider: 'connector-a',
  originExternalId: 'entry-42',
  revision: 1,
  createdAt: '2026-08-02T03:00:00.000Z',
  updatedAt: '2026-08-02T03:00:00.000Z',
};

const exerciseDefinitionCurrent = {
  id: 'source-exercise-definition',
  patientId: 'source-patient',
  name: 'Barbell squat',
  category: 'strength',
  equipment: 'barbell',
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  sourceData: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const workoutPlan = {
  id: 'source-workout-plan',
  patientId: 'source-patient',
  kind: 'plan',
  title: 'Lower body plan',
  status: 'active',
  basedOnWorkoutId: null,
  startedAt: null,
  endedAt: null,
  localDate: null,
  timezone: null,
  timezoneOffsetMinutes: null,
  endedTimezoneOffsetMinutes: null,
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  sourceData: null,
  revision: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  exercises: [
    {
      id: 'source-plan-exercise',
      workoutId: 'source-workout-plan',
      exerciseDefinitionId: 'source-exercise-definition',
      orderIndex: 0,
      name: 'Barbell squat',
      category: 'strength',
      equipment: 'barbell',
      notes: null,
      restSeconds: 180,
      supersetGroup: null,
      originExternalId: null,
      sourceData: null,
      sets: [
        {
          id: 'source-plan-set',
          workoutExerciseId: 'source-plan-exercise',
          orderIndex: 0,
          setType: 'normal',
          status: 'planned',
          weightValue: 80,
          weightUnit: 'kg',
          repetitions: 8,
          durationSeconds: null,
          distanceValue: null,
          distanceUnit: null,
          rpe: null,
          rir: 2,
          notes: null,
          originExternalId: null,
          sourceData: null,
        },
      ],
    },
  ],
};

const workoutCurrent = {
  ...workoutPlan,
  id: 'source-workout-session',
  kind: 'session',
  title: 'Lower body session',
  status: 'completed',
  basedOnWorkoutId: 'source-workout-plan',
  startedAt: '2026-08-03T09:00:00.000Z',
  endedAt: '2026-08-03T10:00:00.000Z',
  localDate: '2026-08-03',
  timezone: 'Asia/Tokyo',
  timezoneOffsetMinutes: 540,
  endedTimezoneOffsetMinutes: 540,
  revision: 2,
  createdAt: '2026-08-03T09:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
  exercises: [
    {
      ...workoutPlan.exercises[0],
      id: 'source-session-exercise',
      workoutId: 'source-workout-session',
      sets: [
        {
          ...workoutPlan.exercises[0].sets[0],
          id: 'source-session-set',
          workoutExerciseId: 'source-session-exercise',
          status: 'completed',
          repetitions: 10,
        },
      ],
    },
  ],
};

const workoutFirst = {
  ...workoutCurrent,
  revision: 1,
  updatedAt: '2026-08-03T09:30:00.000Z',
  exercises: [
    {
      ...workoutCurrent.exercises[0],
      sets: [{ ...workoutCurrent.exercises[0].sets[0], repetitions: 8 }],
    },
  ],
};

describe('archive import storage', () => {
  it('rejects a medicine product before its ingredient is imported', async () => {
    const patientId = 'missing-ingredient-destination';
    await client.execute({
      sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
      args: [patientId, 'owner-1', patientId],
    });
    try {
      const batch = {
        patientId,
        sourcePatientId: 'source-patient',
        kind: 'medicineProducts' as const,
        items: [medicineProductCurrent],
      };
      await expect(archiveModule.importArchiveBatch(batch)).rejects.toMatchObject({
        code: 'missing_medicine_catalog_reference',
      });
      const products = await client.execute({
        sql: 'SELECT id FROM medicine_product WHERE patient_id = ?',
        args: [patientId],
      });
      expect(products.rows).toEqual([]);

      await archiveModule.importArchiveBatch({
        patientId,
        sourcePatientId: 'source-patient',
        kind: 'medicineIngredients',
        items: [medicineIngredientCurrent],
      });
      await expect(archiveModule.importArchiveBatch(batch)).resolves.toMatchObject({ inserted: 1 });
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [patientId] });
    }
  });

  it('rejects a medicine naming an unknown product without inserting the batch', async () => {
    const patientId = 'missing-product-destination';
    await client.execute({
      sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
      args: [patientId, 'owner-1', patientId],
    });
    try {
      await expect(
        archiveModule.importArchiveBatch({
          patientId,
          sourcePatientId: 'source-patient',
          kind: 'medicines',
          items: [
            { ...medicineCurrent, id: 'unlinked-medicine', productId: null },
            { ...medicineCurrent, productId: 'unknown-product' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'missing_medicine_catalog_reference' });
      const medicines = await client.execute({
        sql: 'SELECT id FROM medicine_claim WHERE patient_id = ?',
        args: [patientId],
      });
      const revisions = await client.execute({
        sql: 'SELECT id FROM claim_revision WHERE patient_id = ?',
        args: [patientId],
      });
      expect(medicines.rows).toEqual([]);
      expect(revisions.rows).toEqual([]);
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [patientId] });
    }
  });

  it('restores medicine history after deleting its product and exporting', async () => {
    const patientId = 'deleted-product-source';
    const restoredPatientId = 'deleted-product-destination';
    for (const id of [patientId, restoredPatientId]) {
      await client.execute({
        sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
        args: [id, 'owner-1', id],
      });
    }
    try {
      for (const batch of [
        { kind: 'medicineIngredients' as const, items: [medicineIngredientCurrent] },
        { kind: 'medicineProducts' as const, items: [medicineProductCurrent] },
        { kind: 'medicines' as const, items: [medicineCurrent] },
      ]) {
        await archiveModule.importArchiveBatch({
          patientId,
          sourcePatientId: 'source-patient',
          ...batch,
        });
      }
      const loader = await import('./medicine-catalog-load');
      const { deleteMedicineProduct } = await import('./medicine-catalog-mutations');
      const catalogBefore = await loader.loadMedicineCatalog(patientId, { sourceData: true });
      const product = catalogBefore.products[0];
      await deleteMedicineProduct({
        patientId,
        id: product.id,
        expectedRevision: product.revision,
        source: { kind: 'manual', provider: 'local' },
        changedAt: '2026-08-03T00:00:00.000Z',
      });

      const { db } = await import('./db');
      const schema = await import('./db/schema');
      const { eq } = await import('drizzle-orm');
      const { buildPatientExport } = await import('$lib/export');
      const { parseHealthTrackerExport } = await import('$lib/health-archive');
      const medicines = await db.select().from(schema.medicineClaim)
        .where(eq(schema.medicineClaim.patientId, patientId));
      const claimRevisions = await db.select().from(schema.claimRevision)
        .where(eq(schema.claimRevision.patientId, patientId))
        .orderBy(schema.claimRevision.revision);
      const catalog = await loader.loadMedicineCatalog(patientId, { sourceData: true });
      expect(catalog.products).toEqual([]);
      expect(medicines[0]).toMatchObject({ productId: null, revision: 3 });
      expect(claimRevisions.map(({ snapshot }) => snapshot)).toMatchObject([
        { productId: product.id, revision: 2 },
        { productId: null, revision: 3 },
      ]);
      const exported = parseHealthTrackerExport(JSON.parse(JSON.stringify(buildPatientExport({
        patient: { id: patientId, name: patientId },
        reports: [],
        records: [],
        medicineIngredients: catalog.ingredients,
        medicineProducts: catalog.products,
        medicineCatalogRevisions: await loader.loadMedicineCatalogRevisions(patientId),
        medicines,
        claimRevisions,
        medicineCourses: [],
        doseRegimens: [],
        doseOccurrences: [],
        energyEntries: [],
        energySources: [],
        dataImports: [],
        exerciseDefinitions: [],
        workouts: [],
      }))));
      for (const batch of [
        { kind: 'medicineIngredients' as const, items: exported.medicineIngredients },
        { kind: 'medicineProducts' as const, items: exported.medicineProducts },
        { kind: 'medicineCatalogRevisions' as const, items: exported.medicineCatalogRevisions },
        { kind: 'medicines' as const, items: exported.medicines },
        { kind: 'revisions' as const, items: exported.claimRevisions },
      ]) {
        if (!batch.items.length) continue;
        await archiveModule.importArchiveBatch({
          patientId: restoredPatientId,
          sourcePatientId: patientId,
          ...batch,
        });
      }
      const restoredMedicineId = await archiveModule.resolveArchiveEntityId(
        restoredPatientId, patientId, 'medicine', medicines[0].id,
      );
      const restoredProductId = await archiveModule.resolveArchiveEntityId(
        restoredPatientId, patientId, 'medicine-product', product.id,
      );
      const restoredMedicines = await db.select().from(schema.medicineClaim)
        .where(eq(schema.medicineClaim.patientId, restoredPatientId));
      expect(restoredMedicines).toEqual([
        { ...medicines[0], id: restoredMedicineId, patientId: restoredPatientId },
      ]);
      const restoredRevisions = await db.select().from(schema.claimRevision)
        .where(eq(schema.claimRevision.patientId, restoredPatientId))
        .orderBy(schema.claimRevision.revision);
      expect(restoredRevisions.map(({ snapshot }) => snapshot)).toEqual(
        claimRevisions.map(({ snapshot }) => ({
          ...snapshot,
          id: restoredMedicineId,
          patientId: restoredPatientId,
          productId: 'productId' in snapshot && snapshot.productId ? restoredProductId : null,
        })),
      );
      expect((await loader.loadMedicineCatalog(restoredPatientId, { sourceData: true })).products).toEqual([]);
    } finally {
      for (const id of [patientId, restoredPatientId]) {
        await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [id] });
      }
    }
  });

  it.each([
    { kind: 'medicineProducts' as const, item: medicineProductCurrent },
    { kind: 'medicines' as const, item: medicineCurrent },
  ])('rejects $kind referencing another profile\'s catalogue IDs', async ({ kind, item }) => {
    const patientId = 'catalog-reference-destination';
    const otherPatientId = 'catalog-reference-other';
    for (const id of [patientId, otherPatientId]) {
      await client.execute({
        sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
        args: [id, 'owner-1', id],
      });
    }
    try {
      for (const batch of [
        { kind: 'medicineIngredients' as const, items: [medicineIngredientCurrent] },
        { kind: 'medicineProducts' as const, items: [medicineProductCurrent] },
      ]) {
        await archiveModule.importArchiveBatch({
          patientId: otherPatientId,
          sourcePatientId: otherPatientId,
          ...batch,
        });
      }
      // Restoring to the source profile keeps IDs, so the references exist only
      // in the other profile rather than being remapped to unknown IDs.
      await expect(
        archiveModule.importArchiveBatch({
          patientId,
          sourcePatientId: patientId,
          kind,
          items: [item],
        }),
      ).rejects.toMatchObject({ code: 'missing_medicine_catalog_reference' });
      const products = await client.execute({
        sql: 'SELECT id FROM medicine_product WHERE patient_id = ?',
        args: [patientId],
      });
      const medicines = await client.execute({
        sql: 'SELECT id FROM medicine_claim WHERE patient_id = ?',
        args: [patientId],
      });
      expect(products.rows).toEqual([]);
      expect(medicines.rows).toEqual([]);
    } finally {
      for (const id of [patientId, otherPatientId]) {
        await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [id] });
      }
    }
  });

  it.each([
    { view: 'catalogue', query: '' },
    { view: 'revisions', query: '&entityKind=product&entityId=source-product' },
  ])('returns 404 for another owner\'s medicine $view', async ({ query }) => {
    const patientId = 'catalog-other-owner';
    await client.execute({
      sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
      args: [patientId, 'owner-2', patientId],
    });
    try {
      const { GET } = await import('../../routes/api/medicine-catalog/+server');
      await expect(
        GET({
          url: new URL(`https://health.example/api/medicine-catalog?patientId=${patientId}${query}`),
          locals: { user: { sub: 'owner-1' } },
        } as Parameters<typeof GET>[0]),
      ).rejects.toMatchObject({ status: 404, body: { message: 'Profile not found' } });
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [patientId] });
    }
  });

  it('rejects incomplete medicine-product strengths', async () => {
    await client.execute(
      `INSERT INTO patient (id, owner_user_id, name) VALUES ('invalid-destination', 'owner-1', 'Invalid import')`,
    );
    try {
      await archiveModule.importArchiveBatch({
        patientId: 'invalid-destination',
        sourcePatientId: 'invalid-source',
        kind: 'medicineIngredients',
        items: [medicineIngredientCurrent],
      });
      await expect(
        archiveModule.importArchiveBatch({
          patientId: 'invalid-destination',
          sourcePatientId: 'invalid-source',
          kind: 'medicineProducts',
          items: [
            {
              ...medicineProductCurrent,
              ingredients: [
                {
                  ...medicineProductCurrent.ingredients[0],
                  numeratorUnit: null,
                },
              ],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'invalid_medicine_catalog' });
    } finally {
      await client.execute({
        sql: 'DELETE FROM patient WHERE id = ?',
        args: ['invalid-destination'],
      });
    }
  });

  it('does not restore catalogue children removed after an earlier restore', async () => {
    await client.execute(
      `INSERT INTO patient (id, owner_user_id, name) VALUES ('repeat-destination', 'owner-1', 'Repeat import')`,
    );
    try {
      const batch = {
        patientId: 'repeat-destination',
        sourcePatientId: 'repeat-source',
        kind: 'medicineIngredients' as const,
        items: [medicineIngredientCurrent],
      };
      await archiveModule.importArchiveBatch(batch);
      await client.execute({
        sql: 'DELETE FROM medicine_catalog_identifier WHERE patient_id = ?',
        args: ['repeat-destination'],
      });
      await archiveModule.importArchiveBatch(batch);
      const left = await client.execute({
        sql: 'SELECT count(*) AS n FROM medicine_catalog_identifier WHERE patient_id = ?',
        args: ['repeat-destination'],
      });
      expect(Number(left.rows[0].n)).toBe(0);
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: ['repeat-destination'] });
    }
  });

  it('loads catalogue source payloads only when asked', async () => {
    await client.execute(
      `INSERT INTO patient (id, owner_user_id, name) VALUES ('payload-destination', 'owner-1', 'Payload import')`,
    );
    try {
      await archiveModule.importArchiveBatch({
        patientId: 'payload-destination',
        sourcePatientId: 'payload-source',
        kind: 'medicineIngredients',
        items: [medicineIngredientCurrent],
      });
      const loader = await import('./medicine-catalog-load');
      const light = await loader.loadMedicineCatalog('payload-destination', { sourceData: false });
      const full = await loader.loadMedicineCatalog('payload-destination', { sourceData: true });
      expect(light.ingredients).toHaveLength(1);
      expect(light.ingredients[0].sourceData).toBeNull();
      expect(light.ingredients[0].names).toHaveLength(1);
      expect(full.ingredients[0].sourceData).toEqual({ retained: true });
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: ['payload-destination'] });
    }
  });

  it('exports catalogue entries ordered by updatedAt then id', async () => {
    const patientId = 'catalog-export-order';
    await client.execute({
      sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
      args: [patientId, 'owner-1', patientId],
    });
    try {
      for (const [suffix, name, updatedAt] of [
        ['b', 'Alpha', '2026-01-02T00:00:00.000Z'],
        ['z', 'Beta', '2026-01-01T00:00:00.000Z'],
        ['a', 'Gamma', '2026-01-02T00:00:00.000Z'],
      ]) {
        await client.execute({
          sql: `INSERT INTO medicine_ingredient
            (id, patient_id, canonical_name, normalized_name, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
          args: [`${patientId}-ingredient-${suffix}`, patientId, name, name.toLowerCase(), updatedAt],
        });
        await client.execute({
          sql: `INSERT INTO medicine_product (id, patient_id, display_name, updated_at)
            VALUES (?, ?, ?, ?)`,
          args: [`${patientId}-product-${suffix}`, patientId, name, updatedAt],
        });
      }

      const { GET } = await import('../../routes/api/medicine-catalog/+server');
      const response = await GET({
        url: new URL(`https://health.example/api/medicine-catalog?patientId=${patientId}`),
        locals: { user: { sub: 'owner-1' } },
      } as Parameters<typeof GET>[0]);
      expect(response.status).toBe(200);
      const exported = await response.json() as {
        medicineIngredients: Array<{ id: string }>;
        medicineProducts: Array<{ id: string }>;
      };
      expect(exported.medicineIngredients.map(({ id }) => id)).toEqual(
        ['z', 'a', 'b'].map((suffix) => `${patientId}-ingredient-${suffix}`),
      );
      expect(exported.medicineProducts.map(({ id }) => id)).toEqual(
        ['z', 'a', 'b'].map((suffix) => `${patientId}-product-${suffix}`),
      );
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [patientId] });
    }
  });

  it('loads catalogue revisions ordered by changedAt then id descending', async () => {
    const patientId = 'catalog-revision-order';
    const entityId = `${patientId}-ingredient`;
    await client.execute({
      sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
      args: [patientId, 'owner-1', patientId],
    });
    try {
      for (const [index, [suffix, changedAt]] of [
        ['b', '2026-01-02T00:00:00.000Z'],
        ['c', '2026-01-02T00:00:00.000Z'],
        ['z', '2026-01-01T00:00:00.000Z'],
        ['a', '2026-01-02T00:00:00.000Z'],
      ].entries()) {
        const revision = index + 1;
        await client.execute({
          sql: `INSERT INTO medicine_catalog_revision
            (id, patient_id, entity_kind, entity_id, revision, snapshot, changed_at)
            VALUES (?, ?, 'ingredient', ?, ?, ?, ?)`,
          args: [
            `${patientId}-${suffix}`, patientId, entityId, revision,
            JSON.stringify({ ...medicineIngredientCurrent, id: entityId, patientId, revision }),
            changedAt,
          ],
        });
      }

      const { loadMedicineCatalogRevisions } = await import('./medicine-catalog-load');
      const expectedIds = ['c', 'b', 'a', 'z'].map((suffix) => `${patientId}-${suffix}`);
      expect((await loadMedicineCatalogRevisions(patientId)).map(({ id }) => id)).toEqual(expectedIds);
      expect((await loadMedicineCatalogRevisions(patientId, {
        kind: 'ingredient', id: entityId,
      })).map(({ id }) => id)).toEqual(expectedIds);
    } finally {
      await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [patientId] });
    }
  });

  it('exports nested ingredients without source payloads and restores the catalogue', async () => {
    const patientId = 'catalog-export';
    const restoredPatientId = 'catalog-restored';
    for (const id of [patientId, restoredPatientId]) {
      await client.execute({
        sql: 'INSERT INTO patient (id, owner_user_id, name) VALUES (?, ?, ?)',
        args: [id, 'owner-1', id],
      });
    }
    try {
      for (const batch of [
        { kind: 'medicineIngredients' as const, items: [medicineIngredientCurrent] },
        { kind: 'medicineProducts' as const, items: [medicineProductCurrent] },
        {
          kind: 'medicineCatalogRevisions' as const,
          items: [medicineIngredientCurrent, medicineProductFirst, medicineProductCurrent].map(
            (snapshot) => ({
              id: `revision-${snapshot.id}-${snapshot.revision}`,
              patientId: snapshot.patientId,
              entityKind: 'canonicalName' in snapshot ? 'ingredient' : 'product',
              entityId: snapshot.id,
              revision: snapshot.revision,
              snapshot,
              changedAt: snapshot.updatedAt,
              changeOriginKind: 'manual',
              changeOriginProvider: null,
            }),
          ),
        },
      ]) {
        await archiveModule.importArchiveBatch({
          patientId,
          sourcePatientId: 'source-patient',
          ...batch,
        });
      }

      const { GET } = await import('../../routes/api/medicine-catalog/+server');
      const response = await GET({
        url: new URL(`https://health.example/api/medicine-catalog?patientId=${patientId}`),
        locals: { user: { sub: 'owner-1' } },
      } as Parameters<typeof GET>[0]);
      expect(response.status).toBe(200);
      const exported = await response.json() as {
        medicineIngredients: unknown[];
        medicineProducts: unknown[];
        medicineCatalogRevisions: unknown[];
      };
      const loader = await import('./medicine-catalog-load');
      const catalog = await loader.loadMedicineCatalog(patientId, { sourceData: true });
      const revisions = await loader.loadMedicineCatalogRevisions(patientId);
      const expected = {
        medicineIngredients: structuredClone(catalog.ingredients),
        medicineProducts: structuredClone(catalog.products),
        medicineCatalogRevisions: structuredClone(revisions),
      };
      const products = [
        ...expected.medicineProducts,
        ...expected.medicineCatalogRevisions.flatMap(({ snapshot }) =>
          'ingredients' in snapshot ? [snapshot] : [],
        ),
      ];
      expect(products).toHaveLength(3);
      for (const product of products) {
        expect(product.ingredients).toHaveLength(1);
        for (const component of product.ingredients) {
          expect(component.ingredient.sourceData).toEqual({ retained: true });
          Reflect.deleteProperty(component.ingredient, 'sourceData');
        }
      }
      expect(exported).toEqual(expected);
      expect(exported.medicineIngredients[0]).toMatchObject({ sourceData: { retained: true } });
      expect(exported.medicineCatalogRevisions).toHaveLength(3);

      const versions = await GET({
        url: new URL(
          `https://health.example/api/medicine-catalog?patientId=${patientId}&entityKind=product&entityId=${catalog.products[0].id}`,
        ),
        locals: { user: { sub: 'owner-1' } },
      } as Parameters<typeof GET>[0]);
      expect(await versions.json()).toEqual({
        medicineCatalogRevisions: revisions.filter((revision) => revision.entityKind === 'product'),
      });

      for (const kind of ['medicineIngredients', 'medicineProducts', 'medicineCatalogRevisions'] as const) {
        await archiveModule.importArchiveBatch({
          patientId: restoredPatientId,
          sourcePatientId: patientId,
          kind,
          items: exported[kind],
        });
      }
      const restored = await loader.loadMedicineCatalog(restoredPatientId, { sourceData: true });
      expect(restored.ingredients[0].sourceData).toEqual({ retained: true });
      expect(restored.products[0].sourceData).toEqual({ label: 'retained' });
      expect(restored.products[0].ingredients[0].ingredientId).toBe(restored.ingredients[0].id);
      expect(await loader.loadMedicineCatalogRevisionCounts(restoredPatientId)).toEqual({
        [`ingredient:${restored.ingredients[0].id}`]: 1,
        [`product:${restored.products[0].id}`]: 2,
      });
    } finally {
      for (const id of [patientId, restoredPatientId]) {
        await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: [id] });
      }
    }
  });

  it('remaps parents, preserves revisions, and stays idempotent', async () => {
    const importFile = new File(['hevy-source'], 'hevy.csv', { type: 'text/csv' });
    const importFileSha256 = await sha256Hex(new Uint8Array(await importFile.arrayBuffer()));
    const batches = [
      {
        kind: 'profile' as const,
        items: [
          {
            id: 'source-patient',
            name: 'Archive profile',
            agab: 'female',
            birthday: '1990-04-12',
            extraData: { preferredUnits: 'metric' },
          },
        ],
      },
      {
        kind: 'reports' as const,
        items: [
          {
            id: 'source-report',
            patientId: 'source-patient',
            kind: 'lab',
            testDate: '2026-08-01T00:00:00.000Z',
            reportTime: null,
            rawData: null,
            organizedData: { title: 'Example report' },
            parsedJsonData: null,
            extraData: { facilityName: 'Example clinic' },
          },
        ],
      },
      {
        kind: 'records' as const,
        items: [
          {
            id: 'source-record',
            patientId: 'source-patient',
            reportId: 'source-report',
            metricName: 'Example marker',
            value: '12.3',
            unit: 'mg/dL',
            refRange: '10-20',
            status: 'Normal',
            extraData: { note: 'retained' },
          },
        ],
      },
      { kind: 'medicineIngredients' as const, items: [medicineIngredientCurrent] },
      { kind: 'medicineProducts' as const, items: [medicineProductCurrent] },
      { kind: 'medicines' as const, items: [medicineCurrent] },
      { kind: 'energy' as const, items: [energyCurrent] },
      {
        kind: 'dataImports' as const,
        items: [
          {
            id: 'source-data-import',
            provider: 'hevy',
            format: 'hevy-csv-v1',
            status: 'completed',
            fileName: 'hevy.csv',
            mimeType: 'text/csv',
            byteSize: importFile.size,
            contentSha256: importFileSha256,
            interpretationKey: 'timezone:Asia/Tokyo',
            timezone: 'Asia/Tokyo',
            summaryData: { schema: 'hevy-csv-import-summary/v1' },
            errorCode: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      },
      { kind: 'exerciseDefinitions' as const, items: [exerciseDefinitionCurrent] },
      { kind: 'workouts' as const, items: [workoutPlan, workoutCurrent] },
      {
        kind: 'revisions' as const,
        items: [
          {
            id: 'source-medicine-revision-1',
            patientId: 'source-patient',
            claimKind: 'medicine',
            claimId: 'source-medicine',
            revision: 1,
            snapshot: medicineFirst,
            changedAt: medicineFirst.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-medicine-revision-2',
            patientId: 'source-patient',
            claimKind: 'medicine',
            claimId: 'source-medicine',
            revision: 2,
            snapshot: medicineCurrent,
            changedAt: medicineCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-energy-revision-1',
            patientId: 'source-patient',
            claimKind: 'energy',
            claimId: 'source-energy',
            revision: 1,
            snapshot: energyCurrent,
            changedAt: energyCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-workout-revision-1',
            patientId: 'source-patient',
            claimKind: 'workout',
            claimId: 'source-workout-session',
            revision: 1,
            snapshot: workoutFirst,
            changedAt: workoutFirst.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
        ],
      },
      {
        kind: 'medicineCatalogRevisions' as const,
        items: [
          {
            id: 'source-ingredient-revision-1',
            patientId: 'source-patient',
            entityKind: 'ingredient',
            entityId: 'source-ingredient',
            revision: 1,
            snapshot: medicineIngredientCurrent,
            changedAt: medicineIngredientCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-product-revision-1',
            patientId: 'source-patient',
            entityKind: 'product',
            entityId: 'source-product',
            revision: 1,
            snapshot: medicineProductFirst,
            changedAt: medicineProductFirst.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
          {
            id: 'source-product-revision-2',
            patientId: 'source-patient',
            entityKind: 'product',
            entityId: 'source-product',
            revision: 2,
            snapshot: medicineProductCurrent,
            changedAt: medicineProductCurrent.updatedAt,
            changeOriginKind: 'manual',
            changeOriginProvider: 'local',
          },
        ],
      },
    ];

    for (const batch of batches) {
      await archiveModule.importArchiveBatch({
        patientId: 'destination-patient',
        sourcePatientId: 'source-patient',
        ...batch,
      });
    }
    for (const batch of batches) {
      await archiveModule.importArchiveBatch({
        patientId: 'destination-patient',
        sourcePatientId: 'source-patient',
        ...batch,
      });
    }

    const counts = await client.execute(`
      SELECT
        (SELECT count(*) FROM report) AS reports,
        (SELECT count(*) FROM record) AS records,
        (SELECT count(*) FROM medicine_ingredient) AS medicine_ingredients,
        (SELECT count(*) FROM medicine_product) AS medicine_products,
        (SELECT count(*) FROM medicine_catalog_revision) AS medicine_catalog_revisions,
        (SELECT count(*) FROM medicine_claim) AS medicines,
        (SELECT count(*) FROM energy_claim) AS energy,
        (SELECT count(*) FROM data_import) AS data_imports,
        (SELECT count(*) FROM exercise_definition) AS exercise_definitions,
        (SELECT count(*) FROM workout_claim) AS workouts,
        (SELECT count(*) FROM workout_exercise) AS workout_exercises,
        (SELECT count(*) FROM workout_set) AS workout_sets,
        (SELECT count(*) FROM claim_revision) AS revisions
    `);
    expect(counts.rows[0]).toMatchObject({
      reports: 1,
      records: 1,
      medicine_ingredients: 1,
      medicine_products: 1,
      medicine_catalog_revisions: 3,
      medicines: 1,
      energy: 1,
      data_imports: 1,
      exercise_definitions: 1,
      workouts: 2,
      workout_exercises: 2,
      workout_sets: 2,
      revisions: 6,
    });

    const relationship = await client.execute(`
      SELECT report.patient_id AS patient_id
      FROM record
      JOIN report ON report.id = record.report_id
    `);
    expect(relationship.rows[0]?.patient_id).toBe('destination-patient');

    const medicineRelationship = await client.execute(`
      SELECT medicine_claim.patient_id AS patient_id,
        medicine_product.display_name AS product_name,
        medicine_ingredient.canonical_name AS ingredient_name
      FROM medicine_claim
      JOIN medicine_product ON medicine_product.id = medicine_claim.product_id
      JOIN medicine_product_ingredient
        ON medicine_product_ingredient.product_id = medicine_product.id
      JOIN medicine_ingredient
        ON medicine_ingredient.id = medicine_product_ingredient.ingredient_id
    `);
    expect(medicineRelationship.rows[0]).toMatchObject({
      patient_id: 'destination-patient',
      product_name: 'Example medicine 10 mg',
      ingredient_name: 'Example ingredient',
    });

    const revisions = await client.execute(`
      SELECT claim_kind, revision,
        json_extract(snapshot, '$.patientId') AS snapshot_patient,
        json_extract(snapshot, '$.id') AS snapshot_id,
        claim_id
      FROM claim_revision
      ORDER BY claim_kind, revision
    `);
    expect(revisions.rows).toHaveLength(6);
    expect(revisions.rows.every((row) => row.snapshot_patient === 'destination-patient')).toBe(true);
    expect(revisions.rows.every((row) => row.snapshot_id === row.claim_id)).toBe(true);

    const workoutRelationship = await client.execute(`
      SELECT session.id AS session_id, plan.id AS plan_id, workout_set.repetitions AS repetitions
      FROM workout_claim AS session
      JOIN workout_claim AS plan ON plan.id = session.based_on_workout_id
      JOIN workout_exercise ON workout_exercise.workout_claim_id = session.id
      JOIN workout_set ON workout_set.workout_exercise_id = workout_exercise.id
      WHERE session.kind = 'session' AND plan.kind = 'plan'
    `);
    expect(workoutRelationship.rows[0]).toMatchObject({ repetitions: 10 });

    const sessionId = String(workoutRelationship.rows[0]?.session_id);
    const currentWorkout = await workoutModule.getWorkoutRecord('destination-patient', sessionId);
    expect(currentWorkout?.exercises[0]?.sets[0]?.repetitions).toBe(10);
    if (!currentWorkout) throw new Error('Restored workout is missing');

    const updatedWorkout = await workoutModule.updateWorkoutClaim({
      current: currentWorkout,
      expectedRevision: 2,
      source: { kind: 'manual', provider: 'local' },
      input: {
        kind: currentWorkout.kind,
        title: currentWorkout.title,
        status: currentWorkout.status,
        basedOnWorkoutId: currentWorkout.basedOnWorkoutId,
        startedAt: currentWorkout.startedAt,
        endedAt: currentWorkout.endedAt,
        localDate: currentWorkout.localDate,
        timezone: currentWorkout.timezone,
        timezoneOffsetMinutes: currentWorkout.timezoneOffsetMinutes,
        endedTimezoneOffsetMinutes: currentWorkout.endedTimezoneOffsetMinutes,
        notes: 'Corrected after review',
        exercises: currentWorkout.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseDefinitionId: exercise.exerciseDefinitionId,
          name: exercise.name,
          category: exercise.category,
          equipment: exercise.equipment,
          notes: exercise.notes,
          restSeconds: exercise.restSeconds,
          supersetGroup: exercise.supersetGroup,
          sets: exercise.sets.map((set) => ({
            id: set.id,
            setType: set.setType,
            status: set.status,
            weightValue: set.weightValue,
            weightUnit: set.weightUnit,
            repetitions: 12,
            durationSeconds: set.durationSeconds,
            distanceValue: set.distanceValue,
            distanceUnit: set.distanceUnit,
            rpe: set.rpe,
            rir: set.rir,
            notes: set.notes,
          })),
        })),
      },
    });
    expect(updatedWorkout).toMatchObject({ revision: 3, notes: 'Corrected after review' });
    expect(updatedWorkout.exercises[0]?.sets[0]?.repetitions).toBe(12);
    await expect(
      workoutModule.updateWorkoutClaim({
        current: currentWorkout,
        expectedRevision: 2,
        source: { kind: 'manual', provider: 'local' },
        input: {
          kind: currentWorkout.kind,
          title: currentWorkout.title,
          status: currentWorkout.status,
          basedOnWorkoutId: currentWorkout.basedOnWorkoutId,
          startedAt: currentWorkout.startedAt,
          endedAt: currentWorkout.endedAt,
          localDate: currentWorkout.localDate,
          timezone: currentWorkout.timezone,
          timezoneOffsetMinutes: currentWorkout.timezoneOffsetMinutes,
          endedTimezoneOffsetMinutes: currentWorkout.endedTimezoneOffsetMinutes,
          notes: currentWorkout.notes,
          exercises: [],
        },
      }),
    ).rejects.toMatchObject({ name: 'StaleClaimRevisionError' });

    const workoutRevisionState = await client.execute({
      sql: `SELECT count(*) AS count FROM claim_revision
        WHERE claim_kind = 'workout' AND claim_id = ?`,
      args: [sessionId],
    });
    expect(workoutRevisionState.rows[0]?.count).toBe(3);

    const retainedEnergy = await client.execute(
      'SELECT id, label FROM energy_claim WHERE patient_id = \'destination-patient\'',
    );
    expect(retainedEnergy.rows[0]).toMatchObject({ id: 'existing-energy', label: 'Existing entry' });

    const restoredProfile = await client.execute({
      sql: 'SELECT name, agab, birthday, extra_data FROM patient WHERE id = ?',
      args: ['destination-patient'],
    });
    expect(restoredProfile.rows[0]).toMatchObject({
      name: 'Archive profile',
      agab: 'female',
      birthday: '1990-04-12',
    });
    expect(JSON.parse(String(restoredProfile.rows[0]?.extra_data))).toEqual({
      preferredUnits: 'metric',
    });

    const storedKeys = new Set<string>();
    const put = vi.fn(async (key: string) => {
      storedKeys.add(key);
      return { httpEtag: `etag-${key}` };
    });
    const head = vi.fn(async (key: string) => (storedKeys.has(key) ? { key } : null));
    const bucket = { put, head } as unknown as R2Bucket;
    await archiveMediaModule.restoreArchiveMedia({
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/reports/source-report-scan.pdf',
        sourceKind: 'report-source',
        sourceId: 'source-report',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      },
      file: new File(['report'], 'scan.pdf', { type: 'application/pdf' }),
      bucket,
    });
    await archiveMediaModule.restoreArchiveMedia({
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/reports/source-report-scan.pdf',
        sourceKind: 'report-source',
        sourceId: 'source-report',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      },
      file: new File(['report'], 'scan.pdf', { type: 'application/pdf' }),
      bucket,
    });
    const energyMedia = {
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/calories/source-photo-meal.jpg',
        sourceKind: 'energy-photo' as const,
        sourceId: 'source-photo',
        energyClaimId: 'source-energy',
        originProvider: 'connector-a',
        originExternalId: 'entry-42',
        fileName: 'meal.jpg',
        mimeType: 'image/jpeg',
      },
      file: new File(['photo'], 'meal.jpg', { type: 'image/jpeg' }),
      bucket,
    };
    await archiveMediaModule.restoreArchiveMedia(energyMedia);
    await archiveMediaModule.restoreArchiveMedia(energyMedia);
    const importMedia = {
      patientId: 'destination-patient',
      sourcePatientId: 'source-patient',
      metadata: {
        archivePath: 'media/imports/source-data-import-hevy.csv',
        sourceKind: 'import-file' as const,
        sourceId: 'source-data-import',
        dataImportProvider: 'hevy',
        dataImportFormat: 'hevy-csv-v1',
        dataImportContentSha256: importFileSha256,
        dataImportInterpretationKey: 'timezone:Asia/Tokyo',
        fileName: 'hevy.csv',
        mimeType: 'text/csv',
      },
      file: importFile,
      bucket,
    };
    await expect(
      archiveMediaModule.restoreArchiveMedia({
        ...importMedia,
        file: new File(['evil-source'], 'hevy.csv', { type: 'text/csv' }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_file' });
    await archiveMediaModule.restoreArchiveMedia(importMedia);
    await archiveMediaModule.restoreArchiveMedia(importMedia);

    const mediaState = await client.execute(`
      SELECT
        (SELECT count(*) FROM energy_source) AS energy_sources,
        (SELECT object_etag FROM data_import LIMIT 1) AS import_etag,
        (SELECT raw_data FROM report LIMIT 1) AS report_source
    `);
    expect(mediaState.rows[0]?.energy_sources).toBe(1);
    expect(JSON.parse(String(mediaState.rows[0]?.report_source))).toMatchObject({
      kind: 'r2-file',
      mimeType: 'application/pdf',
      fileName: 'scan.pdf',
    });
    expect(mediaState.rows[0]?.import_etag).toBeTruthy();
    expect(put).toHaveBeenCalledTimes(3);
    expect(
      put.mock.calls.every(([key]) => String(key).includes('destination-patient')),
    ).toBe(true);

    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute({ sql: 'DELETE FROM patient WHERE id = ?', args: ['destination-patient'] });
    const afterDelete = await client.execute('SELECT count(*) AS count FROM claim_revision');
    expect(afterDelete.rows[0]?.count).toBe(0);
  });
});

describe('archive report validation', () => {
  const date = '2026-10-01T12:00:00.000Z';
  const summary = {
    date: '2026-10-01', timeZone: 'Asia/Tokyo', aggregation: 'sum', source: 'Apple Watch',
    sampleCount: 1, coverageSeconds: 3600, excludedSamples: 0, estimated: false,
  };
  const activityRecord = {
    id: 'steps', reportId: 'daily', metricName: 'Daily Steps', value: '100', unit: 'count',
    extraData: { dailySummary: summary },
  };
  async function profile() {
    const patientId = crypto.randomUUID();
    await client.execute({ sql: 'INSERT INTO patient (id, name) VALUES (?, ?)', args: [patientId, 'Validation test'] });
    return patientId;
  }
  function restore(patientId: string, kind: 'reports' | 'records', items: unknown[], sourcePatientId = 'validation-source') {
    return archiveModule.importArchiveBatch({ patientId, sourcePatientId, kind, items });
  }
  async function count(patientId: string, table: 'report' | 'record') {
    return (await client.execute({ sql: `SELECT count(*) AS count FROM ${table} WHERE patient_id = ?`, args: [patientId] })).rows[0].count;
  }

  it.each(['unknown', 'Activity', '', null, undefined])('rejects unsupported report kind %s before writing the batch', async (kind) => {
    const patientId = await profile();
    await expect(restore(patientId, 'reports', [
      { id: 'valid', kind: 'lab', testDate: date }, { id: 'invalid', kind, testDate: date },
    ])).rejects.toMatchObject({ code: 'invalid_report' });
    expect(await count(patientId, 'report')).toBe(0);
  });

  it.each(['Glucose', 'Body Weight', 'Heart Rate', 'Custom marker'])('rejects %s under an activity report without writing sibling records', async (metricName) => {
    const patientId = await profile();
    await restore(patientId, 'reports', [{ id: 'daily', kind: 'activity', testDate: date }]);
    await expect(restore(patientId, 'records', [activityRecord, {
      ...activityRecord, id: 'wrong-kind', metricName,
      extraData: { metricKey: 'daily-steps', dailySummary: summary },
    }])).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await count(patientId, 'record')).toBe(0);
  });

  it.each([
    ['missing summary', { extraData: null }],
    ['invalid summary', { extraData: { dailySummary: { ...summary, aggregation: 'mean' } } }],
    ['wrong day', { extraData: { dailySummary: { ...summary, date: '2026-10-02' } } }],
    ['wrong unit', { unit: 'kg' }],
    ['non-numeric value', { value: 'unknown' }],
    ['blank value', { value: ' \t' }],
    ['hexadecimal value', { value: '0x10' }],
    ['binary value', { value: '0b10' }],
    ['non-finite value', { value: 'Infinity' }],
    ['negative value', { value: '-1' }],
    ['percentage over 100', { metricName: 'Walking Asymmetry', unit: '%', value: '101', extraData: { dailySummary: { ...summary, aggregation: 'mean' } } }],
  ])('rejects an activity record with %s', async (_name, change) => {
    const patientId = await profile();
    await restore(patientId, 'reports', [{ id: 'daily', kind: 'activity', testDate: date }]);
    await expect(restore(patientId, 'records', [{ ...activityRecord, ...change }])).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await count(patientId, 'record')).toBe(0);
  });

  it('normalizes accepted decimal values for the activity reader', async () => {
    const patientId = await profile();
    await restore(patientId, 'reports', [{ id: 'daily', kind: 'activity', testDate: date }]);
    await restore(patientId, 'records', [{ ...activityRecord, value: '1,000.00' }]);
    const { db } = await import('./db');
    const schema = await import('./db/schema');
    const { eq } = await import('drizzle-orm');
    const { activityPoints } = await import('$lib/activity');
    const reports = await db.select().from(schema.report).where(eq(schema.report.patientId, patientId));
    const records = await db.select().from(schema.record).where(eq(schema.record.patientId, patientId));
    expect(records[0].value).toBe('1000');
    expect(activityPoints(reports, records)).toMatchObject([{ key: 'daily-steps', value: 1000 }]);
  });

  it.each(['lab', 'body', 'vital'])('preserves custom metric names in %s reports', async (kind) => {
    const patientId = await profile();
    await restore(patientId, 'reports', [{ id: 'custom-report', kind, testDate: date }]);
    await restore(patientId, 'records', [{ id: 'custom-record', reportId: 'custom-report', metricName: 'Custom measurement', value: '12.3', unit: 'custom unit' }]);
    expect(await count(patientId, 'record')).toBe(1);
  });

  it('validates against the stored parent when a repeated report ID has a different incoming kind', async () => {
    const patientId = await profile();
    await restore(patientId, 'reports', [{ id: 'daily', kind: 'activity', testDate: date }]);
    await restore(patientId, 'reports', [{ id: 'daily', kind: 'lab', testDate: date }]);
    await expect(restore(patientId, 'records', [{ ...activityRecord, metricName: 'Glucose' }])).rejects.toMatchObject({ code: 'invalid_record' });
    expect(await count(patientId, 'record')).toBe(0);
    expect((await client.execute({ sql: 'SELECT kind FROM report WHERE patient_id = ?', args: [patientId] })).rows).toEqual([{ kind: 'activity' }]);
  });

  it('round-trips all eight imported activity metrics with their summaries and stays idempotent', async () => {
    const { parseAppleHealthExport } = await import('$lib/import/apple-health');
    const { importMeasurementSessions } = await import('./measurement-import');
    const { activityPoints } = await import('$lib/activity');
    const sourcePatientId = await profile();
    const patientId = await profile();
    const samples = [
      ['StepCount', 100, 'count'], ['DistanceWalkingRunning', 1, 'km'],
      ['ActiveEnergyBurned', 100, 'kcal'], ['BasalEnergyBurned', 200, 'kcal'],
      ['WalkingSpeed', 3.6, 'km/hr'], ['WalkingStepLength', 60, 'cm'],
      ['WalkingDoubleSupportPercentage', 0.25, '%'], ['WalkingAsymmetryPercentage', 0.02, '%'],
    ];
    const xml = `<HealthData>${samples.map(([type, value, unit]) => `<Record type="HKQuantityTypeIdentifier${type}" sourceName="Apple Watch" unit="${unit}" value="${value}" startDate="2026-10-01T08:00:00Z" endDate="2026-10-01T09:00:00Z"/>`).join('')}</HealthData>`;
    await importMeasurementSessions({ patientId: sourcePatientId, source: 'apple-health', sessions: parseAppleHealthExport(xml, 'Asia/Tokyo').sessions });
    // Read through Drizzle, matching the report/record objects used by archive export.
    const { db } = await import('./db');
    const schema = await import('./db/schema');
    const { eq } = await import('drizzle-orm');
    const reports = await db.select().from(schema.report).where(eq(schema.report.patientId, sourcePatientId));
    const records = await db.select().from(schema.record).where(eq(schema.record.patientId, sourcePatientId));
    await restore(patientId, 'reports', reports, sourcePatientId);
    await restore(patientId, 'records', records, sourcePatientId);
    await restore(patientId, 'reports', reports, sourcePatientId);
    await restore(patientId, 'records', records, sourcePatientId);
    expect(await count(patientId, 'report')).toBe(1);
    expect(await count(patientId, 'record')).toBe(8);
    const restoredReports = await db.select().from(schema.report).where(eq(schema.report.patientId, patientId));
    const restoredRecords = await db.select().from(schema.record).where(eq(schema.record.patientId, patientId));
    expect(activityPoints(restoredReports, restoredRecords)).toEqual(activityPoints(reports, records));
    expect(activityPoints(restoredReports, restoredRecords)).toHaveLength(8);
  });
});
