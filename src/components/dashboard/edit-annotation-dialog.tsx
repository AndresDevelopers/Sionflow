'use client';

import { useState, useEffect } from 'react';
import type { Annotation } from '@/lib/types';
import { doc, updateDoc } from 'firebase/firestore';
import { annotationsCollection } from '@/lib/collections';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Pencil } from 'lucide-react';

interface EditAnnotationDialogProps {
  annotation: Annotation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnnotationUpdated: () => void;
}

export function EditAnnotationDialog({
  annotation,
  open,
  onOpenChange,
  onAnnotationUpdated,
}: EditAnnotationDialogProps) {
  const [editedText, setEditedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (annotation) {
      setEditedText(annotation.text);
    }
  }, [annotation]);

  const handleSave = async () => {
    if (!annotation || !editedText.trim()) return;

    setIsLoading(true);
    try {
      const annotationRef = doc(annotationsCollection, annotation.id);
      await updateDoc(annotationRef, {
        text: editedText.trim(),
      });
      
      onAnnotationUpdated();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating annotation:', error);
      // Optionally show a toast notification here
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Anotación</DialogTitle>
          <DialogDescription>
            Modifica el contenido de la anotación.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            placeholder="Escribe la anotación..."
            rows={4}
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !editedText.trim()}
          >
            {isLoading ? 'Guardando...' : 'Guardar Cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}