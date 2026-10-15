'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Member, MemberStatus } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { mergeMembersCache } from '@/lib/members-cache-merge';

interface UseMembersLocalReturn {
  members: Member[];
  loading: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime: Date | null;
  /**
   * Sincroniza con el servidor (manual / primera carga sin cache).
   * Solo reescribe el cache local si hay cambios reales respecto a lo guardado.
   * Always hydrates in-memory state after a successful fetch (even if cache was already up to date).
   * Returns whether the local cache was updated.
   */
  syncFromServer: () => Promise<boolean>;
  /** Agrega un miembro al cache local (ya debe estar creado en Firestore) */
  addToLocal: (member: Member) => void;
  /** Actualiza un miembro en el cache local (ya debe estar actualizado en Firestore) */
  updateInLocal: (member: Member) => void;
  /** Elimina un miembro del cache local (ya debe estar eliminado de Firestore) */
  removeFromLocal: (memberId: string) => void;
  /** Limpia todo el cache local */
  clearLocalCache: () => void;
}

export function getMembersLocalCacheKeys(barrioOrg: string) {
  return {
    data: `qf_members_local_${barrioOrg}`,
    ts: `qf_members_local_ts_${barrioOrg}`,
  };
}

/**
 * En desarrollo no usamos caché local de miembros: siempre se prueba
 * contra datos frescos del servidor (evita timestamps viejos / estado stale).
 */
export function isMembersLocalCacheEnabled(): boolean {
  return process.env.NODE_ENV === 'production';
}

function normalizeStatus(status?: unknown): MemberStatus {
  if (typeof status !== 'string') return 'active';
  const n = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(n)) return 'deceased';
  if (['inactive', 'inactivo'].includes(n)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(n)) return 'less_active';
  return 'active';
}

function safeLastNameCompare(a: Member, b: Member): number {
  const aName = (a.lastName || a.firstName || '').toString();
  const bName = (b.lastName || b.firstName || '').toString();
  return aName.localeCompare(bName);
}

export function normalizeMembersList(raw: Member[]): Member[] {
  return raw.map((m) => ({ ...m, status: normalizeStatus(m.status) }));
}

/** Persist members list for the members page local-first cache */
export function saveMembersLocalCache(barrioOrg: string, list: Member[]) {
  if (typeof window === 'undefined') return;
  if (!isMembersLocalCacheEnabled()) return;
  try {
    const keys = getMembersLocalCacheKeys(barrioOrg);
    localStorage.setItem(keys.data, JSON.stringify(list));
    localStorage.setItem(keys.ts, String(Date.now()));
  } catch {
    // quota / private mode — ignore
  }
}

/** Quita claves de caché de miembros (útil al arrancar en dev). */
export function clearMembersLocalCacheKeys(barrioOrg: string) {
  if (typeof window === 'undefined' || !barrioOrg) return;
  try {
    const keys = getMembersLocalCacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  } catch {
    // ignore
  }
}

/**
 * Apply server members onto the page-local cache with a merge:
 * only rewrite localStorage when something actually changed.
 * Returns the merged list and whether the cache was written.
 */
export function applyServerMembersToLocalCache(
  barrioOrg: string,
  serverList: Member[]
): { list: Member[]; hasChanges: boolean } {
  // Dev: no localStorage — always use server list as-is
  if (!isMembersLocalCacheEnabled() || typeof window === 'undefined') {
    return { list: serverList, hasChanges: true };
  }

  let cached: Member[] = [];
  try {
    const keys = getMembersLocalCacheKeys(barrioOrg);
    const dataRaw = localStorage.getItem(keys.data);
    if (dataRaw) {
      cached = normalizeMembersList(JSON.parse(dataRaw) as Member[]);
    }
  } catch {
    cached = [];
  }

  const merged = mergeMembersCache(cached, serverList);
  if (merged.hasChanges) {
    // Only rewrite the parts that changed: persist the full merged list
    // (unchanged members kept; new/updated/removed reflected).
    saveMembersLocalCache(barrioOrg, merged.list);
  }
  // If nothing new: leave cache keys and timestamp untouched
  return { list: merged.list, hasChanges: merged.hasChanges };
}

