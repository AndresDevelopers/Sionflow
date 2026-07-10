
'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { getDocs, query, orderBy, where, doc, writeBatch, setDoc, serverTimestamp, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { ministeringCollection, ministeringDistrictsCollection } from '@/lib/collections';
import type { Companionship, Member, MinisteringDistrict } from '@/lib/types';
import { getMembersByStatus } from '@/lib/members-data';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { firestore } from '@/lib/firebase';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, Settings, Trash2, Users, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';
import { buildMemberLink } from '@/lib/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

async function getCompanionships(barrioOrg: string): Promise<Companionship[]> {
  const q = query(ministeringCollection, where('barrioOrg', '==', barrioOrg), orderBy('companions'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as Companionship)
  );
}

/** Distrito 1 por defecto: nunca se muestra ni permite eliminar */
function isProtectedDefaultDistrict(
  district: Pick<MinisteringDistrict, 'name' | 'isDefault'>,
  defaultNameForOne: string,
): boolean {
  if (district.isDefault === true) return true;
  const normalized = (district.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const defaultNormalized = (defaultNameForOne ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (defaultNormalized && normalized === defaultNormalized) return true;
  // "Distrito 1", "District 1", "Distrito 01", etc.
  return /^(distrito|district)\s*0*1$/.test(normalized);
}

async function getDistricts(barrioOrg: string): Promise<MinisteringDistrict[]> {
  const q = query(ministeringDistrictsCollection, where('barrioOrg', '==', barrioOrg), orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as Omit<MinisteringDistrict, 'id'>;
    return {
      ...data,
      id: docSnap.id,
      // Evita fallos de filtro cuando el campo no existe en documentos antiguos
      companionshipIds: Array.isArray(data.companionshipIds) ? data.companionshipIds : [],
      isDefault: Boolean(data.isDefault),
    } as MinisteringDistrict;
  });
}

const PAGE_SIZE = 10;


export default function MinisteringPage() {
  const [companionships, setCompanionships] = useState<Companionship[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const { toast } = useToast();
  const { t } = useI18n();

  const [members, setMembers] = useState<Member[]>([]);
  const [memberMap, setMemberMap] = useState<Map<string, string>>(new Map());
  const [districts, setDistricts] = useState<MinisteringDistrict[]>([]);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null);
  const [isCreateDistrictOpen, setIsCreateDistrictOpen] = useState(false);
  const [newDistrictName, setNewDistrictName] = useState('');
  const [isSavingDistrict, setIsSavingDistrict] = useState(false);
  const [deletingDistrictId, setDeletingDistrictId] = useState<string | null>(null);

  /** Mapa companionshipId -> nombre(s) de distrito (desde districtId del compañerismo y/o companionshipIds del distrito) */
  const companionshipDistrictMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const districtById = new Map(districts.map(d => [d.id, d]));

    // 1) Fuente primaria: districtId en el compañerismo
    companionships.forEach(comp => {
      if (!comp.districtId) return;
      const district = districtById.get(comp.districtId);
      if (!district) return;
      if (!map.has(comp.id)) map.set(comp.id, []);
      if (!map.get(comp.id)!.includes(district.name)) {
        map.get(comp.id)!.push(district.name);
      }
    });

    // 2) Fuente secundaria: companionshipIds en el distrito
    districts.forEach(district => {
      (district.companionshipIds ?? []).forEach(id => {
        if (!map.has(id)) map.set(id, []);
        if (!map.get(id)!.includes(district.name)) {
          map.get(id)!.push(district.name);
        }
      });
    });
    return map;
  }, [districts, companionships]);

  /** IDs de compañerismos que pertenecen a un distrito (ambas fuentes) */
  const getCompanionshipIdsForDistrict = useCallback((districtId: string): Set<string> => {
    const district = districts.find(d => d.id === districtId);
    const ids = new Set<string>(district?.companionshipIds ?? []);
    companionships.forEach(comp => {
      if (comp.districtId === districtId) {
        ids.add(comp.id);
      }
    });
    return ids;
  }, [districts, companionships]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const filteredCompanionships = useMemo(() => {
    if (!selectedDistrictId) return companionships;
    const assignedIds = getCompanionshipIdsForDistrict(selectedDistrictId);
    return companionships.filter(comp => assignedIds.has(comp.id));
  }, [companionships, selectedDistrictId, getCompanionshipIdsForDistrict]);

  const selectDistrictFilter = useCallback((districtId: string | null) => {
    setSelectedDistrictId(districtId);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const visibleCompanionships = useMemo(
    () => filteredCompanionships.slice(0, visibleCount),
    [filteredCompanionships, visibleCount],
  );

  const totalCompanionships = companionships.length;

  const getMemberLink = (name: string, memberId?: string | null) =>
    buildMemberLink({ name, memberId, members, memberMap });
  const updateDistrict = async (districtId: string, updates: Partial<MinisteringDistrict>) => {
    try {
      await setDoc(doc(ministeringDistrictsCollection, districtId), {
        ...updates,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setDistricts(prev => prev.map(d => d.id === districtId ? { ...d, ...updates } : d));
      toast({ title: t('ministering.success'), description: t('ministering.districtUpdatedDescription') });
    } catch (error) {
      logger.error({ error, message: "Failed to update district" });
      toast({ title: t('ministering.error'), description: t('ministering.districtUpdateErrorDescription'), variant: "destructive" });
    }
  };

  /**
   * Asigna o quita un compañerismo de un distrito de forma exclusiva:
   * un compañerismo solo puede pertenecer a un distrito a la vez.
   * Actualiza district.companionshipIds y companionship.districtId.
   */
  const assignCompanionshipToDistrict = async (districtId: string, companionshipId: string) => {
    const district = districts.find(d => d.id === districtId);
    if (!district) return;

    const currentlyInDistrict =
      (district.companionshipIds ?? []).includes(companionshipId) ||
      companionships.find(c => c.id === companionshipId)?.districtId === districtId;

    try {
      const batch = writeBatch(firestore);
      const nextDistricts = districts.map((d) => {
        const currentIds = d.companionshipIds ?? [];
        let nextIds = currentIds;

        if (d.id === districtId) {
          nextIds = currentlyInDistrict
            ? currentIds.filter(id => id !== companionshipId)
            : [...currentIds.filter(id => id !== companionshipId), companionshipId];
        } else if (!currentlyInDistrict && currentIds.includes(companionshipId)) {
          nextIds = currentIds.filter(id => id !== companionshipId);
        } else {
          return d;
        }

        batch.update(doc(ministeringDistrictsCollection, d.id), {
          companionshipIds: nextIds,
          updatedAt: serverTimestamp(),
        });
        return { ...d, companionshipIds: nextIds };
      });

      // Fuente de verdad en el compañerismo (permite filtrar aunque companionshipIds falle)
      const nextDistrictId = currentlyInDistrict ? null : districtId;
      batch.update(doc(ministeringCollection, companionshipId), {
        districtId: nextDistrictId,
      });

      await batch.commit();
      setDistricts(nextDistricts);
      setCompanionships(prev =>
        prev.map(c => (c.id === companionshipId ? { ...c, districtId: nextDistrictId } : c))
      );
      toast({ title: t('ministering.success'), description: t('ministering.districtUpdatedDescription') });
    } catch (error) {
      logger.error({ error, message: "Failed to assign companionship to district" });
      toast({ title: t('ministering.error'), description: t('ministering.districtUpdateErrorDescription'), variant: "destructive" });
    }
  };

  const assignLeaderToDistrict = async (districtId: string, leaderId: string | null) => {
    const leaderName = leaderId ? members.find(m => m.id === leaderId)?.firstName + ' ' + members.find(m => m.id === leaderId)?.lastName : null;
    await updateDistrict(districtId, { leaderId, leaderName });
  };

  const getNextDistrictDefaultName = useCallback(() => {
    const usedNumbers = new Set<number>();
    districts.forEach(d => {
      const match = d.name.match(/(\d+)\s*$/);
      if (match) usedNumbers.add(Number(match[1]));
    });
    let n = 1;
    while (usedNumbers.has(n)) n += 1;
    return t('ministering.districtDefaultName').replace('{number}', n.toString());
  }, [districts, t]);

  const openCreateDistrictDialog = () => {
    setNewDistrictName(getNextDistrictDefaultName());
    setIsCreateDistrictOpen(true);
  };

  const createDistrict = async () => {
    const name = newDistrictName.trim();
    if (!name) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.districtNameRequired'),
        variant: 'destructive',
      });
      return;
    }
    if (districts.some(d => d.name.trim().toLowerCase() === name.toLowerCase())) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.districtNameDuplicate'),
        variant: 'destructive',
      });
      return;
    }

    setIsSavingDistrict(true);
    try {
      const payload = {
        name,
        companionshipIds: [] as string[],
        leaderId: null as string | null,
        leaderName: null as string | null,
        barrioOrg,
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(ministeringDistrictsCollection, payload);
      const created: MinisteringDistrict = {
        id: docRef.id,
        name,
        companionshipIds: [],
        leaderId: null,
        leaderName: null,
      };
      setDistricts(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setIsCreateDistrictOpen(false);
      setNewDistrictName('');
      toast({
        title: t('ministering.districtSavedTitle'),
        description: t('ministering.districtSavedDescription', { name }),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to create district' });
      toast({
        title: t('ministering.districtSaveErrorTitle'),
        description: t('ministering.districtSaveErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsSavingDistrict(false);
    }
  };

  const defaultDistrictName = t('ministering.districtDefaultName').replace('{number}', '1');

  const deleteDistrict = async (districtId: string) => {
    const target = districts.find(d => d.id === districtId);
    if (target && isProtectedDefaultDistrict(target, defaultDistrictName)) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.districtCannotDeleteDefault'),
        variant: 'destructive',
      });
      return;
    }
    if (districts.length <= 1) {
      toast({
        title: t('ministering.error'),
        description: t('ministering.districtCannotDeleteLast'),
        variant: 'destructive',
      });
      return;
    }

    setDeletingDistrictId(districtId);
    try {
      // 1) Borrar el distrito (operación principal)
      await deleteDoc(doc(ministeringDistrictsCollection, districtId));

      // 2) Quitar districtId de las parejas asignadas (best-effort, no bloquea el borrado)
      const assignedCompanionships = companionships.filter(
        (comp) =>
          comp.districtId === districtId ||
          (districts.find(d => d.id === districtId)?.companionshipIds ?? []).includes(comp.id)
      );

      await Promise.allSettled(
        assignedCompanionships.map((comp) =>
          updateDoc(doc(ministeringCollection, comp.id), {
            districtId: null,
            // Asegura barrioOrg en updates parciales por si el doc antiguo no lo tenía
            ...(barrioOrg ? { barrioOrg } : {}),
          })
        )
      );

      setDistricts(prev => prev.filter(d => d.id !== districtId));
      setCompanionships(prev =>
        prev.map(c =>
          assignedCompanionships.some(a => a.id === c.id) ? { ...c, districtId: null } : c
        )
      );
      if (selectedDistrictId === districtId) {
        selectDistrictFilter(null);
      }
      toast({
        title: t('ministering.success'),
        description: t('ministering.districtDeletedDescription'),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to delete district' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.districtDeleteErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setDeletingDistrictId(null);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
        let comps = await getCompanionships(barrioOrg);
        const membersList = await getMembersByStatus(undefined, { barrioOrg });
        setMembers(membersList);
        const map = new Map<string, string>();
        membersList.forEach(member => {
          const fullName = `${member.firstName} ${member.lastName}`;
          map.set(fullName, member.id);
        });
        setMemberMap(map);
        // Load districts
        let districtsList = await getDistricts(barrioOrg);
        if (districtsList.length === 0) {
          // Por defecto solo se crea Distrito 1; el resto se crean manualmente
          const defaultName = t('ministering.districtDefaultName').replace('{number}', '1');
          const docRef = doc(ministeringDistrictsCollection);
          await setDoc(docRef, {
            name: defaultName,
            companionshipIds: [],
            leaderId: null,
            leaderName: null,
            isDefault: true,
            barrioOrg,
            updatedAt: serverTimestamp(),
          });
          districtsList = await getDistricts(barrioOrg);
        } else {
          // Ordenar por nombre (sin renombrar automáticamente)
          districtsList.sort((a, b) => a.name.localeCompare(b.name));

          // Marcar Distrito 1 existente como isDefault si aún no lo está
          const defaultName = t('ministering.districtDefaultName').replace('{number}', '1');
          const defaultDistrict = districtsList.find(d =>
            isProtectedDefaultDistrict(d, defaultName)
          );
          if (defaultDistrict && !defaultDistrict.isDefault) {
            await setDoc(
              doc(ministeringDistrictsCollection, defaultDistrict.id),
              { isDefault: true, updatedAt: serverTimestamp() },
              { merge: true },
            );
            defaultDistrict.isDefault = true;
          }

          // Reparar asignaciones duplicadas: un compañerismo solo en un distrito
          const seenCompanionshipIds = new Set<string>();
          const exclusivityBatch = writeBatch(firestore);
          let needsExclusivityFix = false;
          for (const district of districtsList) {
            const uniqueIds: string[] = [];
            let changed = false;
            for (const id of district.companionshipIds ?? []) {
              if (seenCompanionshipIds.has(id)) {
                changed = true;
                continue;
              }
              seenCompanionshipIds.add(id);
              uniqueIds.push(id);
            }
            if (changed || uniqueIds.length !== (district.companionshipIds ?? []).length) {
              district.companionshipIds = uniqueIds;
              exclusivityBatch.update(doc(ministeringDistrictsCollection, district.id), {
                companionshipIds: uniqueIds,
                updatedAt: serverTimestamp(),
              });
              needsExclusivityFix = true;
            }
          }
          if (needsExclusivityFix) {
            await exclusivityBatch.commit();
          }
        }

        // Sincronizar districtId en compañerismos desde companionshipIds (datos antiguos)
        {
          const companionshipToDistrict = new Map<string, string>();
          districtsList.forEach(d => {
            (d.companionshipIds ?? []).forEach(id => {
              if (!companionshipToDistrict.has(id)) {
                companionshipToDistrict.set(id, d.id);
              }
            });
          });
          const syncBatch = writeBatch(firestore);
          let needsSync = false;
          comps = comps.map(comp => {
            const fromDistrictList = companionshipToDistrict.get(comp.id) ?? null;
            const resolvedDistrictId = comp.districtId || fromDistrictList;
            if (resolvedDistrictId && resolvedDistrictId !== comp.districtId) {
              syncBatch.update(doc(ministeringCollection, comp.id), { districtId: resolvedDistrictId });
              needsSync = true;
              return { ...comp, districtId: resolvedDistrictId };
            }
            return { ...comp, districtId: resolvedDistrictId };
          });
          // También rellenar companionshipIds del distrito si solo hay districtId en el compañerismo
          const districtIdsMap = new Map(districtsList.map(d => [d.id, new Set(d.companionshipIds ?? [])]));
          comps.forEach(comp => {
            if (!comp.districtId) return;
            const set = districtIdsMap.get(comp.districtId);
            if (set && !set.has(comp.id)) {
              set.add(comp.id);
            }
          });
          districtsList = districtsList.map(d => {
            const nextIds = Array.from(districtIdsMap.get(d.id) ?? []);
            const prevIds = d.companionshipIds ?? [];
            if (nextIds.length !== prevIds.length || nextIds.some(id => !prevIds.includes(id))) {
              syncBatch.update(doc(ministeringDistrictsCollection, d.id), {
                companionshipIds: nextIds,
                updatedAt: serverTimestamp(),
              });
              needsSync = true;
              return { ...d, companionshipIds: nextIds };
            }
            return d;
          });
          if (needsSync) {
            await syncBatch.commit();
          }
        }

        setDistricts(districtsList);
        setCompanionships(comps);
    } catch (error) {
      logger.error({ error, message: "Failed to fetch companionships" });
      toast({ title: t('ministering.error'), description: t('ministering.loadError'), variant: "destructive" });
    } finally {
        setLoading(false);
    }
  }, [toast, t, barrioOrg]);


  useEffect(() => {
    if (authLoading || !user) return;
    loadData();
  }, [authLoading, user, loadData]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const handleChange = () => setIsCoarsePointer(mediaQuery.matches);
    handleChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const renderUrgentIndicator = (observation?: string) => {
    const reason = observation?.trim() || t('ministering.noObservation');

    if (isCoarsePointer) {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-2 inline-flex items-center text-xs font-semibold text-destructive underline-offset-2 hover:underline"
            >
              {t('ministering.urgent')}
            </button>
          </PopoverTrigger>
          <PopoverContent className="text-sm">
            {reason}
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-2 inline-flex items-center text-xs font-semibold text-destructive cursor-help">
            {t('ministering.urgent')}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{reason}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  useEffect(() => {
    if (filteredCompanionships.length === 0) {
      setVisibleCount(0);
      return;
    }
    setVisibleCount((prev) => {
      const next = Math.max(prev, PAGE_SIZE);
      return Math.min(next, filteredCompanionships.length);
    });
  }, [filteredCompanionships]);

  useEffect(() => {
    const node = loadMoreTriggerRef.current;
    if (!node) return;
    if (loading) return;
    if (visibleCount >= filteredCompanionships.length) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount((prev) => {
        const next = Math.min(prev + PAGE_SIZE, filteredCompanionships.length);
        return next === prev ? prev : next;
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => {
            const next = Math.min(prev + PAGE_SIZE, filteredCompanionships.length);
            return next === prev ? prev : next;
          });
        }
      });
    }, { rootMargin: '0px 0px 200px 0px' });

    observer.observe(node);

    return () => observer.disconnect();
  }, [loading, visibleCount, filteredCompanionships.length]);

  return (
    <TooltipProvider>
    <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-1">
          {loading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <Card>
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="text-sm font-medium">{t('ministering.companionships')}</CardTitle>
                <CardDescription>{t('ministering.totalCompanionshipsDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCompanionships}</div>
              </CardContent>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-lg">{t('ministering.districtsTitle')}</CardTitle>
              <CardDescription>{t('ministering.districtsManageHelp')}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={openCreateDistrictDialog}
              disabled={loading}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {t('ministering.addDistrict')}
            </Button>
          </CardHeader>
          <CardContent>
            <Dialog open={isCreateDistrictOpen} onOpenChange={setIsCreateDistrictOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('ministering.addDistrictTitle')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="new-district-name">{t('ministering.districtNameLabel')}</Label>
                  <Input
                    id="new-district-name"
                    value={newDistrictName}
                    onChange={(e) => setNewDistrictName(e.target.value)}
                    placeholder={t('ministering.districtNamePlaceholder')}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void createDistrict();
                      }
                    }}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDistrictOpen(false)}
                    disabled={isSavingDistrict}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" onClick={() => void createDistrict()} disabled={isSavingDistrict}>
                    {isSavingDistrict ? t('common.saving') : t('common.save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                Array.from({ length: 1 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))
              ) : (
              districts.map((district) => {
                const assignedIds = getCompanionshipIdsForDistrict(district.id);
                const districtCompanionships = companionships.filter(comp => assignedIds.has(comp.id));
                const totalMembers = districtCompanionships.reduce(
                  (sum, comp) => sum + (comp.companions?.length || 0) + (comp.families?.length || 0),
                  0,
                );

                const isSelected = selectedDistrictId === district.id;
                // Distrito 1 (default): NUNCA mostrar eliminar
                const showDeleteButton =
                  !isProtectedDefaultDistrict(district, defaultDistrictName) &&
                  districts.length > 1;

                return (
                <Card 
                  key={district.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`cursor-pointer transition-all hover:shadow-md select-none ${
                    isSelected 
                      ? 'border-primary bg-primary/5 ring-2 ring-primary' 
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => selectDistrictFilter(isSelected ? null : district.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectDistrictFilter(isSelected ? null : district.id);
                    }
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0" />
                      <span className="truncate">{district.name}</span>
                      {isSelected && (
                        <span className="ml-auto text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full shrink-0">
                          {t('ministering.filtered')}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm">
                      <p className="font-medium">{t('ministering.companionshipsCount', { count: districtCompanionships.length })}</p>
                      <p className="font-medium">{t('ministering.totalMembersCount', { count: totalMembers })}</p>
                      <p className="font-medium">{t('ministering.leaderLabel', { name: district.leaderName || t('ministering.notAssigned') })}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Settings className="mr-2 h-4 w-4" />
                          {t('ministering.manageDistrict')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t('ministering.manageDistrictTitle', { name: district.name })}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium">{t('ministering.selectCompanionships')}</label>
                            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                              {companionships.map(comp => (
                                <div key={comp.id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`comp-${comp.id}`}
                                    checked={
                                      (district.companionshipIds ?? []).includes(comp.id) ||
                                      comp.districtId === district.id
                                    }
                                    onCheckedChange={() => assignCompanionshipToDistrict(district.id, comp.id)}
                                  />
                                  <label htmlFor={`comp-${comp.id}`} className="text-sm">
                                    {comp.companions.join(', ')}
                                  </label>
                                </div>
                              ))}
                              {companionships.length === 0 && (
                                <p className="text-sm text-muted-foreground">{t('ministering.noCompanionshipsAvailable')}</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium">{t('ministering.districtLeader')}</label>
                            <Select
                              value={district.leaderId || 'none'}
                              onValueChange={(value) => assignLeaderToDistrict(district.id, value === 'none' ? null : value)}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder={t('ministering.selectLeader')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{t('ministering.notAssigned')}</SelectItem>
                                {members.map(member => (
                                  <SelectItem key={member.id} value={member.id}>
                                    {member.firstName} {member.lastName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                      {showDeleteButton ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            disabled={deletingDistrictId === district.id}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('ministering.deleteDistrict')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('ministering.deleteDistrictTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('ministering.deleteDistrictDescription', { name: district.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={() => void deleteDistrict(district.id)}
                            >
                              {t('common.delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
              })
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">{t('ministering.companionshipDetails')}</CardTitle>
                {selectedDistrictId && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => selectDistrictFilter(null)}
                    className="gap-1"
                  >
                    <X className="h-3 w-3" />
                    {t('ministering.showAll')}
                  </Button>
                )}
              </div>
              {canWrite && (
              <Button asChild>
                <Link href="/ministering/add">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('ministering.addCompanionship')}
                </Link>
              </Button>
              )}
          </CardHeader>
          <CardContent>
            {selectedDistrictId && !loading && (
              <p className="mb-4 text-sm text-muted-foreground">
                {t('ministering.companionshipsCount', {
                  count: filteredCompanionships.length,
                })}
                {' · '}
                {districts.find(d => d.id === selectedDistrictId)?.name}
              </p>
            )}
            {/* Desktop View: Table */}
            <div className="hidden md:block">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>{t('ministering.companions')}</TableHead>
                    <TableHead>{t('ministering.assignedFamilies')}</TableHead>
                    <TableHead>{t('ministering.district')}</TableHead>
                    <TableHead className="text-right">
                        {t('ministering.actions')}
                    </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                            </TableRow>
                        ))
                    ) : visibleCompanionships.map((item) => (
                    <TableRow key={item.id} className={item.families.some(f => f.isUrgent) ? 'bg-destructive/10' : ''}>
                        <TableCell className="font-medium">
                          {item.companions.map((c, i) => (
                            <div key={i} className={i < item.companions.length - 1 ? 'mb-1' : undefined}>
                              <Link href={getMemberLink(c)} className="text-blue-600 hover:underline">
                                {c}
                              </Link>
                            </div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {item.families.map((f, i) => (
                            <div key={i} className={i < item.families.length - 1 ? 'mb-1' : undefined}>
                              <Link href={getMemberLink(f.name, f.memberId)} className="text-blue-600 hover:underline">
                                {f.name}
                              </Link>
                              {f.isUrgent && renderUrgentIndicator(f.observation)}
                            </div>
                          ))}
                        </TableCell>
                        <TableCell>
                          {companionshipDistrictMap.get(item.id)?.join(', ') || t('ministering.notAssigned')}
                        </TableCell>
                        <TableCell className="text-right">
                            <Button variant="outline" size="sm" asChild>
                                <Link href={`/ministering/${item.id}`}>
                                    <Settings className="mr-2 h-4 w-4" />
                                    {t('ministering.manage')}
                                </Link>
                            </Button>
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>

            {/* Mobile View: Cards */}
            <div className="md:hidden space-y-4">
                {loading ? (
                    Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
                ) : visibleCompanionships.map((item) => (
                     <Card key={item.id} className={item.families.some(f => f.isUrgent) ? 'border-destructive' : ''}>
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle className="text-lg">
                                      {item.companions.map((c, i) => (
                                        <div key={i} className={i < item.companions.length - 1 ? 'mb-1' : undefined}>
                                          <Link href={getMemberLink(c)} className="text-blue-600 hover:underline">
                                            {c}
                                          </Link>
                                        </div>
                                      ))}
                                    </CardTitle>
                                    <CardDescription />
                                </div>
                               <Button variant="outline" size="sm" asChild>
                                    <Link href={`/ministering/${item.id}`}>
                                        <Settings className="mr-2 h-4 w-4" />
                                        {t('ministering.manage')}
                                    </Link>
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                           <div>
                               <p className="font-semibold text-muted-foreground">{t('ministering.assignedFamilies')}</p>
                               {item.families.map((f, i) => (
                                <div key={i} className={i < item.families.length - 1 ? 'mb-1' : undefined}>
                                  <Link href={getMemberLink(f.name, f.memberId)} className="text-blue-600 hover:underline">
                                    <p>{f.name}</p>
                                  </Link>
                                  {f.isUrgent && renderUrgentIndicator(f.observation)}
                                </div>
                              ))}
                           </div>
                           <div>
                               <p className="font-semibold text-muted-foreground">{t('ministering.district')}</p>
                               <p>{companionshipDistrictMap.get(item.id)?.join(', ') || t('ministering.notAssigned')}</p>
                           </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div ref={loadMoreTriggerRef} className="h-1" aria-hidden="true" />

            {!loading && filteredCompanionships.length === 0 && (
                <div className="text-center p-8 text-muted-foreground">
                    {selectedDistrictId 
                      ? t('ministering.noCompanionshipsInDistrict')
                      : t('ministering.noCompanionships')
                    }
                </div>
            )}
          </CardContent>
        </Card>
    </div>
    </TooltipProvider>
  );
}
