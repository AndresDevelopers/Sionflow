'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { orderBy, query, Timestamp, where, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import { activitiesCollection, servicesCollection, annotationsCollection } from '@/lib/collections';
import type { Activity, Annotation } from '@/lib/types';
import { VoiceAnnotations } from '@/components/shared/voice-annotations';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OfflineImage } from '@/components/offline-image';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { usePermission } from '@/hooks/use-permission';
import { useToast } from '@/hooks/use-toast';
import { Image as ImageIcon, Pencil, PlusCircle, RefreshCw, Wand2, Trash2, ArrowRightLeft } from 'lucide-react';
import { addDays, endOfYear, format, getYear, isAfter, isBefore, startOfYear } from 'date-fns';
import { getDateFnsLocale } from '@/lib/i18n-date';
import { cacheImages } from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';
import logger from '@/lib/logger';

async function getAvailableActivityYears(barrioOrg?: string): Promise<number[]> {
  const yearSet = new Set<number>();

  try {
    const constraints: any[] = [orderBy('date', 'desc')];
    if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
    const snapshot = await getDocs(query(activitiesCollection, ...constraints));

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as { date?: Timestamp };
      if (data.date) yearSet.add(getYear(data.date.toDate()));
    });
  } catch (err) {
    logger.error({ error: err, message: 'Error fetching activity years' });
  }

  yearSet.add(getYear(new Date()));

  return Array.from(yearSet).sort((a, b) => b - a);
}

async function getActivitiesForYear(year: number, barrioOrg?: string): Promise<Activity[]> {
  try {
    const start = startOfYear(new Date(year, 0, 1));
    const end = endOfYear(new Date(year, 0, 1));

    const startTimestamp = Timestamp.fromDate(start);
    const endTimestamp = Timestamp.fromDate(end);

    const constraints: any[] = [
      where('date', '>=', startTimestamp),
      where('date', '<=', endTimestamp),
      orderBy('date', 'desc'),
    ];
    if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));

    const activityQuery = query(activitiesCollection, ...constraints);
    const snapshot = await getDocs(activityQuery);
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Activity));
  } catch (error) {
    logger.error({ error, message: 'Error fetching activities' });
    throw error;
  }
}

