
'use client';

import { useState, useEffect, useTransition, useRef, useCallback } from 'react';
import { query, orderBy, addDoc, serverTimestamp, deleteDoc, updateDoc, doc } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import {
  familySearchTrainingsCollection,
  familySearchTasksCollection,
  annotationsCollection,
} from '@/lib/collections';
import type { FamilySearchTraining, FamilySearchTask, Annotation, Member } from '@/lib/types';
import { FamilySelector } from '@/components/family-search/family-selector';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
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
import { PlusCircle, Trash2, Library, BookUser, ListTodo, NotebookPen, Users, Pencil, Type, Minus, Plus } from 'lucide-react';
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

    const fetchData = useCallback(async () => {
        setLoading(true);
        const trainingsSnap = await getDocs(query(familySearchTrainingsCollection, where('barrioOrg', '==', barrioOrg), orderBy('createdAt', 'desc')));
        setTrainings(trainingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FamilySearchTraining)));
        setLoading(false);
    }, [barrioOrg]);

    const fetchAnnotations = useCallback(async () => {
        setLoadingAnnotations(true);
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

    useEffect(() => {
        if (authLoading || !user) return;
        fetchData();
        fetchAnnotations();
    }, [authLoading, user, fetchData, fetchAnnotations]);

    const handleAddTraining = (data: { familyName: string; memberId?: string; memberName?: string }) => {
        const validated = trainingSchema.safeParse(data);

        if (!validated.success) {
            toast({ title: t("familySearch.validation.error"), description: validated.error.errors[0].message, variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            try {
                const trainingData: any = {
                    familyName: data.familyName,
                    barrioOrg,
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
            toast({ title: t("familySearch.validation.error"), description: validated.error.errors[0].message, variant: 'destructive' });
            return;
        }

        startTransition(async () => {
            try {
                await addDoc(familySearchTasksCollection, {
                  task,
                  createdAt: serverTimestamp(),
                  barrioOrg,
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
