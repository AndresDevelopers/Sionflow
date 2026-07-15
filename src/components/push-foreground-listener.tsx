'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { onMessageListener } from '@/lib/firebase-messaging';
import { getAppName } from "@/lib/app-config";

const appName = getAppName();

export function PushForegroundListener() {
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = onMessageListener((payload) => {
      const data =
        typeof payload.data === 'object' && payload.data ? payload.data : null;

      // Silent data-sync from data-sync-publisher CF — refresh without toast.
      // User-facing pushes from notification-dispatcher use type "user-notification"
      // and must NOT trigger auto data refresh (that CF already wrote c_notifications).
      if (data && 'type' in data && data.type === 'data-sync') {
        const d = data as Record<string, unknown>;
        window.dispatchEvent(
          new CustomEvent('sionflow:data-sync', {
            detail: {
              barrioOrg: typeof d.barrioOrg === 'string' ? d.barrioOrg : undefined,
              version: typeof d.version === 'string' ? d.version : undefined,
              collection: typeof d.collection === 'string' ? d.collection : undefined,
            },
          })
        );
        return;
      }

      const title =
        (typeof payload.notification === 'object' && payload.notification && 'title' in payload.notification
          ? payload.notification.title
          : null) ??
        (data && 'title' in data ? data.title : null) ??
        appName;

      const body =
        (typeof payload.notification === 'object' && payload.notification && 'body' in payload.notification
          ? payload.notification.body
          : null) ??
        (data && 'body' in data ? data.body : null) ??
        'Tienes una nueva notificacion.';

      const url =
        data && 'url' in data && typeof data.url === 'string'
          ? data.url
          : null;

      toast({
        title: typeof title === 'string' ? title : appName,
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
