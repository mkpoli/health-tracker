// A report row is either a clinical report (uploaded, extracted, reviewed) or a
// hand-logged body measurement session. Both are a dated container of records,
// which is why they share a table and a trend pipeline.

export const LAB_REPORT_KIND = 'lab';
export const BODY_REPORT_KIND = 'body';

export type ReportKind = typeof LAB_REPORT_KIND | typeof BODY_REPORT_KIND;

export function isBodyReport(report: { kind?: string | null }) {
  return report.kind === BODY_REPORT_KIND;
}
