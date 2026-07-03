'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { servicesCollection } from '@/lib/collections';
import type { Service } from '@/lib/types';
import { ServiceForm } from '../../ServiceForm';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditServicePage() {
  const params = useParams();
  const { id } = params;
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const serviceId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!serviceId) return;

    const fetchService = async () => {
      try {
        const docRef = doc(servicesCollection, serviceId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setService({ id: docSnap.id, ...docSnap.data() } as Service);
        } else {
          setError('Servicio no encontrado.');
        }
      } catch (err) {
        setError('Error al cargar el servicio.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [serviceId]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-8 w-1/2" />
        <div className="space-y-6 p-6">
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

  if (!service) {
    return null;
  }

  return <ServiceForm service={service} />;
}
