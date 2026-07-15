import { NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { fetchLatestChurchNews } from '@/lib/church-news';
import { getAppName } from '@/lib/app-config';
import { enforceRateLimit } from '@/lib/rate-limit';
import { AuthHttpError, requireUid } from '@/lib/api-auth';
import {
  buildCatalogCallingsAnswer,
  formatCallingsContextBlock,
  isFullCallingsListRequest,
  resolveOrganizationCallings,
} from '@/lib/church-organization-callings';

const bodySchema = z.object({
  message: z.string().min(2).max(3000).optional(),
  imageDataUrl: z.string().max(10_000_000).regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, 'Invalid image').optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
  language: z.enum(['en', 'es']).default('es'),
  /** Organization name of the signed-in user (e.g. Quórum de Élderes, Sociedad de Socorro). */
  organizacion: z.string().max(120).optional(),
}).refine((data) => Boolean((data.message && data.message.trim().length > 0) || data.imageDataUrl), {
  message: 'Must include text or image.',
});

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? 'deepseek-v4-flash';
/** Listing all callings needs more tokens than a short Q&A (default was 800 and truncated). */
const DEEPSEEK_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 1600;
/** Full pastoral lists often exceed 8s on DeepSeek; default 30s. */
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30_000;
/** Public model ids (deepseek-chat aliases to v4-flash). */
const FALLBACK_MODELS = ['deepseek-chat', 'deepseek-v4-pro'];

type DeepSeekMessageContent = string | Array<{ text?: string }>;

type DeepSeekChoiceMessage = {
  content?: DeepSeekMessageContent;
  /** Present when thinking mode is on and final content may be empty. */
  reasoning_content?: string;
};

function extractDeepSeekAnswer(message: DeepSeekChoiceMessage | undefined): string {
  if (!message) return '';

  const rawContent = message.content;
  if (typeof rawContent === 'string' && rawContent.trim()) {
    return rawContent.trim();
  }
  if (Array.isArray(rawContent)) {
    const joined = rawContent.map((item) => item.text ?? '').join(' ').trim();
    if (joined) return joined;
  }

  const reasoning = message.reasoning_content;
  if (typeof reasoning === 'string' && reasoning.trim()) {
    return reasoning.trim();
  }

  return '';
}

type ChatLanguage = 'en' | 'es';

const DEFAULT_ORG_BY_LANGUAGE: Record<ChatLanguage, string> = {
  es: 'tu organización',
  en: 'your organization',
};

