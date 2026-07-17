'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';
import { Button } from "@/components/ui/button";
import { X, Download, Loader2 } from 'lucide-react';
import { getAppName } from "@/lib/app-config";
import {
  canPromptPwaInstall,
  initPwaInstallListeners,
  isPwaInstalled,
  isPwaInstallPrompting,
  promptPwaInstall,
  subscribePwaInstall,
} from '@/lib/pwa-install';

const appName = getAppName();

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /CriOS\//i.test(ua) || (/Chrome\//i.test(ua) && !/Edge|Edg|OPR|Opera/i.test(ua));
}

function isSafariIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent) && !/CriOS/i.test(navigator.userAgent);
}

/** Stable string snapshot for useSyncExternalStore (must be referentially stable when unchanged). */
function getInstallSnapshot(): string {
  return [
    canPromptPwaInstall() ? '1' : '0',
    isPwaInstallPrompting() ? '1' : '0',
    isPwaInstalled() ? '1' : '0',
  ].join(':');
}

function parseInstallSnapshot(snapshot: string) {
  const [canInstall, installing, installed] = snapshot.split(':');
  return {
    canInstall: canInstall === '1',
    installing: installing === '1',
    installed: installed === '1',
  };
}

function usePwaInstallState() {
  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      initPwaInstallListeners();
      return subscribePwaInstall(onStoreChange);
    },
    getInstallSnapshot,
    () => '0:0:0',
  );
  return parseInstallSnapshot(snapshot);
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function InstallPrompt() {
  const isClient = useIsClient();
  const { canInstall, installing, installed } = usePwaInstallState();
  const [dismissed, setDismissed] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [localInstalling, setLocalInstalling] = useState(false);
  // Drop stale errors once Chrome re-offers a deferred prompt.
  const displayError = canInstall ? null : errorHint;

  const handleInstall = useCallback(async () => {
    if (localInstalling || installing || !canPromptPwaInstall()) return;

    setErrorHint(null);
    setLocalInstalling(true);
    try {
      const outcome = await promptPwaInstall();
      if (outcome === 'accepted') {
        setDismissed(true);
        return;
      }
      if (outcome === 'dismissed') {
        setErrorHint('Instalación cancelada. Puedes intentar de nuevo desde el menú de Chrome (⋮ → Instalar app).');
        return;
      }
      if (outcome === 'unavailable') {
        setErrorHint('Chrome aún no está listo para instalar. Espera unos segundos y vuelve a intentar.');
        return;
      }
      setErrorHint('No se pudo abrir el instalador. Prueba de nuevo o usa el menú de Chrome (⋮ → Instalar app).');
    } finally {
      setLocalInstalling(false);
    }
  }, [localInstalling, installing]);

  if (!isClient || dismissed || !isMobileDevice() || installed || isPwaInstalled()) {
    return null;
  }

  const busy = localInstalling || installing;
  const onChrome = isChromeBrowser();
  const onIOS = isSafariIOS();
  const showChromeInstall = onChrome && (canInstall || busy || !!displayError);
  const showManual = !onChrome;

  if (!showChromeInstall && !showManual) return null;

  return (
    // Outer: full viewport width + horizontal padding (avoids inset-x + w-full overflow).
    // Inner: capped width, min-w-0 so long app names wrap instead of stretching the card.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 box-border w-full max-w-[100vw] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
      <div className="pointer-events-auto mx-auto w-full min-w-0 max-w-sm overflow-hidden rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:p-4">
        <div className="mb-3 flex min-w-0 items-start gap-2">
          <h3 className="flex min-w-0 flex-1 items-start gap-2 text-sm font-medium leading-snug sm:text-base">
            <Download className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">Instalar {appName}</span>
          </h3>
          <button
            onClick={() => setDismissed(true)}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {onChrome && (canInstall || busy) ? (
          <>
            <p className="mb-3 break-words text-sm text-muted-foreground">
              Instala {appName} para acceso rápido y uso sin conexión.
            </p>
            <Button
              onClick={handleInstall}
              size="sm"
              className="h-11 w-full max-w-full"
              disabled={busy || !canInstall}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                  Instalando…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4 shrink-0" />
                  Instalar
                </>
              )}
            </Button>
            {displayError && (
              <p className="mt-2 break-words text-xs text-muted-foreground">{displayError}</p>
            )}
          </>
        ) : onChrome && displayError ? (
          <p className="break-words text-sm text-muted-foreground">{displayError}</p>
        ) : onIOS ? (
          <p className="break-words text-sm text-muted-foreground">
            Para instalar {appName}: toca el botón <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.
          </p>
        ) : (
          <p className="break-words text-sm text-muted-foreground">
            Para instalar {appName} abre esta página en <strong>Google Chrome</strong>.
          </p>
        )}
      </div>
    </div>
  );
}
