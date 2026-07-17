import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { suggestActivities } from '@/ai/flows/suggest-activities-flow';
import { activitiesCollection } from '@/lib/collections-server';
import logger from '@/lib/logger';
import { getYear } from 'date-fns';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getErrorStatus, requireUidAndBarrioOrg } from '@/lib/api-auth';
import {
  FALLBACK_ACTIVITY_SUGGESTIONS,
  normalizeActivitySuggestions,
  withAiFallback,
  type SuggestedActivities,
} from '@/lib/ai-suggestions';
import { resolveDeepSeekTimeoutMs } from '@/lib/deepseek';

export const runtime = 'nodejs';
/** DeepSeek suggestions often need > default Vercel limit on cold start. */
export const maxDuration = 60;

type TimestampLike = { toDate(): Date };
type ActivityDoc = { title?: string; date?: TimestampLike };

/** Soft AI budget under maxDuration; leave room for Firestore + cold start. */
const AI_SOFT_DEADLINE_MS = Math.min(resolveDeepSeekTimeoutMs(), 25_000);

async function getCurrentYearActivityTitles(barrioOrg: string): Promise<string[]> {
  try {
    const snapshot = await activitiesCollection
      .where('barrioOrg', '==', barrioOrg)
      .orderBy('date', 'desc')
      .get();
    const activities = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as ActivityDoc),
    }));

    return activities
      .filter((a) => Boolean(a.date && getYear(a.date.toDate()) === getYear(new Date())))
      .map((a) => a.title)
      .filter((title): title is string => Boolean(title));
  } catch (error) {
    // Missing composite index or empty tenant — still generate suggestions.
    logger.warn({ error, message: 'Could not load year activities for suggestions; continuing with empty list' });
    return [];
  }
}

async function generateActivitySuggestions(barrioOrg: string): Promise<SuggestedActivities> {
  const currentYearActivities = await getCurrentYearActivityTitles(barrioOrg);
  const { value, source } = await withAiFallback(
    () => suggestActivities({ existingActivities: currentYearActivities }),
    FALLBACK_ACTIVITY_SUGGESTIONS,
    AI_SOFT_DEADLINE_MS,
  );
  if (source === 'fallback') {
    logger.warn({ message: 'Activity suggestions served from fallback', barrioOrg });
  }
  return normalizeActivitySuggestions(value) ?? FALLBACK_ACTIVITY_SUGGESTIONS;
}

function getSuggestionsCached(barrioOrg: string) {
  return unstable_cache(
    async (): Promise<SuggestedActivities> => generateActivitySuggestions(barrioOrg),
    [`suggestions-${barrioOrg}`],
    {
      revalidate: 3600,
      tags: ['suggestions', `suggestions-${barrioOrg}`],
    }
  )();
}

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { barrioOrg } = await requireUidAndBarrioOrg(request);
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    if (refresh) {
      if (process.env.NODE_ENV === 'production') {
        try {
          revalidateTag(`suggestions-${barrioOrg}`, 'default');
        } catch (error) {
          logger.warn({ error, message: 'revalidateTag failed for activity suggestions' });
        }
      }
      const suggestions = await generateActivitySuggestions(barrioOrg);
      return NextResponse.json(suggestions);
    }

    // Dev: skip Data Cache so local iteration always hits DeepSeek.
    if (process.env.NODE_ENV !== 'production') {
      const suggestions = await generateActivitySuggestions(barrioOrg);
      return NextResponse.json(suggestions);
    }

    try {
      const suggestions = await getSuggestionsCached(barrioOrg);
      return NextResponse.json(normalizeActivitySuggestions(suggestions) ?? FALLBACK_ACTIVITY_SUGGESTIONS);
    } catch (error) {
      logger.error({ error, message: 'Error fetching cached suggestions' });
      return NextResponse.json(FALLBACK_ACTIVITY_SUGGESTIONS);
    }
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    logger.error({ error, message: 'Unexpected error in /api/suggestions' });
    // Always return usable content so the UI card never stays empty on infra blips.
    return NextResponse.json(FALLBACK_ACTIVITY_SUGGESTIONS);
  }
}
