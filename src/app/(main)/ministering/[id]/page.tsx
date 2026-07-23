'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { getDoc, getDocs } from '@/lib/firestore-query';
import {
  ministeringCollection,
  ministeringDistrictsCollection,
  ministeringInterviewsCollection,
} from '@/lib/collections';
import type { Companionship, Family, MinisteringDistrict, MinisteringInterview } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import Link from 'next/link';
import { removeMinisteringTeachersFromFamilies } from '@/lib/ministering-reverse-sync';
import { format } from 'date-fns';
import { getDateFnsLocale } from '@/lib/i18n-date';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Textarea } from '@/components/ui/textarea';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft,
  CalendarClock,
  CalendarIcon,
  CheckCircle2,
  Edit,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react';
import { CompanionshipForm } from '../CompanionshipForm';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

function getInterviewAttendees(interview: MinisteringInterview): string[] {
  if (Array.isArray(interview.intervieweeNames) && interview.intervieweeNames.length > 0) {
    return interview.intervieweeNames.map((n) => n.trim()).filter(Boolean);
  }
  if (interview.intervieweeName?.trim()) {
    return [interview.intervieweeName.trim()];
  }
  return [];
}

function isInterviewCompleted(interview: MinisteringInterview): boolean {
  return interview.status === 'completed';
}

