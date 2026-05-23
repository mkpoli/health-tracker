export type ComparableMeasurement = {
  comparableValue: number | null;
  comparableUnit: string | null;
  comparableReferenceRange: string | null;
  multiplier: number;
};

function parseNumber(value?: string | number | null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) return null;

  const normalized = String(value).trim().replace(/,/g, '');
  if (!/^[-+]?\d*\.?\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function normalizeUnitText(unit?: string | null) {
  return (unit || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/μ/g, 'u')
    .replace(/µ/g, 'u')
    .replace(/／/g, '/')
    .replace(/・/g, '')
    .replace(/\*\*/g, '^');
}

function getUnitScale(unit?: string | null) {
  const normalized = normalizeUnitText(unit);
  if (!normalized) {
    return { multiplier: 1, comparableUnit: unit?.trim() || null };
  }

  const directConversions: Array<{ pattern: RegExp; multiplier: number; comparableUnit: string }> = [
    { pattern: /^ng\/mL$/i, multiplier: 100, comparableUnit: 'ng/dL' },
  ];

  for (const conversion of directConversions) {
    if (conversion.pattern.test(normalized)) {
      return {
        multiplier: conversion.multiplier,
        comparableUnit: conversion.comparableUnit,
      };
    }
  }

  const baseUnit = normalized
    .replace(/[xX×*]?10\^?\d+/gi, '')
    .replace(/[xX×*]?10000/gi, '')
    .replace(/[xX×*]?1000/gi, '')
    .replace(/[xX×*]?100/gi, '')
    .replace(/[xX×*]?10/gi, '')
    .replace(/[xX×]?百/gi, '')
    .replace(/[xX×]?千/gi, '')
    .replace(/[xX×]?万/gi, '')
    .trim() || null;

  const patterns: Array<[RegExp, number]> = [
    [/[xX×*]?10\^?4/, 10000],
    [/[xX×*]?10000/, 10000],
    [/[xX×]?万/, 10000],
    [/[xX×*]?10\^?3/, 1000],
    [/[xX×*]?1000/, 1000],
    [/[xX×]?千/, 1000],
    [/[xX×*]?10\^?2/, 100],
    [/[xX×*]?100/, 100],
    [/[xX×]?百/, 100],
    [/[xX×*]?10\^?1/, 10],
    [/[xX×*]?10/, 10],
  ];

  for (const [pattern, multiplier] of patterns) {
    if (pattern.test(normalized)) {
      return { multiplier, comparableUnit: baseUnit };
    }
  }

  return { multiplier: 1, comparableUnit: unit?.trim() || null };
}

function normalizeReferenceRange(refRange: string | null | undefined, multiplier: number) {
  if (!refRange) return null;
  if (multiplier === 1) return refRange;

  return refRange.replace(/(?<![\d.])[+-]?\d*\.?\d+/g, (match) => {
    const parsed = Number(match);
    return Number.isFinite(parsed) ? formatNumber(parsed * multiplier) : match;
  });
}

export function normalizeComparableMeasurement(
  value?: string | number | null,
  unit?: string | null,
  refRange?: string | null,
): ComparableMeasurement {
  const parsedValue = parseNumber(value);
  const { multiplier, comparableUnit } = getUnitScale(unit);

  return {
    comparableValue: parsedValue === null ? null : parsedValue * multiplier,
    comparableUnit,
    comparableReferenceRange: normalizeReferenceRange(refRange, multiplier),
    multiplier,
  };
}

export function convertValueBetweenUnits(
  value: number,
  fromUnit?: string | null,
  toUnit?: string | null,
): number | null {
  if (!Number.isFinite(value)) return null;
  if (!fromUnit && !toUnit) return value;
  if ((fromUnit || '').trim() === (toUnit || '').trim()) return value;

  const fromScale = getUnitScale(fromUnit);
  const toScale = getUnitScale(toUnit);

  if (
    fromScale.comparableUnit &&
    toScale.comparableUnit &&
    fromScale.comparableUnit === toScale.comparableUnit &&
    toScale.multiplier !== 0
  ) {
    return (value * fromScale.multiplier) / toScale.multiplier;
  }

  return null;
}

export function formatConvertedValue(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
