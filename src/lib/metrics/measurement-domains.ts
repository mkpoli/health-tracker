import * as m from '$lib/paraglide/messages.js';
import { BODY_REPORT_KIND, VITAL_REPORT_KIND, type ReportKind } from '$lib/report-kind';
import { bodyMetricFields, bodyMetricFormGroups } from './body';
import { toMeasurementField, type MeasurementField } from './measurement-fields';
import { vitalMetricSources } from './vitals';

// Everything the logging dialog and the history panel need to serve one kind of
// hand-entered measurement, so body and vitals share one implementation.

export type MeasurementDomain = {
  kind: ReportKind;
  fields: MeasurementField[];
  groups: string[];
  groupLabel: (group: string) => string;
  title: () => string;
  subtitle: () => string;
  logAction: () => string;
  emptyTitle: () => string;
  emptyHint: () => string;
  notesPlaceholder: () => string;
  /** Accent used for the panel rule and the primary button. */
  accent: 'violet' | 'rose';
  /** Body-specific extras: the figure and the bra-size readout. */
  bodyExtras: boolean;
};

const vitalFields = vitalMetricSources.map(toMeasurementField);

const bodyGroupLabels: Record<string, () => string> = {
  basics: m.measurement_group_basics,
  composition: m.measurement_group_composition,
  circumference: m.measurement_group_circumference,
  skinfold: m.measurement_group_skinfold,
};

const vitalGroupLabels: Record<string, () => string> = {
  circulation: m.measurement_group_circulation,
  respiration: m.measurement_group_respiration,
  general: m.measurement_group_general,
  ecg: m.measurement_group_ecg,
};

export const bodyDomain: MeasurementDomain = {
  kind: BODY_REPORT_KIND,
  fields: bodyMetricFields,
  groups: bodyMetricFormGroups,
  groupLabel: (group) => bodyGroupLabels[group]?.() ?? group,
  title: m.body_measurements,
  subtitle: m.body_measurements_subtitle,
  logAction: m.log_measurements,
  emptyTitle: m.no_body_measurements,
  emptyHint: m.no_body_measurements_hint,
  notesPlaceholder: m.measurement_notes_placeholder,
  accent: 'violet',
  bodyExtras: true,
};

export const vitalDomain: MeasurementDomain = {
  kind: VITAL_REPORT_KIND,
  fields: vitalFields,
  groups: ['circulation', 'respiration', 'general', 'ecg'],
  groupLabel: (group) => vitalGroupLabels[group]?.() ?? group,
  title: m.vitals,
  subtitle: m.vitals_subtitle,
  logAction: m.log_vitals,
  emptyTitle: m.no_vitals,
  emptyHint: m.no_vitals_hint,
  notesPlaceholder: m.vitals_notes_placeholder,
  accent: 'rose',
  bodyExtras: false,
};

export const measurementDomains: MeasurementDomain[] = [bodyDomain, vitalDomain];

export function getMeasurementDomain(kind: string): MeasurementDomain | null {
  return measurementDomains.find((domain) => domain.kind === kind) || null;
}
