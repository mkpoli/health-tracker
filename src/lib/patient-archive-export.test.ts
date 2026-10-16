import { describe, expect, it, vi } from 'vitest';
import { downloadPatientArchive } from './export';
import { fetchMedicineCatalogArchive } from './medicine-catalog-client';
import { exportPatientArchive } from './patient-archive-export';

vi.mock('./export', () => ({ downloadPatientArchive: vi.fn() }));
vi.mock('./medicine-catalog-client', () => ({ fetchMedicineCatalogArchive: vi.fn() }));

function patientData(id: string) {
  return {
    currentPatient: { id, name: `Patient ${id}` },
    reports: [{ id: `report-${id}` }],
    records: [{ id: `record-${id}` }],
    medicines: [{ id: `medicine-${id}` }],
    medicineCourses: [{ id: `course-${id}` }],
    doseRegimens: [{ id: `regimen-${id}` }],
    doseOccurrences: [{ id: `dose-${id}` }],
    energyEntries: [{ id: `energy-${id}` }],
    energySources: [{ id: `source-${id}` }],
    dataImports: [{ id: `import-${id}` }],
    exerciseDefinitions: [{ id: `exercise-${id}` }],
    workouts: [{ id: `workout-${id}` }],
    claimRevisions: [{ claimId: `medicine-${id}`, revision: 1 }],
  };
}

describe('exportPatientArchive', () => {
  it('keeps the original profile, filename and all export inputs when the profile changes during the catalogue request', async () => {
    const catalog = {
      medicineIngredients: [{ id: 'ingredient-A' }],
      medicineProducts: [{ id: 'product-A' }],
      medicineCatalogRevisions: [{ entityId: 'product-A', revision: 1 }],
    };
    let resolveCatalog!: (value: typeof catalog) => void;
    vi.mocked(fetchMedicineCatalogArchive).mockReturnValue(new Promise((resolve) => {
      resolveCatalog = resolve;
    }));
    const data = patientData('A');
    const { currentPatient, ...inputs } = data;

    const exporting = exportPatientArchive(data);

    expect(fetchMedicineCatalogArchive).toHaveBeenCalledExactlyOnceWith('A');
    expect(downloadPatientArchive).not.toHaveBeenCalled();
    Object.assign(data, patientData('B'));
    resolveCatalog(catalog);
    await exporting;

    expect(downloadPatientArchive).toHaveBeenCalledExactlyOnceWith(
      { patient: currentPatient, ...inputs, ...catalog },
      'Patient A',
    );
  });
});