function buildSystemPrompt(
  language: ChatLanguage,
  organizacion: string,
  appName: string,
): string {
  const org = organizacion.trim() || DEFAULT_ORG_BY_LANGUAGE[language];
  const resolvedCallings = resolveOrganizationCallings(organizacion, language);
  const callingsBlock = resolvedCallings
    ? formatCallingsContextBlock(resolvedCallings, language)
    : language === 'es'
      ? `LLAMAMIENTOS_Y_ASIGNACIONES: no hay un catálogo exacto para "${org}". Responde solo con llamamientos típicos oficiales de esa organización auxiliar o quórum según el Manual General, indícalo con claridad y no inventes cargos ajenos a esa organización.`
      : `CALLINGS_AND_ASSIGNMENTS: no exact catalog for "${org}". Answer only with typical official callings for that auxiliary or quorum per the General Handbook, state that clearly, and do not invent callings outside that organization.`;

  const leadershipHintEs = resolvedCallings?.catalog.feminineLeadershipEs
    ? 'presidenta, consejeras y secretaria'
    : 'presidente, consejeros y secretario';
  const leadershipHintEn = 'president, counselors, and secretary';

  if (language === 'es') {
    return `Eres un asistente especializado exclusivamente en temas de La Iglesia de Jesucristo de los Santos de los Últimos Días.

Contexto de la sesión:
- Organización del usuario: ${org}
- Nombre de la aplicación de gestión: ${appName}
- ${appName} es una herramienta administrativa para la presidencia de ${org} (${leadershipHintEs}). No es un canal oficial de la Iglesia ni sustituye los manuales, LDS Tools ni la Biblioteca del Evangelio.

${callingsBlock}

Reglas obligatorias:
1) Solo puedes responder temas del evangelio de Jesucristo desde fuentes oficiales de la Iglesia (manuales, discursos, sitio oficial, Biblioteca del Evangelio, Biblia y obras canónicas) y su interpretación oficial.
2) Si el usuario pregunta algo no relacionado con la Iglesia ni con esta aplicación, responde con amabilidad que este chat es exclusivo de temas de la Iglesia y de orientación general sobre el uso de la app de su organización.
3) No inventes citas. Si no estás seguro, dilo y sugiere revisar una fuente oficial.
4) Si el usuario pide noticias/actualidad, utiliza el bloque "CONTEXT_NEWS" para confirmar información reciente. Si no hay datos verificables allí, indícalo explícitamente.
5) Responde en español, claro y pastoral, incluyendo recomendaciones prácticas de estudio cuando ayude.
6) Debes mantener continuidad con el historial ("history"): no pierdas el contexto conversacional, evita contradicciones y reconoce seguimiento de preguntas previas.
7) Si la información de actualidad no pudo verificarse o está potencialmente desactualizada, dilo explícitamente antes de responder y luego comparte lo último disponible en CONTEXT_NEWS.
8) Siempre explica con claridad el "por qué" o la razón de lo que describes (llamamientos, deberes, prácticas del evangelio, o el propósito de una función de la app). No te limites a listar qué es; di para qué existe y por qué importa en el servicio a los demás, con palabras naturales y sin jerga innecesaria.
9) Si el usuario pregunta por "otros cargos", llamamientos, asignaciones o cargos de la organización:
   a) Responde SOLO para la organización del usuario (${org}), no mezcles cargos de otras organizaciones.
   b) Enumera TODOS los ítems del bloque LLAMAMIENTOS_Y_ASIGNACIONES (si existe), cada uno con una breve explicación del porqué.
   c) Usa títulos con el género y nombre correctos de ${org} (p. ej. presidenta en Sociedad de Socorro, presidente en Quórum de Élderes).
   d) Aclara que es la estructura típica según el Manual General; en un barrio concreto el obispado decide qué especialistas se llaman.
10) Si la pregunta es sobre la aplicación ${appName}, sus módulos, datos, permisos, configuración, errores, o cómo usarla:
   a) Puedes explicar de forma general el propósito de la función (por qué existe y para qué sirve en el trabajo de la presidencia).
   b) Debes indicar con claridad que el control y la administración de esta app corresponden a la presidencia de ${org}, y que cualquier solicitud, duda operativa, cambio de acceso o asunto de la app debe dirigirse a la presidencia de ${org}.
   c) No inventes datos del barrio, listas de miembros ni configuraciones internas; no tienes acceso a la base de datos de la app.
11) Adapta el lenguaje a la organización del usuario (${org}): usa su nombre de forma natural al hablar de su presidencia y de la app.`;
  }

  return `You are an assistant specialized exclusively in topics related to The Church of Jesus Christ of Latter-day Saints.

Session context:
- User's organization: ${org}
- Management app name: ${appName}
- ${appName} is an administrative tool for the presidency of ${org} (${leadershipHintEn}). It is not an official Church channel and does not replace handbooks, LDS Tools, or Gospel Library.

${callingsBlock}

Mandatory rules:
1) You may only answer gospel topics using official Church sources (handbooks, talks, the official website, Gospel Library, the Bible and other standard works) and their official interpretation.
2) If the user asks about something unrelated to the Church or this application, kindly explain that this chat is exclusively for Church topics and general guidance about their organization's app.
3) Do not invent citations. If you are unsure, say so and suggest checking an official source.
4) If the user asks for news/current events, use the "CONTEXT_NEWS" block to confirm recent information. If there is no verifiable data there, say so explicitly.
5) Respond in English, clearly and pastorally, including practical study recommendations when helpful.
6) Maintain continuity with the conversation history ("history"): do not lose conversational context, avoid contradictions, and acknowledge follow-up questions.
7) If current information could not be verified or may be outdated, say so explicitly before answering and then share the latest available items in CONTEXT_NEWS.
8) Always clearly explain the "why" or reason behind what you describe (callings, duties, gospel practices, or the purpose of an app feature). Do not only list what something is; say why it exists and why it matters in serving others, in natural language without unnecessary jargon.
9) If the user asks about "other callings", callings, assignments, or positions in the organization:
   a) Answer ONLY for the user's organization (${org}); do not mix callings from other organizations.
   b) List ALL items from the CALLINGS_AND_ASSIGNMENTS block (when present), each with a brief explanation of why it exists.
   c) Use titles appropriate to ${org}.
   d) Clarify this is the typical structure per the General Handbook; in a given ward the bishopric decides which specialists are called.
10) If the question is about the ${appName} application, its modules, data, permissions, settings, errors, or how to use it:
   a) You may briefly explain the general purpose of the feature (why it exists and what it is for in the presidency's work).
   b) You must clearly state that control and administration of this app belong to the presidency of ${org}, and that any request, operational question, access change, or app-related matter should be directed to the presidency of ${org}.
   c) Do not invent ward data, member lists, or internal settings; you do not have access to the app's database.
11) Adapt your language to the user's organization (${org}): use its name naturally when referring to their presidency and the app.`;
}

