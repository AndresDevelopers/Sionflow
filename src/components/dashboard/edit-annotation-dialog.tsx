'use client';

import { useState } from 'react';
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
import { useI18n } from '@/contexts/i18n-context';

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
  const { t } = useI18n();
  const [editedText, setEditedText] = useState(annotation?.text ?? '');
  const [prevAnnotation, setPrevAnnotation] = useState(annotation);
  if (annotation !== prevAnnotation) {
    setPrevAnnotation(annotation);
    if (annotation) {
      setEditedText(annotation.text);
    }
  }
  const [isLoading, setIsLoading] = useState(false);

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
          <DialogTitle>{t('dashboard.editAnnotation.title')}</DialogTitle>
          <DialogDescription>
            {t('dashboard.editAnnotation.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            placeholder={t('dashboard.editAnnotation.placeholder')}
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
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || !editedText.trim()}
          >
            {isLoading ? t('dashboard.editAnnotation.saving') : t('dashboard.editAnnotation.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}