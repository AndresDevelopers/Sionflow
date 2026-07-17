/**
 * Single source of truth for the Chrome/Edge `beforeinstallprompt` flow.
 *
 * Multiple components used to each call preventDefault + store their own
 * deferred prompt. That race often made the first "Instalar" tap a no-op
 * (or throw "prompt() may only be called once") while a later tap worked.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type PwaInstallOutcome = 'accepted' | 'dismissed' | 'unavailable' | 'error';

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
let listening = false;
let prompting = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function isPwaInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Wire global listeners once (safe to call from multiple components). */
export function initPwaInstallListeners(): void {
  if (typeof window === 'undefined' || listening) return;
  listening = true;

  if (isPwaInstalled()) {
    installedFlag = true;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    installedFlag = false;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedFlag = true;
    prompting = false;
    notify();
  });
}

export function subscribePwaInstall(listener: Listener): () => void {
  initPwaInstallListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function canPromptPwaInstall(): boolean {
  if (typeof window === 'undefined') return false;
  if (installedFlag || isPwaInstalled()) return false;
  return deferredPrompt != null && !prompting;
}

export function isPwaInstallPrompting(): boolean {
  return prompting;
}

/**
 * Show the native install dialog. Must be called from a direct user gesture.
 * Consumes the deferred event immediately (Chrome allows one prompt() only).
 */
export async function promptPwaInstall(): Promise<PwaInstallOutcome> {
  initPwaInstallListeners();

  if (prompting) return 'unavailable';
  if (!deferredPrompt) return 'unavailable';

  const promptEvent = deferredPrompt;
  deferredPrompt = null;
  prompting = true;
  notify();

  try {
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      installedFlag = true;
    }
    return outcome;
  } catch (error) {
    console.error('[pwa-install] prompt failed', error);
    return 'error';
  } finally {
    prompting = false;
    notify();
  }
}
