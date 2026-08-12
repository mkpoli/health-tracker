import { describe, expect, it } from 'vitest';
import {
  ageInYearsAt,
  formatRefRangeForUnit,
  getRefRangesForMetric,
  hasRefRangesForMetric,
} from './ref-ranges';

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

  it('gives a measured metric intervals in a stated unit', () => {
    for (const entry of getRefRangesForMetric('testosterone')) {
      expect(entry.unit).toBeTruthy();
    }
  });

  it('leaves a dimensionless index without one', () => {
    // A waist-to-hip ratio is a ratio, so an interval for it carries no unit
    // and nothing downstream should look for one.
    for (const entry of getRefRangesForMetric('waist-to-hip-ratio')) {
      expect(entry.unit ?? null).toBeNull();
    }
  });

  it('answers nothing for a metric it does not cover', () => {
    expect(getRefRangesForMetric('something-uncatalogued')).toEqual([]);
    expect(hasRefRangesForMetric('something-uncatalogued')).toBe(false);
    expect(hasRefRangesForMetric('testosterone')).toBe(true);
  });
});

describe('ageInYearsAt', () => {
  const at = (date: string) => Date.parse(date);

  it('counts whole years', () => {
    expect(ageInYearsAt('1990-06-15', at('2026-06-15T00:00:00.000Z'))).toBe(36);
  });

  it('does not count the year until the birthday arrives', () => {
    expect(ageInYearsAt('1990-06-15', at('2026-06-14T23:59:59.000Z'))).toBe(35);
  });

  it('measures the age the person was at the instant asked about', () => {
    expect(ageInYearsAt('1990-06-15', at('2020-06-15T00:00:00.000Z'))).toBe(30);
  });

  it('answers nothing for a missing or unreadable birthday', () => {
    expect(ageInYearsAt(null, at('2026-06-15T00:00:00.000Z'))).toBeNull();
    expect(ageInYearsAt('not a date', at('2026-06-15T00:00:00.000Z'))).toBeNull();
  });

  it('answers nothing rather than a negative age', () => {
    expect(ageInYearsAt('2030-01-01', at('2026-06-15T00:00:00.000Z'))).toBeNull();
  });
});

describe('an interval banded by age', () => {
  const at = (date: string) => Date.parse(date);

  it('does not apply the adult interval the day before adulthood', () => {
    const almost = getRefRangesForMetric('testosterone', {
      agab: 'Male',
      birthday: '2008-06-15',
      now: at('2026-06-14T00:00:00.000Z'),
    });

    expect(almost.find((entry) => entry.label === 'Adult male')?.ageMin).toBe(18);
    expect(ageInYearsAt('2008-06-15', at('2026-06-14T00:00:00.000Z'))).toBe(17);
  });

  it('picks the band the person falls in', () => {
    const banded = getRefRangesForMetric('dhea-s', {
      agab: 'Female',
      birthday: '1990-06-15',
      now: at('2026-06-15T00:00:00.000Z'),
    });

    const top = banded[0];

    expect(top.ageMin === undefined || top.ageMin <= 36).toBe(true);
    expect(top.ageMax === undefined || top.ageMax >= 36).toBe(true);
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
