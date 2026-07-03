import { useEffect, useState, useCallback } from 'react';
import { useToast } from './use-toast';
import { Button } from '@/components/ui/button';

// Check if running as PWA
const isRunningAsPWA = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Type assertion for navigator with standalone property
  type NavigatorWithStandalone = Navigator & {
    standalone?: boolean | 'true' | 1;
  };
  
  const nav = window.navigator as NavigatorWithStandalone;
  
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true ||
    nav.standalone === 'true' ||
    nav.standalone === 1 ||
    document.referrer.includes('android-app://')
  );
};

// Check if we've shown the toast before
const hasShownToastBefore = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('pwaToastShown') === 'true';
  } catch (e) {
    console.warn('Could not access localStorage:', e);
    return false;
  }
};

// Save that we've shown the toast
const markToastAsShown = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('pwaToastShown', 'true');
  } catch (e) {
    console.warn('Could not save to localStorage:', e);
  }
};

export function usePWAInstallToast() {
  const { toast } = useToast();
  const [hasShownToast, setHasShownToast] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const dismissToast = useCallback(() => {
    setHasShownToast(true);
    markToastAsShown();
  }, []);

  useEffect(() => {
    // Only run on client-side
    if (typeof window === 'undefined') return;

    // Check if we should show the toast
    if (isRunningAsPWA() && !hasShownToastBefore() && !isInstalled) {
      const toastId = 'pwa-install-toast';
      
      // Show the toast with a simple message
      const { dismiss } = toast({
        title: 'App Instalada',
        description: 'QuorumFlow está instalado y funciona completamente offline.',
        duration: 5000, // Auto-dismiss after 5 seconds
      });
      
      // Mark as installed to prevent duplicate toasts
      queueMicrotask(() => {
        setIsInstalled(true);
      });
      markToastAsShown();
      
      // Auto-dismiss after 5 seconds as a fallback
      const timer = setTimeout(() => {
        dismiss();
        dismissToast();
      }, 5000);
      
      return () => {
        clearTimeout(timer);
        dismiss();
      };
    }
  }, [toast, isInstalled, dismissToast]);
}
