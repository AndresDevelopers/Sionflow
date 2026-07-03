'use client';

import { useEffect, useState, useTransition, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getDocs, query, orderBy, Timestamp, where, doc, setDoc, getDoc } from 'firebase/firestore';
import { baptismsCollection, futureMembersCollection, convertsCollection, annualReportsCollection, membersCollection } from '@/lib/collections';
import type { Baptism, Convert, AnnualReportAnswers, Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
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
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FileText, Droplets, RefreshCw, Save, Camera, Eye } from 'lucide-react';
import { format, getYear, startOfYear, endOfYear } from 'date-fns';
import { es } from 'date-fns/locale';
import { saveAs } from 'file-saver';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function base64ToDocxBlob(base64: string): Blob {
  const sanitized = base64.replaceAll(/\s/g, '');
  const bytes = Uint8Array.from(atob(sanitized), (char) => char.codePointAt(0) ?? 0);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function countNonEmptyUrls(urls: unknown): number {
  if (!Array.isArray(urls)) return 0;
  return urls.filter((url) => typeof url === 'string' && url.trim() !== '').length;
}

function pickPreferredBaptism(
  existing: Baptism | undefined,
  candidate: Baptism,
  sourcePriority: Record<string, number>
): Baptism {
  if (!existing) return candidate;

  const existingPhotos = countNonEmptyUrls(existing.baptismPhotos);
  const candidatePhotos = countNonEmptyUrls(candidate.baptismPhotos);

  if (candidatePhotos !== existingPhotos) {
    return candidatePhotos > existingPhotos ? candidate : existing;
  }

  const existingPriority = sourcePriority[existing.source] ?? Number.MAX_SAFE_INTEGER;
  const candidatePriority = sourcePriority[candidate.source] ?? Number.MAX_SAFE_INTEGER;

  if (candidatePriority !== existingPriority) {
    return candidatePriority < existingPriority ? candidate : existing;
  }

  return existing;
}

async function getAvailableReportYears(): Promise<number[]> {
  const [
    manualBaptismsSnapshot,
    convertsSnapshot,
    futureMembersSnapshot,
    membersSnapshot,
  ] = await Promise.all([
    getDocs(query(baptismsCollection, orderBy('date', 'desc'))),
    getDocs(convertsCollection),
    getDocs(futureMembersCollection),
    getDocs(membersCollection),
  ]);

  const yearSet = new Set<number>();

  for (const doc of manualBaptismsSnapshot.docs) {
    const data = doc.data() as { date?: Timestamp };
    if (data.date) yearSet.add(getYear(data.date.toDate()));
  }

  for (const doc of convertsSnapshot.docs) {
    const data = doc.data() as { baptismDate?: Timestamp };
    if (data.baptismDate) yearSet.add(getYear(data.baptismDate.toDate()));
  }

  for (const doc of futureMembersSnapshot.docs) {
    const data = doc.data() as { baptismDate?: Timestamp };
    if (data.baptismDate) yearSet.add(getYear(data.baptismDate.toDate()));
  }

  for (const doc of membersSnapshot.docs) {
    const data = doc.data() as { baptismDate?: Timestamp; status?: unknown };
    if (normalizeMemberStatus(data.status) !== 'deceased') {
      if (data.baptismDate) yearSet.add(getYear(data.baptismDate.toDate()));
    }
  }

  yearSet.add(getYear(new Date()));

  return Array.from(yearSet).sort((a, b) => b - a);
}

async function getBaptismsForYear(year: number): Promise<Baptism[]> {
  const start = startOfYear(new Date(year, 0, 1));
  const end = endOfYear(new Date(year, 0, 1));

  const startTimestamp = Timestamp.fromDate(start);
  const endTimestamp = Timestamp.fromDate(end);

  // 4. Obtener todos los miembros para mapear o filtrar
  const allMembersSnapshot = await getDocs(membersCollection);
  const allMembersList = allMembersSnapshot.docs.map(doc => {
    const data = doc.data() as Member;
    return { ...data, id: doc.id };
  });

  const findMemberId = (name: string) => {
    const normalized = name.trim().toLowerCase();
    const found = allMembersList.find(m => `${m.firstName || ''} ${m.lastName || ''}`.trim().toLowerCase() === normalized);
    return found ? found.id : undefined;
  };

  // 1. Obtener de futuros miembros
  const futureMembersQuery = query(
    futureMembersCollection,
    where('baptismDate', '>=', startTimestamp),
    where('baptismDate', '<=', endTimestamp)
  );
  const fmSnapshot = await getDocs(futureMembersQuery);
  const fromFutureMembers = fmSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      date: data.baptismDate,
      source: 'Futuro Miembro',
      photoURL: data.photoURL,
      baptismPhotos: data.baptismPhotos || [],
      memberId: findMemberId(data.name)
    } as Baptism
  });

  // 2. Obtener de nuevos conversos
  const convertsQuery = query(
    convertsCollection,
    where('baptismDate', '>=', startTimestamp),
    where('baptismDate', '<=', endTimestamp)
  );
  const convertsSnapshot = await getDocs(convertsQuery);
  const fromConverts = convertsSnapshot.docs.map(doc => {
    const data = doc.data() as Convert & { baptismPhotos?: string[] };
    return {
      id: doc.id,
      name: data.name,
      date: data.baptismDate,
      source: 'Nuevo Converso',
      photoURL: data.photoURL,
      baptismPhotos: data.baptismPhotos || [],
      memberId: data.memberId || findMemberId(data.name)
    } as Baptism
  });

  // 3. Obtener bautismos manuales
  const baptismsQuery = query(
    baptismsCollection,
    where('date', '>=', startTimestamp),
    where('date', '<=', endTimestamp)
  );
  const bSnapshot = await getDocs(baptismsQuery);
  const fromManual = bSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      date: data.date,
      source: 'Manual',
      photoURL: data.photoURL,
      baptismPhotos: data.baptismPhotos || [],
      memberId: data.memberId || findMemberId(data.name)
    } as Baptism
  });

  // 4. Filtrar miembros bautizados en el año actual
  const fromMembers = allMembersList
    .filter(data => {
      if (normalizeMemberStatus(data.status) === 'deceased') return false;
      if (!data.baptismDate) return false;
      const bDateMillis = data.baptismDate.toMillis();
      return bDateMillis >= startTimestamp.toMillis() && bDateMillis <= endTimestamp.toMillis();
    })
    .map(data => ({
      id: data.id,
      name: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      date: data.baptismDate,
      source: 'Automático',
      photoURL: data.photoURL,
      baptismPhotos: data.baptismPhotos || [],
      memberId: data.id
    } as Baptism));

  const allBaptisms = [...fromFutureMembers, ...fromConverts, ...fromManual, ...fromMembers]
    .filter((b) => b.date);

  const sourcePriority: Record<string, number> = {
    Manual: 1,
    'Nuevo Converso': 2,
    'Futuro Miembro': 3,
    Automático: 4,
  };

  const baptismMap = new Map<string, Baptism>();
  for (const baptism of allBaptisms) {
    const normalizedName = baptism.name.trim().toLowerCase().replaceAll(/\s+/g, ' ');
    const dateKey = baptism.date.toDate().toISOString().split('T')[0];
    const key = `${normalizedName}|${dateKey}`;

    const existing = baptismMap.get(key);
    const preferred = pickPreferredBaptism(existing, baptism, sourcePriority);
    if (preferred !== existing) {
      baptismMap.set(key, preferred);
    }
  }

  return Array.from(baptismMap.values()).sort((a, b) => b.date.toMillis() - a.date.toMillis());
}

