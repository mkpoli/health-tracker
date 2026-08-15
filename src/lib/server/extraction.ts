import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { metricSuggestions } from '$lib/metrics/catalog';
import { MAX_INLINE_IMAGE_BYTES, MAX_UPLOAD_BYTES } from '$lib/upload-limits';
import { normalizeExtractionEvidence } from '$lib/extraction-evidence';
export { buildRawReportSource, resolveStoredReportSource } from '$lib/server/report-source-storage';
export { MAX_INLINE_IMAGE_BYTES, MAX_UPLOAD_BYTES } from '$lib/upload-limits';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return _openai;
}
const metricCatalogPrompt = metricSuggestions.map((label) => `- ${label}`).join('\n');

const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Scans are single-shot and the user waits on them, so an unreadable setting falls back rather than failing the request. */
function getReasoningEffort(): ReasoningEffort {
  const configured = env.OPENAI_API_REASONING_EFFORT;
  return REASONING_EFFORTS.find((effort) => effort === configured) ?? 'medium';
}


/** Long enough to be a paste of something that is not a report. */
export const MAX_TEXT_CHARS = 200_000;

/** How long a scan may run before the person waiting is told it did not finish. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Rejected for what the caller sent, rather than for anything upstream. */
export class ExtractionInputError extends Error {}

/**
 * Base64 of the bytes, prefixed, in one allocation.
 *
 * Encoding chunk by chunk and concatenating the *encoded* pieces avoids ever
 * holding a binary string as long as the document, and joining the prefix in
 * with them means the data URL is built once rather than assembled from a
 * finished base64 string. On a scan-sized file that is two fewer copies alive
 * at the same moment, which is what the memory ceiling is spent on.
 *
 * The chunk size is a multiple of three so each piece encodes without padding;
 * padding mid-stream would corrupt everything after it.
 */
export function toBase64DataUrl(buffer: ArrayBuffer, prefix: string) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_760; // a multiple of 3, and under the argument limit
  const parts: string[] = [prefix];

  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    parts.push(btoa(String.fromCharCode(...slice)));
  }

  return parts.join('');
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

