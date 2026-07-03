
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDocs, query, orderBy, Timestamp, collection, where, documentId } from 'firebase/firestore';
import { membersCollection, futureMembersCollection, ministeringCollection, convertsCollection, newConvertFriendsCollection } from '@/lib/collections';
import type { Convert, Member, NewConvertFriendship, Companionship } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
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
import { Button } from '@/components/ui/button';
import { Info, Pencil, Eye } from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ConvertInfoSheet, type ConvertWithInfo } from './convert-info-sheet';
import { syncMinisteringAssignments } from '@/lib/ministering-sync';
import { useToast } from '@/hooks/use-toast';
import { buildMemberEditUrl } from '@/lib/navigation';

import { firestore } from '@/lib/firebase';
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
  const twentyFourMonthsAgo = subMonths(new Date(), 24);

  // Fetch all required data concurrently
  const [
    convertsSnapshot,
    membersSnapshot,
    friendshipsSnapshot,
    companionshipsSnapshot
  ] = await Promise.all([
    getDocs(query(convertsCollection, orderBy('baptismDate', 'desc'))),
    getDocs(query(membersCollection, orderBy('baptismDate', 'desc'))),
    getDocs(query(newConvertFriendsCollection)),
    getDocs(query(ministeringCollection))
  ]);

  // Filter by barrioOrg client-side (data may be mixed during migration)
  const filterByBarrio = (doc: { barrioOrg?: string }) =>
    !barrioOrg || !doc.barrioOrg || doc.barrioOrg === "" || doc.barrioOrg === barrioOrg;

  // Obtener conversos de la colección c_conversos
  const convertsFromCollection = convertsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Convert & { barrioOrg?: string }))
    .filter(convert =>
      convert.baptismDate &&
      convert.baptismDate.toDate &&
      convert.baptismDate.toDate() > twentyFourMonthsAgo &&
      filterByBarrio(convert)
    );

  // Obtener miembros bautizados hace 2 años
  const membersAsConverts = membersSnapshot.docs
    .map(doc => {
      const memberData = doc.data();
      if (!filterByBarrio(memberData as { barrioOrg?: string })) return null;
      if (normalizeMemberStatus(memberData.status) === 'deceased') {
        return null;
      }
      if (memberData.baptismDate && memberData.baptismDate.toDate) {
        const baptismDate = memberData.baptismDate.toDate();
        if (baptismDate > twentyFourMonthsAgo) {
          return {
            id: `member_${doc.id}`,
            name: `${memberData.firstName} ${memberData.lastName}`,
            baptismDate: memberData.baptismDate,
            photoURL: memberData.photoURL,
            councilCompleted: memberData.councilCompleted || false,
            councilCompletedAt: memberData.councilCompletedAt || null,
            observation: 'Bautizado como miembro',
            missionaryReference: 'Registro de miembros',
            memberId: doc.id
          } as Convert;
        }
      }
      return null;
    })
    .filter(Boolean) as Convert[];

  // Combinar y ordenar por fecha de bautismo (más reciente primero)
  const allConverts = [...convertsFromCollection, ...membersAsConverts]
    .sort((a, b) => b.baptismDate.toDate().getTime() - a.baptismDate.toDate().getTime());

  // Eliminar duplicados basados en nombre y fecha de bautismo
  const uniqueConverts = allConverts.filter((convert, index, self) =>
    index === self.findIndex(c =>
      c.name === convert.name &&
      c.baptismDate.toDate().getTime() === convert.baptismDate.toDate().getTime()
    )
  );

  const friendships = friendshipsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as NewConvertFriendship));
  const companionships = companionshipsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Companionship));
  const members = membersSnapshot.docs
    .map(d => {
      const memberData = d.data();
      return {
        id: d.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status),
      } as Member;
    })
    .filter(member => member.status !== 'deceased');

  // Fetch additional convert info (callings, notes)
  const convertInfos: {
    convertId: string;
    calling: string;
    notes: string;
    recommendationActive: boolean;
    selfRelianceCourse: boolean;
  }[] = [];

  if (uniqueConverts.length > 0) {
    const chunks: string[][] = [];
    const chunkSize = 30; // Firestore 'in' query limit is 30
    for (let i = 0; i < uniqueConverts.length; i += chunkSize) {
      chunks.push(uniqueConverts.slice(i, i + chunkSize).map(c => c.id));
    }

    const chunkPromises = chunks.map(async (chunk) => {
      try {
        const snapshot = await getDocs(
          query(collection(firestore, 'c_conversos_info'), where(documentId(), 'in', chunk))
        );
        return snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            convertId: doc.id,
            calling: data.calling as string || '',
            notes: data.notes as string || '',
            recommendationActive: data.recommendationActive === true,
            selfRelianceCourse: data.selfRelianceCourse === true
          };
        });
      } catch (error) {
        console.error("Error fetching convert info chunk:", error);
        return [];
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    convertInfos.push(...chunkResults.flat());
  }

  // Enrich converts with info
  return uniqueConverts.map(convert => {
    // Find friendship
    const friendship = friendships.find(f => f.convertId === convert.id) || null;

    // Find member data (for converts linked to members or member converts)
    let memberId = convert.memberId;
    if (convert.id.startsWith('member_')) {
      memberId = convert.id.substring(7);
    }
    const memberData = memberId ? members.find(m => m.id === memberId) || null : null;

    // Find ministering teachers from companionships
    let ministeringTeachers: string[] = [];
    if (memberData) {
      // From member record
      ministeringTeachers = memberData.ministeringTeachers || [];
    }
    // Also check companionships by family name
    const familyName = convert.name?.split(' ').slice(1).join(' ');
    if (familyName) {
      const matchingComp = companionships.find(comp =>
        comp.families.some(f => f.name.toLowerCase().includes(familyName.toLowerCase()) ||
          f.name.toLowerCase().includes(convert.name?.toLowerCase() || ''))
      );
      if (matchingComp) {
        ministeringTeachers = [...new Set([...ministeringTeachers, ...matchingComp.companions])];
      }
    }

    // Get additional info
    const info = convertInfos.find(i => i?.convertId === convert.id);

    return {
      ...convert,
      friendship,
      memberData,
      ministeringTeachers,
      calling: info?.calling || '',
      notes: info?.notes || '',
      recommendationActive: info?.recommendationActive || false,
      selfRelianceCourse: info?.selfRelianceCourse || false
    };
  });
}

