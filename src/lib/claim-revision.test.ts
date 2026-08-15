import { describe, expect, it } from 'vitest';
import { changedClaimFields } from './claim-revision';
import {
  claimRevisionValues,
  parseExpectedClaimRevision,
  StaleClaimRevisionError,
} from './server/claim-revisions';
import type { MedicineClaimRecord } from './medicine';

const original: MedicineClaimRecord = {
  id: 'medicine-1',
  patientId: 'patient-1',
  name: 'Medicine',
  genericName: null,
  form: 'tablet',
  strength: '10 mg',
  route: 'oral',
  schedule: 'Every morning',
  status: 'active',
  startDate: '2026-08-01',
  endDate: null,
  purpose: null,
  prescriber: null,
  notes: null,
  originKind: 'manual',
  originProvider: 'local',
  originExternalId: null,
  revision: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('claim revisions', () => {
  it('stores a complete claim snapshot with its source', () => {
    expect(
      claimRevisionValues('medicine', original, { kind: 'manual', provider: 'local' }),
    ).toEqual({
      patientId: 'patient-1',
      claimKind: 'medicine',
      claimId: 'medicine-1',
      revision: 1,
      snapshot: original,
      changedAt: '2026-08-01T00:00:00.000Z',
      changeOriginKind: 'manual',
      changeOriginProvider: 'local',
    });
  });

  it('reports content changes without treating revision metadata as content', () => {
    const next = {
      ...original,
      schedule: 'Every evening',
      status: 'paused' as const,
      revision: 2,
      updatedAt: '2026-08-02T00:00:00.000Z',
    };

    expect(changedClaimFields(next, original)).toEqual(['schedule', 'status']);
  });

  it('uses a dedicated error for optimistic concurrency conflicts', () => {
    expect(new StaleClaimRevisionError()).toMatchObject({
      name: 'StaleClaimRevisionError',
    });
  });

  it('accepts positive safe revisions from edit forms', () => {
    expect(parseExpectedClaimRevision('3')).toBe(3);
    expect(parseExpectedClaimRevision('0')).toBeNull();
    expect(parseExpectedClaimRevision('3.5')).toBeNull();
    expect(parseExpectedClaimRevision('9007199254740992')).toBeNull();
    expect(parseExpectedClaimRevision(null)).toBeNull();
  });
});
