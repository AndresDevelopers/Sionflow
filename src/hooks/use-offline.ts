'use client';

import { useState, useEffect, useCallback } from 'react';

interface OfflineState {
    isOnline: boolean;
    isInstalled: boolean;
    syncInProgress: boolean;
    queuedOperations: number;
}

interface OfflineHook extends OfflineState {
    forceSync: () => Promise<void>;
    installApp: () => Promise<void>;
    canInstall: boolean;
}

export function useOffline(): OfflineHook {
    // Initialize all states at the top to maintain consistent hook order
    const [isClient, setIsClient] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [canInstall, setCanInstall] = useState(false);
    const [state, setState] = useState<OfflineState>({
        isOnline: typeof window !== 'undefined' ? navigator.onLine : true,
        isInstalled: false,
        syncInProgress: false,
        queuedOperations: 0
    });

    // Client-side initialization
    useEffect(() => {
        setIsClient(true);
        
        // Check installation status
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        const isInWebAppiOS = (window.navigator as any).standalone === true;
        const isInstalled = isStandalone || isInWebAppiOS;
        
        setState(prev => ({
            ...prev,
            isInstalled,
            isOnline: navigator.onLine
        }));

        // Setup beforeinstallprompt event
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setCanInstall(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        
        // Cleanup
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    // Check if app is installed
    const checkInstallStatus = useCallback(() => {
        if (typeof window !== 'undefined') {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
            const isInWebAppiOS = (window.navigator as any).standalone === true;
            const isInstalled = isStandalone || isInWebAppiOS;

            setState(prev => ({ ...prev, isInstalled }));
        }
    }, []);

    // Force sync queued operations
    const forceSync = useCallback(async () => {
        if (!isClient || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            console.warn('Service worker not available for sync');
            return;
        }

        setState(prev => ({ ...prev, syncInProgress: true }));

        try {
            navigator.serviceWorker.controller.postMessage({
                type: 'FORCE_SYNC'
            });

            // Wait for sync completion message with proper cleanup
            await new Promise<void>((resolve) => {
                let timeoutId: NodeJS.Timeout;

                const handleMessage = (event: MessageEvent) => {
                    if (event.data?.type === 'SYNC_COMPLETE') {
                        cleanup();
                        resolve();
                    }
                };

                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    if ('serviceWorker' in navigator && navigator.serviceWorker) {
                        try {
                            navigator.serviceWorker.removeEventListener('message', handleMessage);
                        } catch (error) {
                            console.warn('Error removing service worker listener:', error);
                        }
                    }
                };

                try {
                    navigator.serviceWorker.addEventListener('message', handleMessage);

                    // Timeout after 30 seconds
                    timeoutId = setTimeout(() => {
                        cleanup();
                        resolve();
                    }, 30000);
                } catch (error) {
                    console.error('Error setting up sync listener:', error);
                    cleanup();
                    resolve();
                }
            });
        } catch (error) {
            console.error('Force sync failed:', error);
        } finally {
            setState(prev => ({ ...prev, syncInProgress: false }));
        }
    }, [isClient]);

    // Install app
    const installApp = useCallback(async () => {
        if (deferredPrompt) {
            try {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;

                if (outcome === 'accepted') {
                    console.log('App installed successfully');
                    setDeferredPrompt(null);
                    setCanInstall(false);
                    setState(prev => ({ ...prev, isInstalled: true }));
                }
            } catch (error) {
                console.error('Installation failed:', error);
            }
        }
    }, [deferredPrompt]);

    // Get queued operations count
    const updateQueuedOperations = useCallback(async () => {
        try {
            if (!isClient || !('indexedDB' in window)) {
                return;
            }

            const db = await openSyncDB();
            const transaction = db.transaction(['sync_queue'], 'readonly');
            const store = transaction.objectStore('sync_queue');
            const countRequest = store.count();

            const count = await new Promise<number>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('IndexedDB operation timeout'));
                }, 10000); // Aumentado a 10 segundos

                countRequest.onsuccess = () => {
                    clearTimeout(timeoutId);
                    resolve(countRequest.result);
                };

                countRequest.onerror = () => {
                    clearTimeout(timeoutId);
                    reject(countRequest.error);
                };
            });

            setState(prev => ({ ...prev, queuedOperations: count }));
        } catch (error) {
            console.error('Failed to get queued operations count:', error);
            // Set queued operations to 0 on error to avoid blocking the UI
            setState(prev => ({ ...prev, queuedOperations: 0 }));
        }
    }, [isClient]);

    useEffect(() => {
        if (!isClient || typeof window === 'undefined') return;

        let mounted = true;
        let interval: NodeJS.Timeout;

        // Check initial install status
        checkInstallStatus();

        // Listen for online/offline events
        const handleOnline = () => {
            if (!mounted) return;
            setState(prev => ({ ...prev, isOnline: true }));
            // Auto-sync when coming back online
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                forceSync().catch(console.error);
            }
        };

        const handleOffline = () => {
            if (!mounted) return;
            setState(prev => ({ ...prev, isOnline: false }));
        };

        // Listen for install prompt
        const handleBeforeInstallPrompt = (e: Event) => {
            if (!mounted) return;
            e.preventDefault();
            setDeferredPrompt(e);
            setCanInstall(true);
        };

        // Listen for app installed
        const handleAppInstalled = () => {
            if (!mounted) return;
            console.log('App was installed');
            setState(prev => ({ ...prev, isInstalled: true }));
            setCanInstall(false);
            setDeferredPrompt(null);
        };

        // Listen for service worker messages
        const handleServiceWorkerMessage = (event: MessageEvent) => {
            if (!mounted) return;
            if (event.data?.type === 'SYNC_COMPLETE') {
                setState(prev => ({
                    ...prev,
                    syncInProgress: false,
                    queuedOperations: 0
                }));
            }
        };

        // Add event listeners with error handling
        try {
            window.addEventListener('online', handleOnline, { passive: true });
            window.addEventListener('offline', handleOffline, { passive: true });
            window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.addEventListener('appinstalled', handleAppInstalled, { passive: true });

            if ('serviceWorker' in navigator && navigator.serviceWorker) {
                navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
            }

            // Update queued operations count periodically
            updateQueuedOperations().catch(console.error);
            interval = setInterval(() => {
                if (mounted) {
                    updateQueuedOperations().catch(console.error);
                }
            }, 5000);
        } catch (error) {
            console.error('Error setting up offline hook:', error);
        }

        // Cleanup
        return () => {
            mounted = false;

            try {
                window.removeEventListener('online', handleOnline);
                window.removeEventListener('offline', handleOffline);
                window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
                window.removeEventListener('appinstalled', handleAppInstalled);

                if ('serviceWorker' in navigator && navigator.serviceWorker) {
                    navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
                }

                if (interval) {
                    clearInterval(interval);
                }
            } catch (error) {
                console.error('Error cleaning up offline hook:', error);
            }
        };
    }, [isClient, checkInstallStatus, forceSync, updateQueuedOperations]);

    return {
        ...state,
        forceSync,
        installApp,
        canInstall
    };
}

// IndexedDB helper (same as in service worker)
function openSyncDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            reject(new Error('IndexedDB not supported'));
            return;
        }

        const request = indexedDB.open('QuorumFlowSync', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('sync_queue')) {
                const store = db.createObjectStore('sync_queue', {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('timestamp', 'timestamp');
            }
        };
    });
}