const apiMessages = {
  es: {
    missingApiKey: 'DEEPSEEK_API_KEY no está configurada en el servidor.',
    messageTooLong: (max: number) => `El mensaje excede el límite de ${max} caracteres.`,
    invalidRequest: 'Solicitud inválida.',
    newsUnverified: (iso: string) =>
      `No se pudo verificar noticias oficiales recientes al momento de la consulta (${iso}).`,
    noVerifiedNews: 'Sin noticias verificadas en esta solicitud.',
    newsVerified: (latest: string, iso: string) =>
      `Noticias verificadas. Última publicación reportada: ${latest}. Consulta realizada: ${iso}.`,
    unknownDate: 'fecha desconocida',
    analyzeImage: 'Analiza esta imagen dentro del contexto oficial de la Iglesia.',
    deepseekFailed: 'No se pudo obtener respuesta de DeepSeek. Intenta de nuevo en unos segundos.',
    deepseekTimeout: 'La respuesta tardó demasiado. Intenta de nuevo o formula una pregunta más breve.',
    unexpectedError: 'Error inesperado al consultar la IA.',
  },
  en: {
    missingApiKey: 'DEEPSEEK_API_KEY is not configured on the server.',
    messageTooLong: (max: number) => `The message exceeds the ${max} character limit.`,
    invalidRequest: 'Invalid request.',
    newsUnverified: (iso: string) =>
      `Could not verify recent official news at the time of the request (${iso}).`,
    noVerifiedNews: 'No verified news in this request.',
    newsVerified: (latest: string, iso: string) =>
      `News verified. Latest reported publication: ${latest}. Request made: ${iso}.`,
    unknownDate: 'unknown date',
    analyzeImage: 'Analyze this image within the official Church context.',
    deepseekFailed: 'Could not get a response from DeepSeek. Please try again in a few seconds.',
    deepseekTimeout: 'The response took too long. Try again or ask a shorter question.',
    unexpectedError: 'Unexpected error while querying the AI.',
  },
} as const;

