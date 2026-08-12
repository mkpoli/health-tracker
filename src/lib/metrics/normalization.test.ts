import { describe, expect, it } from 'vitest';
import {
  canonicalUnitForm,
  convertValueBetweenUnits,
  normalizeComparableMeasurement,
  parseNumber,
} from './normalization';

// A value and its unit only mean something together. Every chart, delta and
// reference-range comparison downstream reads the comparable form produced
// here, so a wrong multiplier is a wrong number everywhere at once.

describe('parseNumber', () => {
  it('reads plain and decimal values', () => {
    expect(parseNumber('114')).toBe(114);
    expect(parseNumber('75.2')).toBe(75.2);
    expect(parseNumber(66)).toBe(66);
  });

  it('reads a grouped value', () => {
    expect(parseNumber('1,234')).toBe(1234);
  });

  it('reads a signed value', () => {
    expect(parseNumber('-2.5')).toBe(-2.5);
    expect(parseNumber('+3')).toBe(3);
  });

  it('refuses a qualitative result rather than inventing a number', () => {
    expect(parseNumber('Negative')).toBeNull();
    expect(parseNumber('(+)')).toBeNull();
    expect(parseNumber('<0.01')).toBeNull();
  });

  it('refuses empty and non-finite input', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(Number.NaN)).toBeNull();
    expect(parseNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('counting notation with a multiplier', () => {
  it('scales a Japanese hundred-count to a plain count', () => {
    const result = normalizeComparableMeasurement('66', '×百/μL', '39-97');

    expect(result.multiplier).toBe(100);
    expect(result.comparableValue).toBe(6600);
    expect(result.comparableUnit).toBe('/uL');
  });

  it('scales the reference range by the same factor', () => {
    const result = normalizeComparableMeasurement('66', '×百/μL', '39-97');

    expect(result.comparableReferenceRange).toBe('3900-9700');
  });

  it('reads exponent notation', () => {
    expect(normalizeComparableMeasurement('4.5', '×10^3/μL', null).comparableValue).toBe(4500);
    expect(normalizeComparableMeasurement('4.5', 'x10^4/uL', null).multiplier).toBe(10000);
  });

  it('reads an exponent past the handful a ladder would enumerate', () => {
    expect(normalizeComparableMeasurement('4.7', '×10^6/μL', null).comparableValue).toBe(4_700_000);
    expect(normalizeComparableMeasurement('4.7', '10^6/uL', null).multiplier).toBe(1_000_000);
  });

  it('reads the SI forms a haematology report prints', () => {
    expect(normalizeComparableMeasurement('4.7', '×10^12/L', null).comparableValue).toBeCloseTo(4.7e12, 0);
    expect(normalizeComparableMeasurement('7.2', '×10^9/L', null).comparableValue).toBeCloseTo(7.2e9, 0);
  });

  it('reads 千 and 万', () => {
    expect(normalizeComparableMeasurement('5', '×千/μL', null).comparableValue).toBe(5000);
    expect(normalizeComparableMeasurement('5', '×万/μL', null).comparableValue).toBe(50000);
  });

  it('puts a count and its Japanese equivalent on the same scale', () => {
    const exponent = normalizeComparableMeasurement('4.7', '×10^6/μL', null);
    const counted = normalizeComparableMeasurement('470', '×万/μL', null);

    expect(exponent.comparableUnit).toBe(counted.comparableUnit);
    expect(exponent.comparableValue).toBe(counted.comparableValue);
  });
});

describe('cross-family conversions', () => {
  it('converts pounds to kilograms', () => {
    const result = normalizeComparableMeasurement('150', 'lbs', null);

    expect(result.comparableUnit).toBe('kg');
    expect(result.comparableValue).toBeCloseTo(68.039, 3);
  });

  it('converts inches to centimetres', () => {
    const result = normalizeComparableMeasurement('70', 'in', null);

    expect(result.comparableUnit).toBe('cm');
    expect(result.comparableValue).toBeCloseTo(177.8, 6);
  });

  it('converts ng/mL to ng/dL', () => {
    const result = normalizeComparableMeasurement('0.72', 'ng/mL', null);

    expect(result.comparableUnit).toBe('ng/dL');
    expect(result.comparableValue).toBeCloseTo(72, 6);
  });
});

describe('unit casing', () => {
  it('collapses a lowercase litre so two labs land in one series', () => {
    expect(normalizeComparableMeasurement('88', 'mg/dl', null).comparableUnit).toBe('mg/dL');
    expect(normalizeComparableMeasurement('88', 'mg/dL', null).comparableUnit).toBe('mg/dL');
  });

  it('leaves a value alone when the unit needs no scaling', () => {
    const result = normalizeComparableMeasurement('88', 'mg/dL', '73-109');

    expect(result.multiplier).toBe(1);
    expect(result.comparableValue).toBe(88);
    expect(result.comparableReferenceRange).toBe('73-109');
  });

  it('canonicalises a unit for display the same way', () => {
    expect(canonicalUnitForm('mg/dl')).toBe('mg/dL');
    expect(canonicalUnitForm('  ')).toBeNull();
    expect(canonicalUnitForm(null)).toBeNull();
  });

  it('passes a qualitative value through as no number', () => {
    const result = normalizeComparableMeasurement('Negative', '', null);

    expect(result.comparableValue).toBeNull();
  });
});

describe('convertValueBetweenUnits', () => {
  it('converts within a family', () => {
    expect(convertValueBetweenUnits(1, 'ng/mL', 'ng/dL')).toBe(100);
    expect(convertValueBetweenUnits(100, 'ng/dL', 'ng/mL')).toBe(1);
  });

  it('returns the value unchanged for the same unit', () => {
    expect(convertValueBetweenUnits(5, 'mg/dL', 'mg/dL')).toBe(5);
  });

  it('refuses a conversion it cannot make rather than guessing', () => {
    expect(convertValueBetweenUnits(92, 'pg/mL', 'pmol/L')).toBeNull();
    expect(convertValueBetweenUnits(5, 'mg/dL', 'cm')).toBeNull();
  });
});
