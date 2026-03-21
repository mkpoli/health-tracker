import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import OpenAI from 'openai';
import { OPENAI_API_KEY, OPENAI_API_MODEL } from '$env/static/private';
import { metricSuggestions } from '$lib/metrics/catalog';

// Instantiate the OpenAI client once
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const metricCatalogPrompt = metricSuggestions.map((label) => `- ${label}`).join('\n');

// Edge-safe array buffer to base64 converter
function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const data = await request.formData();
    const textContext = data.get('text') as string | null;
    const file = data.get('file') as File | null;

    console.log('[DEBUG] textContext length:', textContext?.length || 0);
    console.log('[DEBUG] file details:', file ? `${file.name} (${file.type}, ${file.size} bytes)` : 'none');

    const messages: any[] = [];

    // System Prompt for structured JSON extraction
    messages.push({
      role: 'system',
      content: `You are a medical data extraction assistant. Your job is to extract clinical metrics from user-provided medical documents (text, images of lab results, etc.).
Extract the document source and the metrics into a strictly typed JSON object like this:
{
  "facilityName": "string representing the lab, hospital, clinic, or testing facility name if visible; otherwise empty string. Preserve the original hospital/facility name exactly as written in the document. Do not translate, transliterate, normalize, or rewrite it into English.",
  "reportDate": "string representing the overall report/check date in ISO-like format if visible (prefer YYYY-MM-DD or YYYY-MM-DDTHH:mm); otherwise empty string",
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
      "notes": "string any brief notes or symptoms mentioned"
    }
  ]
};
Use the exact facility/hospital wording from the source document when present. Do not translate the source language.
For each metric, preserve the original metric label exactly in "originalLabel", and provide a concise English normalized version in "parsedLabel".
When units contain multipliers or local counting notation such as 百, 千, 万, ×100, ×10^2, ×10^3, or similar, calculate a normalized comparable numeric value and unit for cross-report comparison while still preserving the original value and original unit exactly as shown.
If the metric is textual or cannot be normalized safely, leave comparableValue empty or equal to the original numeric value and explain nothing extra.
When choosing "parsedLabel", prefer one of these accepted canonical labels when there is a clear match:
${metricCatalogPrompt}
If none is a clear match, keep a concise English custom label instead of forcing a wrong match.
The accepted-label list is guidance for normalized naming. Do not rewrite "originalLabel" to match it.
Only output the raw JSON object. Do not wrap the JSON in markdown code blocks.`,
    });

    const content = [];

    if (textContext) {
      content.push({ type: 'text', text: `Here is the medical record text:\n${textContext}` });
    }

    if (file && file.size > 0) {
      const arrayBuffer = await file.arrayBuffer();
      const base64String = arrayBufferToBase64(arrayBuffer);
      const mimeType = file.type || 'image/jpeg';

      if (mimeType === 'application/pdf') {
        // @ts-ignore Let the native SDK handle OpenAI type strictly
        content.push({
          type: 'file',
          file: {
            file_data: `data:application/pdf;base64,${base64String}`,
            filename: file.name || 'document.pdf',
          },
        });
      } else {
        content.push({
          type: 'image_url',
          // @ts-ignore
          image_url: {
            url: `data:${mimeType};base64,${base64String}`,
          },
        });
      }
    }

    if (content.length === 0) {
      return json({ error: 'No text or image provided' }, { status: 400 });
    }

    console.log('[DEBUG] sending message types to OpenAI:', content.map(c => c.type));

    messages.push({
      role: 'user',
      content,
    });

    const response = await openai.chat.completions.create({
      // @ts-ignore
      model: OPENAI_API_MODEL || 'gpt-5.4',
      messages,
      temperature: 0,
    });

    const outputRaw = response.choices[0]?.message?.content || '{}';
    console.log('[DEBUG] OpenAI Raw Output:', outputRaw);

    // Clean up potential markdown wrappers
    const cleanedOutput = outputRaw.replace(/```json/gi, '').replace(/```/g, '').trim();
    console.log('[DEBUG] OpenAI Cleaned Output:', cleanedOutput);

    return json(JSON.parse(cleanedOutput));
  } catch (error) {
    console.error('API Error:', error);
    return json({ error: 'Failed to extract medical data' }, { status: 500 });
  }
}
