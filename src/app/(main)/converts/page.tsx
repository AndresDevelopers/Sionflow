
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  getDocsFromServer,
  query,
  orderBy,
  Timestamp,
  collection,
  where,
  documentId,
  deleteDoc,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  serverTimestamp} from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import { membersCollection, ministeringCollection, newConvertFriendsCollection } from '@/lib/collections';
import type { Member, NewConvertFriendship, Companionship } from '@/lib/types';
import { normalizeMemberStatus, getMembersForSelector } from '@/lib/members-data';
import {
  getMemberPhotoURL,
  getRecentConvertCutoff,
  membersToRecentConverts,
  memberToConvertId,
  parseMemberIdFromConvertId,
} from '@/lib/converts-from-members';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Info, Pencil, Eye, Users, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';
import { ConvertInfoSheet, type ConvertWithInfo } from './convert-info-sheet';
import { MemberForm } from '@/components/members/member-form';
import { syncMinisteringAssignments } from '@/lib/ministering-sync';
import { useToast } from '@/hooks/use-toast';
import { buildMemberEditUrl } from '@/lib/navigation';

import { firestore } from '@/lib/firebase';

/** Misma forma de foto que en la página de Miembros (next/image). */
function ConvertAvatar({
  photoURL,
  name,
  size = 40,
}: {
  photoURL?: string | null;
  name: string;
  size?: number;
}) {
  const src = typeof photoURL === 'string' && photoURL.trim() ? photoURL.trim() : undefined;
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  return (
    <div
      className="rounded-full bg-muted flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Users className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}
// Convert info collection for additional data
const convertInfoCollection = (convertId: string) => doc(firestore, 'c_conversos_info', convertId);

type ConvertAlertStatus = 'inactive' | 'less_active' | null;

const getConvertAlertStatus = (convert: ConvertWithInfo): ConvertAlertStatus => {
  const memberStatus = convert.memberData?.status;
  if (memberStatus === 'inactive') return 'inactive';
  if (memberStatus === 'less_active') return 'less_active';
  return null;
};

async function getConvertsWithInfo(barrioOrg: string): Promise<ConvertWithInfo[]> {
  const cutoff = getRecentConvertCutoff();
  const cutoffTs = Timestamp.fromDate(cutoff);

  const membersQuery = query(
    membersCollection,
    where('barrioOrg', '==', barrioOrg),
    where('baptismDate', '>=', cutoffTs),
    orderBy('baptismDate', 'desc')
  );

  // Preferir servidor para no usar IndexedDB stale sin photoURL (caché persistente de Firestore)
  let membersSnapshot;
  try {
    membersSnapshot = await getDocsFromServer(membersQuery);
  } catch {
    membersSnapshot = await getDocs(membersQuery);
  }

  const [friendshipsSnapshot, companionshipsSnapshot] = await Promise.all([
    getDocs(query(newConvertFriendsCollection, where('barrioOrg', '==', barrioOrg))),
    getDocs(query(ministeringCollection, where('barrioOrg', '==', barrioOrg))),
  ]);

  const members = membersSnapshot.docs
    .map((d) => {
      const memberData = d.data() as Record<string, unknown>;
      // Extraer foto de forma explícita (evita perder el campo al mapear)
      const rawPhoto = memberData.photoURL;
      const photoURL =
        typeof rawPhoto === 'string' && rawPhoto.trim()
          ? rawPhoto.trim()
          : undefined;
      return {
        ...memberData,
        id: d.id,
        photoURL,
        status: normalizeMemberStatus(memberData.status as string | undefined),
      } as Member;
    })
    .filter((m) => m.status !== 'deceased');

  const uniqueConverts = membersToRecentConverts(members);

  const friendships = friendshipsSnapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as NewConvertFriendship)
  );
  const companionships = companionshipsSnapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Companionship)
  );

  // Info extra (llamamiento, notas) claveada por member_${id}
  const convertInfos: {
    convertId: string;
    calling: string;
    notes: string;
    recommendationActive: boolean;
    selfRelianceCourse: boolean;
  }[] = [];

  if (uniqueConverts.length > 0) {
    const chunkSize = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueConverts.length; i += chunkSize) {
      chunks.push(uniqueConverts.slice(i, i + chunkSize).map((c) => c.id));
    }

    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const snapshot = await getDocs(
            query(collection(firestore, 'c_conversos_info'), where(documentId(), 'in', chunk))
          );
          return snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              convertId: docSnap.id,
              calling: (data.calling as string) || '',
              notes: (data.notes as string) || '',
              recommendationActive: data.recommendationActive === true,
              selfRelianceCourse: data.selfRelianceCourse === true,
            };
          });
        } catch (error) {
          console.error('Error fetching convert info chunk:', error);
          return [];
        }
      })
    );
    convertInfos.push(...chunkResults.flat());
  }

  return uniqueConverts.map((convert) => {
    const memberId =
      convert.memberId || parseMemberIdFromConvertId(convert.id) || '';
    const memberData = memberId ? members.find((m) => m.id === memberId) || null : null;

    // Amistad: id canónico member_${id}; también match por memberId legacy
    const friendship =
      friendships.find(
        (f) =>
          f.convertId === convert.id ||
          (memberId && f.convertId === memberId) ||
          (memberId && f.convertId === memberToConvertId(memberId))
      ) || null;

    let ministeringTeachers: string[] = memberData?.ministeringTeachers || [];
    const familyName = convert.name?.split(' ').slice(1).join(' ');
    if (familyName) {
      const matchingComp = companionships.find((comp) =>
        comp.families.some(
          (f) =>
            f.name.toLowerCase().includes(familyName.toLowerCase()) ||
            f.name.toLowerCase().includes(convert.name?.toLowerCase() || '')
        )
      );
      if (matchingComp) {
        ministeringTeachers = [...new Set([...ministeringTeachers, ...matchingComp.companions])];
      }
    }

    const info = convertInfos.find((i) => i?.convertId === convert.id);

    // Foto SIEMPRE desde el documento del miembro (fuente de verdad)
    const baptismFallback = Array.isArray(memberData?.baptismPhotos)
      ? memberData.baptismPhotos.find(
          (u): u is string => typeof u === 'string' && u.trim().length > 0
        )
      : undefined;
    const photoURL =
      getMemberPhotoURL(memberData) ||
      getMemberPhotoURL(convert) ||
      baptismFallback ||
      undefined;

    return {
      ...convert,
      memberId,
      photoURL,
      friendship,
      memberData,
      ministeringTeachers,
      calling: info?.calling || '',
      notes: info?.notes || '',
      recommendationActive: info?.recommendationActive || false,
      selfRelianceCourse: info?.selfRelianceCourse || false,
    };
  });
}