export function useMembersLocal(): UseMembersLocalReturn {
  const { user, loading: authLoading, barrioOrg, firebaseUser } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const inFlight = useRef(false);
  const initialLoadDone = useRef(false);
  const membersRef = useRef<Member[]>([]);
  const loadingRef = useRef(true);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Sincroniza el espejo loadingRef hacia el estado loading.
  useEffect(() => {
    if (loadingRef.current !== loading) {
      setLoading(loadingRef.current);
    }
  }, [loading]);

  /** Lee miembros desde localStorage (desactivado en development). */
  const loadFromLocal = useCallback((): { members: Member[]; ts: number } | null => {
    if (!isMembersLocalCacheEnabled()) return null;
    if (!barrioOrg || typeof window === 'undefined') return null;
    try {
      const keys = getMembersLocalCacheKeys(barrioOrg);
      const tsRaw = localStorage.getItem(keys.ts);
      const dataRaw = localStorage.getItem(keys.data);
      // Accept data even if timestamp key is missing (partial writes / older formats)
      if (!dataRaw) return null;
      const ts = tsRaw ? Number(tsRaw) : Date.now();
      if (Number.isNaN(ts)) return null;
      const list = JSON.parse(dataRaw) as Member[];
      return { members: normalizeMembersList(list), ts };
    } catch {
      return null;
    }
  }, [barrioOrg]);

  /** Guarda miembros en localStorage (no-op en development). */
  const saveToLocal = useCallback(
    (list: Member[]) => {
      if (!barrioOrg || !isMembersLocalCacheEnabled()) return;
      saveMembersLocalCache(barrioOrg, list);
    },
    [barrioOrg]
  );

  /**
   * Sincroniza desde el servidor (manual o primera carga sin cache).
   * Compara con el cache: solo reescribe localStorage si hay cambios.
   * ALWAYS applies the merged list to React state so a parallel writer
   * (MembersProvider) cannot leave the UI empty with hasChanges=false.
   */
  const syncFromServer = useCallback(async (): Promise<boolean> => {
    if (!user || !barrioOrg || inFlight.current) return false;
    if (!firebaseUser) return false;

    inFlight.current = true;
    setSyncStatus('syncing');
    try {
      const idToken = await firebaseUser.getIdToken().catch(() => null);
      if (!idToken) throw new Error('No autenticado');
      const url = `/api/members?barrioOrg=${encodeURIComponent(barrioOrg)}&t=${Date.now()}`;
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await response.json()) as Member[];
      const serverList = normalizeMembersList(raw);

      const { list, hasChanges } = applyServerMembersToLocalCache(barrioOrg, serverList);

      // Critical: always hydrate memory after a successful network response.
      // MembersProvider may have already written the same list to localStorage,
      // making hasChanges=false while this hook's state is still [].
      setMembers(list);
      setLastSyncTime(new Date());
      setSyncStatus('idle');
      return hasChanges;
    } catch (error) {
      console.error('[useMembersLocal] syncFromServer error', error);
      setSyncStatus('error');
      // Fall back to whatever is in localStorage if memory is empty
      const cached = loadFromLocal();
      if (cached && membersRef.current.length === 0) {
        setMembers(cached.members);
        setLastSyncTime(new Date(cached.ts));
      }
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [user, firebaseUser, barrioOrg, loadFromLocal]);

  // Carga inicial:
  // - production: localStorage primero; red solo si no hay cache
  // - development: siempre red (sin cache) para probar con datos frescos
  // Espera firebaseUser antes de marcar "done" cuando hay que ir a red.
  // Se re-ejecuta si barrioOrg / firebaseUser cambian (PWA / auth hidratación).
  useEffect(() => {
    if (authLoading || !user || !barrioOrg) {
      // Reset so we retry when prerequisites arrive (barrioOrg often late on PWA)
      if (!barrioOrg) {
        initialLoadDone.current = false;
      }
      // Avoid infinite skeleton when auth finished but profile has no barrio
      if (!authLoading && user && !barrioOrg) {
        loadingRef.current = false;
        queueMicrotask(() => setLoading(false));
      }
      return;
    }
    if (initialLoadDone.current) return;

    // Dev: limpia restos de caché viejos y no hidrata desde localStorage
    if (!isMembersLocalCacheEnabled()) {
      clearMembersLocalCacheKeys(barrioOrg);
    } else {
      const cached = loadFromLocal();
      if (cached) {
        initialLoadDone.current = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMembers(cached.members);
        setLastSyncTime(new Date(cached.ts));
        loadingRef.current = false;
        setLoading(false);
        return;
      }
    }

    // Need network — wait for Firebase user/token first
    if (!firebaseUser) {
      return;
    }

    initialLoadDone.current = true;
    loadingRef.current = true;
    syncFromServer()
      .then((ok) => {
        // If sync failed and still empty, allow a later retry when deps change
        if (!ok && membersRef.current.length === 0) {
          initialLoadDone.current = false;
        }
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [authLoading, user, barrioOrg, firebaseUser, loadFromLocal, syncFromServer]);

  // Header refresh icon + Cloud Function silent sync
  const handleManualRefresh = useCallback(async () => {
    const changed = await syncFromServer();
    // If memory was empty, also re-read localStorage (provider may have written it)
    if (membersRef.current.length === 0) {
      const cached = loadFromLocal();
      if (cached) {
        setMembers(cached.members);
        setLastSyncTime(new Date(cached.ts));
        return true;
      }
    }
    return changed;
  }, [syncFromServer, loadFromLocal]);

  useOnManualRefresh(handleManualRefresh);

  const addToLocal = useCallback(
    (member: Member) => {
      setMembers((prev) => {
        const next = [...prev, { ...member, status: normalizeStatus(member.status) }];
        next.sort(safeLastNameCompare);
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const updateInLocal = useCallback(
    (member: Member) => {
      setMembers((prev) => {
        const next = prev.map((m) =>
          m.id === member.id
            ? { ...member, status: normalizeStatus(member.status) }
            : m
        );
        next.sort(safeLastNameCompare);
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const removeFromLocal = useCallback(
    (memberId: string) => {
      setMembers((prev) => {
        const next = prev.filter((m) => m.id !== memberId);
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const clearLocalCache = useCallback(() => {
    if (!barrioOrg || typeof window === 'undefined') return;
    const keys = getMembersLocalCacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  }, [barrioOrg]);

  return {
    members,
    loading,
    syncStatus,
    lastSyncTime,
    syncFromServer,
    addToLocal,
    updateInLocal,
    removeFromLocal,
    clearLocalCache,
  };
}
