// A report row is a dated container of records. Which kind it is decides which
// dashboard tab owns it and which code may write to it: clinical reports come
// from uploaded documents and the review flow, while measurement sessions are
// entered by hand.

export const LAB_REPORT_KIND = 'lab';
export const BODY_REPORT_KIND = 'body';
export const VITAL_REPORT_KIND = 'vital';
export const ACTIVITY_REPORT_KIND = 'activity';

export type ReportKind = typeof LAB_REPORT_KIND | typeof BODY_REPORT_KIND | typeof VITAL_REPORT_KIND | typeof ACTIVITY_REPORT_KIND;

/** Kinds entered through the measurement dialog rather than the lab review flow. */
export const MEASUREMENT_KINDS: ReportKind[] = [BODY_REPORT_KIND, VITAL_REPORT_KIND];

export function isMeasurementKind(kind?: string | null): kind is ReportKind {
  return MEASUREMENT_KINDS.includes(kind as ReportKind);
}

export function isLabReport(report: { kind?: string | null }) {
  return !isMeasurementKind(report.kind) && report.kind !== ACTIVITY_REPORT_KIND;
}

export function isImportableKind(kind?: string | null): kind is ReportKind {
  return isMeasurementKind(kind) || kind === ACTIVITY_REPORT_KIND;
}
