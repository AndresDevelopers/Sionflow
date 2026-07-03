'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getIdToken } from 'firebase/auth';
import { AlertCircle, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getBrowserPushDiagnostics } from '@/lib/firebase-messaging';
import type { BrowserPushDiagnostics, PushDiagnosticsResponse, PushSubscriptionDiagnostic } from '@/lib/push-diagnostics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatIsoDate(value: string | null): string {
  if (!value) {
    return 'Sin datos';
  }

  return new Intl.DateTimeFormat('es-EC', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'America/Guayaquil',
  }).format(new Date(value));
}

function getResultVariant(result: PushSubscriptionDiagnostic['lastPushResult']) {
  if (result === 'success') {
    return 'default' as const;
  }

  if (result === 'failure' || result === 'invalid-token') {
    return 'destructive' as const;
  }

  return 'secondary' as const;
}

export function PushDeviceDiagnostics() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserPushDiagnostics | null>(null);
  const [serverDiagnostics, setServerDiagnostics] = useState<PushDiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDryRunLoading, setIsDryRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async (runDryCheck = false) => {
    if (!user || !auth.currentUser) {
      return;
    }

    if (runDryCheck) {
      setIsDryRunLoading(true);
    } else {
      setIsLoading(true);
    }

    try {
      const [browserState, idToken] = await Promise.all([
        getBrowserPushDiagnostics(),
        getIdToken(auth.currentUser, true),
      ]);

      const response = await fetch('/api/push/diagnostics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ runDryCheck }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.details ?? payload?.error ?? 'No se pudo cargar el diagnostico push.');
      }

      const payload = await response.json() as PushDiagnosticsResponse;
      setBrowserDiagnostics(browserState);
      setServerDiagnostics(payload);
      setError(null);

      if (runDryCheck) {
        toast({
          title: 'Prueba de push completada',
          description: `Tokens revisados: ${payload.dryRunSummary?.tokensChecked ?? 0}. Exitosos: ${payload.dryRunSummary?.successCount ?? 0}.`,
        });
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'No se pudo cargar el diagnostico push.';
      setError(message);
      toast({
        title: 'Error de diagnostico',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsDryRunLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadDiagnostics(false);
  }, [loadDiagnostics, user]);

  const currentDeviceSubscription = useMemo(() => {
    if (!serverDiagnostics || !browserDiagnostics?.deviceId) {
      return null;
    }

    return serverDiagnostics.subscriptions.find(
      (subscription) => subscription.deviceId === browserDiagnostics.deviceId
    ) ?? null;
  }, [browserDiagnostics?.deviceId, serverDiagnostics]);

  if (!user) {
    return null;
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Push en este dispositivo
            </CardTitle>
            <CardDescription>
              Estado local del navegador, suscripcion guardada en Firestore y ultima validacion del servidor.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadDiagnostics(false)}
              disabled={isLoading || isDryRunLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Actualizar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void loadDiagnostics(true)}
              disabled={isLoading || isDryRunLoading}
            >
              {isDryRunLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Dry-run
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Compatibilidad</div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={browserDiagnostics?.isSupported ? 'default' : 'secondary'}>
                {browserDiagnostics?.isSupported ? 'Compatible' : 'No compatible'}
              </Badge>
              <Badge variant="outline">{browserDiagnostics?.permission ?? 'Cargando'}</Badge>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Service Worker</div>
            <div className="mt-2 font-medium">{browserDiagnostics?.serviceWorkerScriptUrl ?? 'No registrado'}</div>
            <div className="text-xs text-muted-foreground">{browserDiagnostics?.serviceWorkerState ?? 'Sin estado'}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Device ID</div>
            <div className="mt-2 break-all font-mono text-xs">{browserDiagnostics?.deviceId ?? 'No disponible'}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Flag de usuario</div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={serverDiagnostics?.pushNotificationsEnabled ? 'default' : 'secondary'}>
                {serverDiagnostics?.pushNotificationsEnabled ? 'Push activado' : 'Push desactivado'}
              </Badge>
              <Badge variant={serverDiagnostics?.inAppNotificationsEnabled ? 'outline' : 'secondary'}>
                {serverDiagnostics?.inAppNotificationsEnabled ? 'In-app activa' : 'In-app desactivada'}
              </Badge>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Servidor</div>
            <div className="mt-2 text-sm">{serverDiagnostics?.serverTimeEcuador ?? 'Sin datos'}</div>
            <div className="text-xs text-muted-foreground">{serverDiagnostics?.serverTimeUtc ?? ''}</div>
          </div>

          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Dry-run</div>
            <div className="mt-2 text-sm">
              {serverDiagnostics?.dryRunSummary
                ? `${serverDiagnostics.dryRunSummary.successCount}/${serverDiagnostics.dryRunSummary.tokensChecked} tokens validos`
                : 'Aun no ejecutado'}
            </div>
            <div className="text-xs text-muted-foreground">
              {serverDiagnostics?.dryRunSummary
                ? `${serverDiagnostics.dryRunSummary.failureCount} fallidos`
                : 'Usa el boton Dry-run para validar FCM'}
            </div>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Suscripcion actual</div>
              <div className="text-xs text-muted-foreground">
                Coincidencia entre el dispositivo local y el documento en `c_push_subscriptions`.
              </div>
            </div>
            <Badge variant={currentDeviceSubscription?.hasToken ? 'default' : 'secondary'}>
              {currentDeviceSubscription?.hasToken ? 'Token presente' : 'Sin token'}
            </Badge>
          </div>

          {currentDeviceSubscription ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Documento</div>
                <div className="mt-1 break-all font-mono text-xs">{currentDeviceSubscription.docId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Actualizado</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.updatedAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Suscrito</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.subscribedAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Ultimo intento</div>
                <div className="mt-1">{formatIsoDate(currentDeviceSubscription.lastPushAttemptAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Resultado</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={getResultVariant(currentDeviceSubscription.lastPushResult)}>
                    {currentDeviceSubscription.lastPushResult ?? 'Sin intentos'}
                  </Badge>
                  {currentDeviceSubscription.lastPushAttemptMode && (
                    <Badge variant="outline">{currentDeviceSubscription.lastPushAttemptMode}</Badge>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Error</div>
                <div className="mt-1 break-all text-xs">
                  {currentDeviceSubscription.dryRunErrorCode ??
                    currentDeviceSubscription.lastPushErrorCode ??
                    'Sin error'}
                </div>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Ultimo tag</div>
                <div className="mt-1 break-all text-xs">{currentDeviceSubscription.lastNotificationTag ?? 'Sin tag'}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Este dispositivo aun no tiene un documento de suscripcion asociado en Firestore.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
