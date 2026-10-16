import { describe, expect, it } from 'vitest';
import {
  prepareIdentifiers,
  prepareNames,
  sourceFrom,
  sourceInstant,
  type IdentifierDraft,
  type NameDraft,
} from './medicine-catalog-draft';

function source(retrievedAt: string | null = null) {
  return sourceFrom({
    sourceKind: 'manual',
    sourceProvider: null,
    sourceUrl: null,
    sourceRetrievedAt: retrievedAt,
  });
}

function name(overrides: Partial<NameDraft> = {}): NameDraft {
  return {
    localId: 'draft-name',
    id: null,
    name: '',
    languageTag: '',
    nameType: 'synonym',
    jurisdiction: '',
    preferred: false,
    ...source(),
    ...overrides,
  };
}

function identifier(overrides: Partial<IdentifierDraft> = {}): IdentifierDraft {
  return {
    localId: 'draft-identifier',
    id: null,
    system: '',
    code: '',
    jurisdiction: '',
    ...source(),
    ...overrides,
  };
}

describe('catalogue source drafts', () => {
  it.each([
    '2026-10-16T12:34:56.789Z',
    '2026-10-16T21:34:56.789+09:00',
    '2026-11-01T01:30:45.123-04:00',
    '2026-11-01T01:30:45.123-05:00',
  ])('preserves the original instant when %s is untouched', (instant) => {
    const draft = source(instant);
    expect(draft.sourceRetrievedAt).toBe(new Date(instant).toISOString().slice(0, 16));
    expect(sourceInstant(draft.sourceRetrievedAt, draft.retrievedAtBaseline)).toBe(instant);
  });

  it('converts an edited local time and preserves the original when reverted', () => {
    const draft = source('2026-10-16T12:34:56.789Z');
    expect(sourceInstant('2026-10-17T10:20', draft.retrievedAtBaseline)).toBe('2026-10-17T10:20:00.000Z');
    expect(sourceInstant('', draft.retrievedAtBaseline)).toBeNull();
    expect(sourceInstant(draft.sourceRetrievedAt, draft.retrievedAtBaseline)).toBe('2026-10-16T12:34:56.789Z');
  });

  it('handles empty sources and leaves invalid input for server validation', () => {
    const draft = source();
    expect(draft.sourceProvider).toBe('');
    expect(draft.sourceUrl).toBe('');
    expect(draft.sourceRetrievedAt).toBe('');
    expect(sourceInstant('', draft.retrievedAtBaseline)).toBeNull();
    expect(sourceInstant('invalid', draft.retrievedAtBaseline)).toBe('invalid');
    expect(source('invalid').sourceRetrievedAt).toBe('');
  });
});

describe('prepareNames', () => {
  it('uses a trimmed preferred fallback when every row is blank', () => {
    expect(prepareNames([name({ name: '  ' })], '  Paracetamol  ')).toEqual([{
      id: null,
      name: 'Paracetamol',
      languageTag: 'und',
      nameType: 'preferred',
      jurisdiction: null,
      preferred: true,
      sourceKind: 'manual',
      sourceProvider: null,
      sourceUrl: null,
      sourceRetrievedAt: null,
    }]);
    expect(prepareNames([], 'Paracetamol')[0].name).toBe('Paracetamol');
  });

  it('drops blank rows, trims fields and strips draft metadata without mutating the draft', () => {
    const draft = name({
      ...source('2026-10-16T12:34:56.789Z'),
      id: 'saved-name',
      name: '  パラセタモール  ',
      languageTag: ' ja ',
      jurisdiction: ' JP ',
      sourceProvider: ' Reference ',
      sourceUrl: ' https://example.com/medicine ',
      preferred: true,
    });
    const before = structuredClone(draft);
    expect(prepareNames([name(), draft], 'Fallback')).toEqual([{
      id: 'saved-name',
      name: 'パラセタモール',
      languageTag: 'ja',
      nameType: 'synonym',
      jurisdiction: 'JP',
      preferred: true,
      sourceKind: 'manual',
      sourceProvider: 'Reference',
      sourceUrl: 'https://example.com/medicine',
      sourceRetrievedAt: '2026-10-16T12:34:56.789Z',
    }]);
    expect(draft).toEqual(before);
  });

  it('defaults blank language tags and optional fields', () => {
    expect(prepareNames([name({ name: 'Paracetamol', languageTag: ' ' })], '')[0]).toMatchObject({
      languageTag: 'und', jurisdiction: null, sourceProvider: null, sourceUrl: null,
    });
  });
});

describe('prepareIdentifiers', () => {
  it('drops blank rows but retains incomplete pairs for server validation', () => {
    expect(prepareIdentifiers([
      identifier({ system: ' ', code: ' ' }),
      identifier({ system: ' RxNorm ' }),
      identifier({ code: ' 161 ' }),
    ]).map(({ system, code }) => ({ system, code }))).toEqual([
      { system: 'RxNorm', code: '' },
      { system: '', code: '161' },
    ]);
  });

  it('trims identifiers and preserves source precision without leaking draft metadata', () => {
    const draft = identifier({
      ...source('2026-10-16T12:34:56.789Z'),
      id: 'saved-identifier',
      system: ' RxNorm ',
      code: ' 161 ',
      jurisdiction: ' US ',
      sourceProvider: ' Reference ',
      sourceUrl: ' https://example.com/medicine ',
    });
    const before = structuredClone(draft);
    expect(prepareIdentifiers([draft])).toEqual([{
      id: 'saved-identifier',
      system: 'RxNorm',
      code: '161',
      jurisdiction: 'US',
      sourceKind: 'manual',
      sourceProvider: 'Reference',
      sourceUrl: 'https://example.com/medicine',
      sourceRetrievedAt: '2026-10-16T12:34:56.789Z',
    }]);
    expect(draft).toEqual(before);
  });
});
