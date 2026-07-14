'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Bell, BellRing, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  isBrowserPushApiAvailable,
  isIosLikeDevice,
  isStandaloneDisplayMode,
  PushEnableError,
  requestNotificationPermission,
} from '@/lib/firebase-messaging';
import {
  getCurrentPushSubscription,
  getCurrentPushSubscriptionTarget,
  isActivePushSubscription,
  saveCurrentPushSubscription,
  syncAccountPushEnabledFlag,
} from '@/lib/push-subscription';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { usersCollection } from '@/lib/collections';
import { normalizeRole, leadershipRoles } from '@/lib/roles';
import logger from '@/lib/logger';
import { useI18n } from '@/contexts/i18n-context';

const DISMISSAL_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000; // 15 días

export function PushOnboardingGuide() {
  const { user, firebaseUser, userRole } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const [showGuide, setShowGuide] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Verificar si el navegador soporta notificaciones push (Android antiguos → 16, desktop, iOS PWA)
  useEffect(() => {
    if (!isBrowserPushApiAvailable()) {
      setIsSupported(false);
      return;
    }
    // iOS only supports web push when installed to home screen
    if (isIosLikeDevice() && !isStandaloneDisplayMode()) {
      setIsSupported(false);
      return;
    }
    setIsSupported(true);
  }, []);

  /** True only if THIS device already opted in (not another phone on the same account). */
  const checkSubscription = useCallback(async () => {
    if (!user) return false;

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) return false;

    try {
      const subscriptionDoc = await getCurrentPushSubscription(user.uid);
      return isActivePushSubscription(subscriptionDoc);
    } catch {
      return false;
    }
  }, [user]);

  // Lógica principal: decidir si mostrar la guía
  useEffect(() => {
    let isMounted = true;

    const checkOnboardingStatus = async () => {
      if (!user || !firebaseUser || !isSupported) {
        if (isMounted) setIsChecking(false);
        return;
      }

      try {
        const userDocRef = doc(usersCollection, firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (!isMounted) return;

        if (!userDoc.exists()) {
          setIsChecking(false);
          return;
        }

        const data = userDoc.data();
        const role = normalizeRole(data.role);
        const dismissedAt = data.pushOnboardingDismissedAt;

        // Solo mostrar a roles de liderazgo
        if (!leadershipRoles.includes(role as typeof leadershipRoles[number])) {
          setIsChecking(false);
          return;
        }

        // Solo importa el estado de ESTE dispositivo (no el flag de cuenta)
        const subscribed = await checkSubscription();
        if (isMounted) setIsSubscribed(subscribed);

        if (subscribed) {
          setIsChecking(false);
          return;
        }

        // Si nunca ha descartado la guía → mostrar
        if (!dismissedAt) {
          if (isMounted) {
            setShowGuide(true);
            setIsChecking(false);
          }
          return;
        }

        // Si descartó hace más de 15 días → mostrar de nuevo
        const dismissedMs = dismissedAt.toMillis ? dismissedAt.toMillis() : 0;
        const now = Date.now();
        if (now - dismissedMs >= DISMISSAL_COOLDOWN_MS) {
          if (isMounted) {
            setShowGuide(true);
            setIsChecking(false);
          }
          return;
        }

        if (isMounted) setIsChecking(false);
      } catch (error) {
        logger.error({ error, message: 'Error checking push onboarding status' });
        if (isMounted) setIsChecking(false);
      }
    };

    checkOnboardingStatus();

    return () => {
      isMounted = false;
    };
  }, [user, firebaseUser, isSupported, userRole, checkSubscription]);

  const handleDismiss = async () => {
    if (!firebaseUser) return;

    try {
      const userDocRef = doc(usersCollection, firebaseUser.uid);
      await setDoc(userDocRef, {
        pushOnboardingDismissedAt: serverTimestamp(),
      }, { merge: true });

      setShowGuide(false);
    } catch (error) {
      logger.error({ error, message: 'Error dismissing push onboarding guide' });
      setShowGuide(false);
    }
  };

  const handleActivate = async () => {
    if (!user || !firebaseUser) {
      toast({
        title: t('common.error'),
        description: t('push.onboarding.toast.cannotEnable'),
        variant: 'destructive',
      });
      return;
    }

    const target = getCurrentPushSubscriptionTarget(user.uid);
    if (!target) {
      toast({
        title: t('common.error'),
        description: t('push.onboarding.toast.deviceIdError'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const fcmToken = await requestNotificationPermission();
      if (!fcmToken) {
        toast({
          title: t('push.onboarding.toast.permissionDeniedTitle'),
          description: t('push.onboarding.toast.permissionDeniedDescription'),
          variant: 'destructive',
        });
        await handleDismiss();
        return;
      }

      await saveCurrentPushSubscription(user.uid, fcmToken);

      // Account flag = any device active; onboarding dismiss is account-level
      await syncAccountPushEnabledFlag(user.uid);
      const userDocRef = doc(usersCollection, firebaseUser.uid);
      await setDoc(userDocRef, {
        pushOnboardingDismissedAt: serverTimestamp(),
      }, { merge: true });

      setIsSubscribed(true);
      setShowGuide(false);

      toast({
        title: t('push.onboarding.toast.enabledTitle'),
        description: t('push.onboarding.toast.enabledDescription'),
      });

      // Notificación de bienvenida (skip if Notification constructor is restricted)
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(t('push.onboarding.nativeTitle'), {
            body: t('push.onboarding.nativeBody'),
            icon: '/icono-app.png',
            badge: '/icono-app.png',
          });
        }
      } catch {
        // Some Android WebViews allow permission but block the Notification constructor
      }
    } catch (error) {
      logger.error({ error, message: 'Error activating push from onboarding guide' });
      let description = t('push.onboarding.toast.activateError');
      if (error instanceof PushEnableError) {
        if (error.code === 'permission-denied' || error.code === 'permission-dismissed') {
          description = t('push.onboarding.toast.permissionDeniedDescription');
        } else if (error.code === 'ios-not-standalone') {
          description = t('settings.toast.pushIosStandaloneDesc');
        } else if (error.code === 'service-worker') {
          description = t('settings.toast.pushServiceWorkerDesc');
        }
      }
      toast({
        title: t('common.error'),
        description,
        variant: 'destructive',
      });
      // Keep guide available so the user can retry (do not dismiss on transient SW/token errors)
      if (
        error instanceof PushEnableError &&
        (error.code === 'permission-denied' || error.code === 'ios-not-standalone')
      ) {
        await handleDismiss();
      }
    } finally {
      setIsLoading(false);
    }
  };

  // No mostrar nada mientras se verifica o si no aplica
  if (isChecking || !showGuide || !isSupported || !user) {
    return null;
  }

  return (
    <AlertDialog open={showGuide} onOpenChange={(open) => {
      if (!open) handleDismiss();
    }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <BellRing className="h-7 w-7 text-primary" />
          </div>
          <AlertDialogTitle className="text-center text-lg">
            {t('push.onboarding.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center space-y-3">
            <p>
              {t('push.onboarding.description')}
            </p>
            <ul className="text-left list-disc list-inside space-y-1 text-sm">
              <li>{t('push.onboarding.item.birthdays')}</li>
              <li>{t('push.onboarding.item.urgentFamilies')}</li>
              <li>{t('push.onboarding.item.activities')}</li>
              <li>{t('push.onboarding.item.missionary')}</li>
              <li>{t('push.onboarding.item.council')}</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('push.onboarding.skipHint')}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <AlertDialogAction
            onClick={handleActivate}
            disabled={isLoading}
            className="w-full"
          >
            <Bell className="mr-2 h-4 w-4" />
            {isLoading ? t('push.onboarding.activating') : t('push.onboarding.activate')}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={handleDismiss}
            disabled={isLoading}
            className="w-full"
          >
            <X className="mr-2 h-4 w-4" />
            {t('push.onboarding.skip')}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
