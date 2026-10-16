import { describe, expect, it } from 'vitest';
import { fitMedicineField, medicineFieldLimits } from './medicine';

describe('fitMedicineField', () => {
  it('leaves text inside the limit unchanged', () => {
    expect(fitMedicineField('10 mg', medicineFieldLimits.strength)).toBe('10 mg');
  });

  it('cuts to the limit and trims trailing space', () => {
    const text = `${'a'.repeat(119)} b`;
    expect(fitMedicineField(text, medicineFieldLimits.form)).toBe('a'.repeat(119));
  });

  it('never leaves half of a surrogate pair', () => {
    const text = `${'a'.repeat(119)}😀`;
    const fitted = fitMedicineField(text, medicineFieldLimits.route);
    expect(fitted).toBe('a'.repeat(119));
    expect(fitted.length).toBeLessThanOrEqual(medicineFieldLimits.route);
  });
});
