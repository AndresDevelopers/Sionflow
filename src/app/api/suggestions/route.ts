import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { suggestActivities, type SuggestedActivities } from '@/ai/flows/suggest-activities-flow';
import { activitiesCollection } from '@/lib/collections-server';
import logger from '@/lib/logger';
import { getYear } from 'date-fns';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getErrorStatus, requireUidAndBarrioOrg } from '@/lib/api-auth';

type TimestampLike = { toDate(): Date };
type ActivityDoc = { title?: string; date?: TimestampLike };

async function getCurrentYearActivityTitles(barrioOrg: string): Promise<string[]> {
  const snapshot = await activitiesCollection
    .where('barrioOrg', '==', barrioOrg)
    .orderBy('date', 'desc')
    .get();
  const activities = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as ActivityDoc) }));

  return activities
    .filter((a) => Boolean(a.date && getYear(a.date.toDate()) === getYear(new Date())))
    .map((a) => a.title)
    .filter((title): title is string => Boolean(title));
}

function getSuggestionsCached(barrioOrg: string) {
  return unstable_cache(
    async (): Promise<SuggestedActivities> => {
      const currentYearActivities = await getCurrentYearActivityTitles(barrioOrg);
      return suggestActivities({ existingActivities: currentYearActivities });
    },
    [`suggestions-${barrioOrg}`],
    {
      revalidate: 3600,
      tags: ['suggestions', `suggestions-${barrioOrg}`]
    }
  )();
}

const mockSuggestions: SuggestedActivities = {
  spiritual: [
    'Estudio de las Escrituras en grupo',
    'Noche de hogar con enfoque espiritual',
    'Actividad de ayuno y oración'
  ],
  temporal: [
    'Servicio comunitario en un asilo',
    'Actividad deportiva familiar',
    'Taller de autosuficiencia'
  ]
};

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const { barrioOrg } = await requireUidAndBarrioOrg(request);
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    if (refresh) {
      if (process.env.NODE_ENV === 'production') {
        revalidateTag(`suggestions-${barrioOrg}`, 'default');
      }
      try {
        const currentYearActivities = await getCurrentYearActivityTitles(barrioOrg);
        const suggestions = await suggestActivities({ existingActivities: currentYearActivities });
        return NextResponse.json(suggestions);
      } catch (error) {
        logger.error({ error, message: 'Error generating fresh suggestions' });
        return NextResponse.json(mockSuggestions);
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      try {
        const currentYearActivities = await getCurrentYearActivityTitles(barrioOrg);
        const suggestions = await suggestActivities({ existingActivities: currentYearActivities });
        return NextResponse.json(suggestions);
      } catch (error) {
        logger.error({ error, message: 'Error generating suggestions' });
        return NextResponse.json(mockSuggestions);
      }
    }

    try {
      const suggestions = await getSuggestionsCached(barrioOrg);
      return NextResponse.json(suggestions);
    } catch (error) {
      logger.error({ error, message: 'Error fetching cached suggestions' });
      return NextResponse.json(mockSuggestions);
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
    return NextResponse.json(mockSuggestions);
  }
}