export default function ConvertsPage() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const { t } = useI18n();
  const { toast } = useToast();
  const [converts, setConverts] = useState<ConvertWithInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConvert, setSelectedConvert] = useState<ConvertWithInfo | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);

  const loadData = useCallback(async () => {
    if (!barrioOrg) {
      setConverts([]);
      setAvailableMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [data, membersList] = await Promise.all([
        getConvertsWithInfo(barrioOrg),
        getMembersForSelector(true, barrioOrg),
      ]);

      // Refuerzo: si el converso no trae foto, tomar photoURL del selector de miembros
      const membersById = new Map(membersList.map((m) => [m.id, m]));
      const enriched = data.map((c) => {
        const fromList = c.memberId ? membersById.get(c.memberId) : undefined;
        const photoURL =
          getMemberPhotoURL(c) ||
          getMemberPhotoURL(c.memberData) ||
          getMemberPhotoURL(fromList) ||
          undefined;
        return {
          ...c,
          photoURL,
          memberData: c.memberData || fromList || null,
        };
      });

      if (process.env.NODE_ENV === 'development') {
        const missing = enriched.filter((c) => !c.photoURL).map((c) => c.name);
        const withPhoto = enriched.filter((c) => !!c.photoURL).length;
        console.debug('[converts] fotos:', {
          total: enriched.length,
          withPhoto,
          missingPhoto: missing,
        });
      }

      setConverts(enriched);
      setAvailableMembers(membersList);
    } catch (error) {
      console.error('Failed to fetch converts:', error);
    }
    setLoading(false);
  }, [barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadData();
  }, [authLoading, user, loadData]);

  const handleSaveConvertInfo = async (convertId: string, calling: string, notes: string, recommendationActive: boolean, selfRelianceCourse: boolean) => {
    setSaving(true);
    try {
      const infoRef = convertInfoCollection(convertId);
      await setDoc(infoRef, {
        calling,
        notes,
        recommendationActive,
        selfRelianceCourse,
        barrioOrg,
        updatedAt: Timestamp.now()
      }, { merge: true });

      // Update local state
      setConverts(prev => prev.map(c =>
        c.id === convertId ? { ...c, calling, notes, recommendationActive, selfRelianceCourse } : c
      ));
      toast({ title: t('converts.saveInfoSuccessTitle'), description: t('converts.saveInfoSuccessDescription') });
    } catch (error) {
      console.error("Failed to save convert info:", error);
      toast({ title: t('common.error'), description: t('converts.saveInfoError'), variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleSaveFriends = async (convertId: string, convertName: string, friends: string[], friendshipId?: string) => {
    setSaving(true);
    try {
      if (friendshipId) {
        // Update existing friendship
        if (friends.length === 0) {
          await deleteDoc(doc(newConvertFriendsCollection, friendshipId));
          toast({ title: t('converts.friendsRemovedTitle'), description: t('converts.friendsRemovedDescription') });
        } else {
          await updateDoc(doc(newConvertFriendsCollection, friendshipId), {
            friends,
            updatedAt: Timestamp.now()
          });
          toast({ title: t('converts.friendsSavedTitle'), description: t('converts.friendsSavedDescription') });
        }
      } else if (friends.length > 0) {
        // Create new friendship
        await addDoc(newConvertFriendsCollection, {
          convertId,
          convertName,
          friends,
          barrioOrg,
          assignedAt: serverTimestamp()
        });
        toast({ title: t('converts.friendsAssignedTitle'), description: t('converts.friendsAssignedDescription') });
      }

      // Reload data to reflect changes
      await loadData();
    } catch (error) {
      console.error("Failed to save friends:", error);
      toast({ title: t('common.error'), description: t('converts.friendsSaveError'), variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleSaveTeachers = async (memberId: string, teachers: string[], previousTeachers: string[]) => {
    setSaving(true);
    try {
      // Update member document
      await updateDoc(doc(membersCollection, memberId), {
        ministeringTeachers: teachers,
        updatedAt: Timestamp.now()
      });

      // Sync with ministering collection
      const member = availableMembers.find(m => m.id === memberId);
      if (member) {
        await syncMinisteringAssignments(
          { ...member, ministeringTeachers: teachers },
          previousTeachers,
          barrioOrg
        );
      }

      // Reload data to reflect changes
      await loadData();
      toast({ title: t('converts.teachersSavedTitle'), description: t('converts.teachersSavedDescription') });
    } catch (error) {
      console.error("Failed to save teachers:", error);
      toast({ title: t('common.error'), description: t('converts.teachersSaveError'), variant: 'destructive' });
    }
    setSaving(false);
  };

  const openConvertInfo = (convert: ConvertWithInfo) => {
    setSelectedConvert(convert);
    setIsSheetOpen(true);
  };

  const handleFormClose = (savedMember?: Member | null) => {
    setIsFormOpen(false);
    // Si se creó/guardó un miembro con bautismo reciente, refrescar la lista
    if (savedMember) {
      void loadData();
    }
  };

  const totalConverts = converts.length;
  const inactiveCount = converts.filter((c) => getConvertAlertStatus(c) === 'inactive').length;
  const lessActiveCount = converts.filter((c) => getConvertAlertStatus(c) === 'less_active').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start">
          <div className="min-w-0">
            <CardTitle>{t('converts.title')}</CardTitle>
            <CardDescription>
              {t('converts.description')}
            </CardDescription>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end shrink-0">
            <div
              className="text-left sm:text-right"
              aria-label={t('converts.totalCountAria', { count: loading ? 0 : totalConverts })}
            >
              {loading ? (
                <Skeleton className="h-9 w-12 sm:ml-auto" />
              ) : (
                <>
                  <div className="text-3xl font-bold tabular-nums leading-none tracking-tight">
                    {totalConverts}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('converts.countLabel')}
                  </p>
                </>
              )}
            </div>
            {canWrite && (
              <Button className="w-full sm:w-auto" onClick={() => setIsFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t('converts.addButton')}
              </Button>
            )}
          </div>
        </div>
        {!loading && totalConverts > 0 && (inactiveCount > 0 || lessActiveCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {lessActiveCount > 0 && (
              <Badge
                variant="outline"
                className="border-yellow-400/60 text-yellow-700 dark:text-yellow-400"
              >
                {t('converts.countLessActive', { count: lessActiveCount })}
              </Badge>
            )}
            {inactiveCount > 0 && (
              <Badge
                variant="outline"
                className="border-red-500/60 text-red-600 dark:text-red-400"
              >
                {t('converts.countInactive', { count: inactiveCount })}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {/* Lista única responsive: nombre completo siempre visible (sin truncate) */}
        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4 max-w-[240px]" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-28" />
                </div>
              </div>
            ))
          ) : converts.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
              {t('converts.noData')}
            </div>
          ) : (
            converts.map((item) => {
              const convertAlertStatus = getConvertAlertStatus(item);
              const memberHref = item.memberId
                ? `/members/${item.memberId}`
                : `/members?search=${encodeURIComponent(item.name)}`;
              const editHref = item.memberId
                ? buildMemberEditUrl(item.memberId, '/converts')
                : `/members?search=${encodeURIComponent(item.name)}`;

              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border p-3 sm:p-4"
                >
                  <div className="relative shrink-0 mt-0.5">
                    <ConvertAvatar
                      photoURL={item.photoURL || item.memberData?.photoURL}
                      name={item.name}
                      size={40}
                    />
                    {convertAlertStatus && (
                      <span
                        aria-label={
                          convertAlertStatus === 'inactive'
                            ? t('converts.alertInactiveAria')
                            : t('converts.alertLessActiveAria')
                        }
                        title={
                          convertAlertStatus === 'inactive'
                            ? t('converts.alertInactiveTitle')
                            : t('converts.alertLessActiveTitle')
                        }
                        className={`absolute -top-0.5 -right-0.5 block h-0 w-0 border-l-[10px] border-b-[10px] border-l-transparent ${
                          convertAlertStatus === 'inactive'
                            ? 'border-b-red-500'
                            : 'border-b-yellow-400'
                        }`}
                      />
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p
                      className="text-sm font-medium leading-snug text-foreground sm:text-base"
                      style={{
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                      }}
                    >
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {format(item.baptismDate.toDate(), 'd LLLL yyyy', {
                        locale: getDateFnsLocale(),
                      })}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-0.5 -ml-1.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <Link href={memberHref} aria-label={t('converts.view') || 'Ver'}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openConvertInfo(item)}
                        aria-label={t('converts.info') || 'Info'}
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                      {canWrite && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <Link href={editHref} aria-label={t('converts.edit') || 'Editar'}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <ConvertInfoSheet
          convert={selectedConvert}
          isOpen={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          onSave={handleSaveConvertInfo}
          onSaveFriends={handleSaveFriends}
          onSaveTeachers={handleSaveTeachers}
          canWrite={canWrite}
          saving={saving}
          availableMembers={availableMembers}
        />

        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-4 sm:left-[50%] sm:top-1/2 sm:h-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
            <DialogHeader>
              <DialogTitle>{t('converts.addTitle')}</DialogTitle>
              <DialogDescription>{t('converts.addDescription')}</DialogDescription>
            </DialogHeader>
            {isFormOpen && (
              <MemberForm member={null} onClose={handleFormClose} />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
