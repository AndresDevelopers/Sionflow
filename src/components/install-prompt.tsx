'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { X, Download, ExternalLink } from 'lucide-react';
import { getAppName } from "@/lib/app-config";

const appName = getAppName();

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome/i.test(ua) && !/Edge|Edg|OPR|Opera/i.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isOnChrome, setIsOnChrome] = useState(true);

  useEffect(() => {
    if (!isMobile() || isStandalone()) return;

    const onChrome = isChrome();
    setIsOnChrome(onChrome);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
      setShowPrompt(true);
    };

    const handleAppInstalled = () => {
      setShowPrompt(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (!onChrome) {
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleOpenInChrome = () => {
    window.open(window.location.href, '_blank');
  };

  if (!showPrompt || isDismissed || !isMobile() || isStandalone()) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 w-full max-w-[min(100%,24rem)] mx-auto">
      <div className="pointer-events-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <Download className="h-4 w-4" />
            Instalar {appName}
          </h3>
          <button
            onClick={() => setIsDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {canInstall && isOnChrome ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Instala {appName} para acceso rápido y funcionalidad offline.
            </p>
            <Button onClick={handleInstall} size="sm" className="h-11 w-full">
              <Download className="mr-2 h-4 w-4" />
              Instalar
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Para instalar {appName}, abre esta página en <strong>Google Chrome</strong>.
            </p>
            <Button onClick={handleOpenInChrome} size="sm" className="h-11 w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir en Chrome
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
