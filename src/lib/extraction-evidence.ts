export type DateEvidence = {
  sourceText: string;
  normalizedDate: string;
  role: string;
};

export type ExtractionEvidence = {
  sourceTranscript: string;
  dateEvidence: DateEvidence[];
  reportDate: string;
  reportTime: string;
};

const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_DATE_EVIDENCE_ITEMS = 100;

function parseJsonLike(value: unknown) {
  let parsed = value;

  for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }

  return parsed;
}
function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizeExtractionEvidence(value: unknown): ExtractionEvidence | null {
  const parsed = parseJsonLike(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const source = parsed as Record<string, unknown>;
  const sourceTranscript = text(source.sourceTranscript, MAX_TRANSCRIPT_CHARS);
  const reportDate = text(source.reportDate, 40);
  const reportTime = text(source.reportTime, 20);
  const dateEvidence = Array.isArray(source.dateEvidence)
    ? source.dateEvidence
        .slice(0, MAX_DATE_EVIDENCE_ITEMS)
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
          const candidate = item as Record<string, unknown>;
          const sourceText = text(candidate.sourceText, 300);
          if (!sourceText) return null;

          return {
            sourceText,
            normalizedDate: text(candidate.normalizedDate, 40),
            role: text(candidate.role, 40) || 'unknown',
          };
        })
        .filter((item): item is DateEvidence => item !== null)
    : [];

  if (!sourceTranscript && dateEvidence.length === 0 && !reportDate && !reportTime) return null;

  return {
    sourceTranscript,
    dateEvidence,
    reportDate,
    reportTime,
  };
}
