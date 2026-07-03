import { NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getYear } from 'date-fns';
import { suggestServices, type SuggestedServices } from '@/ai/flows/suggest-services-flow';
import { activitiesCollection, servicesCollection } from '@/lib/collections-server';
import logger from '@/lib/logger';

type TimestampLike = { toDate(): Date };
type ServiceDoc = { title?: string; date?: TimestampLike };
type ActivityDoc = { title?: string; date?: TimestampLike };

async function getCurrentYearContext(): Promise<{ services: string[]; activities: string[] }> {
  const [servicesSnapshot, activitiesSnapshot] = await Promise.all([
    servicesCollection.orderBy('date', 'desc').get(),
    activitiesCollection.orderBy('date', 'desc').get(),
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
}

const getServiceSuggestionsCached = unstable_cache(
  async (): Promise<SuggestedServices> => {
    const context = await getCurrentYearContext();
    return suggestServices({
      existingServices: context.services,
      existingActivities: context.activities,
    });
  },
  ['service-suggestions'],
  {
    revalidate: 3600,
    tags: ['service-suggestions'],
  }
);

const fallbackSuggestions: SuggestedServices = {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  if (refresh) {
    if (process.env.NODE_ENV === 'production') {
      revalidateTag('service-suggestions', 'default');
    }
    try {
      const context = await getCurrentYearContext();
      const suggestions = await suggestServices({
        existingServices: context.services,
        existingActivities: context.activities,
      });
      return NextResponse.json(suggestions);
    } catch (error) {
      logger.error({ error, message: 'Error generating fresh service suggestions' });
      return NextResponse.json(fallbackSuggestions);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    try {
      const context = await getCurrentYearContext();
      const suggestions = await suggestServices({
        existingServices: context.services,
        existingActivities: context.activities,
      });
      return NextResponse.json(suggestions);
    } catch (error) {
      logger.error({ error, message: 'Error generating service suggestions (dev)' });
      return NextResponse.json(fallbackSuggestions);
    }
  }

  try {
    const suggestions = await getServiceSuggestionsCached();
    return NextResponse.json(suggestions);
  } catch (error) {
    logger.error({ error, message: 'Error fetching cached service suggestions' });
    return NextResponse.json(fallbackSuggestions);
  }
}
