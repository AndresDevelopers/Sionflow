import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { suggestActivities, type SuggestedActivities } from '@/ai/flows/suggest-activities-flow';
import { activitiesCollection } from '@/lib/collections-server';
import logger from '@/lib/logger';
import { getYear } from 'date-fns';

type TimestampLike = { toDate(): Date };
type ActivityDoc = { title?: string; date?: TimestampLike };

async function getCurrentYearActivityTitles(): Promise<string[]> {
  const snapshot = await activitiesCollection.orderBy('date', 'desc').get();
  const activities = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as ActivityDoc) }));

  return activities
    .filter((a) => Boolean(a.date && getYear(a.date.toDate()) === getYear(new Date())))
    .map((a) => a.title)
    .filter((title): title is string => Boolean(title));
}

const getSuggestionsCached = unstable_cache(
  async (): Promise<SuggestedActivities> => {
    const currentYearActivities = await getCurrentYearActivityTitles();
    return suggestActivities({ existingActivities: currentYearActivities });
  },
  ['suggestions'],
  {
    revalidate: 3600, // 1 hour
    tags: ['suggestions']
  }
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  // If refresh is requested, revalidate and get fresh data
  if (refresh) {
    if (process.env.NODE_ENV === 'production') {
      revalidateTag('suggestions', 'default');
    }
    // Always get fresh data when refresh is requested
    try {
      const currentYearActivities = await getCurrentYearActivityTitles();
      const suggestions = await suggestActivities({ existingActivities: currentYearActivities });
      return NextResponse.json(suggestions);
    } catch (error) {
      logger.error({ error, message: 'Error generating fresh suggestions' });
      const mockSuggestions = {
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

      return NextResponse.json(mockSuggestions);
    }
  }

  // Only use cache in production
  if (process.env.NODE_ENV !== 'production') {
    try {
      const currentYearActivities = await getCurrentYearActivityTitles();
      const suggestions = await suggestActivities({ existingActivities: currentYearActivities });
      return NextResponse.json(suggestions);
    } catch (error) {
      logger.error({ error, message: 'Error generating suggestions' });
      const mockSuggestions = {
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

      return NextResponse.json(mockSuggestions);
    }
  }

  try {
    const suggestions = await getSuggestionsCached();
    return NextResponse.json(suggestions);
  } catch (error) {
    logger.error({ error, message: 'Error fetching cached suggestions' });
    const mockSuggestions = {
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

    return NextResponse.json(mockSuggestions);
  }
}
