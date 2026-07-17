import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getYear } from 'date-fns';
import { suggestServices } from '@/ai/flows/suggest-services-flow';
import { activitiesCollection, servicesCollection } from '@/lib/collections-server';
import logger from '@/lib/logger';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getErrorStatus, requireUidAndBarrioOrg } from '@/lib/api-auth';
import {
  FALLBACK_SERVICE_SUGGESTIONS,
  normalizeServiceSuggestions,
  withAiFallback,
  type SuggestedServices,
} from '@/lib/ai-suggestions';
import { resolveDeepSeekTimeoutMs } from '@/lib/deepseek';

export const runtime = 'nodejs';
/** DeepSeek service suggestions often need > default Vercel limit on cold start. */
export const maxDuration = 60;

type TimestampLike = { toDate(): Date };
type ServiceDoc = { title?: string; date?: TimestampLike };
type ActivityDoc = { title?: string; date?: TimestampLike };

const AI_SOFT_DEADLINE_MS = Math.min(resolveDeepSeekTimeoutMs(), 25_000);

async function getCurrentYearContext(
  barrioOrg: string
): Promise<{ services: string[]; activities: string[] }> {
  try {
    const [servicesSnapshot, activitiesSnapshot] = await Promise.all([
      servicesCollection.where('barrioOrg', '==', barrioOrg).orderBy('date', 'desc').get(),
      activitiesCollection.where('barrioOrg', '==', barrioOrg).orderBy('date', 'desc').get(),
    ]);

    const currentYear = getYear(new Date());

    const services = servicesSnapshot.docs
      .map((docSnap) => docSnap.data() as ServiceDoc)
      .filter((s) => Boolean(s.date && getYear(s.date.toDate()) === currentYear))
      .map((s) => s.title)
      .filter((title): title is string => Boolean(title));

    const activities = activitiesSnapshot.docs
      .map((docSnap) => docSnap.data() as ActivityDoc)
      .filter((a) => Boolean(a.date && getYear(a.date.toDate()) === currentYear))
      .map((a) => a.title)
      .filter((title): title is string => Boolean(title));

    return { services, activities };
  } catch (error) {
    logger.warn({
      error,
      message: 'Could not load year services/activities for suggestions; continuing with empty lists',
    });
    return { services: [], activities: [] };
  }
}

async function generateServiceSuggestions(barrioOrg: string): Promise<SuggestedServices> {
  const context = await getCurrentYearContext(barrioOrg);
  const { value, source } = await withAiFallback(
    () =>
      suggestServices({
        existingServices: context.services,
        existingActivities: context.activities,
      }),
    FALLBACK_SERVICE_SUGGESTIONS,
    AI_SOFT_DEADLINE_MS,
  );
  if (source === 'fallback') {
    logger.warn({ message: 'Service suggestions served from fallback', barrioOrg });
  }
  return normalizeServiceSuggestions(value) ?? FALLBACK_SERVICE_SUGGESTIONS;
}

function getServiceSuggestionsCached(barrioOrg: string) {
  return unstable_cache(
    async (): Promise<SuggestedServices> => generateServiceSuggestions(barrioOrg),
    [`service-suggestions-${barrioOrg}`],
    {
      revalidate: 3600,
      tags: ['service-suggestions', `service-suggestions-${barrioOrg}`],
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
          revalidateTag(`service-suggestions-${barrioOrg}`, 'default');
        } catch (error) {
          logger.warn({ error, message: 'revalidateTag failed for service suggestions' });
        }
      }
      const suggestions = await generateServiceSuggestions(barrioOrg);
      return NextResponse.json(suggestions);
    }

    if (process.env.NODE_ENV !== 'production') {
      const suggestions = await generateServiceSuggestions(barrioOrg);
      return NextResponse.json(suggestions);
    }

    try {
      const suggestions = await getServiceSuggestionsCached(barrioOrg);
      return NextResponse.json(normalizeServiceSuggestions(suggestions) ?? FALLBACK_SERVICE_SUGGESTIONS);
    } catch (error) {
      logger.error({ error, message: 'Error fetching cached service suggestions' });
      return NextResponse.json(FALLBACK_SERVICE_SUGGESTIONS);
    }
  } catch (error) {
    const status = getErrorStatus(error, 500);
    if (status === 401 || status === 403) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unauthorized' },
        { status }
      );
    }
    logger.error({ error, message: 'Unexpected error in /api/service-suggestions' });
    return NextResponse.json(FALLBACK_SERVICE_SUGGESTIONS);
  }
}