export default function ActivitiesPage() {
  const { user, loading: authLoading, barrioOrg, firebaseUser } = useAuth();
  const { t } = useI18n();
  const { canWrite } = usePermission();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState<number[] | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedActivities | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(true);
  /** Start true so production never flashes the empty/error card before the first fetch. */
  const [isGenerating, setIsGenerating] = useState(true);
  const currentYear = getYear(new Date());
  const yearParam = Number(searchParams.get('year'));
  const selectedYear =
    Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 2100 ? yearParam : currentYear;
  const yearOptions =
    availableYears && availableYears.length > 0
      ? availableYears.map(String)
      : [String(selectedYear)];

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', year);
    router.replace(`/reports/activities?${params.toString()}`);
  };

  const fetchActivities = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setLoading(true);
      try {
        const data = await getActivitiesForYear(selectedYear, barrioOrg);
        setActivities(data);
        // Prefetch activity photos into local Cache Storage for offline viewing
        if (isBrowserOnline()) {
          const urls = data.flatMap((a) => a.imageUrls ?? []);
          void cacheImages(urls, { concurrency: 3, limit: 80 });
        }
      } catch (error) {
        logger.error({ error, message: 'Error loading activities for year', year: selectedYear });
        toast({
          title: t('common.error'),
          description: t('reports.activities.loadError'),
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [selectedYear, barrioOrg, toast, t]
  );

  useEffect(() => {
    if (!authLoading && user) {
      queueMicrotask(() => {
        void fetchActivities();
      });
    }
  }, [authLoading, fetchActivities, user]);

  const fetchAnnotations = useCallback(async (opts?: { quiet?: boolean }) => {
    if (authLoading || !user || !barrioOrg) return;
    if (!opts?.quiet) setLoadingAnnotations(true);
    try {
      const q = query(
        annotationsCollection,
        where('source', '==', 'activities'),
        where('barrioOrg', '==', barrioOrg),
        where('isResolved', '==', false)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Annotation))
        .sort((a, b) => {
          const dateA = a.createdAt?.toMillis?.() ?? 0;
          const dateB = b.createdAt?.toMillis?.() ?? 0;
          return dateB - dateA;
        });
      setAnnotations(data);
    } catch (error) {
      logger.error({ error, message: 'Error loading activity annotations' });
      setAnnotations([]);
    } finally {
      setLoadingAnnotations(false);
    }
  }, [authLoading, user, barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;
    queueMicrotask(() => {
      void fetchAnnotations();
    });
  }, [authLoading, user, fetchAnnotations]);

  useOnManualRefresh(async () => {
    await Promise.all([
      fetchActivities({ quiet: true }),
      fetchAnnotations({ quiet: true }),
    ]);
    return true;
  });

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await deleteDoc(doc(annotationsCollection, id));
      toast({
        title: t('reports.activities.annotations.deletedTitle'),
        description: t('reports.activities.annotations.deletedDescription'),
      });
      fetchAnnotations();
    } catch (error) {
      logger.error({ error, message: 'Error deleting activity annotation', id });
      toast({
        title: t('common.error'),
        description: t('reports.activities.annotations.deleteError'),
        variant: 'destructive',
      });
    }
  };

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
      logger.error({
        error,
        message: 'Error transferring activity to service',
        activityId: activity.id,
      });
      toast({
        title: t('common.error'),
        description: t('reports.activities.transferError'),
        variant: 'destructive',
      });
    }
  };

  const handleGenerateSuggestions = useCallback(
    async (refresh = false) => {
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
    },
    [firebaseUser]
  );

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

  const upcomingActivities = activities.filter((activity) => {
    const activityDate = activity.date.toDate();
    const today = new Date();
    const fourteenDaysFromNow = addDays(new Date(), 14);
    today.setHours(0, 0, 0, 0);

    return isAfter(activityDate, today) && isBefore(activityDate, fourteenDaysFromNow);
  });

  return (
    <div className="space-y-6">
      {/* 1. Sugerencias de IA — mismo orden y estructura que Servicio */}
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
              title={t('reports.activities.suggestionsRefresh')}
            >
              <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>{t('reports.activities.suggestionsDescription')}</CardDescription>
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

      {/* 2. Actividades próximas (14 días) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('reports.activities.upcomingTitle')}</CardTitle>
          <CardDescription>{t('reports.activities.upcomingDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : upcomingActivities.length > 0 ? (
            <ul className="space-y-3">
              {upcomingActivities.map((activity) => (
                <li key={activity.id} className="p-3 bg-muted/50 rounded-md">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-semibold">{activity.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(activity.date.toDate(), t('reports.activities.dateLong'), {
                          locale: getDateFnsLocale(),
                        })}
                        {activity.time
                          ? t('reports.activities.atTime', { time: activity.time })
                          : ''}{' '}
                        - {activity.description}
                      </p>
                    </div>
                    {activity.imageUrls && activity.imageUrls.length > 0 && (
                      <div className="ml-3 flex items-center gap-1 text-xs text-muted-foreground">
                        <ImageIcon className="h-3 w-3" />
                        {activity.imageUrls.length}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-4">
              {t('reports.activities.upcomingEmpty')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. Lista del año (tabla desktop + tarjetas móvil) */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <CardTitle>{t('reports.activities.yearTitle', { year: selectedYear })}</CardTitle>
              <CardDescription>{t('reports.activities.yearDescription')}</CardDescription>
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
              {canWrite && (
                <Button asChild>
                  <Link href="/reports/add">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {t('reports.activities.addActivity')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.activities.colTitle')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('reports.activities.colDescription')}
                  </TableHead>
                  <TableHead>{t('reports.activities.colDate')}</TableHead>
                  <TableHead className="text-center">{t('reports.activities.colImages')}</TableHead>
                  <TableHead className="text-right">{t('reports.activities.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Skeleton className="h-5 w-8 inline-block" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-8 w-8 inline-block" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : activities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      {t('reports.activities.noActivities')}
                    </TableCell>
                  </TableRow>
                ) : (
                  activities.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.title}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-sm truncate">
                        {item.description}
                        {item.additionalText && (
                          <span className="block text-xs text-muted-foreground truncate">
                            {t('reports.activities.additionalText', { text: item.additionalText })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {format(item.date.toDate(), 'd MMM, yyyy', {
                          locale: getDateFnsLocale(),
                        })}
                        {item.time ? `, ${item.time}` : ''}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.imageUrls && item.imageUrls.length > 0 ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="flex items-center gap-1">
                                <ImageIcon className="h-4 w-4" />
                                {item.imageUrls.length}
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl">
                              <DialogHeader>
                                <DialogTitle>
                                  {t('reports.activities.imagesDialogTitle', {
                                    title: item.title,
                                  })}
                                </DialogTitle>
                                <DialogDescription>
                                  {t('reports.activities.imagesDialogDescription')}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                                {item.imageUrls.map((url, index) => (
                                  <div key={index} className="relative">
                                    <OfflineImage
                                      src={url}
                                      alt={t('reports.activities.imageAlt', {
                                        index: index + 1,
                                        title: item.title,
                                      })}
                                      width={200}
                                      height={200}
                                      className="w-full h-32 object-cover rounded-md"
                                    />
                                  </div>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            {t('reports.activities.noImages')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <>
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/reports/${item.id}/edit`}>
                                <Pencil className="h-4 w-4" />
                              </Link>
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
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={t('reports.activities.deleteTitle')}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t('reports.activities.deleteDialogTitle')}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t('reports.activities.deleteDialogDescription', {
                                      title: item.title,
                                    })}
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
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : activities.length === 0 ? (
              <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                {t('reports.activities.noActivities')}
              </div>
            ) : (
              activities.map((item) => (
                <div key={item.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(item.date.toDate(), 'd MMM, yyyy', {
                          locale: getDateFnsLocale(),
                        })}
                        {item.time ? `, ${item.time}` : ''}
                      </p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      {item.additionalText && (
                        <p className="text-xs text-muted-foreground line-clamp-2 pt-1">
                          {t('reports.activities.additionalTextMobile', {
                            text: item.additionalText,
                          })}
                        </p>
                      )}
                    </div>
                    {item.imageUrls && item.imageUrls.length > 0 && (
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        {item.imageUrls.length}
                      </span>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1 pt-1 border-t">
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <Link href={`/reports/${item.id}/edit`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleTransferToService(item)}
                        title={t('reports.activities.transferTitle')}
                      >
                        <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t('reports.activities.deleteTitle')}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t('reports.activities.deleteConfirmTitle')}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('reports.activities.deleteConfirmBody')}{' '}
                              <strong>{item.title}</strong>.
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
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <VoiceAnnotations
        title={t('reports.activities.annotations.title')}
        description={t('reports.activities.annotations.description')}
        source="activities"
        annotations={annotations}
        isLoading={loadingAnnotations}
        onAnnotationAdded={fetchAnnotations}
        onAnnotationToggled={fetchAnnotations}
        onDeleteAnnotation={handleDeleteAnnotation}
        currentUserId={user?.uid}
      />
    </div>
  );
}
