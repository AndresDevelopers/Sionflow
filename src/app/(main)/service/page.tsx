
'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getDocs, query, orderBy, Timestamp, where, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { servicesCollection, activitiesCollection } from '@/lib/collections';
import type { Service } from '@/lib/types';
import { addDays, endOfYear, format, getYear, isAfter, isBefore, startOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';

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
import Image from 'next/image';

type SuggestedServices = {
  quorumCare: string[];
  communityImpact: string[];
};


async function getServicesForYear(year: number): Promise<Service[]> {
  try {
    const start = startOfYear(new Date(year, 0, 1));
    const end = endOfYear(new Date(year, 0, 1));

    const startTimestamp = Timestamp.fromDate(start);
    const endTimestamp = Timestamp.fromDate(end);

    const q = query(
      servicesCollection,
      where('date', '>=', startTimestamp),
      where('date', '<=', endTimestamp),
      orderBy('date', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Service));
  } catch (error) {
    logger.error({ error, message: 'Error fetching services' });
    throw error; // Re-throw to be handled by caller
  }
}

export default function ServicePage() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const [services, setServices] = useState<Service[]>([]);
  const [serviceSuggestions, setServiceSuggestions] = useState<SuggestedServices | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingSuggestions, startGeneratingSuggestions] = useTransition();
  const { toast } = useToast();
  
  const currentYear = getYear(new Date());
  const yearParam = Number(searchParams.get('year'));
  const selectedYear = Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 2100 ? yearParam : currentYear;

  const fetchServices = useCallback(() => {
    setLoading(true);
    getServicesForYear(selectedYear)
        .then(data => {
            setServices(data);
        })
        .catch(err => {
            logger.error({ error: err, message: "Failed to fetch services" });
            toast({ title: "Error", description: "No se pudieron cargar los servicios.", variant: "destructive" });
        })
        .finally(() => {
            setLoading(false);
        });
  }, [selectedYear, toast]);

  useEffect(() => {
    if (!authLoading && user) {
      queueMicrotask(() => fetchServices());
    }
  }, [authLoading, fetchServices, user]);

  const handleDelete = async (serviceId: string, serviceTitle: string) => {
    try {
      await deleteDoc(doc(servicesCollection, serviceId));
      toast({
        title: 'Servicio Eliminado',
        description: 'El registro ha sido eliminado exitosamente.',
      });
      fetchServices(); // Refresh the list
    } catch (error) {
      logger.error({ error, message: 'Error deleting service', serviceId });
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el servicio.',
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
      });
      await deleteDoc(doc(servicesCollection, service.id));
      toast({
        title: 'Transferido a Actividades',
        description: `El servicio "${service.title}" ha sido transferido a Actividades y eliminado de Servicios.`,
      });
      fetchServices();
    } catch (error) {
      logger.error({ error, message: 'Error transferring service to activity', serviceId: service.id });
      toast({
        title: 'Error',
        description: 'No se pudo transferir el servicio a Actividades.',
        variant: 'destructive',
      });
    }
  };

  const handleGenerateServiceSuggestions = useCallback((refresh = false) => {
    startGeneratingSuggestions(async () => {
      try {
        const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
        const cacheKey = 'service_suggestions_cache';
        const cacheTimestampKey = 'service_suggestions_timestamp';

        if (!refresh && isProduction) {
          const cachedData = localStorage.getItem(cacheKey);
          const cachedTimestamp = localStorage.getItem(cacheTimestampKey);

          if (cachedData && cachedTimestamp) {
            const cacheAge = Date.now() - Number.parseInt(cachedTimestamp, 10);
            if (!Number.isNaN(cacheAge) && cacheAge < 24 * 60 * 60 * 1000) {
              setServiceSuggestions(JSON.parse(cachedData) as SuggestedServices);
              return;
            }
          }
        }

        const response = await fetch(refresh ? '/api/service-suggestions?refresh=true' : '/api/service-suggestions');
        if (!response.ok) {
          throw new Error(`Failed to fetch service suggestions: ${response.status} ${response.statusText}`);
        }
        const result = (await response.json()) as SuggestedServices;
        setServiceSuggestions(result);

        if (isProduction) {
          localStorage.setItem(cacheKey, JSON.stringify(result));
          localStorage.setItem(cacheTimestampKey, Date.now().toString());
        }
      } catch (error) {
        logger.error({ error, message: 'Error generating service suggestions' });
        setServiceSuggestions(null);
      }
    });
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      queueMicrotask(() => handleGenerateServiceSuggestions());
    }
  }, [authLoading, handleGenerateServiceSuggestions, user]);


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
              <CardTitle>Sugerencias de Servicios</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleGenerateServiceSuggestions(true)}
              disabled={isGeneratingSuggestions}
            >
              <RefreshCw className={`h-4 w-4 ${isGeneratingSuggestions ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            Ideas generadas por IA para el próximo mes, basadas en servicios y actividades actuales.
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
                <h3 className="font-semibold mb-2">Apoyo al Quórum</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {serviceSuggestions.quorumCare.map((service, index) => (
                    <li key={`qc-${index}`}>{service}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">Impacto Comunitario</h3>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {serviceSuggestions.communityImpact.map((service, index) => (
                    <li key={`ci-${index}`}>{service}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-center text-muted-foreground py-8">
              No se pudieron generar sugerencias de servicios en este momento.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Próximos Servicios</CardTitle>
          <CardDescription>
            Proyectos de servicio planeados para los próximos 14 días.
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
                        {format(service.date.toDate(), "'El' d 'de' LLLL", { locale: es })}
                        {service.time ? ` a las ${service.time}` : ''} - {service.description}
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
              No hay servicios programados para los próximos 14 días.
            </p>
          )}
        </CardContent>
      </Card>
    
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Servicios del Año {selectedYear}</CardTitle>
              <CardDescription>
                Proyectos de servicio registrados en el año seleccionado.
              </CardDescription>
            </div>
            <Button asChild>
                <Link href="/service/add">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Servicio
                </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead className="hidden md:table-cell">Descripción</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-center">Imágenes</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
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
                    No hay servicios registrados.
                  </TableCell>
                </TableRow>
              ) : (
                services.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="hidden md:table-cell max-w-sm truncate">{item.description}</TableCell>
                    <TableCell>
                      {format(item.date.toDate(), "d MMM, yyyy", { locale: es })}
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
                              <DialogTitle>Imágenes del Servicio: {item.title}</DialogTitle>
                              <DialogDescription>
                                Imágenes relacionadas con este proyecto de servicio.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                              {item.imageUrls.map((url, index) => (
                                <div key={index} className="relative">
                                  <Image
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
                        <span className="text-muted-foreground text-sm">Sin imágenes</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                       <Button variant="ghost" size="icon" asChild>
                         <Link href={`/service/${item.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                       </Button>
                       <Button
                         variant="ghost"
                         size="icon"
                         onClick={() => handleTransferToActivity(item)}
                         title="Transferir a Actividades"
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
                            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer. Esto eliminará permanentemente el servicio: <strong>{item.title}</strong>.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(item.id, item.title)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              Eliminar
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
        </CardContent>
      </Card>
    </div>
  );
}
