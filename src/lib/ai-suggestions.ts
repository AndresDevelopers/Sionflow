/**
 * Shared AI suggestion fallbacks + response guards.
 * Used by API routes (when DeepSeek fails/timeouts) and by the client
 * so production never shows an empty suggestions card.
 */

export type SuggestedActivities = {
  spiritual: string[];
  temporal: string[];
};

export type SuggestedServices = {
  quorumCare: string[];
  communityImpact: string[];
};

export const FALLBACK_ACTIVITY_SUGGESTIONS: SuggestedActivities = {
  spiritual: [
    'Estudio de las Escrituras en grupo',
    'Noche de hogar con enfoque espiritual',
    'Actividad de ayuno y oración',
  ],
  temporal: [
    'Servicio comunitario en un asilo',
    'Actividad deportiva familiar',
    'Taller de autosuficiencia',
  ],
};

export const FALLBACK_SERVICE_SUGGESTIONS: SuggestedServices = {
  quorumCare: [
    'Brigada de visitas y apoyo a hermanos convalecientes durante el mes.',
    'Jornada de ayuda en mudanzas para familias del quórum con necesidad urgente.',
    'Plan de acompañamiento semanal para hermanos menos activos con metas simples.',
  ],
  communityImpact: [
    'Operativo de limpieza de parque barrial con invitación abierta a vecinos.',
    'Campaña de donación y entrega de alimentos para familias referidas por líderes locales.',
    'Servicio de mantenimiento básico en hogares de adultos mayores de la comunidad.',
  ],
};

function asStringList(value: unknown, targetLen = 3): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (items.length === 0) return null;
  if (items.length >= targetLen) return items.slice(0, targetLen);
  // Pad by cycling if the model returned fewer than expected.
  const padded = [...items];
  while (padded.length < targetLen) {
    padded.push(items[padded.length % items.length]!);
  }
  return padded;
}

/** Normalize / validate activity suggestions from API or localStorage. */
export function normalizeActivitySuggestions(raw: unknown): SuggestedActivities | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const spiritual = asStringList(data.spiritual);
  const temporal = asStringList(data.temporal);
  if (!spiritual || !temporal) return null;
  return { spiritual, temporal };
}

/** Normalize / validate service suggestions from API or localStorage. */
export function normalizeServiceSuggestions(raw: unknown): SuggestedServices | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const quorumCare = asStringList(data.quorumCare);
  const communityImpact = asStringList(data.communityImpact);
  if (!quorumCare || !communityImpact) return null;
  return { quorumCare, communityImpact };
}

/**
 * Soft deadline around an AI call. On timeout or throw, returns fallback
 * so serverless routes always finish under maxDuration and return content.
 * Work rejections are always swallowed so a late DeepSeek abort cannot
 * become an unhandledRejection after the route already responded.
 */
export async function withAiFallback<T>(
  work: () => Promise<T>,
  fallback: T,
  deadlineMs: number,
): Promise<{ value: T; source: 'ai' | 'fallback' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const workPromise = work().then(
    (value) => ({ value, source: 'ai' as const }),
    () => ({ value: fallback, source: 'fallback' as const }),
  );
  const deadlinePromise = new Promise<{ value: T; source: 'fallback' }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ value: fallback, source: 'fallback' });
    }, deadlineMs);
  });
  try {
    return await Promise.race([workPromise, deadlinePromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
