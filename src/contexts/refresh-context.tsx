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
import { canReachNetwork, isBrowserOnline, withTimeout } from '@/lib/network';
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

/** How the last successful sync was triggered */
export type SyncSource = 'manual' | 'automatic';

interface RefreshContextValue {
  /**
   * True while a *manual* refresh is in progress (header button spinner).
   * Silent CF sync does not set this — background only.
   */
  isRefreshing: boolean;
  /**
   * True while any refresh is in flight (manual or silent CF auto-sync).
   * Used by DataSyncListener to absorb overlapping signals without UI spin.
   */
  isSyncInFlight: boolean;
  /** Last successful sync time (updated even when there is no new data) */
  lastSyncTime: Date | null;
  /** Whether last sync was manual (header button) or automatic (CF / silent) */
  lastSyncSource: SyncSource | null;
  /**
   * Bumps only after a *manual* refresh finishes; used as key to remount
   * page content so mount-only loaders re-run. Silent CF sync never bumps this.
   */
  refreshGeneration: number;
  /**
   * Bumps after every successful online refresh (manual + silent).
   * Pages can depend on this to soft-reload data in place without remounting.
   */
  dataSyncGeneration: number;
  /** Register a handler that runs on every refresh (manual + silent). Returns unregister fn. */
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  /**
   * Refresh page data from server/cache.
   * Auto path (Cloud Function signal): `{ silent: true }` — in-place only
   * (handlers + clock); never remounts the page or calls router.refresh().
   * Header button (fallback): default / `{ silent: false }` — full refresh
   * with remount so mount-only loaders re-run.
   * Offline / no connectivity: keeps cache, never blocks the UI.
   */
  requestRefresh: (options?: RequestRefreshOptions) => Promise<void>;
  /**
   * Update header clock (e.g. after Cloud Function auto-sync).
   * Defaults source to `automatic` when omitted.
   */
  markLastSyncTime: (date?: Date, source?: SyncSource) => void;
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

/** Custom event name for optional loose coupling outside React tree */
export const APP_DATA_REFRESH_EVENT = 'sionflow:data-refresh';

/** Per-handler timeout so one stuck page cannot freeze the spinner forever */
const HANDLER_TIMEOUT_MS = 6_000;
/** Soft budget for the whole offline refresh pass */
const OFFLINE_REFRESH_BUDGET_MS = 2_500;
/** Soft budget when online but network is flaky */
const ONLINE_REFRESH_BUDGET_MS = 15_000;

function lastSyncStorageKey(barrioOrg: string) {
  const prefix = typeof window !== 'undefined' ? getAppStoragePrefix() : 'sionflow';
  return `${prefix}_last_manual_sync_${barrioOrg}`;
}

type StoredLastSync = {
  ts: number;
  source: SyncSource | null;
};

function parseStoredLastSync(raw: string): StoredLastSync | null {
  // Legacy format: plain timestamp number
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && asNumber > 0 && raw.trim() === String(asNumber)) {
    return { ts: asNumber, source: null };
  }
  try {
    const parsed = JSON.parse(raw) as { ts?: unknown; source?: unknown };
    const ts = typeof parsed.ts === 'number' ? parsed.ts : Number(parsed.ts);
    if (Number.isNaN(ts) || ts <= 0) return null;
    const source =
      parsed.source === 'manual' || parsed.source === 'automatic'
        ? parsed.source
        : null;
    return { ts, source };
  } catch {
    return null;
  }
}

function readStoredLastSync(
  barrioOrg: string | null | undefined
): StoredLastSync | null {
  if (!barrioOrg || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(lastSyncStorageKey(barrioOrg));
    if (!raw) return null;
    return parseStoredLastSync(raw);
  } catch {
    return null;
  }
}