export async function extractMedicalData(textContext: string | null, file: File | null) {
  const isImage = Boolean(file && file.type.startsWith('image/'));

  if (file && file.size > MAX_UPLOAD_BYTES) {
    throw new ExtractionInputError(
      `That document is ${megabytes(file.size)} MB, and ${megabytes(MAX_UPLOAD_BYTES)} MB is as much as the model accepts in one file. Split it and send the parts.`,
    );
  }

  // An image is inlined as a data URL, which the worker holds several times
  // over. The browser shrinks anything above this before it is sent, so what
  // arrives too large is a format it could not decode.
  if (file && isImage && file.size > MAX_INLINE_IMAGE_BYTES) {
    throw new ExtractionInputError(
      `That image is ${megabytes(file.size)} MB and could not be resized in the browser — HEIC is the usual reason. Export it as JPEG or PNG, or keep it under ${megabytes(MAX_INLINE_IMAGE_BYTES)} MB.`,
    );
  }

  if (textContext && textContext.length > MAX_TEXT_CHARS) {
    throw new ExtractionInputError(
      `That text is ${textContext.length} characters. The limit is ${MAX_TEXT_CHARS} — paste one report at a time.`,
    );
  }

  const messages: any[] = [
    {
      role: 'system',
      content: `You are a medical data extraction assistant. Your job is to extract clinical metrics from user-provided medical documents (text, images of lab results, etc.).
Extract the document source and the metrics into a strictly typed JSON object like this:
{
  "facilityName": "string representing the lab, hospital, clinic, or testing facility name if visible; otherwise empty string. Preserve the original hospital/facility name exactly as written in the document. Do not translate, transliterate, normalize, or rewrite it into English.",
  "sourceTranscript": "complete plain-text transcription of every visible part of the document in reading order. Preserve the original language, spelling, dates, times, labels, values, units, notes, and footer text",
  "dateEvidence": [
    {
      "sourceText": "date or timestamp exactly as printed in the document",
      "normalizedDate": "the same value normalized to YYYY-MM-DD or YYYY-MM-DDTHH:mm when possible",
      "role": "collection" | "report" | "issue" | "print" | "email" | "birth" | "unknown"
    }
  ],
  "reportDate": "primary report/check timestamp in ISO-like format. Prefer a visible issue/result timestamp such as 発行日 when it includes a time, then the clinical collection or examination date. Use YYYY-MM-DD or YYYY-MM-DDTHH:mm; otherwise empty string",
  "reportTime": "time portion of reportDate when it is printed in the document; otherwise empty string",
  "metrics": [
    {
      "type": "Blood Pressure" | "Blood Glucose" | "Weight" | "Cholesterol" | "Other",
      "originalLabel": "string representing the exact test name exactly as written in the source document, preserving original language, abbreviations, capitalization, and script",
      "parsedLabel": "short English normalized label for cross-facility comparison (e.g. 'Systolic', 'Hemoglobin A1c', 'LDL Cholesterol', 'Heart Rate')",
      "value": "string or number representing the original measured value exactly as displayed (e.g. '120', '75.2', '66', '114.9', 'Negative')",
      "unit": "string representing the original unit of measurement exactly as displayed (e.g. 'mmHg', 'kg', 'mg/dL', '×100/μL', '×10^2/μL', '×百/μL', '' if none)",
      "comparableValue": "number representing a normalized comparable value when the original unit uses a scale factor or uncommon notation; otherwise the same numeric value. Example: 66 with unit ×百/μL becomes 6600 with comparableUnit /μL",
      "comparableUnit": "string representing the normalized comparable unit used for cross-report comparison (e.g. '/μL', 'mg/dL'); otherwise same as unit",
      "comparableReferenceRange": "string representing the normalized reference range in comparableUnit when conversion is needed; otherwise same as referenceRange",
      "referenceRange": "string representing the normal/reference range (e.g. '90-120', '< 150')",
      "date": "string representing the metric date in ISO-like format if visible (prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm); otherwise empty string",
      "status": "Normal" | "High" | "Low" | "Review Required" | "Stable",
      "collectionContext": "fasting" | "post-meal" | "random" | "" ,
      "hoursSinceMeal": "number of hours between the last meal and the draw when the document states it; otherwise empty",
      "notes": "string any brief notes or symptoms mentioned"
    }
  ]
};
Use the exact facility/hospital wording from the source document when present. Do not translate the source language.
A glucose or triglyceride value means something different depending on whether the person had eaten, and documents usually say which. Set "collectionContext" to "fasting" for a fasting draw (空腹時, 絶食, FBS, fasting), "post-meal" when the document says the person had eaten (食後, 食後2時間, PPBS, postprandial, non-fasting, 随時 when it states a recent meal), and "random" for an explicitly casual draw (随時, casual) with no meal stated. Leave it empty when the document does not say — do not guess.
When the document states the interval since eating (e.g. 食後2時間), put that number in "hoursSinceMeal". If the document gives the condition once for the whole panel, apply it to every metric drawn in that panel.
For each metric, preserve the original metric label exactly in "originalLabel", and provide a concise English normalized version in "parsedLabel".
When units contain multipliers or local counting notation such as 百, 千, 万, ×100, ×10^2, ×10^3, or similar, calculate a normalized comparable numeric value and unit for cross-report comparison while still preserving the original value and original unit exactly as shown.
If the metric is textual or cannot be normalized safely, leave comparableValue empty or equal to the original numeric value and explain nothing extra.
When choosing "parsedLabel", prefer one of these accepted canonical labels when there is a clear match:
${metricCatalogPrompt}
If none is a clear match, keep a concise English custom label instead of forcing a wrong match.
The accepted-label list is guidance for normalized naming. Do not rewrite "originalLabel" to match it.
Only output the raw JSON object. Do not wrap the JSON in markdown code blocks.`,
    },
  ];

  const content: any[] = [];

  if (textContext) {
    content.push({ type: 'text', text: `Here is the medical record text:\n${textContext}` });
  }

  // A document is uploaded and referenced by id rather than inlined as base64.
  // Inlining meant the worker held it as bytes, again as a data URL, and again
  // inside the JSON body — several times its own size against a 128 MB
  // isolate, which is what used to decide how large a scan could be. The upload
  // is streamed, so the file is held about once. Images stay inline because the
  // chat API takes them only as a URL, and the browser has already shrunk them.
  let uploadedFileId: string | null = null;

  if (file && file.size > 0) {
    if (isImage) {
      const mimeType = file.type || 'image/jpeg';
      const dataUrl = toBase64DataUrl(await file.arrayBuffer(), `data:${mimeType};base64,`);
      content.push({ type: 'image_url', image_url: { url: dataUrl } });
    } else {
      const uploaded = await getOpenAI().files.create({ file, purpose: 'user_data' });
      uploadedFileId = uploaded.id;
      content.push({ type: 'file', file: { file_id: uploaded.id } });
    }
  }

  if (content.length === 0) {
    throw new Error('No text or image provided');
  }

  messages.push({ role: 'user', content });

  try {
    const response = await getOpenAI().chat.completions.create(
      {
        model: env.OPENAI_API_MODEL || 'gpt-5.6-sol',
        messages,
        reasoning_effort: getReasoningEffort(),
      },
      // Without a deadline the request runs until the platform kills the worker,
      // and the person waiting is told nothing. One retry, because a scan is
      // expensive and the caller is sitting in front of it.
      { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
    );

    const outputRaw = response.choices[0]?.message?.content || '{}';
    const cleanedOutput = outputRaw.replace(/```json/gi, '').replace(/```/g, '').trim();

    const extracted = JSON.parse(cleanedOutput);
    const evidence = normalizeExtractionEvidence(extracted);

    return {
      ...extracted,
      sourceTranscript: evidence?.sourceTranscript || '',
      dateEvidence: evidence?.dateEvidence || [],
      reportDate: evidence?.reportDate || '',
      reportTime: evidence?.reportTime || '',
    };
  } finally {
    // The document is a person's medical record, so it does not stay in the
    // model provider's file storage beyond the request that needed it. A
    // failure to delete must not replace whatever the caller was going to get.
    if (uploadedFileId) {
      await getOpenAI()
        .files.delete(uploadedFileId)
        .catch((error) => console.error('[extraction] could not delete uploaded file', error));
    }
  }
}
