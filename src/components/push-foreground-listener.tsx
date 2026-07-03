'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { onMessageListener } from '@/lib/firebase-messaging';

export function PushForegroundListener() {
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = onMessageListener((payload) => {
      const title =
        (typeof payload.notification === 'object' && payload.notification && 'title' in payload.notification
          ? payload.notification.title
          : null) ??
        (typeof payload.data === 'object' && payload.data && 'title' in payload.data
          ? payload.data.title
          : null) ??
        'QuorumFlow';

      const body =
        (typeof payload.notification === 'object' && payload.notification && 'body' in payload.notification
          ? payload.notification.body
          : null) ??
        (typeof payload.data === 'object' && payload.data && 'body' in payload.data
          ? payload.data.body
          : null) ??
        'Tienes una nueva notificacion.';

      const url =
        typeof payload.data === 'object' && payload.data && 'url' in payload.data && typeof payload.data.url === 'string'
          ? payload.data.url
          : null;

      toast({
        title: typeof title === 'string' ? title : 'QuorumFlow',
        description: typeof body === 'string' ? body : 'Tienes una nueva notificacion.',
        ...(url
          ? {
            action: (
              <ToastAction altText="Abrir notificacion" onClick={() => router.push(url)}>
                Abrir
              </ToastAction>
            ),
          }
          : {}),
      });
    });

    return () => {
      unsubscribe();
    };
  }, [router, toast]);

  return null;
}
