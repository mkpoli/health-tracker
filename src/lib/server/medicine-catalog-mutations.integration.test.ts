import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from './db/schema';
import { parseMedicineIngredientInput, parseMedicineProductInput } from './medicine-catalog';
import { parseMedicineInput } from './medicines';

let directory: string;
let client: Client;
let catalog: typeof import('./medicine-catalog-mutations');
let claims: typeof import('./claim-mutations');
let revisions: typeof import('./claim-revisions');
const origin = { kind: 'manual', provider: 'local' } as const;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function ingredientInput(canonicalName = 'Ingredient') {
  return parseMedicineIngredientInput(form({
    canonicalName,
    structure: JSON.stringify({ names: [], identifiers: [{ system: 'local', code: canonicalName }] }),
  }));
}

function productInput(ingredientId: string, displayName = 'Product') {
  return parseMedicineProductInput(form({
    displayName,
    structure: JSON.stringify({
      names: [], identifiers: [{ system: 'local', code: displayName }],
      ingredients: [{ ingredientId, numeratorValue: '10', numeratorUnit: 'mg' }],
    }),
  }));
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'health-tracker-catalog-'));
  const databaseUrl = `file:${join(directory, 'test.db')}`;
  vi.doMock('$env/dynamic/private', () => ({
    env: { DATABASE_URL: databaseUrl, DATABASE_AUTH_TOKEN: 'local-test-token' },
  }));
  client = createClient({ url: databaseUrl });
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  );
  await client.executeMultiple(statements.join('\n'));
  await client.execute('PRAGMA foreign_keys = ON');
  await drizzle(client).insert(schema.patient).values([
    { id: 'profile-1', ownerUserId: 'owner-1', name: 'Primary' },
    { id: 'profile-2', ownerUserId: 'owner-1', name: 'Other profile' },
  ]);
  catalog = await import('./medicine-catalog-mutations');
  claims = await import('./claim-mutations');
  revisions = await import('./claim-revisions');
});

afterAll(async () => {
  client?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('medicine catalog mutations', () => {
  it('creates, updates and deletes catalogue records and detaches claims with revisions', async () => {
    const ingredient = await catalog.createMedicineIngredient({
      patientId: 'profile-1', input: ingredientInput(), origin,
    });
    const updatedIngredient = await catalog.updateMedicineIngredient({
      current: ingredient, input: ingredientInput('Renamed ingredient'), expectedRevision: 1, source: origin,
    });
    expect(updatedIngredient).toMatchObject({ canonicalName: 'Renamed ingredient', revision: 2 });
    expect(updatedIngredient.names).toHaveLength(1);
    expect(updatedIngredient.identifiers[0].code).toBe('Renamed ingredient');
    const product = await catalog.createMedicineProduct({
      patientId: 'profile-1', input: productInput(ingredient.id), origin,
    });
    const updatedProduct = await catalog.updateMedicineProduct({
      current: product, input: productInput(ingredient.id, 'Renamed product'), expectedRevision: 1, source: origin,
    });
    expect(updatedProduct).toMatchObject({ displayName: 'Renamed product', revision: 2 });
    expect(updatedProduct.names).toHaveLength(1);
    expect(updatedProduct.identifiers[0].code).toBe('Renamed product');
    expect(updatedProduct.ingredients).toHaveLength(1);
    expect(updatedProduct.ingredients[0].ingredient.canonicalName).toBe('Renamed ingredient');
    const ledger = await client.execute(
      'SELECT entity_kind, revision FROM medicine_catalog_revision ORDER BY entity_kind, revision',
    );
    expect(ledger.rows.map((row) => [row.entity_kind, row.revision])).toEqual([
      ['ingredient', 1], ['ingredient', 2], ['product', 1], ['product', 2],
    ]);
    await expect(catalog.deleteMedicineIngredient({
      patientId: 'profile-1', id: ingredient.id, expectedRevision: 2,
    })).rejects.toBeInstanceOf(catalog.MedicineCatalogIngredientInUseError);
    const { claim } = await claims.createMedicineClaim({
      patientId: 'profile-1', origin,
      input: parseMedicineInput(form({ name: 'Medicine', status: 'active', productId: product.id })),
    });
    await catalog.deleteMedicineProduct({
      patientId: 'profile-1', id: product.id, expectedRevision: 2, source: origin,
    });
    const stored = await client.execute({
      sql: 'SELECT product_id, revision FROM medicine_claim WHERE id = ?', args: [claim.id],
    });
    expect(stored.rows[0]).toMatchObject({ product_id: null, revision: 2 });
    const history = await client.execute({
      sql: 'SELECT snapshot FROM claim_revision WHERE claim_id = ? ORDER BY revision', args: [claim.id],
    });
    expect(history.rows.map((row) => JSON.parse(String(row.snapshot)).productId)).toEqual([product.id, null]);
    await catalog.deleteMedicineIngredient({ patientId: 'profile-1', id: ingredient.id, expectedRevision: 2 });
    for (const table of [
      'medicine_ingredient', 'medicine_product', 'medicine_catalog_name',
      'medicine_catalog_identifier', 'medicine_product_ingredient', 'medicine_catalog_revision',
    ]) {
      expect((await client.execute(`SELECT count(*) AS count FROM ${table}`)).rows[0].count).toBe(0);
    }
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  });

  it('rejects references and deletion across profiles without changing existing records', async () => {
    const ingredient = await catalog.createMedicineIngredient({
      patientId: 'profile-2', input: ingredientInput(), origin,
    });
    const product = await catalog.createMedicineProduct({
      patientId: 'profile-2', input: productInput(ingredient.id), origin,
    });
    await expect(catalog.createMedicineProduct({
      patientId: 'profile-1', input: productInput(ingredient.id), origin,
    })).rejects.toBeInstanceOf(catalog.InvalidMedicineCatalogReferenceError);
    await expect(claims.createMedicineClaim({
      patientId: 'profile-1', origin,
      input: parseMedicineInput(form({ name: 'Medicine', status: 'active', productId: product.id })),
    })).rejects.toBeInstanceOf(claims.InvalidMedicineReferenceError);
    await expect(catalog.deleteMedicineProduct({
      patientId: 'profile-1', id: product.id, expectedRevision: 1, source: origin,
    })).rejects.toBeInstanceOf(revisions.StaleClaimRevisionError);
    await expect(catalog.deleteMedicineIngredient({
      patientId: 'profile-1', id: ingredient.id, expectedRevision: 1,
    })).rejects.toBeInstanceOf(revisions.StaleClaimRevisionError);
    expect(await catalog.getMedicineProductRecord('profile-1', product.id)).toBeNull();
    expect(await catalog.getMedicineIngredientRecord('profile-1', ingredient.id)).toBeNull();
    expect(await catalog.getMedicineProductRecord('profile-2', product.id)).toEqual(product);
    const ownIngredient = await catalog.createMedicineIngredient({
      patientId: 'profile-1', input: ingredientInput(), origin,
    });
    const ownProduct = await catalog.createMedicineProduct({
      patientId: 'profile-1', input: productInput(ownIngredient.id), origin,
    });
    await expect(catalog.updateMedicineProduct({
      current: ownProduct, input: productInput(ingredient.id), expectedRevision: 1, source: origin,
    })).rejects.toBeInstanceOf(catalog.InvalidMedicineCatalogReferenceError);
    expect(await catalog.getMedicineProductRecord('profile-1', ownProduct.id)).toEqual(ownProduct);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  });
});
