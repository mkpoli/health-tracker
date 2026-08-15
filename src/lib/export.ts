// Shared JSON export for a single patient's complete dataset. The dashboard
// export and the pre-delete backup produce the same portable snapshot.

export interface PatientExportInput {
  patient: unknown;
  reports: unknown[];
  records: unknown[];
  medicines: unknown[];
}

export function buildPatientExport({ patient, reports, records, medicines }: PatientExportInput) {
  return {
    format: 'health-tracker-export',
    version: 2,
    exportedAt: new Date().toISOString(),
    patient,
    reports,
    records,
    medicines,
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
