import { describe, expect, it } from 'vitest';
import {
  localizedMedicineCatalogName,
  normalizedMedicineCatalogName,
  type MedicineCatalogNameRecord,
} from '$lib/medicine-catalog';
import {
  InvalidMedicineCatalogInputError,
  parseMedicineIngredientInput,
  parseMedicineProductInput,
} from './medicine-catalog';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('medicine catalog input', () => {
  it('normalizes an ingredient with localized names and terminology identifiers', () => {
    const input = parseMedicineIngredientInput(
      form({
        canonicalName: '  Semaglutide  ',
        status: 'active',
        notes: 'Peptide medicine',
        structure: JSON.stringify({
          names: [
            {
              name: 'セマグルチド',
              languageTag: 'ja-JP',
              nameType: 'generic',
              jurisdiction: 'jp',
              preferred: true,
              sourceKind: 'regulator',
              sourceProvider: 'PMDA',
              sourceUrl: 'https://www.pmda.go.jp/',
              sourceRetrievedAt: '2026-08-15T12:00:00+09:00',
            },
          ],
          identifiers: [
            {
              system: 'RxNorm',
              code: '1991302',
              sourceKind: 'terminology',
            },
          ],
        }),
      }),
    );

    expect(input).toMatchObject({
      canonicalName: 'Semaglutide',
      status: 'active',
      names: [
        {
          name: 'セマグルチド',
          languageTag: 'ja-JP',
          nameType: 'generic',
          jurisdiction: 'JP',
          preferred: true,
          sourceProvider: 'PMDA',
          sourceRetrievedAt: '2026-08-15T03:00:00.000Z',
        },
      ],
      identifiers: [{ system: 'RxNorm', code: '1991302' }],
    });
  });

  it('parses a structured product composition', () => {
    const input = parseMedicineProductInput(
      form({
        displayName: 'Wegovy 0.25 mg',
        productType: 'branded',
        status: 'active',
        doseFormText: 'injection',
        routeText: 'subcutaneous',
        strengthText: '0.25 mg per dose',
        marketCountry: 'jp',
        structure: JSON.stringify({
          names: [],
          identifiers: [{ system: 'YJ', code: '2499418G1020', jurisdiction: 'JP' }],
          ingredients: [
            {
              ingredientId: 'ingredient-1',
              role: 'active',
              numeratorValue: '0.25',
              numeratorUnit: 'mg',
              denominatorValue: '1',
              denominatorUnit: 'dose',
              sourceKind: 'label',
            },
          ],
        }),
      }),
    );

    expect(input).toMatchObject({
      displayName: 'Wegovy 0.25 mg',
      productType: 'branded',
      marketCountry: 'JP',
      names: [{ name: 'Wegovy 0.25 mg', preferred: true, languageTag: 'und' }],
      ingredients: [
        {
          ingredientId: 'ingredient-1',
          numeratorValue: '0.25',
          numeratorUnit: 'mg',
          denominatorValue: '1',
          denominatorUnit: 'dose',
        },
      ],
    });
  });

  it('rejects incomplete strengths and unsafe source URLs', () => {
    expect(() =>
      parseMedicineProductInput(
        form({
          displayName: 'Example',
          structure: JSON.stringify({
            names: [],
            identifiers: [],
            ingredients: [
              { ingredientId: 'ingredient-1', numeratorValue: '5', numeratorUnit: null },
            ],
          }),
        }),
      ),
    ).toThrowError(new InvalidMedicineCatalogInputError('invalid_strength'));

    expect(() =>
      parseMedicineIngredientInput(
        form({
          canonicalName: 'Example',
          structure: JSON.stringify({
            names: [
              {
                name: 'Example',
                languageTag: 'en',
                nameType: 'preferred',
                sourceUrl: 'javascript:alert(1)',
              },
            ],
            identifiers: [],
          }),
        }),
      ),
    ).toThrowError(new InvalidMedicineCatalogInputError('invalid_source'));
  });
});

describe('medicine catalog names', () => {
  const base = {
    ingredientId: 'ingredient-1',
    productId: null,
    orderIndex: 0,
    normalizedName: '',
    nameType: 'preferred' as const,
    jurisdiction: null,
    preferred: true,
    sourceKind: 'manual',
    sourceProvider: null,
    sourceUrl: null,
    sourceRetrievedAt: null,
  };
  const names: MedicineCatalogNameRecord[] = [
    { ...base, id: 'name-en', name: 'Estradiol', languageTag: 'en' },
    { ...base, id: 'name-ja', name: 'エストラジオール', languageTag: 'ja-JP' },
  ];

  it('selects a localized label and normalizes searchable text', () => {
    expect(localizedMedicineCatalogName(names, 'ja-JP', 'Fallback')).toBe('エストラジオール');
    expect(localizedMedicineCatalogName(names, 'ja', 'Fallback')).toBe('エストラジオール');
    expect(localizedMedicineCatalogName(names, 'zh-Hans', 'Fallback')).toBe('Estradiol');
    expect(normalizedMedicineCatalogName('  Ｗｅｇｏｖｙ   0.25 MG ')).toBe('wegovy 0.25 mg');
  });
});

describe('product composition uniqueness', () => {
  it('rejects the same ingredient with different row IDs and roles', () => {
    expect(() => parseMedicineProductInput(form({
      displayName: 'Product',
      structure: JSON.stringify({
        names: [],
        identifiers: [],
        ingredients: [
          { id: 'row-1', ingredientId: 'ingredient-1', role: 'active' },
          { id: 'row-2', ingredientId: ' ingredient-1 ', role: 'inactive' },
        ],
      }),
    }))).toThrowError(new InvalidMedicineCatalogInputError('invalid_ingredient'));
  });
});

describe('country validation', () => {
  it.each(['USA', 'J', '123', 'United States'])(
    'reports invalid_country for %s in every country field',
    (country) => {
      for (const structure of [
        { names: [{ name: 'Ingredient', jurisdiction: country }], identifiers: [] },
        { names: [], identifiers: [{ system: 'local', code: '1', jurisdiction: country }] },
      ]) {
        expect(() => parseMedicineIngredientInput(form({
          canonicalName: 'Ingredient', structure: JSON.stringify(structure),
        }))).toThrowError(new InvalidMedicineCatalogInputError('invalid_country'));
        expect(() => parseMedicineProductInput(form({
          displayName: 'Product', structure: JSON.stringify({ ...structure, ingredients: [] }),
        }))).toThrowError(new InvalidMedicineCatalogInputError('invalid_country'));
      }
      expect(() => parseMedicineProductInput(form({
        displayName: 'Product', marketCountry: country,
        structure: JSON.stringify({ names: [], identifiers: [], ingredients: [] }),
      }))).toThrowError(new InvalidMedicineCatalogInputError('invalid_country'));
    },
  );
});
