'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { OfflineImage } from '@/components/offline-image';
import { useRouter, useSearchParams } from 'next/navigation';
import { orderBy, query, Timestamp, where, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import { activitiesCollection, servicesCollection } from '@/lib/collections';
import type { Activity } from '@/lib/types';
import {
  FALLBACK_ACTIVITY_SUGGESTIONS,
  normalizeActivitySuggestions,
  type SuggestedActivities,
} from '@/lib/ai-suggestions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { useToast } from '@/hooks/use-toast';
import { Camera, FileText, Pencil, PlusCircle, RefreshCw, Wand2, Trash2, ArrowRightLeft } from 'lucide-react';
import { endOfYear, format, getYear, startOfYear } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import logger from '@/lib/logger';

async function getAvailableActivityYears(barrioOrg?: string): Promise<number[]> {
  const yearSet = new Set<number>();

  try {
    const constraints: any[] = [orderBy('date', 'desc')];
    if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
    const snapshot = await getDocs(query(activitiesCollection, ...constraints));

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as { date?: Timestamp };
      if (data.date) yearSet.add(getYear(data.date.toDate()));
    });
  } catch (err) {
    logger.error({ error: err, message: 'Error fetching activity years' });
  }

  yearSet.add(getYear(new Date()));

  return Array.from(yearSet).sort((a, b) => b - a);
}

async function getActivitiesForYear(year: number, barrioOrg?: string): Promise<Activity[]> {
  const start = startOfYear(new Date(year, 0, 1));
  const end = endOfYear(new Date(year, 0, 1));

  const startTimestamp = Timestamp.fromDate(start);
  const endTimestamp = Timestamp.fromDate(end);

  const constraints: any[] = [
    where('date', '>=', startTimestamp),
    where('date', '<=', endTimestamp),
    orderBy('date', 'desc')
  ];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));

  const activityQuery = query(
    activitiesCollection,
    ...constraints
  );
  const snapshot = await getDocs(activityQuery);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Activity));
}

