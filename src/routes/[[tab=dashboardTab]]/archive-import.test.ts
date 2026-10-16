import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_HEALTH_ARCHIVE_VERSION, MAX_ARCHIVE_BATCH_BYTES } from '$lib/archive-format';
import { chunkArchiveItems } from '$lib/health-archive';

const mocks = vi.hoisted(() => ({
  getOwnedPatient: vi.fn(async () => ({ id: 'patient-1' })),
  importArchiveBatch: vi.fn(async (input: { items: unknown[] }) => ({ imported: input.items.length })),
}));

vi.mock('$lib/server/ownership', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/server/ownership')>(),
  getOwnedPatient: mocks.getOwnedPatient,
}));

vi.mock('$lib/server/archive-import', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/server/archive-import')>(),
  importArchiveBatch: mocks.importArchiveBatch,
}));

import { actions } from './+page.server';

function importBatch(kind: string, items: unknown[]) {
  const body = new FormData();
  body.set('patientId', 'patient-1');
  body.set('sourcePatientId', 'source-patient');
  body.set('kind', kind);
  body.set('version', String(CURRENT_HEALTH_ARCHIVE_VERSION));
  body.set('items', JSON.stringify(items));

  return actions.importArchiveBatch({
    request: new Request('https://health.example/?/importArchiveBatch', { method: 'POST', body }),
    locals: { user: { sub: 'owner-1' } },
  } as Parameters<typeof actions.importArchiveBatch>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('archive import action size limit', () => {
  it.each([
    ['medicineIngredients', 50],
    ['medicineProducts', 25],
    ['medicineCatalogRevisions', 25],
  ] as const)('accepts byte-sized %s batches with large source data', async (kind, size) => {
    const sourceData = { text: '薬'.repeat(650_000) };
    const items = Array.from({ length: 7 }, (_, index) => {
      const entry = { id: `entry-${index}`, sourceData };
      return kind === 'medicineCatalogRevisions' ? { id: `revision-${index}`, snapshot: entry } : entry;
    });
    const serialized = JSON.stringify(items);
    expect(serialized.length).toBeLessThan(MAX_ARCHIVE_BATCH_BYTES);
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(MAX_ARCHIVE_BATCH_BYTES);

    expect(await importBatch(kind, items)).toMatchObject({
      status: 413,
      data: { code: 'archive_batch_too_large' },
    });
    expect(mocks.getOwnedPatient).not.toHaveBeenCalled();
    expect(mocks.importArchiveBatch).not.toHaveBeenCalled();

    const batches = chunkArchiveItems(items, size, MAX_ARCHIVE_BATCH_BYTES);
    expect(batches.map((batch) => batch.length)).toEqual([6, 1]);
    for (const batch of batches) {
      expect(await importBatch(kind, batch)).toMatchObject({ success: true });
    }
    expect(mocks.importArchiveBatch.mock.calls.map(([input]) => input.items).flat()).toEqual(items);
  });

  it('accepts the exact byte limit and rejects one byte more before storage', async () => {
    const overhead = new TextEncoder().encode(JSON.stringify([{ sourceData: '' }])).byteLength;
    const entry = { sourceData: 'a'.repeat(MAX_ARCHIVE_BATCH_BYTES - overhead) };
    expect(await importBatch('medicineIngredients', [entry])).toMatchObject({ success: true });
    vi.clearAllMocks();

    entry.sourceData += 'a';
    expect(await importBatch('medicineIngredients', [entry])).toMatchObject({
      status: 413,
      data: { code: 'archive_batch_too_large' },
    });
    expect(mocks.getOwnedPatient).not.toHaveBeenCalled();
    expect(mocks.importArchiveBatch).not.toHaveBeenCalled();
    expect(() => chunkArchiveItems([entry], 50, MAX_ARCHIVE_BATCH_BYTES)).toThrowError(
      expect.objectContaining({ code: 'item_too_large' }),
    );
  });

  it('rejects a single entry whose source data exceeds the cap after JSON escaping', async () => {
    const entry = { sourceData: '\0'.repeat(2 * 1024 * 1024) };
    expect(await importBatch('medicineProducts', [entry])).toMatchObject({
      status: 413,
      data: { code: 'archive_batch_too_large' },
    });
    expect(mocks.importArchiveBatch).not.toHaveBeenCalled();
    expect(() => chunkArchiveItems([entry], 25, MAX_ARCHIVE_BATCH_BYTES)).toThrowError(
      expect.objectContaining({ code: 'item_too_large' }),
    );
  });
});
