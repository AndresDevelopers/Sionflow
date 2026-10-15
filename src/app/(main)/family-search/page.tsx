
'use client';

import { useState, useEffect, useTransition, useRef, useCallback, useMemo } from 'react';
import { query, orderBy, addDoc, serverTimestamp, deleteDoc, updateDoc, doc } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import {
  familySearchTrainingsCollection,
  familySearchTasksCollection,
  annotationsCollection,
} from '@/lib/collections';
import type { FamilySearchTraining, Annotation, Member, FamilySearchHelpType } from '@/lib/types';
import { FamilySelector } from '@/components/family-search/family-selector';
import { getMembersForSelector, updateMember } from '@/lib/members-data';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PlusCircle, Trash2, Library, BookUser, Users, Type, Minus, Plus, CircleHelp, CheckCircle2, Search, HandHelping } from 'lucide-react';
import logger from '@/lib/logger';
import { VoiceAnnotations } from '@/components/shared/voice-annotations';
import { where, deleteDoc as deleteDocFirestore } from 'firebase/firestore';


const faqData = [
    { question: "familySearch.faq.q1", answer: "familySearch.faq.a1" },
    { question: "familySearch.faq.q2", answer: "familySearch.faq.a2" },
    { question: "familySearch.faq.q3", answer: "familySearch.faq.a3" },
    { question: "familySearch.faq.q4", answer: "familySearch.faq.a4" }
];

