import type { MetricDefinition } from './catalog';

// Shape shared by every hand-entered measurement catalog. Each source carries
// what the logging form needs on top of the metric definition: a default unit,
// the alternatives a device may report, and a numeric step.

export type MeasurementFieldSource = {
  key: string;
  canonicalLabel: string;
  /** Section the logging form files this under. */
  group: string;
  categories: string[];
  unit?: string | null;
  unitOptions?: string[];
  step?: number;
  aliases?: string[];
  wikidataId?: string;
  /** Expands into left and right variants alongside the unsided base. */
  sided?: boolean;
  /** Shown before the form is switched to its full catalog. */
  common?: boolean;
  /** Overrides the catalog's default freshness horizon for this reading. */
  freshnessDays?: number;
  calculation?: MetricDefinition['calculation'];
};

/** One row of the logging form. */
export type MeasurementField = {
  key: string;
  canonicalLabel: string;
  group: string;
  unit: string | null;
  unitOptions: string[];
  step: number;
  common: boolean;
  sided: boolean;
  leftKey: string | null;
  rightKey: string | null;
};

export function toMeasurementField(source: MeasurementFieldSource): MeasurementField {
  return {
    key: source.key,
    canonicalLabel: source.canonicalLabel,
    group: source.group,
    unit: source.unit ?? null,
    unitOptions: source.unitOptions ?? (source.unit ? [source.unit] : []),
    step: source.step ?? 0.1,
    common: Boolean(source.common),
    sided: Boolean(source.sided),
    leftKey: source.sided ? `${source.key}-left` : null,
    rightKey: source.sided ? `${source.key}-right` : null,
  };
}