export default function ActivitiesPage() {
  const { user, loading: authLoading, barrioOrg, firebaseUser } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState<number[] | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedActivities | null>(null);
  /** Start true so production never flashes the empty/error card before the first fetch. */
  const [isGenerating, setIsGenerating] = useState(true);
  const currentYear = getYear(new Date());
  const yearParam = Number(searchParams.get('year'));
  const selectedYear = Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 2100 ? yearParam : currentYear;
  const yearOptions = (availableYears && availableYears.length > 0)
    ? availableYears.map(String)
    : [String(selectedYear)];

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', year);
    router.replace(`/reports/activities?${params.toString()}`);
  };

  const fetchActivities = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const data = await getActivitiesForYear(selectedYear, barrioOrg);
      setActivities(data);
    } catch (error) {
      logger.error({ error, message: 'Error loading activities for year', year: selectedYear });
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, barrioOrg]);

  useOnManualRefresh(async () => {
    await fetchActivities({ quiet: true });
    return true;
  });

  const handleDelete = async (activityId: string, activityTitle: string) => {
    try {
      await deleteDoc(doc(activitiesCollection, activityId));
      toast({
        title: t('reports.activities.deletedTitle'),
        description: t('reports.activities.deletedDescription'),
      });
      fetchActivities();
    } catch (error) {
      logger.error({ error, message: 'Error deleting activity', activityId });
      toast({
        title: t('common.error'),
        description: t('reports.activities.deleteError'),
        variant: 'destructive',
      });
    }
  };

  const handleTransferToService = async (activity: Activity) => {
    try {
      const { requireBarrioOrg } = await import('@/lib/tenant-scope');
      await addDoc(servicesCollection, {
        title: activity.title,
        date: activity.date,
        description: activity.description,
        time: activity.time || null,
        imageUrls: activity.imageUrls || [],
        councilNotified: false,
        barrioOrg: requireBarrioOrg(barrioOrg),
      });
      await deleteDoc(doc(activitiesCollection, activity.id));
      toast({
        title: t('reports.activities.transferredTitle'),
        description: t('reports.activities.transferredDescription', { title: activity.title }),
      });
      fetchActivities();
    } catch (error) {
      logger.error({ error, message: 'Error transferring activity to service', activityId: activity.id });
      toast({
        title: t('common.error'),
        description: t('reports.activities.transferError'),
        variant: 'destructive',
      });
    }
  };

  const handleGenerateSuggestions = useCallback(async (refresh = false) => {
    setIsGenerating(true);
    try {
      const isProduction =
        typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
      const cacheKey = 'activities_suggestions_cache';
      const cacheTimestampKey = 'activities_suggestions_timestamp';

      if (!refresh && isProduction) {
        try {
          const cachedData = localStorage.getItem(cacheKey);
          const cachedTimestamp = localStorage.getItem(cacheTimestampKey);

          if (cachedData && cachedTimestamp) {
            const cacheAge = Date.now() - Number.parseInt(cachedTimestamp, 10);
            if (!Number.isNaN(cacheAge) && cacheAge < 24 * 60 * 60 * 1000) {
              const normalized = normalizeActivitySuggestions(JSON.parse(cachedData));
              if (normalized) {
                setSuggestions(normalized);
                return;
              }
              localStorage.removeItem(cacheKey);
              localStorage.removeItem(cacheTimestampKey);
            }
          }
        } catch (error) {
          logger.error({ error, message: 'Error loading activity suggestions from cache' });
        }
      }

      const idToken = await firebaseUser?.getIdToken().catch(() => null);
      if (!idToken) {
        // Auth still settling or offline sticky session without token — show fallback, not empty.
        setSuggestions(FALLBACK_ACTIVITY_SUGGESTIONS);
        return;
      }

      const url = refresh ? '/api/suggestions?refresh=true' : '/api/suggestions';
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: AbortSignal.timeout(45_000),
      });

      if (!response.ok) {
        logger.error({
          message: 'Failed to fetch activity suggestions',
          status: response.status,
          statusText: response.statusText,
        });
        setSuggestions(FALLBACK_ACTIVITY_SUGGESTIONS);
        return;
      }

      const result = normalizeActivitySuggestions(await response.json());
      const finalSuggestions = result ?? FALLBACK_ACTIVITY_SUGGESTIONS;
      setSuggestions(finalSuggestions);

      if (isProduction && result) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(result));
          localStorage.setItem(cacheTimestampKey, Date.now().toString());
        } catch (error) {
          logger.error({ error, message: 'Error saving activity suggestions to cache' });
        }
      }
    } catch (error) {
      logger.error({ error, message: 'Error generating activity suggestions' });
      setSuggestions(FALLBACK_ACTIVITY_SUGGESTIONS);
    } finally {
      setIsGenerating(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (authLoading || !user) return;
    fetchActivities();
  }, [authLoading, user, fetchActivities]);

  useEffect(() => {
    if (authLoading || !user || !firebaseUser) return;
    void handleGenerateSuggestions();
  }, [authLoading, user, firebaseUser, handleGenerateSuggestions]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const years = await getAvailableActivityYears(barrioOrg);
        if (cancelled) return;
        setAvailableYears(years);

        if (years.length > 0 && !years.includes(selectedYear)) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('year', String(years[0]));
          router.replace(`/reports/activities?${params.toString()}`);
        }
      } catch (error) {
        if (cancelled) return;
        logger.error({ error, message: 'Error loading available activity years' });
        setAvailableYears([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router, searchParams, selectedYear, barrioOrg]);

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-balance text-fluid-title font-semibold">
          {t('activities.pageTitle')}
        </h1>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          {t('activities.pageDescription')}
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <CardTitle>{t('activities.pageTitle')}</CardTitle>
                <CardDescription>
                  {t('reports.activities.cardDescription', { year: selectedYear })}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-40">
                <Select
                  value={String(selectedYear)}
                  onValueChange={handleYearChange}
                  disabled={availableYears === null}
                >
                  <SelectTrigger aria-label={t('reports.filterByYear')}>
                    <SelectValue placeholder={t('reports.yearPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button asChild>
                <Link href="/reports/add">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('reports.activities.addActivity')}
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.activities.colTitle')}</TableHead>
                  <TableHead>{t('reports.activities.colDate')}</TableHead>
                  <TableHead>{t('reports.activities.colDescription')}</TableHead>
                  <TableHead className="text-right">{t('reports.activities.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 inline-block" /></TableCell>
                    </TableRow>
                  ))
                ) : activities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      {t('reports.activities.noActivities')}
                    </TableCell>
                  </TableRow>
                ) : (
                  activities.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {(item.imageUrls && item.imageUrls.length > 0) ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <span className="font-medium cursor-pointer hover:underline">{item.title}</span>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="max-w-3xl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{item.title}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {format(item.date.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() })}
                                    {item.time && `, ${item.time}`}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <Carousel className="w-full">
                                  <CarouselContent>
                                    {item.imageUrls.map((url, index) => (
                                      <CarouselItem key={index}>
                                        <OfflineImage
                                          src={url}
                                          alt={t('reports.activities.imageAlt', { index: index + 1, title: item.title })}
                                          width={800}
                                          height={600}
                                          className="w-full h-auto object-contain rounded-md"
                                          data-ai-hint="activity photo"
                                        />
                                      </CarouselItem>
                                    ))}
                                  </CarouselContent>
                                  <CarouselPrevious />
                                  <CarouselNext />
                                </Carousel>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t('reports.activities.close')}</AlertDialogCancel>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <span>{item.title}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(item.date.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() })}
                        {item.time && `, ${item.time}`}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <p className="truncate">{item.description}</p>
                        {item.additionalText && (
                           <p className="text-xs text-muted-foreground truncate">
                            {t('reports.activities.additionalText', { text: item.additionalText })}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.imageUrls && item.imageUrls.length > 0 && (
                          <Camera className="h-4 w-4 inline-block mr-2 text-muted-foreground" />
                        )}
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/reports/${item.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleTransferToService(item)}
                          title={t('reports.activities.transferTitle')}
                        >
                          <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title={t('reports.activities.deleteTitle')}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('reports.activities.deleteDialogTitle')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('reports.activities.deleteDialogDescription', { title: item.title })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('reports.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(item.id, item.title)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                {t('reports.activities.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
            ) : activities.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">{t('reports.activities.noActivities')}</p>
            ) : (
              activities.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="flex flex-row items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <CardDescription>
                        {format(item.date.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() })}
                        {item.time && `, ${item.time}`}
                      </CardDescription>
                    </div>
                    <div className="flex items-center">
                      {item.imageUrls && item.imageUrls.length > 0 && (
                        <Camera className="h-4 w-4 inline-block mr-2 text-muted-foreground" />
                      )}
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/reports/${item.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                          onClick={() => handleTransferToService(item)}
                          title={t('reports.activities.transferTitle')}
                        >
                          <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title={t('reports.activities.deleteTitle')}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('reports.activities.deleteDialogTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('reports.activities.deleteDialogDescription', { title: item.title })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                              <AlertDialogCancel>{t('reports.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(item.id, item.title)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                {t('reports.activities.delete')}
                              </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                      {item.additionalText && (
                          <p className="text-xs text-muted-foreground line-clamp-2 pt-1">
                           {t('reports.activities.additionalTextMobile', { text: item.additionalText })}
                         </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-primary" />
              <CardTitle>{t('reports.activities.suggestionsTitle')}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleGenerateSuggestions(true)}
              disabled={isGenerating}
            >
              <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            {t('reports.activities.suggestionsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isGenerating ? (
            <div className="space-y-4">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-5 w-1/3 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : suggestions ? (
            <div className="space-y-4">
              <div>
                 <h3 className="font-semibold mb-2">{t('reports.activities.spiritual')}</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {suggestions.spiritual.map((activity, index) => (
                    <li key={`s-${index}`}>{activity}</li>
                  ))}
                </ul>
              </div>
              <div>
                 <h3 className="font-semibold mb-2">{t('reports.activities.temporal')}</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {suggestions.temporal.map((activity, index) => (
                    <li key={`t-${index}`}>{activity}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-center text-muted-foreground py-8">
              {t('reports.activities.suggestionsError')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
