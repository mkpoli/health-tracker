import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  forEachArchiveMedia,
  HealthArchiveError,
  parseHealthTrackerExport,
  readHealthArchiveFile,
  sha256Hex,
} from './health-archive';

function baseExport(overrides: Record<string, unknown> = {}) {
  return {
    format: 'health-tracker-export',
    version: 5,
    exportedAt: '2026-08-15T00:00:00.000Z',
    patient: { id: 'patient-1', name: 'Example' },
    reports: [],
    records: [],
    medicines: [],
    energyEntries: [],
    energySources: [],
    claimRevisions: [],
    mediaFiles: [],
    ...overrides,
  };
}

describe('health archive', () => {
  it('normalizes optional collections from an older export', () => {
    expect(
      parseHealthTrackerExport({
        format: 'health-tracker-export',
        version: 1,
        patient: { id: 'patient-1' },
        reports: [],
        records: [],
      }),
    ).toMatchObject({
      version: 1,
      medicines: [],
      energyEntries: [],
      energySources: [],
      claimRevisions: [],
      mediaFiles: [],
    });
  });

  it('rejects a media path that could leave the extraction root', () => {
    expect(() =>
      parseHealthTrackerExport(
        baseExport({
          mediaFiles: [
            {
              archivePath: '../photo.jpg',
              sourceKind: 'energy-photo',
              sourceId: 'source-1',
            },
          ],
        }),
      ),
    ).toThrow(HealthArchiveError);
  });

  it('streams the manifest and reports present media paths', async () => {
    const photo = new Uint8Array([1, 2, 3]);
    const archivePath = 'media/calories/source-1-photo.jpg';
    const manifest = baseExport({
      mediaFiles: [
        {
          archivePath,
          sourceKind: 'energy-photo',
          sourceId: 'source-1',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          byteSize: photo.byteLength,
          sha256: await sha256Hex(photo),
        },
      ],
    });
    const archive = zipSync(
      {
        'health-data.json': strToU8(JSON.stringify(manifest)),
        [archivePath]: photo,
      },
      { level: 0 },
    );
    const file = new File([archive], 'health-archive.zip', { type: 'application/zip' });
    const read = await readHealthArchiveFile(file);

    expect(read.kind).toBe('zip');
    expect([...read.availableMediaPaths]).toEqual([archivePath]);
    expect(read.missingMediaPaths).toEqual([]);

    const restored: Array<{ path: string; bytes: number[] }> = [];
    const completed = await forEachArchiveMedia(file, read.data.mediaFiles, async (media, bytes) => {
      restored.push({ path: media.archivePath, bytes: Array.from(bytes) });
    });

    expect(restored).toEqual([{ path: archivePath, bytes: [1, 2, 3] }]);
    expect([...completed]).toEqual([archivePath]);
  });

  it('reports media omitted from a JSON-only export', async () => {
    const archivePath = 'media/reports/report-1-scan.pdf';
    const file = new File(
      [
        JSON.stringify(
          baseExport({
            mediaFiles: [
              {
                archivePath,
                sourceKind: 'report-source',
                sourceId: 'report-1',
                fileName: 'scan.pdf',
                mimeType: 'application/pdf',
              },
            ],
          }),
        ),
      ],
      'health-data.json',
      { type: 'application/json' },
    );

    const read = await readHealthArchiveFile(file);
    expect(read.kind).toBe('json');
    expect(read.missingMediaPaths).toEqual([archivePath]);
  });

  it('rejects media whose checksum differs from the manifest', async () => {
    const archivePath = 'media/calories/source-1-photo.jpg';
    const manifest = baseExport({
      mediaFiles: [
        {
          archivePath,
          sourceKind: 'energy-photo',
          sourceId: 'source-1',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          byteSize: 3,
          sha256: '0'.repeat(64),
        },
      ],
    });
    const archive = zipSync(
      {
        'health-data.json': strToU8(JSON.stringify(manifest)),
        [archivePath]: new Uint8Array([1, 2, 3]),
      },
      { level: 0 },
    );
    const file = new File([archive], 'health-archive.zip', { type: 'application/zip' });

    await expect(
      forEachArchiveMedia(file, parseHealthTrackerExport(manifest).mediaFiles, async () => {}),
    ).rejects.toMatchObject({ code: 'checksum_mismatch' });
  });

  it('requires integrity metadata for retained files in a current ZIP', async () => {
    const archivePath = 'media/reports/report-1-scan.pdf';
    const archive = zipSync(
      {
        'health-data.json': strToU8(
          JSON.stringify(
            baseExport({
              mediaFiles: [
                {
                  archivePath,
                  sourceKind: 'report-source',
                  sourceId: 'report-1',
                  fileName: 'scan.pdf',
                  mimeType: 'application/pdf',
                },
              ],
            }),
          ),
        ),
        [archivePath]: new Uint8Array([1, 2, 3]),
      },
      { level: 0 },
    );

    await expect(
      readHealthArchiveFile(new File([archive], 'health-archive.zip', { type: 'application/zip' })),
    ).rejects.toMatchObject({ code: 'invalid_format' });
  });
});