export default function ManageCompanionshipPage() {
  const router = useRouter();
  const params = useParams();
  const { barrioOrg, user } = useAuth();
  const { canWrite } = usePermission();
  const { id } = params;
  const { toast } = useToast();
  const { t } = useI18n();

  const [companionship, setCompanionship] = useState<Companionship | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [isInterviewDialogOpen, setIsInterviewDialogOpen] = useState(false);
  const [editingInterviewId, setEditingInterviewId] = useState<string | null>(null);
  const [interviewDate, setInterviewDate] = useState<Date | undefined>(undefined);
  const [interviewTime, setInterviewTime] = useState('');
  const [selectedInterviewees, setSelectedInterviewees] = useState<string[]>([]);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | undefined>(undefined);
  const [isSchedulingInterview, setIsSchedulingInterview] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [interviewToComplete, setInterviewToComplete] = useState<MinisteringInterview | null>(null);
  const [completeObservation, setCompleteObservation] = useState('');
  const [isCompletingInterview, setIsCompletingInterview] = useState(false);
  const [interviews, setInterviews] = useState<MinisteringInterview[]>([]);
  const [loadingInterviews, setLoadingInterviews] = useState(false);

  const companionshipId = Array.isArray(id) ? id[0] : id;

  const companionshipName = useMemo(() => {
    if (!companionship?.companions?.length) return '';
    return companionship.companions.join(t('ministering.and'));
  }, [companionship, t]);

  const fetchCompanionship = useCallback(async () => {
    if (!companionshipId) return;

    setLoading(true);
    const docRef = doc(ministeringCollection, companionshipId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = { id: docSnap.id, ...docSnap.data() } as Companionship;
      setCompanionship(data);
      setFamilies(data.families);
    } else {
      toast({
        title: t('ministering.error'),
        description: t('ministering.companionshipNotFound'),
        variant: 'destructive',
      });
      router.push('/ministering');
    }
    setLoading(false);
  }, [companionshipId, router, toast, t]);

  const fetchInterviews = useCallback(async () => {
    if (!companionshipId || !barrioOrg) return;
    setLoadingInterviews(true);
    try {
      // Todas las entrevistas del compañerismo (programadas y completadas)
      const snap = await getDocs(
        query(
          ministeringInterviewsCollection,
          where('barrioOrg', '==', barrioOrg),
          where('companionshipId', '==', companionshipId),
          orderBy('date', 'asc'),
        ),
      );
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as MinisteringInterview,
      );
      // Programadas primero (por fecha), luego completadas (más recientes arriba)
      list.sort((a, b) => {
        const aDone = isInterviewCompleted(a) ? 1 : 0;
        const bDone = isInterviewCompleted(b) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const aMs = a.date?.toDate?.()?.getTime?.() ?? 0;
        const bMs = b.date?.toDate?.()?.getTime?.() ?? 0;
        return aDone ? bMs - aMs : aMs - bMs;
      });
      setInterviews(list);
    } catch (error) {
      logger.error({ error, message: 'Error loading ministering interviews' });
    } finally {
      setLoadingInterviews(false);
    }
  }, [companionshipId, barrioOrg]);

  useEffect(() => {
    fetchCompanionship();
  }, [fetchCompanionship]);

  useEffect(() => {
    fetchInterviews();
  }, [fetchInterviews]);

  const handleFamilyChange = (index: number, field: keyof Family, value: unknown) => {
    const updatedFamilies = [...families];
    (updatedFamilies[index] as Record<string, unknown>)[field] = value;
    setFamilies(updatedFamilies);
  };

  const handleSaveChanges = async () => {
    if (!companionshipId) return;
    setIsSaving(true);
    try {
      const docRef = doc(ministeringCollection, companionshipId);
      await updateDoc(docRef, { families });
      toast({ title: t('ministering.success'), description: t('ministering.changesSaved') });
    } catch (error) {
      logger.error({ error, message: 'Error saving companionship changes' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.saveChangesError'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!companionshipId || !companionship) return;
    try {
      const companionNames = companionship.companions || [];
      const familyNames = companionship.families.map((f) => f.name);

      await removeMinisteringTeachersFromFamilies(companionNames, familyNames, barrioOrg);

      await deleteDoc(doc(ministeringCollection, companionshipId));

      toast({
        title: t('ministering.companionshipDeletedTitle'),
        description: t('ministering.companionshipDeletedDescription'),
      });
      router.push('/ministering');
    } catch (error) {
      logger.error({ error, message: 'Error deleting companionship' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.deleteCompanionshipError'),
        variant: 'destructive',
      });
    }
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    startTransition(async () => {
      await fetchCompanionship();
    });
  };

  const companionOptions = useMemo(() => {
    const names = (companionship?.companions ?? [])
      .map((name) => name.trim())
      .filter(Boolean);
    // Unique while preserving order
    return Array.from(new Set(names));
  }, [companionship?.companions]);

  const toggleInterviewee = (name: string, checked: boolean) => {
    setSelectedInterviewees((prev) => {
      if (checked) {
        if (prev.includes(name)) return prev;
        return [...prev, name];
      }
      return prev.filter((n) => n !== name);
    });
  };

  const resetInterviewForm = () => {
    setEditingInterviewId(null);
    setInterviewDate(undefined);
    setSelectedCalendarDate(undefined);
    setInterviewTime('');
    setSelectedInterviewees(companionOptions);
  };

  const openInterviewDialog = () => {
    resetInterviewForm();
    setSelectedInterviewees(companionOptions);
    setIsInterviewDialogOpen(true);
  };

  const openEditInterviewDialog = (interview: MinisteringInterview) => {
    if (isInterviewCompleted(interview)) return;
    const day = interview.date?.toDate?.();
    setEditingInterviewId(interview.id);
    setInterviewDate(day);
    setSelectedCalendarDate(day);
    setInterviewTime(interview.time || '');
    const attendees = getInterviewAttendees(interview);
    setSelectedInterviewees(
      attendees.length > 0
        ? attendees.filter((n) => companionOptions.includes(n))
        : companionOptions,
    );
    setIsInterviewDialogOpen(true);
  };

  const openCompleteDialog = (interview: MinisteringInterview) => {
    if (!canWrite || isInterviewCompleted(interview)) return;
    setInterviewToComplete(interview);
    setCompleteObservation('');
    setIsCompleteDialogOpen(true);
  };

  const closeCompleteDialog = () => {
    setIsCompleteDialogOpen(false);
    setInterviewToComplete(null);
    setCompleteObservation('');
  };

  const handleConfirmCompleteInterview = async () => {
    if (!canWrite || !interviewToComplete || isInterviewCompleted(interviewToComplete)) return;

    setIsCompletingInterview(true);
    try {
      const observation = completeObservation.trim();
      await updateDoc(doc(ministeringInterviewsCollection, interviewToComplete.id), {
        status: 'completed',
        observation: observation || null,
        completedAt: serverTimestamp(),
        completedBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: t('ministering.success'),
        description: t('ministering.interview.completedDescription'),
      });
      closeCompleteDialog();
      await fetchInterviews();
    } catch (error) {
      logger.error({ error, message: 'Error completing ministering interview' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.interview.completeError'),
        variant: 'destructive',
      });
    } finally {
      setIsCompletingInterview(false);
    }
  };

  /**
   * Resuelve el distrito del compañerismo y su líder (dueño del distrito).
   * Preferencia: districtId en el compañerismo; si falta, busca por companionshipIds.
   */
  const resolveDistrictLeader = async (): Promise<{
    districtId: string;
    leaderMemberId: string;
    leaderName: string | null;
  } | null> => {
    if (!barrioOrg || !companionshipId) return null;

    let district: MinisteringDistrict | null = null;

    if (companionship?.districtId) {
      const districtSnap = await getDoc(
        doc(ministeringDistrictsCollection, companionship.districtId),
      );
      if (districtSnap.exists()) {
        district = {
          id: districtSnap.id,
          ...(districtSnap.data() as Omit<MinisteringDistrict, 'id'>),
        };
      }
    }

    if (!district) {
      const districtsSnap = await getDocs(
        query(ministeringDistrictsCollection, where('barrioOrg', '==', barrioOrg)),
      );
      for (const d of districtsSnap.docs) {
        const data = d.data() as Omit<MinisteringDistrict, 'id'>;
        if ((data.companionshipIds ?? []).includes(companionshipId)) {
          district = { id: d.id, ...data };
          break;
        }
      }
    }

    if (!district) return null;
    if (!district.leaderId) {
      return {
        districtId: district.id,
        leaderMemberId: '',
        leaderName: district.leaderName ?? null,
      };
    }

    return {
      districtId: district.id,
      leaderMemberId: district.leaderId,
      leaderName: district.leaderName ?? null,
    };
  };

  const handleScheduleInterview = async () => {
    if (!companionshipId || !companionship || !barrioOrg || !user?.uid) return;

    if (!interviewDate) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.interview.dateRequired'),
        variant: 'destructive',
      });
      return;
    }
    if (!interviewTime.trim()) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.interview.timeRequired'),
        variant: 'destructive',
      });
      return;
    }

    const attendees = selectedInterviewees
      .map((n) => n.trim())
      .filter((n) => n && companionOptions.includes(n));

    if (attendees.length === 0) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.interview.intervieweeRequired'),
        variant: 'destructive',
      });
      return;
    }

    setIsSchedulingInterview(true);
    try {
      const { requireBarrioOrg } = await import('@/lib/tenant-scope');
      const scopedBarrioOrg = requireBarrioOrg(barrioOrg);

      // Guardar a mediodía local para evitar desfaces de zona horaria al leer el día.
      const dateAtNoon = new Date(
        interviewDate.getFullYear(),
        interviewDate.getMonth(),
        interviewDate.getDate(),
        12,
        0,
        0,
        0,
      );

      // companionshipName se genera automáticamente (no se escribe a mano)
      const autoCompanionshipName =
        companionshipName.trim() || attendees.join(t('ministering.and'));

      if (editingInterviewId) {
        await updateDoc(doc(ministeringInterviewsCollection, editingInterviewId), {
          companionshipName: autoCompanionshipName,
          intervieweeNames: attendees,
          date: Timestamp.fromDate(dateAtNoon),
          time: interviewTime.trim(),
          status: 'scheduled',
          completedAt: null,
          completedBy: null,
          updatedAt: serverTimestamp(),
        });

        toast({
          title: t('ministering.success'),
          description: t('ministering.interview.rescheduledDescription'),
        });
      } else {
        const leaderInfo = await resolveDistrictLeader();
        if (!leaderInfo || !leaderInfo.leaderMemberId) {
          toast({
            title: t('ministering.error'),
            description: t('ministering.interview.leaderRequired'),
            variant: 'destructive',
          });
          return;
        }

        await addDoc(ministeringInterviewsCollection, {
          companionshipId,
          companionshipName: autoCompanionshipName,
          intervieweeNames: attendees,
          districtId: leaderInfo.districtId,
          leaderMemberId: leaderInfo.leaderMemberId,
          leaderName: leaderInfo.leaderName,
          date: Timestamp.fromDate(dateAtNoon),
          time: interviewTime.trim(),
          status: 'scheduled',
          barrioOrg: scopedBarrioOrg,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });

        toast({
          title: t('ministering.success'),
          description: t('ministering.interview.scheduledDescription'),
        });
      }

      setIsInterviewDialogOpen(false);
      resetInterviewForm();
      await fetchInterviews();
    } catch (error) {
      logger.error({ error, message: 'Error scheduling ministering interview' });
      toast({
        title: t('ministering.error'),
        description: editingInterviewId
          ? t('ministering.interview.rescheduleError')
          : t('ministering.interview.scheduleError'),
        variant: 'destructive',
      });
    } finally {
      setIsSchedulingInterview(false);
    }
  };

  if (loading || isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/4" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-10 w-1/3 self-end" />
      </div>
    );
  }

  if (!companionship) {
    return null;
  }

  if (isEditMode) {
    return <CompanionshipForm companionship={companionship} onCancel={handleCancelEdit} />;
  }

  return (
    <div className="space-y-6">
      <Button variant="outline" asChild>
        <Link href="/ministering">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('ministering.backToList')}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start gap-2 flex-wrap">
            <div>
              <CardTitle>{t('ministering.manageCompanionshipTitle')}</CardTitle>
              <CardDescription>{companionshipName}</CardDescription>
            </div>
            {canWrite && (
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={openInterviewDialog}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  {t('ministering.interview.scheduleButton')}
                </Button>
                <Button variant="outline" onClick={() => setIsEditMode(true)}>
                  <Edit className="mr-2 h-4 w-4" />
                  {t('common.edit')}
                </Button>
                <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t('common.delete')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('ministering.deleteConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('ministering.deleteConfirmDescription')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {t('common.delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('ministering.family')}</TableHead>
                  <TableHead>{t('ministering.urgent')}</TableHead>
                  <TableHead className="w-[40%]">{t('ministering.observation')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {families.map((family, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{family.name}</TableCell>
                    <TableCell>
                      <Switch
                        checked={family.isUrgent}
                        onCheckedChange={(checked) =>
                          handleFamilyChange(index, 'isUrgent', checked)
                        }
                        aria-label={t('ministering.markAsUrgentAria')}
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        value={family.observation}
                        onChange={(e) =>
                          handleFamilyChange(index, 'observation', e.target.value)
                        }
                        placeholder={t('ministering.addNotePlaceholder')}
                        rows={1}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">
              {t('ministering.interview.listTitle')}
            </h3>
            {loadingInterviews ? (
              <Skeleton className="h-10 w-full" />
            ) : interviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('ministering.interview.empty')}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {interviews.map((interview) => {
                  const day = interview.date?.toDate?.();
                  const dayLabel = day
                    ? format(day, 'EEEE d MMMM yyyy', { locale: getDateFnsLocale() })
                    : '—';
                  const attendees = getInterviewAttendees(interview);
                  const completed = isInterviewCompleted(interview);
                  const observation = interview.observation?.trim() || '';
                  return (
                    <li
                      key={interview.id}
                      className={cn(
                        'flex flex-col gap-3 rounded-md px-3 py-2 sm:flex-row sm:items-start sm:justify-between',
                        completed ? 'bg-muted/30 opacity-90' : 'bg-muted/50',
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium capitalize">{dayLabel}</span>
                          <Badge variant={completed ? 'secondary' : 'default'}>
                            {completed
                              ? t('ministering.interview.completedBadge')
                              : t('ministering.interview.scheduledBadge')}
                          </Badge>
                        </div>
                        {attendees.length > 0 ? (
                          <div className="text-muted-foreground">
                            <p className="font-medium text-foreground/80">
                              {t('ministering.interview.intervieweesLabel')}:
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                              {attendees.map((name) => (
                                <li key={name} className="whitespace-normal">
                                  {name}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <p className="text-muted-foreground">
                          {t('ministering.interview.timeLabel')}: {interview.time}
                        </p>
                        {completed && observation ? (
                          <div className="text-muted-foreground">
                            <p className="font-medium text-foreground/80">
                              {t('ministering.interview.observationLabel')}:
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap break-words">
                              {observation}
                            </p>
                          </div>
                        ) : null}
                      </div>
                      {canWrite && !completed && (
                        <div className="flex flex-wrap gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEditInterviewDialog(interview)}
                            disabled={isCompletingInterview || isSchedulingInterview}
                          >
                            <Edit className="mr-1.5 h-3.5 w-3.5" />
                            {t('ministering.interview.editButton')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openCompleteDialog(interview)}
                            disabled={isCompletingInterview || isSchedulingInterview}
                          >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            {t('ministering.interview.complete')}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          {canWrite && (
            <Button onClick={handleSaveChanges} disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? t('common.saving') : t('common.saveChanges')}
            </Button>
          )}
        </CardFooter>
      </Card>

      <Dialog
        open={isInterviewDialogOpen}
        onOpenChange={(open) => {
          setIsInterviewDialogOpen(open);
          if (!open) resetInterviewForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingInterviewId
                ? t('ministering.interview.editDialogTitle')
                : t('ministering.interview.dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingInterviewId
                ? t('ministering.interview.editDialogDescription')
                : t('ministering.interview.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('ministering.interview.intervieweesLabel')}</Label>
              <div className="rounded-md border p-3 space-y-2">
                {companionOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('ministering.interview.noCompanions')}
                  </p>
                ) : (
                  companionOptions.map((name) => {
                    const checked = selectedInterviewees.includes(name);
                    const checkboxId = `interview-attendee-${name}`;
                    return (
                      <label
                        key={name}
                        htmlFor={checkboxId}
                        className="flex items-center gap-3 rounded-sm px-1 py-1.5 text-sm cursor-pointer hover:bg-muted/60"
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={checked}
                          onCheckedChange={(value) =>
                            toggleInterviewee(name, value === true)
                          }
                        />
                        <span className="leading-none">{name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('ministering.interview.dateLabel')}</Label>
              <Popover
                open={datePopoverOpen}
                onOpenChange={(open) => {
                  setDatePopoverOpen(open);
                  if (open) setSelectedCalendarDate(interviewDate);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !interviewDate && 'text-muted-foreground',
                    )}
                  >
                    {interviewDate ? (
                      format(interviewDate, 'd LLLL yyyy', { locale: getDateFnsLocale() })
                    ) : (
                      <span>{t('ministering.interview.selectDate')}</span>
                    )}
                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedCalendarDate || interviewDate}
                    onSelect={setSelectedCalendarDate}
                    defaultMonth={selectedCalendarDate || interviewDate}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today;
                    }}
                    autoFocus
                    locale={getDateFnsLocale()}
                  />
                  <div className="p-3 border-t flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => {
                        setSelectedCalendarDate(undefined);
                        setDatePopoverOpen(false);
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      onClick={() => {
                        if (selectedCalendarDate) {
                          setInterviewDate(selectedCalendarDate);
                        }
                        setDatePopoverOpen(false);
                      }}
                    >
                      {t('ministering.interview.setDate')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interview-time">{t('ministering.interview.timeLabel')}</Label>
              <Input
                id="interview-time"
                type="time"
                value={interviewTime}
                onChange={(e) => setInterviewTime(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsInterviewDialogOpen(false);
                resetInterviewForm();
              }}
              disabled={isSchedulingInterview}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleScheduleInterview} disabled={isSchedulingInterview}>
              {isSchedulingInterview ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : editingInterviewId ? (
                t('ministering.interview.rescheduleConfirm')
              ) : (
                t('ministering.interview.confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isCompleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isCompletingInterview) {
            closeCompleteDialog();
          } else if (open) {
            setIsCompleteDialogOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ministering.interview.completeDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('ministering.interview.completeDialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="interview-complete-observation">
              {t('ministering.interview.observationLabel')}
            </Label>
            <Textarea
              id="interview-complete-observation"
              value={completeObservation}
              onChange={(e) => setCompleteObservation(e.target.value)}
              placeholder={t('ministering.interview.observationPlaceholder')}
              rows={4}
              disabled={isCompletingInterview}
            />
            <p className="text-xs text-muted-foreground">
              {t('ministering.interview.observationOptionalHint')}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeCompleteDialog}
              disabled={isCompletingInterview}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={handleConfirmCompleteInterview} disabled={isCompletingInterview}>
              {isCompletingInterview ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('ministering.interview.completing')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {t('ministering.interview.confirmComplete')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