export default function FamilySearchPage() {
    const { user, loading: authLoading, barrioOrg } = useAuth();
    const { canWrite } = usePermission();
    const { t } = useI18n();
    const [trainings, setTrainings] = useState<FamilySearchTraining[]>([]);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const trainingSchema = z.object({
      familyName: z.string().min(2, t('familySearch.validation.familyNameRequired')),
      memberId: z.string().optional(),
      memberName: z.string().optional(),
    });
    const taskSchema = z.object({
      task: z.string().min(5, t('familySearch.validation.taskRequired')),
    });
    const annotationSchema = z.object({
      note: z.string().min(5, t('familySearch.validation.noteRequired')),
    });

    // State for dialogs and forms
    const [isTrainingOpen, setTrainingOpen] = useState(false);
    const [isTaskOpen, setTaskOpen] = useState(false);
    const [loadingAnnotations, setLoadingAnnotations] = useState(true);
    const [faqFontSize, setFaqFontSize] = useState<'sm' | 'base' | 'lg'>('base');
    const trainingFormRef = useRef<HTMLFormElement>(null);
    const taskFormRef = useRef<HTMLFormElement>(null);

    // Miembros sin cuenta de FamilySearch (sección Ayuda)
    const [membersWithoutFs, setMembersWithoutFs] = useState<Member[]>([]);
    const [loadingMembersWithoutFs, setLoadingMembersWithoutFs] = useState(true);
    const [markingMemberId, setMarkingMemberId] = useState<string | null>(null);
    const [markingAction, setMarkingAction] = useState<'help' | 'completed' | null>(null);
    const [helpSearch, setHelpSearch] = useState('');
    const [helpDialogMember, setHelpDialogMember] = useState<Member | null>(null);
    const [helpType, setHelpType] = useState<FamilySearchHelpType>('create_account');
    const [helpOtherDetails, setHelpOtherDetails] = useState('');

    const fetchData = useCallback(async (opts?: { quiet?: boolean }) => {
        if (!opts?.quiet) setLoading(true);
        const trainingsSnap = await getDocs(query(familySearchTrainingsCollection, where('barrioOrg', '==', barrioOrg), orderBy('createdAt', 'desc')));
        setTrainings(trainingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FamilySearchTraining)));
        setLoading(false);
    }, [barrioOrg]);

    const fetchAnnotations = useCallback(async (opts?: { quiet?: boolean }) => {
        if (!opts?.quiet) setLoadingAnnotations(true);
        try {
            const q = query(
                annotationsCollection,
                where('source', '==', 'family-search'),
                where('barrioOrg', '==', barrioOrg),
                where('isResolved', '==', false)
            );
            const snapshot = await getDocs(q);
            const data = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() } as Annotation))
                .sort((a, b) => {
                    const dateA = a.createdAt?.toMillis?.() ?? 0;
                    const dateB = b.createdAt?.toMillis?.() ?? 0;
                    return dateB - dateA;
                });
            setAnnotations(data);
        } catch (error) {
            console.error('Error fetching family-search annotations:', error);
            setAnnotations([]);
        } finally {
            setLoadingAnnotations(false);
        }
    }, [barrioOrg]);

    const fetchMembersWithoutFs = useCallback(async (opts?: { quiet?: boolean }) => {
        if (!barrioOrg) {
            setMembersWithoutFs([]);
            setLoadingMembersWithoutFs(false);
            return;
        }
        if (!opts?.quiet) setLoadingMembersWithoutFs(true);
        try {
            // Activos y menos activos (no fallecidos); solo sin cuenta FS
            // Prioriza quienes ya tienen solicitud de ayuda
            const members = await getMembersForSelector(false, barrioOrg);
            const withoutFs = members.filter((m) => m.hasFamilySearchAccount !== true);
            setMembersWithoutFs(
                [...withoutFs].sort((a, b) => {
                    const helpA = a.needsFamilySearchHelp === true ? 0 : 1;
                    const helpB = b.needsFamilySearchHelp === true ? 0 : 1;
                    if (helpA !== helpB) return helpA - helpB;
                    const last = (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
                    if (last !== 0) return last;
                    return (a.firstName || '').localeCompare(b.firstName || '', undefined, { sensitivity: 'base' });
                })
            );
        } catch (error) {
            console.error('Error fetching members without FamilySearch account:', error);
            setMembersWithoutFs([]);
        } finally {
            setLoadingMembersWithoutFs(false);
        }
    }, [barrioOrg]);

    useEffect(() => {
        if (authLoading || !user) return;
        void (async () => {
            await fetchData();
            await fetchAnnotations();
            await fetchMembersWithoutFs();
        })();
    }, [authLoading, user, fetchData, fetchAnnotations, fetchMembersWithoutFs]);

    useOnManualRefresh(async () => {
        await Promise.all([
            fetchData({ quiet: true }),
            fetchAnnotations({ quiet: true }),
            fetchMembersWithoutFs({ quiet: true }),
        ]);
        return true;
    });

    const sortMembersWithoutFs = useCallback((list: Member[]) => {
        return [...list].sort((a, b) => {
            const helpA = a.needsFamilySearchHelp === true ? 0 : 1;
            const helpB = b.needsFamilySearchHelp === true ? 0 : 1;
            if (helpA !== helpB) return helpA - helpB;
            const last = (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
            if (last !== 0) return last;
            return (a.firstName || '').localeCompare(b.firstName || '', undefined, { sensitivity: 'base' });
        });
    }, []);

    const filteredMembersWithoutFs = useMemo(() => {
        const q = helpSearch.trim().toLowerCase();
        if (!q) return membersWithoutFs;
        return membersWithoutFs.filter((m) => {
            const full = `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase();
            return full.includes(q);
        });
    }, [membersWithoutFs, helpSearch]);

    const openHelpDialog = (member: Member) => {
        if (!canWrite) return;
        const hasCreateAccountHelp = Boolean(member.familySearchCreateAccountAnnotationId);
        setHelpDialogMember(member);
        setHelpType(hasCreateAccountHelp ? 'other' : 'create_account');
        setHelpOtherDetails('');
    };

    const closeHelpDialog = () => {
        if (isPending && markingAction === 'help') return;
        setHelpDialogMember(null);
        setHelpOtherDetails('');
        setHelpType('create_account');
    };

    const handleConfirmFamilySearchHelp = () => {
        if (!canWrite || !user || !helpDialogMember) return;
        const member = helpDialogMember;
        const fullName = `${member.firstName || ''} ${member.lastName || ''}`.trim() || t('common.notSpecified');
        const hasCreateAccountHelp = Boolean(member.familySearchCreateAccountAnnotationId);

        if (helpType === 'create_account' && hasCreateAccountHelp) {
            toast({
                title: t('common.error'),
                description: t('familySearch.help.helpAlreadyCreateAccount', { name: fullName }),
                variant: 'destructive',
            });
            return;
        }

        if (helpType === 'other' && helpOtherDetails.trim().length < 3) {
            toast({
                title: t('common.error'),
                description: t('familySearch.help.otherDetailsRequired'),
                variant: 'destructive',
            });
            return;
        }

        setMarkingMemberId(member.id);
        setMarkingAction('help');
        startTransition(async () => {
            try {
                const { requireBarrioOrg } = await import('@/lib/tenant-scope');
                const scopedBarrioOrg = requireBarrioOrg(barrioOrg);

                const noteText =
                    helpType === 'create_account'
                        ? t('familySearch.help.helpNoteCreateAccount', { name: fullName })
                        : t('familySearch.help.helpNoteOther', {
                              name: fullName,
                              details: helpOtherDetails.trim() || t('familySearch.help.helpNoteOtherDefault'),
                          });

                // Nota primero (visible en Anotaciones); luego el flag del miembro
                const annotationRef = await addDoc(annotationsCollection, {
                    text: noteText,
                    source: 'family-search',
                    isCouncilAction: false,
                    isResolved: false,
                    createdAt: serverTimestamp(),
                    userId: user.uid,
                    barrioOrg: scopedBarrioOrg,
                    memberId: member.id,
                    helpType,
                });

                const memberUpdate: Partial<Member> = { needsFamilySearchHelp: true };
                if (helpType === 'create_account') {
                    memberUpdate.familySearchCreateAccountAnnotationId = annotationRef.id;
                }
                await updateMember(member.id, memberUpdate);

                setMembersWithoutFs((prev) =>
                    sortMembersWithoutFs(
                        prev.map((m) =>
                            m.id === member.id
                                ? {
                                      ...m,
                                      needsFamilySearchHelp: true,
                                      ...(helpType === 'create_account'
                                          ? { familySearchCreateAccountAnnotationId: annotationRef.id }
                                          : {}),
                                  }
                                : m
                        )
                    )
                );
                setHelpDialogMember(null);
                setHelpOtherDetails('');
                await fetchAnnotations({ quiet: true });
                toast({
                    title: t('common.success'),
                    description: t('familySearch.help.helpRequested', { name: fullName }),
                });
            } catch (error) {
                logger.error({ error, message: 'Error marking FamilySearch help needed' });
                toast({
                    title: t('common.error'),
                    description: t('familySearch.help.helpError'),
                    variant: 'destructive',
                });
            } finally {
                setMarkingMemberId(null);
                setMarkingAction(null);
            }
        });
    };

    const deleteCreateAccountHelpNotes = async (member: Member) => {
        const idsToDelete = new Set<string>();

        if (member.familySearchCreateAccountAnnotationId) {
            idsToDelete.add(member.familySearchCreateAccountAnnotationId);
        }

        // Respaldo: notas de ayuda "crear cuenta" del miembro ya cargadas en memoria
        for (const annotation of annotations) {
            if (
                annotation.memberId === member.id &&
                annotation.helpType === 'create_account'
            ) {
                idsToDelete.add(annotation.id);
            }
        }

        // Respaldo por texto (notas antiguas sin helpType)
        const createAccountPrefixEs = 'Ayuda FamilySearch:';
        const createAccountPrefixEn = 'FamilySearch help:';
        for (const annotation of annotations) {
            if (annotation.memberId !== member.id) continue;
            const text = annotation.text || '';
            const looksLikeCreateAccount =
                (text.startsWith(createAccountPrefixEs) && text.includes('crear su cuenta')) ||
                (text.startsWith(createAccountPrefixEn) && text.includes('creating their account'));
            if (looksLikeCreateAccount) {
                idsToDelete.add(annotation.id);
            }
        }

        await Promise.all(
            Array.from(idsToDelete).map(async (id) => {
                try {
                    await deleteDocFirestore(doc(annotationsCollection, id));
                } catch (error) {
                    // Si ya no existe, continuar
                    logger.error({ error, message: `Error deleting create-account help note ${id}` });
                }
            })
        );

        return idsToDelete.size;
    };

    const handleMarkHasFamilySearchAccount = (member: Member) => {
        if (!canWrite) return;
        setMarkingMemberId(member.id);
        setMarkingAction('completed');
        startTransition(async () => {
            try {
                // Completado: borra la nota de "crear cuenta" y marca cuenta lista
                await deleteCreateAccountHelpNotes(member);
                await updateMember(member.id, {
                    hasFamilySearchAccount: true,
                    needsFamilySearchHelp: false,
                    familySearchCreateAccountAnnotationId: null,
                });
                setMembersWithoutFs((prev) => prev.filter((m) => m.id !== member.id));
                await fetchAnnotations({ quiet: true });
                toast({
                    title: t('common.success'),
                    description: t('familySearch.help.markedHasAccount', {
                        name: `${member.firstName} ${member.lastName}`.trim(),
                    }),
                });
            } catch (error) {
                logger.error({ error, message: 'Error marking FamilySearch account' });
                toast({
                    title: t('common.error'),
                    description: t('familySearch.help.markError'),
                    variant: 'destructive',
                });
            } finally {
                setMarkingMemberId(null);
                setMarkingAction(null);
            }
        });
    };

    const handleAddTraining = (data: { familyName: string; memberId?: string; memberName?: string }) => {
        const validated = trainingSchema.safeParse(data);

        if (!validated.success) {
            toast({ title: t("familySearch.validation.error"), description: validated.error.issues[0].message, variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            try {
                const { requireBarrioOrg } = await import('@/lib/tenant-scope');
                const trainingData: any = {
                    familyName: data.familyName,
                    barrioOrg: requireBarrioOrg(barrioOrg),
                    createdAt: serverTimestamp()
                };

                // Add member reference if selected from existing members
                if (data.memberId && data.memberName) {
                    trainingData.memberId = data.memberId;
                    trainingData.memberName = data.memberName;
                }

                await addDoc(familySearchTrainingsCollection, trainingData);
                toast({ title: t("common.success"), description: t("familySearch.training.addedSuccess") });
                setTrainingOpen(false);
                fetchData();
            } catch (error) {
                logger.error({ error, message: 'Error adding family training' });
                toast({ title: t("common.error"), description: t("familySearch.training.addError"), variant: 'destructive' });
            }
        });
    }

    const handleAddTask = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const task = formData.get('task') as string;
        const validated = taskSchema.safeParse({ task });

        if (!validated.success) {
            toast({ title: t("familySearch.validation.error"), description: validated.error.issues[0].message, variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            try {
                const { requireBarrioOrg } = await import('@/lib/tenant-scope');
                await addDoc(familySearchTasksCollection, {
                  task,
                  createdAt: serverTimestamp(),
                  barrioOrg: requireBarrioOrg(barrioOrg),
                });
                toast({ title: t("common.success"), description: t("familySearch.task.addedSuccess") });
                setTaskOpen(false);
                taskFormRef.current?.reset();
                fetchData();
            } catch (error) {
                logger.error({ error, message: 'Error adding task' });
                toast({ title: t("common.error"), description: t("familySearch.task.addError"), variant: 'destructive' });
            }
        });
    }

    const handleDeleteAnnotation = async (id: string) => {
        try {
            await deleteDocFirestore(doc(annotationsCollection, id));
            toast({ title: t("common.success"), description: t("familySearch.annotations.deletedSuccess") });
            fetchAnnotations();
        } catch (error) {
            logger.error({ error, message: 'Error deleting annotation' });
            toast({ title: t("common.error"), description: t("familySearch.annotations.deleteError"), variant: 'destructive' });
        }
    };

    const handleDelete = (id: string, type: 'training' | 'task') => {
        startTransition(async () => {
            try {
                let docRef;
                let successMessage = '';

                if (type === 'training') {
                    docRef = doc(familySearchTrainingsCollection, id);
                    successMessage = t('familySearch.toast.deleteTrainingSuccess');
                } else {
                    docRef = doc(familySearchTasksCollection, id);
                    successMessage = t('familySearch.toast.deleteTaskSuccess');
                }

                await deleteDoc(docRef);
                toast({ title: t('common.success'), description: successMessage });
                fetchData();

            } catch (error) {
                 const errorMessage = (error as Error).message;
                 logger.error({ error: errorMessage, message: `Error deleting ${type}` });
                 toast({ 
                    title: t('common.error'), 
                    description: t('familySearch.toast.deleteError', { error: errorMessage }), 
                    variant: 'destructive' 
                });
            }
        });
    };


  const getFaqFontClass = () => {
    return faqFontSize === 'sm' ? 'text-sm' : faqFontSize === 'lg' ? 'text-lg' : 'text-base';
  };

  return (
    <section className="page-section">
       <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Library className="h-8 w-8 text-primary" />
            <div className="flex flex-col gap-1">
                <h1 className="text-balance text-fluid-title font-semibold">{t('familySearch.title')}</h1>
                <p className="text-balance text-fluid-subtitle text-muted-foreground">
                    {t('familySearch.description')}
                </p>
            </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-1">
            {/* Familias por Capacitar */}
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                           <BookUser className="h-6 w-6 text-primary" />
                           <div>
                                <CardTitle>{t('familySearch.familiesToTrain')}</CardTitle>
                                <CardDescription>{t('familySearch.familiesToTrainDescription')}</CardDescription>
                           </div>
                        </div>
                        <Dialog open={isTrainingOpen} onOpenChange={setTrainingOpen}>
                            {canWrite && (
                            <DialogTrigger asChild><Button size="sm"><PlusCircle className="mr-2"/> {t('familySearch.addFamily')}</Button></DialogTrigger>
                            )}
                            <DialogContent className="w-full max-w-[90vw] sm:max-w-lg">
                                <DialogHeader>
                                    <DialogTitle>{t('familySearch.addFamilyDialogTitle')}</DialogTitle>
                                    <DialogDescription>
                                        {t('familySearch.addFamilyDialogDescription')}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="py-4">
                                    <FamilySelector 
                                        onFamilySelect={handleAddTraining}
                                        disabled={isPending}
                                    />
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? <Skeleton className="h-24 w-full" /> : trainings.length === 0 ? <p className="text-sm text-center py-4 text-muted-foreground">{t('familySearch.noFamilies')}</p> : (
                        <ul className="space-y-3">{trainings.map(item => (
                            <li key={item.id} className="flex items-center justify-between text-sm border-b pb-2">
                                <div className="flex-1">
                                    <p className="font-medium">{item.familyName}</p>
                                    {item.memberName && (
                                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            {t('familySearch.linkedTo', { name: item.memberName })}
                                        </p>
                                    )}
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id, 'training')} disabled={isPending}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                            </li>
                        ))}</ul>
                    )}
                </CardContent>
            </Card>

            {/* Ayuda: miembros sin cuenta de FamilySearch */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-center gap-3">
                            <CircleHelp className="h-6 w-6 text-primary shrink-0" />
                            <div>
                                <CardTitle className="flex flex-wrap items-center gap-2">
                                    {t('familySearch.help.title')}
                                    {!loadingMembersWithoutFs && (
                                        <Badge variant="secondary" className="tabular-nums font-normal">
                                            {membersWithoutFs.length}
                                        </Badge>
                                    )}
                                </CardTitle>
                                <CardDescription>{t('familySearch.help.description')}</CardDescription>
                            </div>
                        </div>
                    </div>
                    {membersWithoutFs.length > 5 && (
                        <div className="relative mt-2">
                            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={helpSearch}
                                onChange={(e) => setHelpSearch(e.target.value)}
                                placeholder={t('familySearch.help.searchPlaceholder')}
                                className="pl-9"
                                aria-label={t('familySearch.help.searchPlaceholder')}
                            />
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    {loadingMembersWithoutFs ? (
                        <div className="space-y-2">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    ) : filteredMembersWithoutFs.length === 0 ? (
                        <p className="text-sm text-center py-4 text-muted-foreground">
                            {helpSearch.trim()
                                ? t('familySearch.help.noSearchResults')
                                : t('familySearch.help.empty')}
                        </p>
                    ) : (
                        <ul className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                            {filteredMembersWithoutFs.map((member) => {
                                const fullName = `${member.firstName || ''} ${member.lastName || ''}`.trim();
                                const isMarking = markingMemberId === member.id;
                                const isSavingHelp = isMarking && markingAction === 'help';
                                const isSavingCompleted = isMarking && markingAction === 'completed';
                                const needsHelp = member.needsFamilySearchHelp === true;
                                const hasCreateAccountHelp = Boolean(member.familySearchCreateAccountAnnotationId);
                                return (
                                    <li
                                        key={member.id}
                                        className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-sm sm:text-base break-words">
                                                {fullName || t('common.notSpecified')}
                                            </p>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1.5 py-0 h-5 font-normal"
                                                >
                                                    {t(`member.status.${member.status}`)}
                                                </Badge>
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1.5 py-0 h-5 font-normal text-amber-700 border-amber-300 dark:text-amber-400"
                                                >
                                                    {t('familySearch.help.noAccountBadge')}
                                                </Badge>
                                                {hasCreateAccountHelp && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] px-1.5 py-0 h-5 font-normal text-sky-700 border-sky-300 dark:text-sky-400"
                                                    >
                                                        {t('familySearch.help.createAccountBadge')}
                                                    </Badge>
                                                )}
                                                {needsHelp && !hasCreateAccountHelp && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] px-1.5 py-0 h-5 font-normal text-violet-700 border-violet-300 dark:text-violet-400"
                                                    >
                                                        {t('familySearch.help.otherHelpBadge')}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                        {canWrite && (
                                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0">
                                                <Button
                                                    size="sm"
                                                    variant={needsHelp ? 'outline' : 'default'}
                                                    className="w-full sm:w-auto"
                                                    disabled={isPending || isMarking}
                                                    onClick={() => openHelpDialog(member)}
                                                >
                                                    <HandHelping className="mr-1.5 h-4 w-4" />
                                                    {isSavingHelp
                                                        ? t('common.saving')
                                                        : t('familySearch.help.helpAction')}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    className="w-full sm:w-auto"
                                                    disabled={isPending || isMarking}
                                                    onClick={() => handleMarkHasFamilySearchAccount(member)}
                                                >
                                                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                                                    {isSavingCompleted
                                                        ? t('common.saving')
                                                        : t('familySearch.help.completedAction')}
                                                </Button>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {/* Diálogo: tipo de ayuda FamilySearch */}
            <Dialog
                open={Boolean(helpDialogMember)}
                onOpenChange={(open) => {
                    if (!open) closeHelpDialog();
                }}
            >
                <DialogContent className="w-full max-w-[90vw] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {t('familySearch.help.dialogTitle', {
                                name:
                                    helpDialogMember
                                        ? `${helpDialogMember.firstName || ''} ${helpDialogMember.lastName || ''}`.trim() ||
                                          t('common.notSpecified')
                                        : '',
                            })}
                        </DialogTitle>
                        <DialogDescription>
                            {t('familySearch.help.dialogDescription')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>{t('familySearch.help.typeLabel')}</Label>
                            <RadioGroup
                                value={helpType}
                                onValueChange={(value) => setHelpType(value as FamilySearchHelpType)}
                                className="gap-3"
                                disabled={isPending && markingAction === 'help'}
                            >
                                <label
                                    htmlFor="fs-help-create-account"
                                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                                        helpType === 'create_account' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                                    } ${
                                        helpDialogMember?.familySearchCreateAccountAnnotationId
                                            ? 'cursor-not-allowed opacity-60'
                                            : ''
                                    }`}
                                >
                                    <RadioGroupItem
                                        value="create_account"
                                        id="fs-help-create-account"
                                        disabled={Boolean(helpDialogMember?.familySearchCreateAccountAnnotationId)}
                                        className="mt-0.5"
                                    />
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium leading-none">
                                            {t('familySearch.help.typeCreateAccount')}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {helpDialogMember?.familySearchCreateAccountAnnotationId
                                                ? t('familySearch.help.helpAlreadyCreateAccount', {
                                                      name:
                                                          `${helpDialogMember.firstName || ''} ${helpDialogMember.lastName || ''}`.trim() ||
                                                          t('common.notSpecified'),
                                                  })
                                                : t('familySearch.help.typeCreateAccountDesc')}
                                        </p>
                                    </div>
                                </label>
                                <label
                                    htmlFor="fs-help-other"
                                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                                        helpType === 'other' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                                    }`}
                                >
                                    <RadioGroupItem value="other" id="fs-help-other" className="mt-0.5" />
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium leading-none">
                                            {t('familySearch.help.typeOther')}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t('familySearch.help.typeOtherDesc')}
                                        </p>
                                    </div>
                                </label>
                            </RadioGroup>
                        </div>
                        {helpType === 'other' && (
                            <div className="space-y-2">
                                <Label htmlFor="fs-help-other-details">
                                    {t('familySearch.help.otherDetailsLabel')}
                                </Label>
                                <Textarea
                                    id="fs-help-other-details"
                                    value={helpOtherDetails}
                                    onChange={(e) => setHelpOtherDetails(e.target.value)}
                                    placeholder={t('familySearch.help.otherDetailsPlaceholder')}
                                    rows={3}
                                    disabled={isPending && markingAction === 'help'}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={closeHelpDialog}
                            disabled={isPending && markingAction === 'help'}
                        >
                            {t('familySearch.help.dialogCancel')}
                        </Button>
                        <Button
                            type="button"
                            onClick={handleConfirmFamilySearchHelp}
                            disabled={
                                isPending ||
                                (helpType === 'create_account' &&
                                    Boolean(helpDialogMember?.familySearchCreateAccountAnnotationId))
                            }
                        >
                            {isPending && markingAction === 'help'
                                ? t('common.saving')
                                : t('familySearch.help.dialogConfirm')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

             {/* Anotaciones */}
            <VoiceAnnotations
                title={t('familySearch.annotationsTitle')}
                description={t('familySearch.annotationsDescription')}
                source="family-search"
                annotations={annotations}
                isLoading={loadingAnnotations}
                onAnnotationAdded={fetchAnnotations}
                onAnnotationToggled={fetchAnnotations}
                onDeleteAnnotation={handleDeleteAnnotation}
                currentUserId={user?.uid}
            />

            {/* FAQ */}
            <Card className="lg:col-span-2">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>{t('familySearch.faqTitle')}</CardTitle>
                            <CardDescription>{t('familySearch.faqDescription')}</CardDescription>
                        </div>
                        <div className="flex items-center gap-1 border rounded-md">
                            <Button
                                variant={faqFontSize === 'sm' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setFaqFontSize('sm')}
                                title="Letra pequeña"
                            >
                                <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant={faqFontSize === 'base' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setFaqFontSize('base')}
                                title="Letra normal"
                            >
                                <Type className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant={faqFontSize === 'lg' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setFaqFontSize('lg')}
                                title="Letra grande"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Accordion type="single" collapsible className="w-full">
                        {faqData.map((faq, index) => (
                             <AccordionItem value={`item-${index}`} key={index}>
                                <AccordionTrigger className={getFaqFontClass()}>{t(faq.question)}</AccordionTrigger>
                                <AccordionContent>
                                    <p className={`text-muted-foreground leading-relaxed ${getFaqFontClass()}`}>{t(faq.answer)}</p>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    </section>
  );
}
