/**
 * Gemini — IA SOLO para IMÁGENES (visión).
 *
 * Usos:
 *   - Descripción automática de fotos en Obra misional (tab Imágenes)
 *   - Análisis de imagen adjunta en Chat Iglesia (luego DeepSeek responde en texto)
 *
 * NO sustituye a DeepSeek: no se usa para chat, resúmenes ni sugerencias.
 * DeepSeek cubre todo lo de texto (`@/lib/deepseek` + DEEPSEEK_API_KEY).
 *
 * Env: GEMINI_API_KEY (o GOOGLE_GENERATIVE_AI_API_KEY), GEMINI_VISION_MODEL
 *
 * Por qué Gemini: DeepSeek chat (v4-flash/pro) rechaza `image_url`
 * ("unknown variant image_url, expected text").
 */
import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';
import logger from '@/lib/logger';

const DescriptionSchema = z.object({
  description: z.string().min(1),
});

type VisionResult = z.infer<typeof DescriptionSchema>;

/** Prefer current stable vision models; gemini-2.0-flash was retired (404). */
const DEFAULT_VISION_MODEL = 'gemini-2.5-flash-lite';
const FALLBACK_VISION_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

function parseDataUrl(imageData: string): { mimeType: string; base64: string } {
  const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('imageData debe ser un data URL base64 (data:image/...;base64,...)');
  }
  return { mimeType: match[1], base64: match[2] };
}

function visionModelCandidates(): string[] {
  const preferred = process.env.GEMINI_VISION_MODEL || DEFAULT_VISION_MODEL;
  return Array.from(new Set([preferred, ...FALLBACK_VISION_MODELS]));
}

async function callGeminiVision(
  apiKey: string,
  model: string,
  mimeType: string,
  base64: string
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'Analiza la imagen y responde SOLO con JSON válido, sin markdown ni texto extra. ' +
                'Formato: {"description":"descripción detallada en español de lo que se ve"}. ' +
                'Si es una actividad misional o de la Iglesia, menciónalo cuando sea evidente.',
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, status: response.status, body };
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!raw) {
    return { ok: false, status: 502, body: 'Gemini respondió sin contenido de descripción.' };
  }

  return { ok: true, text: raw };
}

function parseDescriptionPayload(raw: string): VisionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Modelo a veces devuelve texto plano; envolver como descripción
    return DescriptionSchema.parse({ description: raw });
  }
  return DescriptionSchema.parse(parsed);
}

async function describeWithGemini(imageData: string): Promise<VisionResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY no está configurada. DeepSeek no soporta imágenes; se necesita Gemini para descripciones automáticas.'
    );
  }

  const { mimeType, base64 } = parseDataUrl(imageData);
  const models = visionModelCandidates();
  let lastError = '';

  for (const model of models) {
    const result = await callGeminiVision(apiKey, model, mimeType, base64);
    if (result.ok) {
      return parseDescriptionPayload(result.text);
    }

    lastError = `Gemini vision request failed (${result.status}) model=${model}: ${result.body}`;
    logger.warn({
      message: 'Gemini vision model candidate failed',
      model,
      status: result.status,
    });

    // Retry next model only for not-found / unavailable models
    if (result.status !== 404 && !/no longer available|not found/i.test(result.body)) {
      break;
    }
  }

  throw new Error(lastError || 'Gemini vision request failed.');
}

/**
 * Optional polish: rewrite Gemini caption into a clean missionary-work style
 * Spanish sentence via DeepSeek (text-only). Failures fall back to original.
 */
async function polishDescription(description: string): Promise<string> {
  if (!process.env.DEEPSEEK_API_KEY) return description;

  try {
    const result = await requestDeepSeekJson({
      schema: DescriptionSchema,
      messages: [
        {
          role: 'system',
          content:
            'Eres un asistente que reescribe descripciones de fotos de obra misional. Responde solo JSON válido.',
        },
        {
          role: 'user',
          content:
            `Reescribe esta descripción de forma natural, clara y en español (1-3 oraciones). ` +
            `No inventes detalles. Formato: {"description":"..."}\n\nTexto base:\n${description}`,
        },
      ],
    });
    return result.description;
  } catch {
    return description;
  }
}

export async function describeImage(imageData: string): Promise<VisionResult> {
  const geminiResult = await describeWithGemini(imageData);
  const polished = await polishDescription(geminiResult.description);
  return { description: polished };
}

export function isVisionConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}
