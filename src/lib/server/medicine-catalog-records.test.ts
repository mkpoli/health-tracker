import { describe, expect, it } from 'vitest';
import { buildMedicineProductRecords } from './medicine-catalog-records';

describe('buildMedicineProductRecords', () => {
  it('throws when a component references a missing ingredient', () => {
    expect(() =>
      buildMedicineProductRecords(
        [],
        [],
        [],
        [
          {
            id: 'component-1',
            patientId: 'patient-1',
            productId: 'product-1',
            ingredientId: 'missing-ingredient',
            orderIndex: 0,
            role: 'active',
            numeratorValue: null,
            numeratorUnit: null,
            denominatorValue: null,
            denominatorUnit: null,
            strengthText: null,
            basisOfStrengthText: null,
            sourceKind: 'manual',
            sourceProvider: null,
            sourceUrl: null,
            sourceRetrievedAt: null,
          },
        ],
        [],
      ),
    ).toThrowError('Missing ingredient missing-ingredient for medicine product component component-1');
  });
});
