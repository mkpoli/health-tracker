import { describe, expect, it } from 'vitest';
import {
  ArchiveImportError,
  archiveEntityId,
  importArchiveBatch,
  resolveArchiveEntityId,
} from './archive-import';
import { ArchiveMediaError, parseArchiveMediaMetadata } from './archive-media';

describe('archive import identity', () => {
  it('maps one source item to a stable UUID for its destination profile', async () => {
    const first = await archiveEntityId('patient-1', 'source-patient-1', 'medicine', 'source-1');
    const repeated = await archiveEntityId('patient-1', 'source-patient-1', 'medicine', 'source-1');
    const otherPatient = await archiveEntityId('patient-2', 'source-patient-1', 'medicine', 'source-1');
    const otherSourcePatient = await archiveEntityId('patient-1', 'source-patient-2', 'medicine', 'source-1');
    const otherKind = await archiveEntityId('patient-1', 'source-patient-1', 'energy', 'source-1');

    expect(first).toBe(repeated);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(first).not.toBe(otherPatient);
    expect(first).not.toBe(otherSourcePatient);
    expect(first).not.toBe(otherKind);
  });

  it('keeps original IDs when an archive returns to its source profile', async () => {
    await expect(
      resolveArchiveEntityId('patient-1', 'patient-1', 'report', 'report-1'),
    ).resolves.toBe('report-1');
    await expect(
      resolveArchiveEntityId('patient-2', 'patient-1', 'report', 'report-1'),
    ).resolves.not.toBe('report-1');
  });

  it('rejects empty and oversized batches before reaching storage', async () => {
    await expect(
      importArchiveBatch({
        patientId: 'patient-1',
        sourcePatientId: 'source-patient',
        kind: 'reports',
        items: [],
      }),
    ).rejects.toEqual(new ArchiveImportError('invalid_batch'));
    await expect(
      importArchiveBatch({
        patientId: 'patient-1',
        sourcePatientId: 'source-patient',
        kind: 'reports',
        items: Array(251).fill({}),
      }),
    ).rejects.toEqual(new ArchiveImportError('batch_too_large'));
  });

  it('rejects impossible and non-ISO calendar dates', async () => {
    await expect(
      importArchiveBatch({
        patientId: 'patient-1',
        sourcePatientId: 'source-patient',
        kind: 'profile',
        items: [{ name: 'Example', birthday: '2026-02-30' }],
      }),
    ).rejects.toEqual(new ArchiveImportError('invalid_profile'));

    await expect(
      importArchiveBatch({
        patientId: 'patient-1',
        sourcePatientId: 'source-patient',
        kind: 'energy',
        items: [
          {
            id: 'energy-1',
            direction: 'intake',
            status: 'recorded',
            occurredAt: '2026-08-02T03:00:00.000Z',
            localDate: '2026-8-2',
            timezoneOffsetMinutes: 0,
            revision: 1,
            createdAt: '2026-08-02T03:00:00.000Z',
            updatedAt: '2026-08-02T03:00:00.000Z',
          },
        ],
      }),
    ).rejects.toEqual(new ArchiveImportError('invalid_energy'));
  });
});

describe('archive media metadata', () => {
  it('requires the parent energy claim for a meal photo', () => {
    expect(() =>
      parseArchiveMediaMetadata({
        archivePath: 'media/calories/source-1-photo.jpg',
        sourceKind: 'energy-photo',
        sourceId: 'source-1',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
      }),
    ).toThrowError(new ArchiveMediaError('invalid_metadata'));
  });

  it('accepts a bounded report source descriptor', () => {
    expect(
      parseArchiveMediaMetadata({
        archivePath: 'media/reports/report-1-scan.pdf',
        sourceKind: 'report-source',
        sourceId: 'report-1',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      }),
    ).toEqual({
      archivePath: 'media/reports/report-1-scan.pdf',
      sourceKind: 'report-source',
      sourceId: 'report-1',
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
    });
  });
});