export default function ConvertsPage() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [converts, setConverts] = useState<ConvertWithInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConvert, setSelectedConvert] = useState<ConvertWithInfo | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, membersSnapshot] = await Promise.all([
        getConvertsWithInfo(barrioOrg),
        getDocs(query(membersCollection, orderBy('firstName', 'asc')))
      ]);
      setConverts(data);
      setAvailableMembers(membersSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    } catch (error) {
      console.error("Failed to fetch converts:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !user) return;
    queueMicrotask(() => {
      void loadData();
    });
  }, [authLoading, user]);

  const handleSaveConvertInfo = async (convertId: string, calling: string, notes: string, recommendationActive: boolean, selfRelianceCourse: boolean) => {
    setSaving(true);
    try {
      const infoRef = convertInfoCollection(convertId);
      await setDoc(infoRef, {
        calling,
        notes,
        recommendationActive,
        selfRelianceCourse,
        updatedAt: Timestamp.now()
      }, { merge: true });

      // Update local state
      setConverts(prev => prev.map(c =>
        c.id === convertId ? { ...c, calling, notes, recommendationActive, selfRelianceCourse } : c
      ));
      toast({ title: '✅ Información guardada', description: 'Los datos del converso se actualizaron correctamente.' });
    } catch (error) {
      console.error("Failed to save convert info:", error);
      toast({ title: 'Error', description: 'No se pudo guardar la información.', variant: 'destructive' });
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
          toast({ title: '✅ Amigos eliminados', description: 'La asignación de amigos fue removida.' });
        } else {
          await updateDoc(doc(newConvertFriendsCollection, friendshipId), {
            friends,
            updatedAt: Timestamp.now()
          });
          toast({ title: '✅ Amigos guardados', description: 'La asignación de amigos se actualizó.' });
        }
      } else if (friends.length > 0) {
        // Create new friendship
        await addDoc(newConvertFriendsCollection, {
          convertId,
          convertName,
          friends,
          assignedAt: serverTimestamp()
        });
        toast({ title: '✅ Amigos asignados', description: 'Se asignaron amigos al converso.' });
      }

      // Reload data to reflect changes
      await loadData();
    } catch (error) {
      console.error("Failed to save friends:", error);
      toast({ title: 'Error', description: 'No se pudo guardar la asignación de amigos.', variant: 'destructive' });
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
      toast({ title: '✅ Maestros guardados', description: 'Los maestros ministrantes se actualizaron.' });
    } catch (error) {
      console.error("Failed to save teachers:", error);
      toast({ title: 'Error', description: 'No se pudo guardar los maestros ministrantes.', variant: 'destructive' });
    }
    setSaving(false);
  };

  const openConvertInfo = (convert: ConvertWithInfo) => {
    setSelectedConvert(convert);
    setIsSheetOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('converts.title')}</CardTitle>
            <CardDescription>
              {t('converts.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('converts.name')}</TableHead>
              <TableHead>{t('converts.baptismDate')}</TableHead>
              <TableHead className="text-right">{t('converts.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-5 w-32" />
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-20 inline-block" /></TableCell>
                </TableRow>
              ))
            ) : converts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  {t('converts.noData')}
                </TableCell>
              </TableRow>
            ) : (
              converts.map((item) => {
                const convertAlertStatus = getConvertAlertStatus(item);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Avatar>
                            <AvatarImage src={item.photoURL} data-ai-hint="profile picture" />
                            <AvatarFallback>{item.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          {convertAlertStatus && (
                            <span
                              aria-label={convertAlertStatus === 'inactive' ? 'Converso inactivo' : 'Converso menos activo'}
                              title={convertAlertStatus === 'inactive' ? 'Inactivo' : 'Menos activo'}
                              className={`absolute -top-0.5 -right-0.5 block h-0 w-0 border-l-[10px] border-b-[10px] border-l-transparent ${
                                convertAlertStatus === 'inactive' ? 'border-b-red-500' : 'border-b-yellow-400'
                              }`}
                            />
                          )}
                        </div>
                        <span>{item.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(item.baptismDate.toDate(), 'd LLLL yyyy', { locale: es })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={item.id.startsWith('member_')
                            ? `/members/${item.id.substring(7)}`
                            : item.memberId
                              ? `/members/${item.memberId}`
                              : `/members?search=${encodeURIComponent(item.name)}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openConvertInfo(item)}>
                          <Info className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={item.id.startsWith('member_')
                            ? buildMemberEditUrl(item.id.substring(7), '/converts')
                            : item.memberId
                              ? buildMemberEditUrl(item.memberId, '/converts')
                              : `/members?search=${encodeURIComponent(item.name)}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        <ConvertInfoSheet
          convert={selectedConvert}
          isOpen={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          onSave={handleSaveConvertInfo}
          onSaveFriends={handleSaveFriends}
          onSaveTeachers={handleSaveTeachers}
          saving={saving}
          availableMembers={availableMembers}
        />
      </CardContent>
    </Card>
  );
}
