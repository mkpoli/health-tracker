import { downloadPatientArchive, type PatientExportInput } from '$lib/export';
import { fetchMedicineCatalogArchive } from '$lib/medicine-catalog-client';

type PatientArchiveData = Omit<
  PatientExportInput,
  'patient' | 'medicineIngredients' | 'medicineProducts' | 'medicineCatalogRevisions'
> & {
  currentPatient: { id: string; name: string } | null;
};

export async function exportPatientArchive(data: PatientArchiveData) {
  const patient = data.currentPatient;
  if (!patient) return;

  const patientName = patient.name;
  const input = {
    patient,
    reports: data.reports,
    records: data.records,
    medicines: data.medicines,
    medicineCourses: data.medicineCourses,
    doseRegimens: data.doseRegimens,
    doseOccurrences: data.doseOccurrences,
    energyEntries: data.energyEntries,
    energySources: data.energySources,
    dataImports: data.dataImports,
    exerciseDefinitions: data.exerciseDefinitions,
    workouts: data.workouts,
    claimRevisions: data.claimRevisions,
  };
  const catalog = await fetchMedicineCatalogArchive(patient.id);
  await downloadPatientArchive(
    {
      ...input,
      medicineIngredients: catalog.medicineIngredients,
      medicineProducts: catalog.medicineProducts,
      medicineCatalogRevisions: catalog.medicineCatalogRevisions,
    },
    patientName,
  );
}
