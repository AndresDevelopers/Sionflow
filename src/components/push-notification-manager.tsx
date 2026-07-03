'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Bell, BellOff } from 'lucide-react';
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
import {
  deleteNotificationToken,
  getExistingNotificationToken,
  requestNotificationPermission,
} from '@/lib/firebase-messaging';
import {
  clearCurrentPushSubscription,
  getCurrentPushSubscription,
  getCurrentPushSubscriptionTarget,
  saveCurrentPushSubscription,
} from '@/lib/push-subscription';

export function PushNotificationManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkSubscription = useCallback(async () => {
    if (!user) {
      setIsSubscribed(false);
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      setIsSubscribed(false);
      return;
    }

    try {
      const subscriptionDoc = await getCurrentPushSubscription(user.uid);
      if (subscriptionDoc) {
        setIsSubscribed(Boolean(subscriptionDoc.fcmToken));
        return;
      }

      const existingToken = await getExistingNotificationToken();
      setIsSubscribed(Boolean(existingToken));
    } catch (error) {
      console.error('Error checking push subscription:', error);
      setIsSubscribed(false);
    }
  }, [user]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    ) {
      setIsSupported(true);
      void checkSubscription();
    }
  }, [checkSubscription]);

  const subscribeToPush = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "No se puede activar las notificaciones en este momento.",
        variant: "destructive"
      });
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      toast({
        title: "Error",
        description: "No se pudo identificar este dispositivo.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      const fcmToken = await requestNotificationPermission();
      if (!fcmToken) {
        toast({
          title: "Permiso Denegado",
          description: "No se otorgo permiso para enviar notificaciones.",
          variant: "destructive"
        });
        return;
      }

      await saveCurrentPushSubscription(user.uid, fcmToken);

      setIsSubscribed(true);
      toast({
        title: "Notificaciones Activadas",
        description: "Recibiras notificaciones push en este dispositivo.",
      });

      if (Notification.permission === 'granted') {
        new Notification('Notificaciones activadas', {
          body: 'Ahora recibiras recordatorios importantes de la aplicacion.',
          icon: '/logo.svg',
          badge: '/logo.svg'
        });
      }
    } catch (error) {
      console.error('Error subscribing to push:', error);
      toast({
        title: "Error",
        description: "No se pudo activar las notificaciones. Intenta de nuevo.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      setShowPermissionDialog(false);
    }
  };

  const unsubscribeFromPush = async () => {
    if (!user) {
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      return;
    }

    setIsLoading(true);
    try {
      await deleteNotificationToken();

      await clearCurrentPushSubscription(user.uid);

      setIsSubscribed(false);
      toast({
        title: "Notificaciones Desactivadas",
        description: "Ya no recibiras notificaciones push en este dispositivo.",
      });
    } catch (error) {
      console.error('Error unsubscribing from push:', error);
      toast({
        title: "Error",
        description: "No se pudo desactivar las notificaciones.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isSupported || !user) {
    return null;
  }

  return (
    <>
      <Button
        variant={isSubscribed ? "outline" : "default"}
        size="sm"
        onClick={() => {
          if (isSubscribed) {
            void unsubscribeFromPush();
          } else {
            setShowPermissionDialog(true);
          }
        }}
        disabled={isLoading}
      >
        {isSubscribed ? (
          <>
            <BellOff className="mr-2 h-4 w-4" />
            Desactivar Notificaciones
          </>
        ) : (
          <>
            <Bell className="mr-2 h-4 w-4" />
            Activar Notificaciones
          </>
        )}
      </Button>

      <AlertDialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activar Notificaciones Push</AlertDialogTitle>
            <AlertDialogDescription>
              Deseas recibir notificaciones push en este dispositivo? Te enviaremos recordatorios importantes sobre:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Cumpleanos de miembros</li>
                <li>Servicios proximos</li>
                <li>Necesidades urgentes de ministracion</li>
                <li>Actividades del quorum</li>
                <li>Asignaciones de la obra misional</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={subscribeToPush}>
              Activar Notificaciones
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
