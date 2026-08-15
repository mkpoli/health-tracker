import { describe, expect, it } from 'vitest';
import { normalizeExtractionEvidence } from './extraction-evidence';

describe('normalizeExtractionEvidence', () => {
  it('keeps the transcript and date evidence', () => {
    expect(
      normalizeExtractionEvidence({
        sourceTranscript: ' 発行日：2026/08/05 10:13 ',
        dateEvidence: [
          {
            sourceText: '発行日：2026/08/05 10:13',
            normalizedDate: '2026-08-05T10:13',
            role: 'issue',
          },
        ],
        reportDate: '2026-08-05T10:13',
        reportTime: '10:13',
      }),
    ).toEqual({
      sourceTranscript: '発行日：2026/08/05 10:13',
      dateEvidence: [
        {
          sourceText: '発行日：2026/08/05 10:13',
          normalizedDate: '2026-08-05T10:13',
          role: 'issue',
        },
      ],
      reportDate: '2026-08-05T10:13',
      reportTime: '10:13',
    });
  });

  it('reads evidence from JSON storage', () => {
    expect(
      normalizeExtractionEvidence(
        JSON.stringify({
          sourceTranscript: '検査日: 2026/08/12',
          dateEvidence: [{ sourceText: '検査日: 2026/08/12', normalizedDate: '2026-08-12' }],
          reportDate: '2026-08-12',
        }),
      ),
    ).toMatchObject({
      sourceTranscript: '検査日: 2026/08/12',
      reportDate: '2026-08-12',
      reportTime: '',
    });
  });

  it('rejects empty evidence', () => {
    expect(normalizeExtractionEvidence({})).toBeNull();
  });
});
