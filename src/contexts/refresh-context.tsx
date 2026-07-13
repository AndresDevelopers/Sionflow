'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';
import { getAppStoragePrefix } from '@/lib/app-config';
import {
  beginForceServerReads,
  clearAiSuggestionCaches,
  clearForceServerReads,
} from '@/lib/firestore-query';
import { isBrowserOnline } from '@/lib/network';
import { flushOfflineSync } from '@/lib/firebase-offline-sync';

/**
 * Handler for manual refresh.
 * May return `true` if it applied real data changes (so the UI can message accordingly).
 */
export type RefreshHandler = () => void | boolean | Promise<void | boolean>;

export type RequestRefreshOptions = {
  /**
   * Silent = auto-sync from Cloud Function (no toast).
   * Manual button uses silent: false (default) as fallback UX.
   */
  silent?: boolean;
};

interface RefreshContextValue {
  /** True while a manual refresh is in progress */
  isRefreshing: boolean;
  /** Last successful sync time (updated even when there is no new data) */
  lastSyncTime: Date | null;
  /** Bumps when a refresh finishes; use as key to remount page content */
  refreshGeneration: number;
  /** Register a handler that runs on every manual refresh. Returns unregister fn. */
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  /**
   * Refresh page data from server/cache.
   * Auto path (Cloud Function signal): `{ silent: true }`.
   * Header button (fallback): default / `{ silent: false }`.
   */
  requestRefresh: (options?: RequestRefreshOptions) => Promise<void>;
  /** Update header clock (e.g. after Cloud Function auto-sync). */
  markLastSyncTime: (date?: Date) => void;
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

/** Custom event name for optional loose coupling outside React tree */
export const APP_DATA_REFRESH_EVENT = 'sionflow:data-refresh';

function lastSyncStorageKey(barrioOrg: string) {
  const prefix = typeof window !== 'undefined' ? getAppStoragePrefix() : 'sionflow';
  return `${prefix}_last_manual_sync_${barrioOrg}`;
}

function readStoredLastSync(barrioOrg: string | null | undefined): Date | null {
  if (!barrioOrg || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(lastSyncStorageKey(barrioOrg));
    if (!raw) return null;
    const ts = Number(raw);
    if (Number.isNaN(ts) || ts <= 0) return null;
    return new Date(ts);
  } catch {
    return null;
  }
}

function writeStoredLastSync(barrioOrg: string, date: Date) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(lastSyncStorageKey(barrioOrg), String(date.getTime()));
  } catch {
    // quota / private mode
  }
}

export function RefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const { barrioOrg } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const handlersRef = useRef(new Set<RefreshHandler>());

  // Restore last sync time for this ward/org (so user always sees when they last synced)
  useEffect(() => {
    setLastSyncTime(readStoredLastSync(barrioOrg));
  }, [barrioOrg]);

  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const markLastSyncTime = useCallback(
    (date?: Date) => {
      const when = date ?? new Date();
      setLastSyncTime(when);
      if (barrioOrg) {
        writeStoredLastSync(barrioOrg, when);
      }
    },
    [barrioOrg]
  );

  const requestRefresh = useCallback(async (options?: RequestRefreshOptions) => {
    if (isRefreshing) return;
    const silent = options?.silent === true;
    setIsRefreshing(true);
    try {
      const online = isBrowserOnline();

      if (online) {
        await flushOfflineSync();
        beginForceServerReads(20_000);
        clearAiSuggestionCaches();
      } else {
        clearForceServerReads();
      }

      const handlers = Array.from(handlersRef.current);
      const results = await Promise.all(
        handlers.map(async (handler) => {
          try {
            return await handler();
          } catch (error) {
            console.error('[RefreshProvider] handler failed', error);
            return false;
          }
        })
      );

      const anyDataChanged = results.some((r) => r === true);

      // Always stamp the header clock after a completed online sync
      // (manual button OR Cloud Function auto-sync)
      const now = new Date();
      if (online) {
        setLastSyncTime(now);
        if (barrioOrg) {
          writeStoredLastSync(barrioOrg, now);
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(APP_DATA_REFRESH_EVENT, {
            detail: {
              hasChanges: anyDataChanged,
              lastSyncTime: now.toISOString(),
              offline: !online,
              silent,
            },
          })
        );
      }

      // CRITICAL offline: never call router.refresh() — App Router re-fetches RSC
      // over the network and tears down the shell (mobile shows "sin internet").
      // Also avoid remounting pages so in-memory + local cache stay visible.
      if (online) {
        router.refresh();
        setRefreshGeneration((g) => g + 1);
      }

      // Toasts only for manual fallback (or offline feedback)
      if (!silent) {
        if (!online) {
          toast({
            title: t('offline.refresh.cacheTitle') || 'Modo sin conexión',
            description:
              t('offline.refresh.cacheDescription') ||
              'Mostrando datos en cache. Los cambios se enviarán al recuperar internet.',
          });
        } else if (anyDataChanged) {
          toast({
            title: t('mainLayout.refreshSuccessTitle') || 'Datos actualizados',
            description:
              t('mainLayout.refreshSuccessDescription') ||
              'Se aplicaron los cambios nuevos del servidor.',
          });
        } else {
          toast({
            title: t('mainLayout.refreshUpToDateTitle') || 'Todo al día',
            description:
              t('mainLayout.refreshUpToDateDescription') ||
              'No hay datos nuevos. Se conservó el cache local.',
          });
        }
      }
    } catch (error) {
      console.error('[RefreshProvider] requestRefresh failed', error);
      if (!silent) {
        toast({
          title: t('common.error') || 'Error',
          description:
            t('mainLayout.refreshErrorDescription') ||
            'No se pudieron actualizar los datos.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, router, toast, t, barrioOrg]);

  const value = useMemo(
    () => ({
      isRefreshing,
      lastSyncTime,
      refreshGeneration,
      registerRefreshHandler,
      requestRefresh,
      markLastSyncTime,
    }),
    [
      isRefreshing,
      lastSyncTime,
      refreshGeneration,
      registerRefreshHandler,
      requestRefresh,
      markLastSyncTime,
    ]
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) {
    throw new Error('useRefresh must be used within RefreshProvider');
  }
  return ctx;
}

/** Optional: null outside provider */
export function useRefreshOptional(): RefreshContextValue | null {
  return useContext(RefreshContext) ?? null;
}

/**
 * Register a callback that runs when the user presses the global refresh icon.
 * Pass a stable handler (useCallback) to avoid re-registering every render.
 */
export function useOnManualRefresh(handler: RefreshHandler) {
  const refresh = useRefreshOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!refresh) return;
    return refresh.registerRefreshHandler(() => handlerRef.current());
  }, [refresh]);
}