async function getAnnualReportAnswers(year: number): Promise<AnnualReportAnswers | null> {
  const docRef = doc(annualReportsCollection, String(year));
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data() as AnnualReportAnswers;
  }
  return null;
}

const reportQuestions = [
  { id: 'p1', label: 'Describir los esfuerzos por ayudar a los miembros a vivir el Evangelio de Jesucristo.' },
  { id: 'p2', label: 'Cómo apoyó su organización a la Obra Misional en su barrio o rama.' },
  { id: 'p3', label: 'Describir los esfuerzos por cuidar de los pobres y necesitados (no utilice nombres sin permiso).' },
  { id: 'p4', label: 'Describir como su organización apoyo los esfuerzos por ayudar a los miembros a investigar su historia familiar.' },
  { id: 'p5', label: 'Como secretario, describa cómo usted ha sentido la inspiración del Señor y cómo ha sentido la mano de Dios el Padre guiando sus esfuerzos.' },
  { id: 'p6', label: 'Describa la información adicional que usted sienta que es importante incluir en este informe.' },
];

export default function ReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [baptisms, setBaptisms] = useState<Baptism[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGeneratingReport, startGeneratingReport] = useTransition();
  const [photosModalOpen, setPhotosModalOpen] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [selectedBaptismName, setSelectedBaptismName] = useState<string>("");
  const [availableYears, setAvailableYears] = useState<number[] | null>(null);
  const currentYear = getYear(new Date());
  const yearParam = Number(searchParams.get('year'));
  const selectedYear = Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 2100 ? yearParam : currentYear;
  const yearOptions = (availableYears && availableYears.length > 0)
    ? availableYears.map(String)
    : [String(selectedYear)];

  const handleYearChange = (year: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', year);
    router.replace(`/reports?${params.toString()}`);
  };

  const [answers, setAnswers] = useState<Partial<AnnualReportAnswers>>({});
  const [loadingAnswers, setLoadingAnswers] = useState(true);

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setLoadingAnswers(true);

    const [baptismsData, answersData] = await Promise.all([
      getBaptismsForYear(selectedYear),
      getAnnualReportAnswers(selectedYear)
    ]);

    setBaptisms(baptismsData);
    if (answersData) {
      setAnswers(answersData);
    }
    setLoading(false);
    setLoadingAnswers(false);

    return baptismsData;
  }, [selectedYear]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await fetchInitialData();
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, fetchInitialData]);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const years = await getAvailableReportYears();
        if (cancelled) return;
        setAvailableYears(years);

        if (years.length > 0 && !years.includes(selectedYear)) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('year', String(years[0]));
          router.replace(`/reports?${params.toString()}`);
        }
      } catch (error) {
        if (cancelled) return;
        logger.error({ error, message: 'Error loading available report years' });
        setAvailableYears([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, router, searchParams, selectedYear]);



  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSaveAnswers = async () => {
    try {
      const docRef = doc(annualReportsCollection, String(selectedYear));
      await setDoc(docRef, answers, { merge: true });
      toast({ title: 'Éxito', description: 'Respuestas guardadas correctamente.' });
    } catch (error) {
      logger.error({ error, message: 'Error saving annual report answers' });
      toast({ title: 'Error', description: 'No se pudieron guardar las respuestas.', variant: 'destructive' });
    }
  };

  const generateReportForYear = async (year: number) => {
    startGeneratingReport(async () => {
      try {
        const functions = getFunctions();
        const generateCompleteReportCallable = httpsCallable(functions, 'generateCompleteReport');
        const result = await generateCompleteReportCallable({
          year,
          includeAllActivities: false
        });

        const data = result.data as { fileContents: string };
        const blob = base64ToDocxBlob(data.fileContents);

        saveAs(blob, `Reporte_Completo_${year}.docx`);
        toast({ title: "Éxito", description: "El reporte completo se ha generado correctamente." });

      } catch (error) {
        logger.error({ error, message: "Error calling generateCompleteReport cloud function" });

        // Fallback a la función anterior si la nueva falla
        try {
          const functions = getFunctions();
          const generateReportCallable = httpsCallable(functions, 'generateReport');
          const result = await generateReportCallable({
            year,
            includeAllActivities: false
          });

          const data = result.data as { fileContents: string };
          const blob = base64ToDocxBlob(data.fileContents);

          saveAs(blob, `Reporte_Anual_${year}.docx`);
          toast({ title: "Éxito", description: "El reporte se ha generado correctamente (versión anterior)." });
        } catch (fallbackError) {
          logger.error({ error: fallbackError, message: "Error calling fallback generateReport cloud function" });
          toast({
            title: "Error al Generar Reporte",
            description: "No se pudo generar el reporte. Verifica la consola para más detalles.",
            variant: "destructive",
            duration: 9000
          });
        }
      }
    });
  };

  const openPhotosModal = (photos: string[], name: string) => {
    setSelectedPhotos(photos);
    setSelectedBaptismName(name);
    setPhotosModalOpen(true);
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <CardTitle>Informe Anual {selectedYear}</CardTitle>
                <CardDescription>
                  Compila la información para el informe anual del quórum.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <Select value={String(selectedYear)} onValueChange={handleYearChange} disabled={availableYears === null}>
                  <SelectTrigger aria-label="Filtrar por año">
                    <SelectValue placeholder="Año" />
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
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={isGeneratingReport}>
                    {isGeneratingReport ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Generando...</> : <><Download className="mr-2 h-4 w-4" />Descargar Reporte</>}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Descargar reporte</AlertDialogTitle>
                    <AlertDialogDescription>
                      Elige el año del informe que deseas descargar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="grid gap-2">
                    <AlertDialogAction
                      className="w-full h-11"
                      disabled={isGeneratingReport}
                      onClick={() => generateReportForYear(currentYear)}
                    >
                      Año actual ({currentYear})
                    </AlertDialogAction>
                    <AlertDialogAction
                      className="w-full h-11"
                      disabled={isGeneratingReport}
                      onClick={() => generateReportForYear(currentYear - 1)}
                    >
                      Año pasado ({currentYear - 1})
                    </AlertDialogAction>
                    <AlertDialogCancel className="w-full h-11">
                      Cancelar
                    </AlertDialogCancel>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loadingAnswers ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            reportQuestions.map(q => (
              <div key={q.id} className="space-y-2">
                <Label htmlFor={q.id} className="font-semibold">{q.label}</Label>
                <Textarea
                  id={q.id}
                  value={(answers as any)[q.id] || ''}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                  rows={4}
                />
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="flex justify-end">
          <Button onClick={handleSaveAnswers}><Save className="mr-2 h-4 w-4" /> Guardar Respuestas</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <Droplets className="h-8 w-8 text-primary" />
              <div>
                <CardTitle>Bautismos del Año {selectedYear}</CardTitle>
                <CardDescription>
                  Lista de miembros bautizados en el año seleccionado.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Fecha de Bautismo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  if (loading) {
                    return [1, 2].map((num) => (
                      <TableRow key={`skeleton-row-${num}`}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-8 w-8 inline-block" /></TableCell>
                      </TableRow>
                    ));
                  }

                  if (baptisms.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={3} className="h-24 text-center">
                          No hay miembros bautizados registrados para este año.
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return baptisms.map((item) => {
                    const hasLink = item.memberId;
                    const hasPhotos = item.baptismPhotos && item.baptismPhotos.length > 0;

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{format(item.date.toDate(), 'd LLLL yyyy', { locale: es })}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {hasLink ? (
                              <Button variant="ghost" size="icon" asChild>
                                <Link href={`/members/${item.memberId}`}>
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                            ) : null}
                            {hasPhotos ? (
                              <Button variant="ghost" size="icon" onClick={() => openPhotosModal(item.baptismPhotos || [], item.name)}>
                                <Camera className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  });
                })()}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {(() => {
              if (loading) {
                return [1].map((num) => <Skeleton key={`skeleton-card-${num}`} className="h-24 w-full" />);
              }

              if (baptisms.length === 0) {
                return <p className="text-center text-sm text-muted-foreground py-8">No hay miembros bautizados registrados.</p>;
              }

              return baptisms.map((item) => {
                const hasLink = item.memberId;
                const hasPhotos = item.baptismPhotos && item.baptismPhotos.length > 0;

                return (
                  <Card key={item.id}>
                    <CardContent className="pt-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold">{item.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(item.date.toDate(), 'd LLLL yyyy', { locale: es })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {hasLink ? (
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/members/${item.memberId}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                          ) : null}
                          {hasPhotos ? (
                            <Button variant="ghost" size="icon" onClick={() => openPhotosModal(item.baptismPhotos || [], item.name)}>
                              <Camera className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              });
            })()}
          </div>
        </CardContent>
      </Card>

      <Dialog open={photosModalOpen} onOpenChange={setPhotosModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fotos de Bautismo - {selectedBaptismName}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto">
            {selectedPhotos.map((url, index) => (
              <div key={url} className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Foto de bautismo ${index + 1}`}
                  className="rounded-md object-cover max-h-96 w-auto"
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
