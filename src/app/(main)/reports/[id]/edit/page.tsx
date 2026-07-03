'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { activitiesCollection } from '@/lib/collections';
import type { Activity } from '@/lib/types';
import { ActivityForm } from '../../ActivityForm';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditActivityPage() {
  const params = useParams();
  const { id } = params;
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activityId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!activityId) return;

    const fetchActivity = async () => {
      try {
        const docRef = doc(activitiesCollection, activityId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setActivity({ id: docSnap.id, ...docSnap.data() } as Activity);
        } else {
          setError('Actividad no encontrada.');
        }
      } catch (err) {
        setError('Error al cargar la actividad.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchActivity();
  }, [activityId]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-8 w-1/2" />
        <div className="space-y-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-destructive">{error}</div>;
  }

  if (!activity) {
    return null;
  }

  return <ActivityForm activity={activity} />;
}
