
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
  CardFooter,
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
} from "@/components/ui/alert-dialog";
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '../ui/skeleton';
import { CheckCircle, NotebookPen, PlusCircle, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { EditAnnotationDialog } from './edit-annotation-dialog';
import { useAuth } from '@/contexts/auth-context';

interface AnnotationListProps {
  title: string;
  description: string;
  source: 'dashboard' | 'council';
  annotations: Annotation[];
  isLoading: boolean;
  onAnnotationAdded: () => void;
  onAnnotationToggled: () => void;
  showCouncilView?: boolean;
  onResolveAnnotation?: (id: string) => void;
  onDeleteAnnotation?: (id: string) => void;
  currentUserId?: string;
}

export function AnnotationList({
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
}: AnnotationListProps) {
  const { userRole } = useAuth();
  const isSecretary = userRole === 'secretary';
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
              return [id, 'Usuario'] as const;
            }
            const data = userDoc.data() as { name?: string; displayName?: string };
            return [id, data.name ?? data.displayName ?? 'Usuario'] as const;
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
  }, [annotations, userNames]);

  const handleAddAnnotation = async () => {
    if (newAnnotation.trim() === '') return;
    if (!currentUserId) return;
    try {
      await addDoc(annotationsCollection, {
        text: newAnnotation,
        source,
        isCouncilAction: false,
        isResolved: false,
        createdAt: serverTimestamp(),
        userId: currentUserId,
      });
      setNewAnnotation('');
      setOpen(false);
      onAnnotationAdded();
    } catch (error) {
        console.error("Failed to add annotation: ", error);
        // Optionally show a toast to the user
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
        console.error("Failed to toggle annotation: ", error);
        // Optionally show a toast to the user
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
    setSelectedAnnotation(null)
  }

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
        <div className="flex justify-between items-start">
          <div className="flex items-start gap-3">
            <NotebookPen className="h-8 w-8 text-primary" />
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Anotación
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva Anotación</DialogTitle>
                <DialogDescription>
                  Escribe la nota que quieres registrar.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={newAnnotation}
                onChange={(e) => setNewAnnotation(e.target.value)}
                placeholder="Ej: Contactar a la familia Pérez para ofrecer ayuda con la mudanza..."
              />
              <DialogFooter>
                <Button
                  onClick={handleAddAnnotation}
                  disabled={!newAnnotation.trim()}
                >
                  Guardar Anotación
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
            No hay anotaciones.
          </p>
        ) : (
          <ul className="space-y-3">
            {annotations.map((item) => {
              const canManage = isSecretary || (currentUserId && item.userId === currentUserId);

              return (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex items-start gap-3">
                    {!showCouncilView && canManage && (
                      <Checkbox
                        id={`council-${item.id}`}
                        checked={item.isCouncilAction}
                        onCheckedChange={() => handleToggleCouncilAction(item.id, item.isCouncilAction)}
                        aria-label="Marcar para consejo"
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium">{item.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(item.createdAt.toDate(), 'd LLL yyyy, h:mm a', { locale: es })}
                        {item.userId && ` · Por: ${userNames[item.userId] ?? 'Usuario'}`}
                        {showCouncilView &&
                          ` - Creado en: ${item.source === 'dashboard' ? 'Dashboard' : 'Consejo'}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {showCouncilView && onResolveAnnotation && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onResolveAnnotation(item.id)}
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Resolver
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditAnnotation(item)}
                        title="Editar anotación"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {onDeleteAnnotation && canManage && (
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteTrigger(item)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>

    <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
            Esta acción no se puede deshacer. Esto eliminará permanentemente la anotación:{" "}
            <strong>&quot;{selectedAnnotation?.text}&quot;</strong>.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedAnnotation(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive hover:bg-destructive/90"
            >
            Eliminar
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
