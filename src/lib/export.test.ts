import { describe, expect, it } from 'vitest';
import { buildPatientExport } from './export';

describe('buildPatientExport', () => {
  it('includes medicine claims in the patient snapshot', () => {
    const payload = buildPatientExport({
      patient: { id: 'patient-1' },
      reports: [{ id: 'report-1' }],
      records: [{ id: 'record-1' }],
      medicines: [{ id: 'medicine-1', revision: 2 }],
    });

    expect(payload).toMatchObject({
      format: 'health-tracker-export',
      version: 2,
      patient: { id: 'patient-1' },
      medicines: [{ id: 'medicine-1', revision: 2 }],
    });
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
  });
});
