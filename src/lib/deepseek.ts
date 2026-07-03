import { z } from 'zod';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

export async function requestDeepSeekText(messages: DeepSeekMessage[], model = DEFAULT_MODEL): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY no está configurada en el servidor.');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };

  const rawContent = data.choices?.[0]?.message?.content;

  if (typeof rawContent === 'string') {
    return rawContent.trim();
  }

  if (Array.isArray(rawContent)) {
    return rawContent.map((item) => item.text ?? '').join(' ').trim();
  }

  throw new Error('DeepSeek respondió sin contenido.');
}

export async function requestDeepSeekJson<T>(params: {
  messages: DeepSeekMessage[];
  schema: z.ZodSchema<T>;
  model?: string;
}): Promise<T> {
  const text = await requestDeepSeekText(params.messages, params.model);
  const normalized = extractJsonBlock(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('La respuesta de DeepSeek no fue JSON válido.');
  }

  return params.schema.parse(parsed);
}
