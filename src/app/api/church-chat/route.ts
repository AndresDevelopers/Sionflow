import { NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { fetchLatestChurchNews } from '@/lib/church-news';

const bodySchema = z.object({
  message: z.string().min(2).max(3000).optional(),
  imageDataUrl: z.string().max(10_000_000).regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, 'Imagen inválida').optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
}).refine((data) => Boolean((data.message && data.message.trim().length > 0) || data.imageDataUrl), {
  message: 'Debe incluir texto o imagen.',
});

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? 'deepseek-v4-flash';
const FALLBACK_MODELS = ['deepseek-chat'];

const systemPrompt = `Eres un asistente especializado exclusivamente en temas de La Iglesia de Jesucristo de los Santos de los Últimos Días.

Reglas obligatorias:
1) Solo puedes responder temas del evangelio de Jesucristo desde fuentes oficiales de la Iglesia (manuales, discursos, sitio oficial, Biblioteca del Evangelio, Biblia y obras canónicas) y su interpretación oficial.
2) Si el usuario pregunta algo no relacionado, responde con amabilidad que este chat es exclusivo de temas de la Iglesia.
3) No inventes citas. Si no estás seguro, dilo y sugiere revisar una fuente oficial.
4) Si el usuario pide noticias/actualidad, utiliza el bloque "CONTEXT_NEWS" para confirmar información reciente. Si no hay datos verificables allí, indícalo explícitamente.
5) Responde en español, claro y pastoral, incluyendo recomendaciones prácticas de estudio cuando ayude.
6) Debes mantener continuidad con el historial ("history"): no pierdas el contexto conversacional, evita contradicciones y reconoce seguimiento de preguntas previas.
7) Si la información de actualidad no pudo verificarse o está potencialmente desactualizada, dilo explícitamente antes de responder y luego comparte lo último disponible en CONTEXT_NEWS.`;

export async function POST(request: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY no está configurada en el servidor.' },
      { status: 500 }
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }

  const { message, imageDataUrl, history } = parsed.data;

  const nowIso = new Date().toISOString();
  let newsStatus = `No se pudo verificar noticias oficiales recientes al momento de la consulta (${nowIso}).`;
  let contextNews = 'Sin noticias verificadas en esta solicitud.';
  try {
    const news = await fetchLatestChurchNews();
    if (news.length > 0) {
      const latestPublishedAt = news[0]?.publishedAt || 'fecha desconocida';
      newsStatus = `Noticias verificadas. Última publicación reportada: ${latestPublishedAt}. Consulta realizada: ${nowIso}.`;
      contextNews = news
        .map((item, index) => `${index + 1}. ${item.title} | ${item.publishedAt} | ${item.link}`)
        .join('\n');
    }
  } catch (error) {
    logger.warn({ error, message: 'No fue posible obtener noticias oficiales para church-chat.' });
  }

  const userText = message?.trim() || 'Analiza esta imagen dentro del contexto oficial de la Iglesia.';

  const messages = [
    { role: 'system', content: `${systemPrompt}\n\nNEWS_STATUS:\n${newsStatus}\n\nCONTEXT_NEWS:\n${contextNews}` },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    {
      role: 'user',
      content: imageDataUrl
        ? [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ]
        : userText,
    },
  ];

  try {
    const modelCandidates = Array.from(new Set([DEEPSEEK_CHAT_MODEL, ...FALLBACK_MODELS]));
    let answer = '';
    let lastErrorText = '';
    let lastStatus = 502;

    for (const model of modelCandidates) {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorText = await response.text();
        logger.warn({ message: 'DeepSeek request failed for model candidate', model, status: response.status });
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      answer = typeof rawContent === 'string'
        ? rawContent.trim()
        : Array.isArray(rawContent)
          ? rawContent.map((item) => item.text ?? '').join(' ').trim()
          : '';

      if (answer) {
        break;
      }
    }

    if (!answer) {
      logger.error({
        message: 'DeepSeek request failed in church-chat route after all model candidates',
        status: lastStatus,
        errorText: lastErrorText,
      });
      return NextResponse.json({ error: 'No se pudo obtener respuesta de DeepSeek.' }, { status: 502 });
    }

    return NextResponse.json({ answer, contextNews });
  } catch (error) {
    logger.error({ error, message: 'Unexpected error in church-chat route' });
    return NextResponse.json({ error: 'Error inesperado al consultar la IA.' }, { status: 500 });
  }
}
