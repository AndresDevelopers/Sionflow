'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAppStoragePrefix } from '@/lib/app-config';
import {
    canPromptPwaInstall,
    initPwaInstallListeners,
    isPwaInstalled,
    promptPwaInstall,
    subscribePwaInstall,
    type PwaInstallOutcome,
} from '@/lib/pwa-install';

interface OfflineState {
    isOnline: boolean;
    isInstalled: boolean;
    syncInProgress: boolean;
    queuedOperations: number;
}

interface OfflineHook extends OfflineState {
    forceSync: () => Promise<void>;
    installApp: () => Promise<PwaInstallOutcome>;
    canInstall: boolean;
}

export function useOffline(): OfflineHook {
    // Initialize all states at the top to maintain consistent hook order
    const [isClient, setIsClient] = useState(false);
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

        const isInstalled = isPwaInstalled();
        setState(prev => ({
            ...prev,
            isInstalled,
            isOnline: navigator.onLine
        }));

        initPwaInstallListeners();
        setCanInstall(canPromptPwaInstall());

        return subscribePwaInstall(() => {
            setCanInstall(canPromptPwaInstall());
            if (isPwaInstalled()) {
                setState(prev => ({ ...prev, isInstalled: true }));
            }
        });
    }, []);

    // Check if app is installed
    const checkInstallStatus = useCallback(() => {
        if (typeof window !== 'undefined') {
            setState(prev => ({ ...prev, isInstalled: isPwaInstalled() }));
        }
    }, []);

    // Force sync: Firestore pending writes (SDK) + Storage offline queue
    const forceSync = useCallback(async () => {
        if (!isClient) return;

        setState(prev => ({ ...prev, syncInProgress: true }));

        try {
            const { flushOfflineSync } = await import('@/lib/firebase-offline-sync');
            const result = await flushOfflineSync();
            setState(prev => ({
                ...prev,
                queuedOperations: result.storagePending,
            }));

            // Keep SW hook for any legacy queue entries
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'FORCE_SYNC' });
            }
        } catch (error) {
            console.error('Force sync failed:', error);
        } finally {
            setState(prev => ({ ...prev, syncInProgress: false }));
        }
    }, [isClient]);

    // Install app via shared deferred-prompt store (single prompt() call site)
    const installApp = useCallback(async (): Promise<PwaInstallOutcome> => {
        const outcome = await promptPwaInstall();
        if (outcome === 'accepted') {
            setCanInstall(false);
            setState(prev => ({ ...prev, isInstalled: true }));
        } else {
            setCanInstall(canPromptPwaInstall());
        }
        return outcome;
    }, []);

    // Count Storage offline queue (+ legacy SW queue if present)
    const updateQueuedOperations = useCallback(async () => {
        try {
            if (!isClient || !('indexedDB' in window)) {
                return;
            }

            const { getStorageQueueCount } = await import('@/lib/storage-offline-queue');
            let count = await getStorageQueueCount();

            try {
                const db = await openSyncDB();
                const transaction = db.transaction(['sync_queue'], 'readonly');
                const store = transaction.objectStore('sync_queue');
                const legacy = await new Promise<number>((resolve) => {
                    const countRequest = store.count();
                    countRequest.onsuccess = () => resolve(countRequest.result);
                    countRequest.onerror = () => resolve(0);
                });
                count += legacy;
                db.close();
            } catch {
                // legacy store may not exist
            }

            setState(prev => ({ ...prev, queuedOperations: count }));
        } catch (error) {
            console.error('Failed to get queued operations count:', error);
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
            // Auto-sync Firestore pending + Storage queue when back online
            forceSync().catch(console.error);
        };

        const onQueueChanged = () => {
            if (!mounted) return;
            updateQueuedOperations().catch(console.error);
        };

        const handleOffline = () => {
            if (!mounted) return;
            setState(prev => ({ ...prev, isOnline: false }));
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
            window.addEventListener('sionflow:storage-queue-changed', onQueueChanged);
            window.addEventListener('sionflow:offline-sync-complete', onQueueChanged);

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
                window.removeEventListener('sionflow:storage-queue-changed', onQueueChanged);
                window.removeEventListener('sionflow:offline-sync-complete', onQueueChanged);

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

        const request = indexedDB.open(`${getAppStoragePrefix()}Sync`, 1);

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