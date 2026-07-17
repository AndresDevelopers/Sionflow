'use client';

import { useEffect, useState } from 'react';
import type { Annotation } from '@/lib/types';
import {
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { annotationsCollection, usersCollection } from '@/lib/collections';

import { Button } from '@/components/ui/button';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '../ui/skeleton';
import { CheckCircle, NotebookPen, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { EditAnnotationDialog } from '../dashboard/edit-annotation-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

interface VoiceAnnotationsProps {
  title: string;
  description: string;
  source: 'dashboard' | 'council' | 'family-search' | 'missionary-work' | 'service' | 'activities';
  annotations: Annotation[];
  isLoading: boolean;
  onAnnotationAdded: () => void;
  onAnnotationToggled: () => void;
  showCouncilView?: boolean;
  onResolveAnnotation?: (id: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  currentUserId?: string;
}

export function VoiceAnnotations({
  title,
  description,
  source,
  annotations,
  isLoading,
  onAnnotationAdded,
  onAnnotationToggled,
  showCouncilView = false,
  onResolveAnnotation,
  onDeleteAnnotation,
  currentUserId,
}: VoiceAnnotationsProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const { userRole, barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const isSecretary = userRole === 'secretary';
  const userFallback = t('voiceAnnotations.userFallback');
  const [open, setOpen] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState('');
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [annotationToEdit, setAnnotationToEdit] = useState<Annotation | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    const fetchUserNames = async () => {
      const uniqueUserIds = Array.from(
        new Set(annotations.map((annotation) => annotation.userId).filter(Boolean))
      );
      const missingUserIds = uniqueUserIds.filter((id) => !userNames[id]);

      if (missingUserIds.length === 0) return;

      try {
        const entries = await Promise.all(
          missingUserIds.map(async (id) => {
            const userDocRef = doc(usersCollection, id);
            const userDoc = await getDoc(userDocRef);
            if (!userDoc.exists()) {
              return [id, userFallback] as const;
            }
            const data = userDoc.data() as { name?: string; displayName?: string };
            return [id, data.name ?? data.displayName ?? userFallback] as const;
          })
        );

        if (isMounted) {
          setUserNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } catch (error) {
        console.error('Error fetching annotation user names:', error);
      }
    };

    fetchUserNames();

    return () => {
      isMounted = false;
    };
  }, [annotations, userNames, userFallback]);

  const handleAddAnnotation = async () => {
    if (newAnnotation.trim() === '') return;
    if (!currentUserId) return;

    try {
      const { requireBarrioOrg } = await import('@/lib/tenant-scope');
      const scopedBarrioOrg = requireBarrioOrg(
        barrioOrg,
        t('voiceAnnotations.toast.saveErrorDescription') ||
          'Usuario sin barrio/organización. No se puede guardar la nota.'
      );

      await addDoc(annotationsCollection, {
        text: newAnnotation.trim(),
        source,
        isCouncilAction: false,
        isResolved: false,
        createdAt: serverTimestamp(),
        userId: currentUserId,
        barrioOrg: scopedBarrioOrg,
      });

      setNewAnnotation('');
      setOpen(false);
      onAnnotationAdded();

      toast({
        title: t('voiceAnnotations.toast.savedTitle'),
        description: t('voiceAnnotations.toast.savedDescription'),
      });
    } catch (error) {
      console.error('Failed to add annotation: ', error);
      toast({
        title: t('voiceAnnotations.toast.saveErrorTitle'),
        description: t('voiceAnnotations.toast.saveErrorDescription'),
        variant: 'destructive',
      });
    }
  };

  const handleToggleCouncilAction = async (
    id: string,
    currentStatus: boolean
  ) => {
    try {
      const annotationRef = doc(annotationsCollection, id);
      await updateDoc(annotationRef, { isCouncilAction: !currentStatus });
      onAnnotationToggled();
    } catch (error) {
      console.error('Failed to toggle annotation: ', error);
      toast({
        title: t('voiceAnnotations.toast.saveErrorTitle'),
        description: t('voiceAnnotations.toast.updateErrorDescription'),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteTrigger = (annotation: Annotation) => {
    setSelectedAnnotation(annotation);
    setIsAlertOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (selectedAnnotation && onDeleteAnnotation) {
      onDeleteAnnotation(selectedAnnotation.id);
    }
    setIsAlertOpen(false);
    setSelectedAnnotation(null);
  };

  const handleEditAnnotation = (annotation: Annotation) => {
    setAnnotationToEdit(annotation);
    setEditDialogOpen(true);
  };

  const handleAnnotationUpdated = () => {
    onAnnotationAdded();
    setEditDialogOpen(false);
    setAnnotationToEdit(null);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <NotebookPen className="h-8 w-8 text-primary shrink-0" />
              <div className="min-w-0">
                <CardTitle className="break-words">{title}</CardTitle>
                <CardDescription className="break-words">{description}</CardDescription>
              </div>
            </div>
            {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="shrink-0 w-full sm:w-auto">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('voiceAnnotations.addButton')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('voiceAnnotations.newTitle')}</DialogTitle>
                  <DialogDescription>
                    {t('voiceAnnotations.newDescription')}
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={newAnnotation}
                  onChange={(e) => setNewAnnotation(e.target.value)}
                  placeholder={t('voiceAnnotations.placeholder')}
                  rows={4}
                />
                <DialogFooter>
                  <Button
                    onClick={handleAddAnnotation}
                    disabled={!newAnnotation.trim()}
                  >
                    {t('voiceAnnotations.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : annotations.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {t('voiceAnnotations.empty')}
            </p>
          ) : (
            <ul className="space-y-3">
              {annotations.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-start sm:justify-between rounded-md border p-3 gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {!showCouncilView && (
                      <Checkbox
                        id={`council-${item.id}`}
                        checked={item.isCouncilAction}
                        onCheckedChange={() => handleToggleCouncilAction(item.id, item.isCouncilAction)}
                        aria-label={t('voiceAnnotations.markForCouncilAria')}
                        className="shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words">{item.text}</p>
                      <p className="text-xs text-muted-foreground break-words">
                        {format(item.createdAt.toDate(), 'd LLL yyyy, h:mm a', { locale: getDateFnsLocale() })}
                        {item.userId && t('voiceAnnotations.byUser', { name: userNames[item.userId] ?? userFallback })}
                        {showCouncilView && t('voiceAnnotations.createdIn', {
                          source: t(`voiceAnnotations.source.${item.source}`),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 sm:shrink-0">
                    {showCouncilView && onResolveAnnotation && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onResolveAnnotation(item.id)}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        {t('voiceAnnotations.resolve')}
                      </Button>
                    )}
                    {canWrite && (isSecretary || (currentUserId && item.userId === currentUserId)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditAnnotation(item)}
                        title={t('voiceAnnotations.editTitle')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canWrite && onDeleteAnnotation && (isSecretary || (currentUserId && item.userId === currentUserId)) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTrigger(item)}
                        title={t('voiceAnnotations.deleteTitle')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('voiceAnnotations.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('voiceAnnotations.deleteConfirmDescription')}{' '}
              <strong>&quot;{selectedAnnotation?.text}&quot;</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedAnnotation(null)}>
              {t('voiceAnnotations.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive hover:bg-destructive/90"
            >
              {t('voiceAnnotations.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditAnnotationDialog
        annotation={annotationToEdit}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onAnnotationUpdated={handleAnnotationUpdated}
      />
    </>
  );
}
