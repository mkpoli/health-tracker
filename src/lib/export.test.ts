import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildPatientArchiveBytes, buildPatientExport, listPatientArchiveMedia } from './export';

describe('buildPatientExport', () => {
  it('includes medicine claims in the patient snapshot', () => {
    const payload = buildPatientExport({
      patient: { id: 'patient-1' },
      reports: [{ id: 'report-1' }],
      records: [{ id: 'record-1' }],
      medicines: [{ id: 'medicine-1', revision: 2 }],
      energyEntries: [{ id: 'energy-1', energyKcal: 540 }],
      energySources: [{ id: 'source-1', energyClaimId: 'energy-1' }],
      claimRevisions: [{ claimKind: 'medicine', claimId: 'medicine-1', revision: 1 }],
    });

    expect(payload).toMatchObject({
      format: 'health-tracker-export',
      version: 4,
      patient: { id: 'patient-1' },
      medicines: [{ id: 'medicine-1', revision: 2 }],
      energyEntries: [{ id: 'energy-1', energyKcal: 540 }],
      energySources: [{ id: 'source-1', energyClaimId: 'energy-1' }],
      claimRevisions: [{ claimKind: 'medicine', claimId: 'medicine-1', revision: 1 }],
    });
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
  });

  it('lists retained meal photos and report scans for the archive', () => {
    const input = {
      patient: { id: 'patient-1' },
      reports: [
        {
          id: 'report-1',
          rawData: JSON.stringify({
            kind: 'r2-file',
            sourceUrl: '/api/report-source?key=report',
            fileName: '../scan.pdf',
            mimeType: 'application/pdf',
          }),
        },
      ],
      records: [],
      medicines: [],
      energyEntries: [],
      energySources: [
        {
          id: 'source-1',
          sourceUrl: '/api/energy-source?id=source-1',
          fileName: 'meal.jpg',
          mimeType: 'image/jpeg',
        },
      ],
      claimRevisions: [],
    };

    expect(listPatientArchiveMedia(input)).toEqual([
      expect.objectContaining({
        archivePath: 'media/calories/source-1-meal.jpg',
        sourceKind: 'energy-photo',
      }),
      expect.objectContaining({
        archivePath: 'media/reports/report-1-scan.pdf',
        sourceKind: 'report-source',
      }),
    ]);
  });

  it('writes the structured snapshot and retained bytes into a ZIP', async () => {
    const input = {
      patient: { id: 'patient-1' },
      reports: [],
      records: [],
      medicines: [],
      energyEntries: [{ id: 'energy-1' }],
      energySources: [
        {
          id: 'source-1',
          sourceUrl: '/api/energy-source?id=source-1',
          fileName: 'meal.jpg',
          mimeType: 'image/jpeg',
        },
      ],
      claimRevisions: [{ claimKind: 'energy', claimId: 'energy-1', revision: 1 }],
    };
    const requested: string[] = [];
    const archive = await buildPatientArchiveBytes(input, 'https://health.example', async (request) => {
      requested.push(String(request));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const files = unzipSync(archive);

    expect(requested).toEqual(['https://health.example/api/energy-source?id=source-1']);
    expect(Array.from(files['media/calories/source-1-meal.jpg'])).toEqual([1, 2, 3]);
    expect(JSON.parse(strFromU8(files['health-data.json']))).toMatchObject({
      format: 'health-tracker-export',
      version: 4,
      energyEntries: [{ id: 'energy-1' }],
      claimRevisions: [{ claimKind: 'energy', claimId: 'energy-1', revision: 1 }],
      mediaFiles: [{ archivePath: 'media/calories/source-1-meal.jpg' }],
    });
  });

  it('refuses an archive source from another origin', async () => {
    const input = {
      patient: {},
      reports: [],
      records: [],
      medicines: [],
      energyEntries: [],
      energySources: [{ id: 'source-1', sourceUrl: 'https://other.example/source' }],
      claimRevisions: [],
    };

    await expect(buildPatientArchiveBytes(input, 'https://health.example')).rejects.toThrow(
      'Archive source must be served by this app',
    );
  });
});
