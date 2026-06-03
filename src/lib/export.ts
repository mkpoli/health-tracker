// Shared JSON export for a single patient's complete dataset (profile + every
// report + every record, with all columns intact). Used by the dashboard
// "Export JSON Data" action and the pre-delete backup in the Danger Zone so
// both produce an identical, re-importable snapshot.

export interface PatientExportInput {
  patient: unknown;
  reports: unknown[];
  records: unknown[];
}

export function buildPatientExport({ patient, reports, records }: PatientExportInput) {
  return {
    format: 'health-tracker-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    patient,
    reports,
    records,
  };
}

export function downloadPatientExport(input: PatientExportInput, patientName?: string | null) {
  const payload = buildPatientExport(input);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = patientName?.trim().replace(/\s+/g, '_') || 'patient';

  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName}_health-data_${datePart}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
