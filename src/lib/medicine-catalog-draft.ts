import type { MedicineCatalogSource } from '$lib/medicine-catalog';

export type SourceDraft = {
  sourceKind: string;
  sourceProvider: string;
  sourceUrl: string;
  sourceRetrievedAt: string;
  retrievedAtBaseline: { instant: string | null; local: string };
};

export type NameDraft = SourceDraft & {
  localId: string;
  id: string | null;
  name: string;
  languageTag: string;
  nameType: 'preferred' | 'brand' | 'generic' | 'synonym';
  jurisdiction: string;
  preferred: boolean;
};

export type IdentifierDraft = SourceDraft & {
  localId: string;
  id: string | null;
  system: string;
  code: string;
  jurisdiction: string;
};

export function sourceFrom(value: MedicineCatalogSource): SourceDraft {
  const instant = value.sourceRetrievedAt ? new Date(value.sourceRetrievedAt) : null;
  const localDateTime = instant && !Number.isNaN(instant.getTime())
    ? new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : '';
  return {
    sourceKind: value.sourceKind,
    sourceProvider: value.sourceProvider || '',
    sourceUrl: value.sourceUrl || '',
    sourceRetrievedAt: localDateTime,
    retrievedAtBaseline: { instant: value.sourceRetrievedAt, local: localDateTime },
  };
}

export function sourceInstant(value: string, baseline: SourceDraft['retrievedAtBaseline']) {
  if (value === baseline.local) return baseline.instant;
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : instant.toISOString();
}

export function prepareNames(names: NameDraft[], fallback: string) {
  return names
    .filter((name) => name.name.trim())
    .map(({ localId: _localId, retrievedAtBaseline, ...name }) => ({
      ...name,
      name: name.name.trim(),
      languageTag: name.languageTag.trim() || 'und',
      jurisdiction: name.jurisdiction.trim() || null,
      sourceProvider: name.sourceProvider.trim() || null,
      sourceUrl: name.sourceUrl.trim() || null,
      sourceRetrievedAt: sourceInstant(name.sourceRetrievedAt, retrievedAtBaseline),
    }))
    .concat(
      names.some((name) => name.name.trim())
        ? []
        : [{
            id: null,
            name: fallback.trim(),
            languageTag: 'und',
            nameType: 'preferred' as const,
            jurisdiction: null,
            preferred: true,
            sourceKind: 'manual',
            sourceProvider: null,
            sourceUrl: null,
            sourceRetrievedAt: null,
          }],
    );
}

export function prepareIdentifiers(identifiers: IdentifierDraft[]) {
  return identifiers
    .filter((identifier) => identifier.system.trim() || identifier.code.trim())
    .map(({ localId: _localId, retrievedAtBaseline, ...identifier }) => ({
      ...identifier,
      system: identifier.system.trim(),
      code: identifier.code.trim(),
      jurisdiction: identifier.jurisdiction.trim() || null,
      sourceProvider: identifier.sourceProvider.trim() || null,
      sourceUrl: identifier.sourceUrl.trim() || null,
      sourceRetrievedAt: sourceInstant(identifier.sourceRetrievedAt, retrievedAtBaseline),
    }));
}
