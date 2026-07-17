'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Member, MemberStatus } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { mergeMembersCache } from '@/lib/members-cache-merge';

interface UseMembersLocalReturn {
  members: Member[];
  loading: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime: Date | null;
  /**
   * Sincroniza con el servidor (manual / primera carga sin cache).
   * Solo reescribe el cache local si hay cambios reales respecto a lo guardado.
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

function normalizeStatus(status?: unknown): MemberStatus {
  if (typeof status !== 'string') return 'active';
  const n = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(n)) return 'deceased';
  if (['inactive', 'inactivo'].includes(n)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(n)) return 'less_active';
  return 'active';
}

export function normalizeMembersList(raw: Member[]): Member[] {
  return raw.map((m) => ({ ...m, status: normalizeStatus(m.status) }));
}

/** Persist members list for the members page local-first cache */
export function saveMembersLocalCache(barrioOrg: string, list: Member[]) {
  if (typeof window === 'undefined') return;
  try {
    const keys = getMembersLocalCacheKeys(barrioOrg);
    localStorage.setItem(keys.data, JSON.stringify(list));
    localStorage.setItem(keys.ts, String(Date.now()));
  } catch {
    // quota / private mode — ignore
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
  if (typeof window === 'undefined') {
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

  /** Lee miembros desde localStorage */
  const loadFromLocal = useCallback((): { members: Member[]; ts: number } | null => {
    if (!barrioOrg || typeof window === 'undefined') return null;
    try {
      const keys = getMembersLocalCacheKeys(barrioOrg);
      const tsRaw = localStorage.getItem(keys.ts);
      const dataRaw = localStorage.getItem(keys.data);
      if (!tsRaw || !dataRaw) return null;
      const ts = Number(tsRaw);
      if (Number.isNaN(ts)) return null;
      const list = JSON.parse(dataRaw) as Member[];
      return { members: normalizeMembersList(list), ts };
    } catch {
      return null;
    }
  }, [barrioOrg]);

  /** Guarda miembros en localStorage */
  const saveToLocal = useCallback(
    (list: Member[]) => {
      if (!barrioOrg) return;
      saveMembersLocalCache(barrioOrg, list);
    },
    [barrioOrg]
  );

  /**
   * Sincroniza desde el servidor (manual o primera carga sin cache).
   * Compara con el cache: solo reescribe localStorage y el estado si hay cambios.
   */
  const syncFromServer = useCallback(async (): Promise<boolean> => {
    if (!user || !barrioOrg || inFlight.current) return false;
    inFlight.current = true;
    setSyncStatus('syncing');
    try {
      const idToken = await firebaseUser?.getIdToken().catch(() => null);
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

      if (hasChanges) {
        setMembers(list);
        setLastSyncTime(new Date());
      }
      // Sin cambios: se conserva el cache y el lastSyncTime previo
      setSyncStatus('idle');
      return hasChanges;
    } catch (error) {
      console.error('[useMembersLocal] syncFromServer error', error);
      setSyncStatus('error');
      // Mantener datos locales si falla — no borrar cache
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [user, firebaseUser, barrioOrg]);

  // Carga inicial: localStorage primero. Solo va al servidor si NO hay cache.
  // No usa TTL para no gastar lecturas de Firestore innecesarias.
  // Se re-ejecuta si barrioOrg cambia (p. ej. cache de auth tarda en hidratarse en PWA).
  useEffect(() => {
    // Si aún no tenemos barrioOrg, no marcar como "done" — esperar a que llegue
    if (authLoading || !user || !barrioOrg) {
      // Reset the flag so we retry when prerequisites arrive
      if (!barrioOrg) {
        initialLoadDone.current = false;
      }
      return;
    }
    if (initialLoadDone.current) return;

    initialLoadDone.current = true;

    const cached = loadFromLocal();
    if (cached) {
      setMembers(cached.members);
      setLastSyncTime(new Date(cached.ts));
      setLoading(false);
      return;
    }

    setLoading(true);
    syncFromServer().finally(() => setLoading(false));
  }, [authLoading, user, barrioOrg, loadFromLocal, syncFromServer]);

  const addToLocal = useCallback(
    (member: Member) => {
      setMembers((prev) => {
        const next = [...prev, { ...member, status: normalizeStatus(member.status) }];
        next.sort((a, b) => a.lastName.localeCompare(b.lastName));
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
        next.sort((a, b) => a.lastName.localeCompare(b.lastName));
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
