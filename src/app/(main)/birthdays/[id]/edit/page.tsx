
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { birthdaysCollection } from '@/lib/collections';
import type { Birthday } from '@/lib/types';
import { BirthdayForm } from '../../BirthdayForm';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/i18n-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function EditBirthdayPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const { id } = params;
  const [birthday, setBirthday] = useState<Birthday | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const birthdayId = Array.isArray(id) ? id[0] : id;

  const fetchBirthday = useCallback(async () => {
    if (!birthdayId || !user) return;

    setLoading(true);
    try {
      const docRef = doc(birthdaysCollection, birthdayId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setBirthday({ id: docSnap.id, ...docSnap.data() } as Birthday);
        setIsFormOpen(true); // Open the dialog once data is fetched
      } else {
        toast({ title: t('birthdays.error'), description: t('birthdayEdit.notFound'), variant: "destructive"});
        router.push('/birthdays');
      }
    } catch (err) {
      toast({ title: t('birthdays.error'), description: t('birthdayEdit.loadError'), variant: "destructive"});
      router.push('/birthdays');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [birthdayId, user, router, toast, t]);

  useEffect(() => {
    fetchBirthday();
  }, [fetchBirthday]);

  const handleFormClose = useCallback(() => {
    setIsFormOpen(false);
    // Use a timeout to allow the dialog to close before navigating
    setTimeout(() => router.push('/birthdays'), 150);
  }, [router]);

  if (loading || authLoading) {
    return (
        <Dialog open={true}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="sr-only">{t('birthdayEdit.loading')}</DialogTitle>
                </DialogHeader>
                <div className="max-w-md w-full mx-auto space-y-4">
                    <Skeleton className="h-10 w-1/3" />
                    <Skeleton className="h-8 w-1/2" />
                    <div className="space-y-6 p-6 border rounded-lg bg-background">
                    <Skeleton className="h-24 w-24 rounded-full mx-auto" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <div className="flex justify-end gap-2">
                        <Skeleton className="h-10 w-24" />
                    </div>
                    </div>
                </div>
            </DialogContent>
      </Dialog>
    );
  }

  return (
    <BirthdayForm
        isOpen={isFormOpen}
        onOpenChange={handleFormClose}
        onFormSubmit={() => router.push('/birthdays')}
        birthday={birthday ?? undefined}
    />
  );
}
