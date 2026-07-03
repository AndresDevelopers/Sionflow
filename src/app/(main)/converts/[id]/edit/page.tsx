
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { convertsCollection } from '@/lib/collections';
import type { Convert } from '@/lib/types';
import { ConvertForm } from '../../ConvertForm';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function EditConvertPage() {
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const { id } = params;
  const [convert, setConvert] = useState<Convert | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const convertId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!convertId || !user) return;

    const fetchConvert = async () => {
      setLoading(true);
      try {
        const docRef = doc(convertsCollection, convertId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConvert({ id: docSnap.id, ...docSnap.data() } as Convert);
        } else {
          setError('Converso no encontrado.');
        }
      } catch (err) {
        setError('Error al cargar los datos del converso.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchConvert();
  }, [convertId, user]);

  if (loading || authLoading) {
    return (
      <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
                <DialogTitle className="sr-only">Cargando</DialogTitle>
            </DialogHeader>
            <div className="max-w-2xl mx-auto space-y-4">
                <Skeleton className="h-10 w-1/3" />
                <Skeleton className="h-8 w-1/2" />
                <div className="space-y-6 p-6 border rounded-lg">
                <Skeleton className="h-24 w-24 rounded-full mx-auto" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <div className="flex justify-end gap-2">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-10 w-24" />
                </div>
                </div>
            </div>
          </DialogContent>
      </Dialog>
    );
  }

  if (error) {
    return <div className="text-center text-destructive">{error}</div>;
  }

  return convert ? <ConvertForm convert={convert} /> : null;
}