export async function POST(request: Request) {
  // DeepSeek is the main variable cost — require auth, then 10 req/min per uid.
  const limited = await enforceRateLimit(request, 'churchChat');
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const preLanguage: ChatLanguage =
    raw && typeof raw === 'object' && (raw as { language?: string }).language === 'en' ? 'en' : 'es';

  try {
    await requireUid(request);
  } catch (error) {
    if (error instanceof AuthHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: apiMessages[preLanguage].invalidRequest },
      { status: 401 }
    );
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    const language: ChatLanguage = preLanguage;
    const maxInputChars = 3000;
    const messageIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === 'message' && issue.code === 'too_big'
    );
    if (messageIssue) {
      return NextResponse.json(
        { error: apiMessages[language].messageTooLong(maxInputChars) },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: apiMessages[language].invalidRequest }, { status: 400 });
  }

  const { message, imageDataUrl, history, language, organizacion } = parsed.data;
  const messages_i18n = apiMessages[language];
  const appName = getAppName();
  const userText = message?.trim() || '';

  // Fast path: "Otros cargos" / full callings list from the org catalog (no DeepSeek).
  // Avoids timeouts when listing every calling with a long system prompt.
  const resolvedCallings = resolveOrganizationCallings(organizacion, language);
  if (
    !imageDataUrl &&
    userText &&
    resolvedCallings &&
    isFullCallingsListRequest(userText)
  ) {
    const answer = buildCatalogCallingsAnswer(resolvedCallings, language);
    return NextResponse.json({
      answer,
      contextNews: messages_i18n.noVerifiedNews,
      source: 'organization-callings-catalog',
    });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: apiMessages[language].missingApiKey },
      { status: 500 }
    );
  }

  const systemPrompt = buildSystemPrompt(language, organizacion ?? '', appName);

  const nowIso = new Date().toISOString();
  let newsStatus: string = messages_i18n.newsUnverified(nowIso);
  let contextNews: string = messages_i18n.noVerifiedNews;
  try {
    const news = await fetchLatestChurchNews();
    if (news.length > 0) {
      const latestPublishedAt = news[0]?.publishedAt || messages_i18n.unknownDate;
      newsStatus = messages_i18n.newsVerified(latestPublishedAt, nowIso);
      contextNews = news
        .map((item, index) => `${index + 1}. ${item.title} | ${item.publishedAt} | ${item.link}`)
        .join('\n');
    }
  } catch (error) {
    logger.warn({ error, message: 'No fue posible obtener noticias oficiales para church-chat.' });
  }

  const promptUserText = userText || messages_i18n.analyzeImage;

  // DeepSeek chat rejects multimodal image_url payloads. When an image is present,
  // describe it with Gemini first and pass a text-only prompt to DeepSeek.
  let imageContext = '';
  if (imageDataUrl) {
    try {
      const { describeImage } = await import('@/lib/vision');
      const vision = await describeImage(imageDataUrl);
      imageContext = `\n\n[IMAGE_DESCRIPTION]\n${vision.description}`;
    } catch (error) {
      logger.warn({ error, message: 'No se pudo analizar la imagen adjunta en church-chat.' });
      imageContext =
        '\n\n[IMAGE_DESCRIPTION]\nNo se pudo analizar la imagen automáticamente (falta GEMINI_API_KEY o falló la API de visión).';
    }
  }

  const messages = [
    { role: 'system', content: `${systemPrompt}\n\nNEWS_STATUS:\n${newsStatus}\n\nCONTEXT_NEWS:\n${contextNews}` },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    {
      role: 'user',
      content: `${promptUserText}${imageContext}`,
    },
  ];

  try {
    const modelCandidates = Array.from(new Set([DEEPSEEK_CHAT_MODEL, ...FALLBACK_MODELS]));
    let answer = '';
    let lastErrorText = '';
    let lastStatus = 502;

    for (const model of modelCandidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
      try {
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
            max_tokens: DEEPSEEK_MAX_TOKENS,
            thinking: { type: 'disabled' },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          lastStatus = response.status;
          lastErrorText = await response.text();
          logger.warn({ message: 'DeepSeek request failed for model candidate', model, status: response.status });
          continue;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: DeepSeekChoiceMessage }>;
        };
        answer = extractDeepSeekAnswer(data.choices?.[0]?.message);

        if (answer) {
          break;
        }

        lastStatus = 502;
        lastErrorText = 'empty content from model';
        logger.warn({ message: 'DeepSeek returned empty content', model });
      } catch (error) {
        const isTimeout =
          (error instanceof Error && error.name === 'AbortError') ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            (error as { name: string }).name === 'AbortError');
        if (isTimeout) {
          lastStatus = 504;
          lastErrorText = `timeout after ${DEEPSEEK_TIMEOUT_MS}ms`;
          logger.warn({
            message: 'DeepSeek request failed for model candidate',
            model,
            status: 'timeout',
            timeoutMs: DEEPSEEK_TIMEOUT_MS,
          });
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Last resort: if DeepSeek failed but the user asked for all callings, use the catalog.
    if (!answer && resolvedCallings && userText && isFullCallingsListRequest(userText)) {
      logger.warn({
        message: 'DeepSeek failed; serving organization callings catalog fallback',
        lastStatus,
        lastErrorText,
      });
      return NextResponse.json({
        answer: buildCatalogCallingsAnswer(resolvedCallings, language),
        contextNews,
        source: 'organization-callings-catalog-fallback',
      });
    }

    if (!answer) {
      logger.error({
        message: 'DeepSeek request failed in church-chat route after all model candidates',
        status: lastStatus,
        errorText: lastErrorText,
      });
      const errorMessage =
        lastStatus === 504 ? messages_i18n.deepseekTimeout : messages_i18n.deepseekFailed;
      return NextResponse.json({ error: errorMessage }, { status: lastStatus === 504 ? 504 : 502 });
    }

    return NextResponse.json({ answer, contextNews });
  } catch (error) {
    logger.error({ error, message: 'Unexpected error in church-chat route' });
    return NextResponse.json({ error: messages_i18n.unexpectedError }, { status: 500 });
  }
}
