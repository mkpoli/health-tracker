import { describe, expect, it } from 'vitest';
import { formatRefRangeForUnit, getRefRangesForMetric, hasRefRangesForMetric } from './ref-ranges';

// The catalog ranks every published interval by how well it fits the person and
// discards none, so the caller decides what a partial fit means. What must hold
// here is that the intervals keep their attribution and their units.

describe('getRefRangesForMetric', () => {
  it('ranks the interval matching a stated sex first', () => {
    const female = getRefRangesForMetric('testosterone', { agab: 'Female', birthday: '1990-01-01' });

    expect(female[0].label).toBe('Adult female');
  });

  it('ranks the other way for the other stated sex', () => {
    const male = getRefRangesForMetric('testosterone', { agab: 'Male', birthday: '1990-01-01' });

    expect(male[0].label).toBe('Adult male');
  });

  it('returns every interval regardless of fit, so the caller filters', () => {
    const known = getRefRangesForMetric('testosterone', { agab: 'Female', birthday: '1990-01-01' });
    const unknown = getRefRangesForMetric('testosterone');

    expect(unknown).toHaveLength(known.length);
  });

  it('marks a hormone-therapy interval as such rather than mixing it in', () => {
    const therapy = getRefRangesForMetric('testosterone').filter(
      (entry) => entry.context === 'on-therapy',
    );

    expect(therapy.length).toBeGreaterThan(0);
    for (const entry of therapy) {
      expect(entry.source).toBeTruthy();
    }
  });

  it('gives every interval a unit, so nothing is compared unit-blind', () => {
    for (const entry of getRefRangesForMetric('testosterone')) {
      expect(entry.unit).toBeTruthy();
    }
  });

  it('answers nothing for a metric it does not cover', () => {
    expect(getRefRangesForMetric('something-uncatalogued')).toEqual([]);
    expect(hasRefRangesForMetric('something-uncatalogued')).toBe(false);
    expect(hasRefRangesForMetric('testosterone')).toBe(true);
  });
});

describe('formatRefRangeForUnit', () => {
  const entry = { label: 'Adult male', range: '264-916', unit: 'ng/dL' };

  it('converts a range into the unit the reading uses', () => {
    const converted = formatRefRangeForUnit(entry, 'ng/mL');

    expect(converted).toMatchObject({ range: '2.64-9.16', unit: 'ng/mL', converted: true });
  });

  it('leaves a range alone when the units already agree', () => {
    expect(formatRefRangeForUnit(entry, 'ng/dL')).toMatchObject({ range: '264-916', converted: false });
  });

  it('leaves a range alone when no target unit is given', () => {
    expect(formatRefRangeForUnit(entry, null)).toMatchObject({ range: '264-916', converted: false });
  });

  it('keeps the original rather than inventing a conversion it cannot make', () => {
    const attempted = formatRefRangeForUnit(entry, 'nmol/L');

    expect(attempted).toMatchObject({ range: '264-916', unit: 'ng/dL', converted: false });
  });

  it('converts a one-sided range too', () => {
    const converted = formatRefRangeForUnit(
      { label: 'Transfeminine HRT target', range: '<50', unit: 'ng/dL' },
      'ng/mL',
    );

    expect(converted.range).toBe('<0.5');
  });
});