function writeStoredLastSync(
  barrioOrg: string,
  date: Date,
  source: SyncSource | null
) {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredLastSync = { ts: date.getTime(), source };
    localStorage.setItem(lastSyncStorageKey(barrioOrg), JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

async function runHandlersSafely(
  handlers: RefreshHandler[],
  perHandlerMs: number
): Promise<boolean> {
  if (handlers.length === 0) return false;

  const results = await Promise.all(
    handlers.map(async (handler) => {
      try {
        const result = await withTimeout(
          Promise.resolve().then(() => handler()),
          perHandlerMs,
          'refresh-handler'
        );
        return result === true;
      } catch (error) {
        console.warn('[RefreshProvider] handler failed or timed out', error);
        return false;
      }
    })
  );

  return results.some(Boolean);
}

export function RefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const { barrioOrg } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncInFlight, setIsSyncInFlight] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [lastSyncSource, setLastSyncSource] = useState<SyncSource | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [dataSyncGeneration, setDataSyncGeneration] = useState(0);
  const handlersRef = useRef(new Set<RefreshHandler>());
  const inFlightRef = useRef(false);
  /** Avoid putting lastSyncTime in requestRefresh deps (re-subscribes CF listener). */
  const lastSyncTimeRef = useRef<Date | null>(null);
  useEffect(() => {
    lastSyncTimeRef.current = lastSyncTime;
  }, [lastSyncTime]);

  // Restore last sync time/source for this ward/org (so user always sees when they last synced)
  useEffect(() => {
    const stored = readStoredLastSync(barrioOrg);
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación desde sistema externo (localStorage: última sincronización por barrioOrg)
      setLastSyncTime(new Date(stored.ts));
      setLastSyncSource(stored.source);
    } else {
      setLastSyncTime(null);
      setLastSyncSource(null);
    }
  }, [barrioOrg]);

  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const markLastSyncTime = useCallback(
    (date?: Date, source: SyncSource = 'automatic') => {
      const when = date ?? new Date();
      setLastSyncTime(when);
      setLastSyncSource(source);
      if (barrioOrg) {
        writeStoredLastSync(barrioOrg, when, source);
      }
    },
    [barrioOrg]
  );

  const requestRefresh = useCallback(async (options?: RequestRefreshOptions) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const silent = options?.silent === true;
    // Manual: spin the header button. Silent CF: background only (no UI block).
    setIsSyncInFlight(true);
    if (!silent) {
      setIsRefreshing(true);
    }

    try {
      // 1) Fast local flag
      let online = isBrowserOnline();

      // 2) If the browser says online, verify real connectivity (mobile often lies)
      if (online) {
        online = await canReachNetwork(2_000);
      }

      const handlers = Array.from(handlersRef.current);

      // ── OFFLINE / NO CONNECTIVITY: keep cache, never remount, never hang ──
      if (!online) {
        clearForceServerReads();

        // Best-effort: re-hydrate from localStorage / Firestore IndexedDB with a hard budget
        try {
          await withTimeout(
            runHandlersSafely(handlers, 1_500),
            OFFLINE_REFRESH_BUDGET_MS,
            'offline-refresh'
          );
        } catch {
          // ignore — cache already on screen
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(APP_DATA_REFRESH_EVENT, {
              detail: {
                hasChanges: false,
                lastSyncTime: lastSyncTimeRef.current?.toISOString() ?? null,
                offline: true,
                silent,
              },
            })
          );
        }

        if (!silent) {
          toast({
            title: t('offline.refresh.cacheTitle') || 'Modo sin conexión',
            description:
              t('offline.refresh.cacheDescription') ||
              'Sin internet: se mantienen los datos en cache. Se sincronizará al recuperar la red.',
          });
        }
        return;
      }

      // ── ONLINE: sync + force server window ──
      // flushOfflineSync may write pending docs → CF publishes a signal.
      // DataSyncListener absorbs those echoes so the source stays "manual".
      //
      // Silent (CF auto-sync): update in place only — never remount the tree
      // and never router.refresh(). Remounting made every remote write feel
      // like a full page reload for all users (including the one who saved).
      // Manual header button: remount so mount-only page loaders re-run.
      try {
        await withTimeout(flushOfflineSync(), 8_000, 'flushOfflineSync');
      } catch (error) {
        console.warn('[RefreshProvider] flushOfflineSync timed out', error);
      }

      beginForceServerReads(20_000);
      clearAiSuggestionCaches();

      let anyDataChanged = false;
      try {
        anyDataChanged = await withTimeout(
          runHandlersSafely(handlers, HANDLER_TIMEOUT_MS),
          ONLINE_REFRESH_BUDGET_MS,
          'online-refresh'
        );
      } catch (error) {
        console.warn('[RefreshProvider] online handlers budget exceeded', error);
      }

      const now = new Date();
      const source: SyncSource = silent ? 'automatic' : 'manual';
      setLastSyncTime(now);
      setLastSyncSource(source);
      if (barrioOrg) {
        writeStoredLastSync(barrioOrg, now, source);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(APP_DATA_REFRESH_EVENT, {
            detail: {
              hasChanges: anyDataChanged,
              lastSyncTime: now.toISOString(),
              lastSyncSource: source,
              offline: false,
              silent,
            },
          })
        );
      }

      // Soft generation for in-place listeners (silent + manual).
      setDataSyncGeneration((g) => g + 1);

      // Full remount + Next RSC refresh only on *manual* refresh.
      // Silent CF sync must stay background: handlers + event already ran.
      if (!silent) {
        try {
          router.refresh();
        } catch {
          // ignore
        }
        setRefreshGeneration((g) => g + 1);

        if (anyDataChanged) {
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
      // On total failure, still never leave the user blocked — prefer cache message
      clearForceServerReads();
      if (!silent) {
        if (!isBrowserOnline()) {
          toast({
            title: t('offline.refresh.cacheTitle') || 'Modo sin conexión',
            description:
              t('offline.refresh.cacheDescription') ||
              'Sin internet: se mantienen los datos en cache.',
          });
        } else {
          toast({
            title: t('common.error') || 'Error',
            description:
              t('mainLayout.refreshErrorDescription') ||
              'No se pudieron actualizar los datos. Se mantiene el cache.',
            variant: 'destructive',
          });
        }
      }
    } finally {
      // Do NOT clear force-server window here on success — remounted pages
      // need ~20s of getDocsFromServer (TTL in beginForceServerReads).
      inFlightRef.current = false;
      setIsSyncInFlight(false);
      setIsRefreshing(false);
    }
  }, [router, toast, t, barrioOrg]);

  const value = useMemo(
    () => ({
      isRefreshing,
      isSyncInFlight,
      lastSyncTime,
      lastSyncSource,
      refreshGeneration,
      dataSyncGeneration,
      registerRefreshHandler,
      requestRefresh,
      markLastSyncTime,
    }),
    [
      isRefreshing,
      isSyncInFlight,
      lastSyncTime,
      lastSyncSource,
      refreshGeneration,
      dataSyncGeneration,
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
 * Register a callback that runs on every data refresh:
 * - Manual header button
 * - Silent Cloud Function auto-sync (background, no remount)
 *
 * Prefer this for list/detail pages so other accounts see updates in place
 * without a full page remount. Keep loaders quiet when data is already shown.
 *
 * Pass a stable handler (useCallback) to avoid re-registering every render.
 */
export function useOnManualRefresh(handler: RefreshHandler) {
  const refresh = useRefreshOptional();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!refresh) return;
    return refresh.registerRefreshHandler(() => handlerRef.current());
  }, [refresh]);
}

/**
 * Soft re-run a data loader when CF auto-sync or manual refresh completes,
 * without remounting the page. Skips the first mount (use your own mount effect).
 * Prefer `useOnManualRefresh` when the loader is the single source of truth.
 */
export function useOnDataSyncGeneration(handler: () => void | Promise<void>) {
  const refresh = useRefreshOptional();
  const generation = refresh?.dataSyncGeneration ?? 0;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const skipFirstRef = useRef(true);

  useEffect(() => {
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      return;
    }
    void handlerRef.current();
  }, [generation]);
}
