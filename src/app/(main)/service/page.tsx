
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { query, orderBy, Timestamp, where, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import { servicesCollection, activitiesCollection } from '@/lib/collections';
import type { Service } from '@/lib/types';
import { addDays, endOfYear, format, getYear, isAfter, isBefore, startOfYear } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { useI18n } from "@/contexts/i18n-context";
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { usePermission } from '@/hooks/use-permission';

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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
} from "@/components/ui/alert-dialog";
import { PlusCircle, Trash2, Pencil, Image as ImageIcon, ArrowRightLeft, RefreshCw, Wand2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { OfflineImage } from '@/components/offline-image';
import { cacheImages } from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';

import {
  FALLBACK_SERVICE_SUGGESTIONS,
  normalizeServiceSuggestions,
  type SuggestedServices,
} from '@/lib/ai-suggestions';

async function getServicesForYear(year: number, barrioOrg?: string): Promise<Service[]> {
  try {
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

    const q = query(
      servicesCollection,
      ...constraints
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Service));
  } catch (error) {
    logger.error({ error, message: 'Error fetching services' });
    throw error; // Re-throw to be handled by caller
  }
}

export default function ServicePage() {
  const { user, loading: authLoading, barrioOrg, firebaseUser } = useAuth();
  const { t } = useI18n();
  const { canWrite } = usePermission();
  const searchParams = useSearchParams();
  const [services, setServices] = useState<Service[]>([]);
  const [serviceSuggestions, setServiceSuggestions] = useState<SuggestedServices | null>(null);
  const [loading, setLoading] = useState(true);
  /** Start true so production never flashes the empty/error card before the first fetch. */
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(true);
  const { toast } = useToast();
  
  const currentYear = getYear(new Date());
  const yearParam = Number(searchParams.get('year'));
  const selectedYear = Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 2100 ? yearParam : currentYear;

  const fetchServices = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const data = await getServicesForYear(selectedYear, barrioOrg);
      setServices(data);
      // Prefetch service photos into local Cache Storage for offline viewing
      if (isBrowserOnline()) {
        const urls = data.flatMap((s) => s.imageUrls ?? []);
        void cacheImages(urls, { concurrency: 3, limit: 80 });
      }
    } catch (err) {
      logger.error({ error: err, message: "Failed to fetch services" });
      toast({ title: t('common.error'), description: t('service.loadError'), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedYear, toast, barrioOrg, t]);

  useEffect(() => {
    if (!authLoading && user) {
      queueMicrotask(() => {
        void fetchServices();
      });
    }
  }, [authLoading, fetchServices, user]);

  useOnManualRefresh(async () => {
    await fetchServices({ quiet: true });
    return true;
  });

  const handleDelete = async (serviceId: string, serviceTitle: string) => {
    try {
      await deleteDoc(doc(servicesCollection, serviceId));
      toast({
        title: t('service.deletedTitle'),
        description: t('service.deletedDescription'),
      });
      fetchServices(); // Refresh the list
    } catch (error) {
      logger.error({ error, message: 'Error deleting service', serviceId });
      toast({
        title: t('common.error'),
        description: t('service.deleteError'),
        variant: 'destructive',
      });
    }
  };

  const handleTransferToActivity = async (service: Service) => {
    try {
      await addDoc(activitiesCollection, {
        title: service.title,
        date: service.date,
        description: service.description,
        time: service.time || null,
        imageUrls: service.imageUrls || [],
        barrioOrg,
      });
      await deleteDoc(doc(servicesCollection, service.id));
      toast({
        title: t('service.transferredTitle'),
        description: t('service.transferredDescription', { title: service.title }),
      });
      fetchServices();
    } catch (error) {
      logger.error({ error, message: 'Error transferring service to activity', serviceId: service.id });
      toast({
        title: t('common.error'),
        description: t('service.transferError'),
        variant: 'destructive',
      });
    }
  };

  const handleGenerateServiceSuggestions = useCallback(async (refresh = false) => {
    setIsGeneratingSuggestions(true);
    try {
      const isProduction =
        typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
      const cacheKey = 'service_suggestions_cache';
      const cacheTimestampKey = 'service_suggestions_timestamp';

      if (!refresh && isProduction) {
        try {
          const cachedData = localStorage.getItem(cacheKey);
          const cachedTimestamp = localStorage.getItem(cacheTimestampKey);

          if (cachedData && cachedTimestamp) {
            const cacheAge = Date.now() - Number.parseInt(cachedTimestamp, 10);
            if (!Number.isNaN(cacheAge) && cacheAge < 24 * 60 * 60 * 1000) {
              const normalized = normalizeServiceSuggestions(JSON.parse(cachedData));
              if (normalized) {
                setServiceSuggestions(normalized);
                return;
              }
              localStorage.removeItem(cacheKey);
              localStorage.removeItem(cacheTimestampKey);
            }
          }
        } catch (error) {
          logger.error({ error, message: 'Error loading service suggestions from cache' });
        }
      }

      const idToken = await firebaseUser?.getIdToken().catch(() => null);
      if (!idToken) {
        setServiceSuggestions(FALLBACK_SERVICE_SUGGESTIONS);
        return;
      }

      const response = await fetch(
        refresh ? '/api/service-suggestions?refresh=true' : '/api/service-suggestions',
        {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: AbortSignal.timeout(45_000),
        }
      );
      if (!response.ok) {
        logger.error({
          message: 'Failed to fetch service suggestions',
          status: response.status,
          statusText: response.statusText,
        });
        setServiceSuggestions(FALLBACK_SERVICE_SUGGESTIONS);
        return;
      }

      const result = normalizeServiceSuggestions(await response.json());
      const finalSuggestions = result ?? FALLBACK_SERVICE_SUGGESTIONS;
      setServiceSuggestions(finalSuggestions);

      if (isProduction && result) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(result));
          localStorage.setItem(cacheTimestampKey, Date.now().toString());
        } catch (error) {
          logger.error({ error, message: 'Error saving service suggestions to cache' });
        }
      }
    } catch (error) {
      logger.error({ error, message: 'Error generating service suggestions' });
      setServiceSuggestions(FALLBACK_SERVICE_SUGGESTIONS);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (authLoading || !user || !firebaseUser) return;
    void handleGenerateServiceSuggestions();
  }, [authLoading, handleGenerateServiceSuggestions, user, firebaseUser]);


  const upcomingServices = services.filter(service => {
    const serviceDate = service.date.toDate();
    const today = new Date();
    const fourteenDaysFromNow = addDays(new Date(), 14);
    today.setHours(0,0,0,0); // Start of today
    
    return isAfter(serviceDate, today) && isBefore(serviceDate, fourteenDaysFromNow);
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Wand2 className="h-6 w-6 text-primary" />
              <CardTitle>{t('service.suggestionsTitle')}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleGenerateServiceSuggestions(true)}
              disabled={isGeneratingSuggestions}
              title={t('service.suggestionsRefresh')}
            >
              <RefreshCw className={`h-4 w-4 ${isGeneratingSuggestions ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            {t('service.suggestionsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isGeneratingSuggestions ? (
            <div className="space-y-4">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-5 w-1/3 mt-4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : serviceSuggestions ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">{t('service.suggestionsQuorumCare')}</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {serviceSuggestions.quorumCare.map((service, index) => (
                    <li key={`qc-${index}`}>{service}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">{t('service.suggestionsCommunity')}</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {serviceSuggestions.communityImpact.map((service, index) => (
                    <li key={`ci-${index}`}>{service}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-center text-muted-foreground py-8">
              {t('service.suggestionsError')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
              <CardTitle>{t('service.upcomingTitle')}</CardTitle>
              <CardDescription>
                {t('service.upcomingDescription')}
              </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : upcomingServices.length > 0 ? (
            <ul className="space-y-3">
              {upcomingServices.map(service => (
                <li key={service.id} className="p-3 bg-muted/50 rounded-md">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-semibold">{service.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(service.date.toDate(), t("service.dateLong"), { locale: getDateFnsLocale() })}
                        {service.time ? t('service.atTime', { time: service.time }) : ''} - {service.description}
                      </p>
                    </div>
                    {service.imageUrls && service.imageUrls.length > 0 && (
                      <div className="ml-3 flex items-center gap-1 text-xs text-muted-foreground">
                        <ImageIcon className="h-3 w-3" />
                        {service.imageUrls.length}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-4">
              {t('service.upcomingEmpty')}
            </p>
          )}
        </CardContent>
      </Card>
    
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>{t('service.yearTitle', { year: selectedYear })}</CardTitle>
              <CardDescription>
                {t('service.yearDescription')}
              </CardDescription>
            </div>
            {canWrite && (
            <Button asChild>
                <Link href="/service/add">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {t('service.addService')}
                </Link>
            </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('service.tableTitle')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('service.tableDescription')}</TableHead>
                <TableHead>{t('service.tableDate')}</TableHead>
                <TableHead className="text-center">{t('service.tableImages')}</TableHead>
                <TableHead className="text-right">{t('service.tableActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-8 inline-block" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 inline-block" /></TableCell>
                  </TableRow>
                ))
              ) : services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    {t('service.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                services.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="hidden md:table-cell max-w-sm truncate">{item.description}</TableCell>
                    <TableCell>
                      {format(item.date.toDate(), "d MMM, yyyy", { locale: getDateFnsLocale() })}
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
                              <DialogTitle>{t('service.imagesDialogTitle', { title: item.title })}</DialogTitle>
                              <DialogDescription>
                                {t('service.imagesDialogDescription')}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                              {item.imageUrls.map((url, index) => (
                                <div key={index} className="relative">
                                  <OfflineImage
                                    src={url}
                                    alt={`Imagen ${index + 1} del servicio ${item.title}`}
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
                        <span className="text-muted-foreground text-sm">{t('service.noImages')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                       {canWrite && (
                       <>
                       <Button variant="ghost" size="icon" asChild>
                         <Link href={`/service/${item.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                       </Button>
                       <Button
                         variant="ghost"
                         size="icon"
                         onClick={() => handleTransferToActivity(item)}
                          title={t('service.transferTitle')}
                        >
                          <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                       </Button>
                       <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('service.deleteDialogTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('service.deleteDialogDescription')} <strong>{item.title}</strong>.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('service.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(item.id, item.title)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              {t('service.delete')}
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
            ) : services.length === 0 ? (
                   <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                 {t('service.empty')}
               </div>
            ) : (
              services.map((item) => (
                <div key={item.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(item.date.toDate(), "d MMM, yyyy", { locale: getDateFnsLocale() })}
                        {item.time ? `, ${item.time}` : ''}
                      </p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
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
                      <Link href={`/service/${item.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                    </Button>
                     <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleTransferToActivity(item)} title={t('service.transferTitle')}>
                      <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('service.deleteConfirmTitle')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('service.deleteConfirmBody')} <strong>{item.title}</strong>.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(item.id, item.title)} className="bg-destructive hover:bg-destructive/90">
                            Eliminar
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
    </div>
  );
}
