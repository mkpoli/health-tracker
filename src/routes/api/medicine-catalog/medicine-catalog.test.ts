import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnedPatient: vi.fn(),
  requireUserId: vi.fn(() => 'account-1'),
  loadMedicineCatalog: vi.fn(),
  loadMedicineCatalogRevisions: vi.fn(),
}));

vi.mock('$lib/server/ownership', () => ({
  getOwnedPatient: mocks.getOwnedPatient,
  requireUserId: mocks.requireUserId,
}));

vi.mock('$lib/server/medicine-catalog-load', () => ({
  loadMedicineCatalog: mocks.loadMedicineCatalog,
  loadMedicineCatalogRevisions: mocks.loadMedicineCatalogRevisions,
}));

import { GET } from './+server';

function requestEvent(query = '') {
  return {
    url: new URL(`https://health.example/api/medicine-catalog?patientId=profile-1${query}`),
    locals: { user: { sub: 'account-1' } },
  } as unknown as Parameters<typeof GET>[0];
}

const ingredient = {
  id: 'ingredient-1',
  canonicalName: 'Ingredient',
  sourceData: { label: 'Ingredient source payload' },
};
const component = { ingredientId: ingredient.id, role: 'active', ingredient };
const product = {
  id: 'product-1',
  sourceData: { label: 'Product source payload' },
  ingredients: [component],
};
const revision = {
  id: 'revision-1',
  entityKind: 'product',
  entityId: product.id,
  revision: 1,
  snapshot: product,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOwnedPatient.mockResolvedValue({ id: 'profile-1' });
  mocks.loadMedicineCatalog.mockResolvedValue({ ingredients: [ingredient], products: [product] });
  mocks.loadMedicineCatalogRevisions.mockResolvedValue([revision]);
});

describe('medicine catalog archive', () => {
  it('strips nested source data when the ingredient payload is exported at top level', async () => {
    const response = await GET(requestEvent());
    const archivedProduct = {
      ...product,
      ingredients: [{ ...component, ingredient: { id: ingredient.id, canonicalName: 'Ingredient' } }],
    };

    await expect(response.json()).resolves.toEqual({
      medicineIngredients: [ingredient],
      medicineProducts: [archivedProduct],
      medicineCatalogRevisions: [{ ...revision, snapshot: archivedProduct }],
    });
    expect(mocks.loadMedicineCatalog).toHaveBeenCalledWith('profile-1', { sourceData: true });
    expect(product.ingredients[0].ingredient.sourceData).toEqual(ingredient.sourceData);
  });

  it('keeps the surviving payload in an old product revision after the ingredient is deleted', async () => {
    const currentProduct = { ...product, ingredients: [] };
    mocks.loadMedicineCatalog.mockResolvedValue({
      ingredients: [{ ...ingredient, id: 'ingredient-2' }],
      products: [currentProduct],
    });

    const response = await GET(requestEvent());

    await expect(response.json()).resolves.toEqual({
      medicineIngredients: [{ ...ingredient, id: 'ingredient-2' }],
      medicineProducts: [currentProduct],
      medicineCatalogRevisions: [revision],
    });
  });

  it.each([
    [{ label: 'Historical payload' }, { label: 'Current payload' }],
    [{ details: { version: 1 } }, { details: { version: 2 } }],
    [{ values: [1, 2] }, { values: [2, 1] }],
  ])('keeps a historical payload that differs from the current ingredient payload: %j', async (historicalSourceData, sourceData) => {
    const historicalProduct = {
      ...product,
      ingredients: [{ ...component, ingredient: { ...ingredient, sourceData: historicalSourceData } }],
    };
    const historicalRevision = { ...revision, snapshot: historicalProduct };
    const currentIngredient = { ...ingredient, sourceData };
    const currentProduct = {
      ...product,
      ingredients: [{ ...component, ingredient: currentIngredient }],
    };
    mocks.loadMedicineCatalog.mockResolvedValue({
      ingredients: [currentIngredient],
      products: [currentProduct],
    });
    mocks.loadMedicineCatalogRevisions.mockResolvedValue([historicalRevision]);

    const response = await GET(requestEvent());

    await expect(response.json()).resolves.toEqual({
      medicineIngredients: [currentIngredient],
      medicineProducts: [{
        ...product,
        ingredients: [{ ...component, ingredient: { id: ingredient.id, canonicalName: 'Ingredient' } }],
      }],
      medicineCatalogRevisions: [historicalRevision],
    });
  });

  it('strips equal nested payloads regardless of object key order', async () => {
    const sourceData = { label: 'Ingredient source payload', details: [{ code: 'A', version: 1 }] };
    const nestedIngredient = {
      ...ingredient,
      sourceData: { details: [{ version: 1, code: 'A' }], label: 'Ingredient source payload' },
    };
    const nestedProduct = { ...product, ingredients: [{ ...component, ingredient: nestedIngredient }] };
    mocks.loadMedicineCatalog.mockResolvedValue({
      ingredients: [{ ...ingredient, sourceData }],
      products: [nestedProduct],
    });
    mocks.loadMedicineCatalogRevisions.mockResolvedValue([{ ...revision, snapshot: nestedProduct }]);

    const response = await GET(requestEvent());
    const archivedProduct = {
      ...product,
      ingredients: [{ ...component, ingredient: { id: ingredient.id, canonicalName: 'Ingredient' } }],
    };

    await expect(response.json()).resolves.toEqual({
      medicineIngredients: [{ ...ingredient, sourceData }],
      medicineProducts: [archivedProduct],
      medicineCatalogRevisions: [{ ...revision, snapshot: archivedProduct }],
    });
  });

  it.each([null, undefined])('keeps nested payloads when the top-level payload is %s', async (sourceData) => {
    mocks.loadMedicineCatalog.mockResolvedValue({
      ingredients: [{ ...ingredient, sourceData }],
      products: [product],
    });

    const response = await GET(requestEvent());
    await expect(response.json()).resolves.toMatchObject({
      medicineProducts: [product],
      medicineCatalogRevisions: [revision],
    });
  });

  it.each([
    { ingredients: null },
    { ingredients: 'invalid' },
    { ingredients: {} },
    { ingredients: [{ ingredientId: ingredient.id }] },
    { ingredients: [null] },
    { ingredients: [{ ingredient: null }] },
    { ingredients: [{ ingredient: 'invalid' }] },
    { ingredients: [{ ingredient: [] }] },
  ])('passes malformed nested ingredients through unchanged: $ingredients', async ({ ingredients }) => {
    const malformedProduct = { ...product, ingredients };
    const malformedRevision = { ...revision, snapshot: malformedProduct };
    mocks.loadMedicineCatalog.mockResolvedValue({
      ingredients: [ingredient],
      products: [malformedProduct],
    });
    mocks.loadMedicineCatalogRevisions.mockResolvedValue([malformedRevision]);

    const response = await GET(requestEvent());
    await expect(response.json()).resolves.toEqual({
      medicineIngredients: [ingredient],
      medicineProducts: [malformedProduct],
      medicineCatalogRevisions: [malformedRevision],
    });
  });

  it('returns individual entity revisions with their nested source data', async () => {
    const response = await GET(requestEvent('&entityKind=product&entityId=product-1'));

    await expect(response.json()).resolves.toEqual({ medicineCatalogRevisions: [revision] });
    expect(mocks.loadMedicineCatalogRevisions).toHaveBeenCalledWith('profile-1', {
      kind: 'product',
      id: 'product-1',
    });
    expect(mocks.loadMedicineCatalog).not.toHaveBeenCalled();
  });
});
