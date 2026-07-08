
'use client'

export const dynamic = 'force-dynamic';

import { getDocs, query, orderBy, where, Timestamp, doc, updateDoc, getDoc, deleteDoc, collection, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';


import type { Member, FutureMember, Companionship, Family, Annotation, Service, Activity, NewConvertFriendship, Ordinance, TempleOrdinance } from '@/lib/types';
import { OrdinanceLabels, TempleOrdinanceLabels } from '@/lib/types';
import { getLessActiveMembers, getUrgentMembers, normalizeMemberStatus, updateMember, getDeceasedMembers, getInactiveMembers } from '@/lib/members-data';
import { createNotificationsForAll } from '@/lib/notification-helpers';
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { firestore } from '@/lib/firebase';

import { membersCollection, futureMembersCollection, ministeringCollection, annotationsCollection, servicesCollection, activitiesCollection, newConvertFriendsCollection } from '@/lib/collections';

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
import { format, subYears, addDays, subHours, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';
import { UserCheck, UserMinus, Users, CalendarClock, AlertTriangle, CheckCircle, Wrench, BellRing, Calendar, Info, Loader2, BadgeCheck, AlertCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from '@/components/ui/skeleton';
import { VoiceAnnotations } from '@/components/shared/voice-annotations';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { ConvertInfoSheet, type ConvertWithInfo } from '@/app/(main)/converts/convert-info-sheet';
import { syncMinisteringAssignments } from '@/lib/ministering-sync';


async function getAnnotations(source: 'dashboard' | 'council', forCouncil: boolean = false, barrioOrg?: string): Promise<Annotation[]> {
  try {
    let q;
    if (forCouncil) {
      const councilConstraints: any[] = [where('barrioOrg', '==', barrioOrg), where('isCouncilAction', '==', true), where('isResolved', '==', false)];
      const fromDashboardQuery = query(annotationsCollection, ...councilConstraints);
      const fromCouncilQuery = query(annotationsCollection, where('barrioOrg', '==', barrioOrg), where('source', '==', 'council'), where('isResolved', '==', false));

      const [dashboardSnapshot, councilSnapshot] = await Promise.all([
        getDocs(fromDashboardQuery),
        getDocs(fromCouncilQuery)
      ]);

      const dashboardAnns = dashboardSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Annotation));
      const councilAnns = councilSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Annotation));

      const allAnns = new Map([...dashboardAnns, ...councilAnns].map(ann => [ann.id, ann]));
      return Array.from(allAnns.values());
    } else {
      q = query(annotationsCollection, where('barrioOrg', '==', barrioOrg), where('source', '==', source), where('isResolved', '==', false));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Annotation))
        .sort((a, b) => {
          const dateA = a.createdAt?.toMillis?.() ?? 0;
          const dateB = b.createdAt?.toMillis?.() ?? 0;
          return dateB - dateA;
        });
    }

  } catch (error) {
    console.error("Error fetching annotations", { error, source, forCouncil });
    return [];
  }
}

async function getCouncilMembers(barrioOrg?: string): Promise<Member[]> {
  const twoYearsAgo = subYears(new Date(), 2);
  const twentyFourHoursAgo = subHours(new Date(), 24);

  const membersConstraints: any[] = [orderBy('baptismDate', 'desc')];
  if (barrioOrg) membersConstraints.unshift(where('barrioOrg', '==', barrioOrg));
  const snapshot = await getDocs(query(membersCollection, ...membersConstraints));

  const councilList = snapshot.docs
    .map(doc => {
      const memberData = doc.data();
      return {
        id: doc.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status),
      } as Member;
    })
    .filter(member => {
      if (member.status === 'deceased') return false;
      const baptismDate = member.baptismDate?.toDate();
      if (!baptismDate || baptismDate < twoYearsAgo) return false;

      const isPending = !member.councilCompleted;
      const wasCompletedRecently = member.councilCompleted && member.councilCompletedAt && member.councilCompletedAt.toDate() > twentyFourHoursAgo;

      return isPending || wasCompletedRecently;
    });

  return councilList;
}

async function getUpcomingBaptisms(barrioOrg?: string): Promise<FutureMember[]> {
  const now = new Date();
  const sevenDaysFromNow = addDays(now, 7);

  const constraints: any[] = [
    where('baptismDate', '>=', Timestamp.fromDate(now)),
    where('baptismDate', '<=', Timestamp.fromDate(sevenDaysFromNow))
  ];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
  const q = query(
    futureMembersCollection,
    ...constraints
  );

  const snapshot = await getDocs(q);
  const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FutureMember));

  return data.sort((a, b) => a.baptismDate.toMillis() - b.baptismDate.toMillis());
}

type UrgentFamily = Family & { companionshipId: string, companions: string[] };

async function getUrgentNeeds(barrioOrg?: string): Promise<UrgentFamily[]> {
  const ministeringConstraints: any[] = [];
  if (barrioOrg) ministeringConstraints.push(where('barrioOrg', '==', barrioOrg));
  const snapshot = await getDocs(query(ministeringCollection, ...ministeringConstraints));
  const urgentNeeds: UrgentFamily[] = [];

  snapshot.forEach(doc => {
    const comp = { id: doc.id, ...doc.data() } as Companionship;
    comp.families.forEach(family => {
      if (family.isUrgent) {
        urgentNeeds.push({
          ...family,
          companionshipId: comp.id,
          companions: comp.companions,
        });
      }
    });
  });

  return urgentNeeds;
}

async function getCouncilAnnotations(barrioOrg?: string): Promise<Annotation[]> {
  const councilAnns = await getAnnotations('council', true, barrioOrg);
  return councilAnns.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

async function getUpcomingServices(barrioOrg?: string): Promise<Service[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Query all upcoming services and filter out already-notified ones in memory
  // (Firestore doesn't support OR / != cleanly for this pattern)
  // A separate query to get documents that don't have the councilNotified field at all
  const coll = collection(firestore, 'c_servicios');
  const constraints: any[] = [where('date', '>=', Timestamp.fromDate(today))];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
  const allServicesSnapshot = await getDocs(query(coll, ...constraints));

  const notNotifiedOrFieldMissing = allServicesSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Service))
    .filter(service => service.councilNotified === false || service.councilNotified === undefined);

  // Sort the combined results by date
  return notNotifiedOrFieldMissing.sort((a, b) => a.date.toMillis() - b.date.toMillis());
}

// Function to get upcoming activities from Reports page data source (show 14 days before, hide after date passes)
async function getUpcomingActivities(barrioOrg?: string): Promise<Activity[]> {
  try {
    const now = new Date();
    const fourteenDaysFromNow = addDays(now, 14);

    // Get all activities using the same query as Reports page
    const constraints: any[] = [orderBy('date', 'desc')];
    if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
    const q = query(activitiesCollection, ...constraints);
    const snapshot = await getDocs(q);

    const activities = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Activity))
      .filter(activity => {
        const activityDate = activity.date.toDate();

        // Show activities that are:
        // 1. Within 14 days from now (upcoming)
        // 2. Not past their date (hide after date passes)
        return isBefore(activityDate, fourteenDaysFromNow) && isAfter(activityDate, now);
      })
      .sort((a, b) => a.date.toMillis() - b.date.toMillis()); // Sort by date ascending for council view

    return activities;
  } catch (error) {
    logger.error({ error, message: 'Error fetching upcoming activities from Reports data source' });
    return [];
  }
}

// All possible ordinances
const ALL_ORDINANCES: Ordinance[] = [
  'baptism',
  'confirmation',
  'elder_ordination',
  'endowment',
  'sealed_spouse',
  'high_priest_ordination',
  'aronico_ordination'
];

// All possible temple ordinances for deceased members
const ALL_TEMPLE_ORDINANCES: TempleOrdinance[] = [
  'baptism',
  'confirmation',
  'initiatory',
  'endowment',
  'sealed_to_father',
  'sealed_to_mother',
  'sealed_to_spouse'
];

// Get all ordinances from member (combines ordinances and templeOrdinances for backwards compatibility)
function getAllOrdinances(member: Member): TempleOrdinance[] {
  const ordinances = member.ordinances || [];
  const templeOrdinances = (member as any).templeOrdinances || [];
  // Combine both arrays and remove duplicates
  const combined = [...ordinances, ...templeOrdinances];
  return [...new Set(combined)];
}

// Check if member has all ordinances completed
function hasAllOrdinances(member: Member): boolean {
  const memberOrdinances = member.ordinances || [];
  return ALL_ORDINANCES.every(ord => memberOrdinances.includes(ord));
}

// Check if member has all temple ordinances completed
function hasAllTempleOrdinances(member: Member): boolean {
  const memberOrdinances = getAllOrdinances(member);
  return ALL_TEMPLE_ORDINANCES.every(ord => memberOrdinances.includes(ord));
}

// Get missing ordinances for a member
function getMissingOrdinances(member: Member): Ordinance[] {
  const memberOrdinances = member.ordinances || [];
  return ALL_ORDINANCES.filter(ord => !memberOrdinances.includes(ord));
}

// Get missing temple ordinances for a member
function getMissingTempleOrdinances(member: Member): TempleOrdinance[] {
  const memberOrdinances = getAllOrdinances(member);
  return ALL_TEMPLE_ORDINANCES.filter(ord => !memberOrdinances.includes(ord));
}

// Get days until removal for completed members
function getDaysUntilRemoval(member: Member): number | null {
  if (!hasAllTempleOrdinances(member)) return null;
  const completedAt = member.templeWorkCompletedAt?.toDate();
  if (!completedAt) return null;

  const now = new Date();
  const sevenDaysLater = new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.ceil((sevenDaysLater.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return daysRemaining > 0 ? daysRemaining : 0;
}


// Helper to convert a Member (convert) into the ConvertWithInfo shape the sheet expects
const convertInfoCollection = (convertId: string) => doc(firestore, 'c_conversos_info', convertId);

function memberToConvertWithInfo(member: Member): ConvertWithInfo {
  return {
    id: `member_${member.id}`,
    name: `${member.firstName} ${member.lastName}`,
    baptismDate: member.baptismDate!,
    photoURL: member.photoURL,
    councilCompleted: member.councilCompleted || false,
    councilCompletedAt: member.councilCompletedAt || null,
    observation: '',
    missionaryReference: '',
    memberId: member.id,
    memberData: member,
    ministeringTeachers: member.ministeringTeachers || [],
    friendship: null,
    calling: '',
    notes: '',
    recommendationActive: false,
    selfRelianceCourse: false,
  } as ConvertWithInfo;
}

export default function CouncilPage() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const [councilConverts, setCouncilConverts] = useState<Member[]>([]);
  const [upcomingBaptisms, setUpcomingBaptisms] = useState<FutureMember[]>([]);
  const [urgentNeeds, setUrgentNeeds] = useState<UrgentFamily[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [lessActiveMembers, setLessActiveMembers] = useState<Member[]>([]);
  const [inactiveMembers, setInactiveMembers] = useState<Member[]>([]);
  const [urgentMembers, setUrgentMembers] = useState<Member[]>([]);
  const [upcomingActivities, setUpcomingActivities] = useState<Activity[]>([]);
  const [deceasedMembers, setDeceasedMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Convert Info Sheet state
  const [selectedConvert, setSelectedConvert] = useState<ConvertWithInfo | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetLoading, setSheetLoading] = useState<string | null>(null); // memberId being loaded
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [converts, baptisms, needs, notes, upcomingServices, lessActive, inactive, urgent, activities, membersSnap, deceased] = await Promise.all([
        getCouncilMembers(barrioOrg),
        getUpcomingBaptisms(barrioOrg),
        getUrgentNeeds(barrioOrg),
        getCouncilAnnotations(barrioOrg),
        getUpcomingServices(barrioOrg),
        getLessActiveMembers(barrioOrg),
        getInactiveMembers(barrioOrg),
        getUrgentMembers(barrioOrg),
        getUpcomingActivities(barrioOrg),
        getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg))),
        getDeceasedMembers(barrioOrg),
      ]);
      setCouncilConverts(converts);
      setUpcomingBaptisms(baptisms);
      setUrgentNeeds(needs);
      setAnnotations(notes);
      setServices(upcomingServices);
      setLessActiveMembers(lessActive);
      setInactiveMembers(inactive);
      setUrgentMembers(urgent);
      setUpcomingActivities(activities);
      setAvailableMembers(membersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
      setDeceasedMembers(deceased);

      // Send daily notifications for urgent members (fire-and-forget)
      sendDailyUrgentNotifications(urgent).catch(() => { });
    } catch (error) {
      logger.error({ error, message: 'Error fetching council data' });
      toast({ title: "Error", description: "No se pudieron cargar los datos del consejo.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;
    fetchAllData();
  }, [authLoading, user, fetchAllData]);

  const handleResolveAnnotation = async (id: string) => {
    try {
      const annotationRef = doc(annotationsCollection, id);
      const annotationSnap = await getDoc(annotationRef);

      if (!annotationSnap.exists()) {
        logger.warn({ annotationId: id, message: 'Attempted to resolve non-existent annotation' });
        toast({ title: 'Error', description: 'Annotation not found.', variant: 'destructive' });
        return;
      }

      const annotationData = annotationSnap.data() as Annotation;

      if (annotationData.source === 'council') {
        await deleteDoc(annotationRef);
      } else {
        await updateDoc(annotationRef, {
          isResolved: true,
          isCouncilAction: false,
        });
      }
      toast({ title: 'Anotación Resuelta', description: 'La anotación ha sido marcada como resuelta.' });
      fetchAllData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error resolving annotation', id });
      toast({ title: 'Error al Resolver', description: `Failed to resolve annotation: ${errorMessage}`, variant: 'destructive' });
    }
  }

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await deleteDoc(doc(annotationsCollection, id));
      toast({ title: 'Anotación Eliminada', description: 'La anotación ha sido eliminada permanentemente.' });
      fetchAllData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error deleting annotation', id });
      toast({ title: 'Error al Eliminar', description: `Failed to delete annotation: ${errorMessage}`, variant: 'destructive' });
    }
  }

  // ── Convert Info Sheet handlers ────────────────────────────────────────
  const handleSaveConvertInfo = async (convertId: string, calling: string, notes: string, recommendationActive: boolean, selfRelianceCourse: boolean) => {
    setSheetSaving(true);
    try {
      const infoRef = convertInfoCollection(convertId);
      await setDoc(infoRef, { calling, notes, recommendationActive, selfRelianceCourse, updatedAt: Timestamp.now() }, { merge: true });
      toast({ title: '✅ Información guardada', description: 'Los datos del converso se actualizaron correctamente.' });
    } catch (error) {
      logger.error({ error, convertId, message: 'Error saving convert info from council' });
      toast({ title: 'Error', description: 'No se pudo guardar la información.', variant: 'destructive' });
    }
    setSheetSaving(false);
  };

  const handleSaveFriends = async (convertId: string, convertName: string, friends: string[], friendshipId?: string) => {
    setSheetSaving(true);
    try {
      if (friendshipId) {
        if (friends.length === 0) {
          await deleteDoc(doc(newConvertFriendsCollection, friendshipId));
          toast({ title: '✅ Amigos eliminados', description: 'La asignación de amigos fue removida.' });
        } else {
          await updateDoc(doc(newConvertFriendsCollection, friendshipId), { friends, updatedAt: Timestamp.now() });
          toast({ title: '✅ Amigos guardados', description: 'La asignación de amigos se actualizó.' });
        }
      } else if (friends.length > 0) {
        await addDoc(newConvertFriendsCollection, { convertId, convertName, friends, assignedAt: serverTimestamp() });
        toast({ title: '✅ Amigos asignados', description: 'Se asignaron amigos al converso.' });
      }
    } catch (error) {
      logger.error({ error, convertId, message: 'Error saving friends from council' });
      toast({ title: 'Error', description: 'No se pudo guardar la asignación de amigos.', variant: 'destructive' });
    }
    setSheetSaving(false);
  };

  const handleSaveTeachers = async (memberId: string, teachers: string[], previousTeachers: string[]) => {
    setSheetSaving(true);
    try {
      await updateDoc(doc(membersCollection, memberId), { ministeringTeachers: teachers, updatedAt: Timestamp.now() });
      const member = availableMembers.find(m => m.id === memberId);
      if (member) {
        await syncMinisteringAssignments({ ...member, ministeringTeachers: teachers }, previousTeachers, barrioOrg);
      }
      toast({ title: '✅ Maestros guardados', description: 'Los maestros ministrantes se actualizaron.' });
    } catch (error) {
      logger.error({ error, memberId, message: 'Error saving teachers from council' });
      toast({ title: 'Error', description: 'No se pudo guardar los maestros ministrantes.', variant: 'destructive' });
    }
    setSheetSaving(false);
  };


  // Opens the sheet AFTER loading all real Firestore data.
  // The convertId is `member_${member.id}` — the same key the Converts page uses,
  // so any edit here is immediately visible there too.
  const openConvertSheet = async (member: Member) => {
    setSheetLoading(member.id);
    const convertId = `member_${member.id}`;
    try {
      const [infoSnap, friendshipsSnap, memberSnap] = await Promise.all([
        getDoc(convertInfoCollection(convertId)),
        getDocs(query(newConvertFriendsCollection, where('convertId', '==', convertId))),
        getDoc(doc(membersCollection, member.id)),
      ]);

      const info = infoSnap.exists() ? infoSnap.data() : null;
      const friendship = friendshipsSnap.docs.length > 0
        ? ({ id: friendshipsSnap.docs[0].id, ...friendshipsSnap.docs[0].data() } as NewConvertFriendship)
        : null;
      const freshMember = memberSnap.exists()
        ? ({ id: memberSnap.id, ...memberSnap.data() } as Member)
        : member;

      setSelectedConvert({
        id: convertId,
        name: `${member.firstName} ${member.lastName}`,
        baptismDate: member.baptismDate!,
        photoURL: member.photoURL,
        councilCompleted: freshMember.councilCompleted || false,
        councilCompletedAt: freshMember.councilCompletedAt || null,
        observation: '',
        missionaryReference: '',
        memberId: member.id,
        memberData: freshMember,
        ministeringTeachers: freshMember.ministeringTeachers || [],
        friendship,
        calling: info?.calling || '',
        notes: info?.notes || '',
        recommendationActive: info?.recommendationActive === true,
        selfRelianceCourse: info?.selfRelianceCourse === true,
      } as ConvertWithInfo);

      setIsSheetOpen(true);
    } catch (error) {
      logger.error({ error, memberId: member.id, message: 'Error loading convert info for council sheet' });
      toast({ title: 'Error', description: 'No se pudo cargar la información del converso.', variant: 'destructive' });
    } finally {
      setSheetLoading(null);
    }
  };


  const handleMarkCouncilCompleted = async (memberId: string) => {
    try {
      const memberRef = doc(membersCollection, memberId);
      await updateDoc(memberRef, {
        councilCompleted: true,
        councilCompletedAt: Timestamp.now()
      });
      toast({ title: 'Éxito', description: 'Seguimiento de miembro marcado como completado.' });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error marking council as completed' });
      toast({ title: 'Error', description: 'No se pudo marcar como completado.', variant: 'destructive' });
    }
  }

  const handleResolveUrgentNeed = async (companionshipId: string, familyName: string) => {
    try {
      const companionshipRef = doc(ministeringCollection, companionshipId);
      const companionshipSnap = await getDoc(companionshipRef);

      if (!companionshipSnap.exists()) throw new Error("Companionship not found");

      const companionship = companionshipSnap.data() as Companionship;
      const familyIndex = companionship.families.findIndex(f => f.name === familyName);
      if (familyIndex === -1) throw new Error("Family not found");

      const updatedFamilies = [...companionship.families];
      updatedFamilies[familyIndex] = { ...updatedFamilies[familyIndex], isUrgent: false, observation: '' };
      await updateDoc(companionshipRef, { families: updatedFamilies });
      toast({ title: 'Éxito', description: 'La necesidad urgente ha sido marcada como resuelta.' });
      fetchAllData();
    } catch (error) {
      logger.error({ error, companionshipId, familyName, message: 'Error resolving urgent need' });
      toast({ title: 'Error', description: 'No se pudo resolver la necesidad urgente.', variant: 'destructive' });
    }
  }

  const handleMarkServiceNotified = async (serviceId: string) => {
    try {
      const serviceRef = doc(servicesCollection, serviceId);
      await updateDoc(serviceRef, { councilNotified: true });
      toast({ title: 'Éxito', description: 'El servicio ha sido marcado como avisado.' });
      fetchAllData();
    } catch (error) {
      logger.error({ error, serviceId, message: 'Error marking service as notified' });
      toast({ title: 'Error', description: 'No se pudo marcar el servicio como avisado.', variant: 'destructive' });
    }
  };

  const handleMarkLessActiveMemberCompleted = async (memberId: string) => {
    try {
      const memberRef = doc(collection(firestore, 'c_miembros'), memberId);
      await updateDoc(memberRef, {
        councilCompleted: true,
        councilCompletedAt: Timestamp.now()
      });
      toast({ title: 'Éxito', description: 'Seguimiento de miembro menos activo marcado como completado.' });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error marking less active member as completed' });
      toast({ title: 'Error', description: 'No se pudo marcar como completado.', variant: 'destructive' });
    }
  };

  const sendDailyUrgentNotifications = async (members: Member[]) => {
    const now = new Date();
    for (const member of members) {
      const lastNotified = member.urgentNotifiedAt?.toDate();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (!lastNotified || lastNotified < twentyFourHoursAgo) {
        try {
          await createNotificationsForAll({
            title: '⚠️ Recordatorio: Miembro Urgente',
            body: `${member.firstName} ${member.lastName} sigue marcado como urgente${member.urgentReason ? `: ${member.urgentReason}` : ''}`,
            contextType: 'member',
            contextId: member.id,
            actionUrl: '/council'
          }, barrioOrg);
          await updateMember(member.id, { urgentNotifiedAt: Timestamp.now() } as Partial<Member>);
        } catch (error) {
          logger.error({ error, memberId: member.id, message: 'Error sending daily urgent notification' });
        }
      }
    }
  };

  const handleResolveUrgentMember = async (memberId: string) => {
    try {
      await updateMember(memberId, {
        isUrgent: false,
        urgentReason: '',
      });
      toast({ title: 'Éxito', description: 'Miembro desmarcado como urgente.' });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error resolving urgent member' });
      toast({ title: 'Error', description: 'No se pudo resolver la urgencia del miembro.', variant: 'destructive' });
    }
  };

  const today = new Date();
  const sevenDaysFromNow = addDays(today, 7);
  const servicesIn7Days = services.filter(s => s.date.toDate() <= sevenDaysFromNow);
  const futureServices = services.filter(s => s.date.toDate() > sevenDaysFromNow);


  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="pt-6">
          <VoiceAnnotations
            title="Anotaciones para el Consejo"
            description="Notas del quórum y puntos marcados para seguimiento en el consejo."
            source="council"
            annotations={annotations}
            isLoading={loading}
            onAnnotationAdded={fetchAllData}
            onAnnotationToggled={fetchAllData}
            showCouncilView={true}
            onResolveAnnotation={handleResolveAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            currentUserId={user?.uid}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Wrench className="h-8 w-8 text-primary" />
            <div>
              <CardTitle>Servicios Próximos</CardTitle>
              <CardDescription>
                Proyectos de servicio para coordinar en el consejo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-2 font-semibold">En los Próximos 7 Días</h3>
            {loading ? <Skeleton className="h-24 w-full" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servicesIn7Days.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center">
                        No hay servicios programados para esta semana.
                      </TableCell>
                    </TableRow>
                  ) : (
                    servicesIn7Days.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>{format(item.date.toDate(), "eeee, d 'de' LLLL", { locale: es })}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => handleMarkServiceNotified(item.id)}>
                            <BellRing className="mr-2 h-4 w-4" />
                            Marcar como Avisado
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Servicios Futuros</h3>
            {loading ? <Skeleton className="h-24 w-full" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {futureServices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center">
                        No hay más servicios futuros programados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    futureServices.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>{format(item.date.toDate(), "d 'de' LLLL, yyyy", { locale: es })}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-8 w-8 text-orange-500" />
            <div>
              <CardTitle>Necesidades Urgentes de Miembros</CardTitle>
              <CardDescription>
                Miembros marcados como urgentes que requieren atención prioritaria del consejo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : urgentMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay miembros marcados como urgentes.
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {urgentMembers.map((member, index) => (
                <AccordionItem value={`urgent-${index}`} key={member.id}>
                  <AccordionTrigger>
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-3">
                        {member.photoURL ? (
                          <Image
                            src={member.photoURL}
                            alt={`${member.firstName} ${member.lastName}`}
                            width={36}
                            height={36}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-orange-500" />
                          </div>
                        )}
                        <span className="font-semibold">{member.firstName} {member.lastName}</span>
                      </div>
                      <Badge variant="destructive">Urgente</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="p-4 bg-muted/50 rounded-md space-y-4">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                        <p className="text-sm">
                          <span className="font-semibold">Razón:</span> {member.urgentReason || 'No especificada'}
                        </p>
                      </div>
                      {member.phoneNumber && (
                        <p className="text-sm text-muted-foreground">
                          Teléfono: {member.phoneNumber}
                        </p>
                      )}
                      <Button size="sm" onClick={() => handleResolveUrgentMember(member.id)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Marcar como Resuelto
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <CardTitle>Seguimiento de Conversos</CardTitle>
              <CardDescription>
                Miembros recién bautizados para seguimiento en el consejo de barrio.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : councilConverts.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay conversos pendientes de seguimiento.
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Foto</TableHead>
                      <TableHead>Bautismo</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {councilConverts.map((item) => (
                      <TableRow key={item.id} className={item.councilCompleted ? 'bg-green-500/10' : ''}>
                        <TableCell>
                          {item.photoURL ? (
                            <Image
                              src={item.photoURL}
                              alt={`Foto de ${item.firstName} ${item.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                              <UserCheck className="w-6 h-6 text-gray-500" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-xs font-medium text-foreground">{item.firstName} {item.lastName}</span>
                            <span>{item.baptismDate ? format(item.baptismDate.toDate(), 'd LLLL yyyy', { locale: es }) : 'N/A'}</span>
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex justify-end items-center gap-2">
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/members/${item.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={sheetLoading === item.id}
                              onClick={() => openConvertSheet(item)}
                            >
                              {sheetLoading === item.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Info className="h-4 w-4" />}
                            </Button>
                            {item.councilCompleted ? (
                              <Badge variant="default">Completado</Badge>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => handleMarkCouncilCompleted(item.id)}>
                                <UserCheck className="mr-2 h-4 w-4" />
                                Marcar Completado
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-4">
                {councilConverts.map((item) => (
                  <Card key={item.id} className={item.councilCompleted ? 'bg-green-500/10' : ''}>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          {item.photoURL ? (
                            <Image
                              src={item.photoURL}
                              alt={`Foto de ${item.firstName} ${item.lastName}`}
                              width={48}
                              height={48}
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                              <UserCheck className="w-6 h-6 text-gray-500" />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-foreground">{item.firstName} {item.lastName}</p>
                            <p className="text-sm text-muted-foreground">
                              Bautismo: {item.baptismDate ? format(item.baptismDate.toDate(), 'd LLL yyyy', { locale: es }) : 'N/A'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/members/${item.id}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={sheetLoading === item.id}
                            onClick={() => openConvertSheet(item)}
                          >
                            {sheetLoading === item.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Info className="h-4 w-4" />}
                          </Button>
                          {item.councilCompleted ? (
                            <Badge variant="default">Completado</Badge>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleMarkCouncilCompleted(item.id)}>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Completar
                            </Button>
                          )}
                        </div>
                      </div>

                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Convert Info Sheet — same as in the Converts page */}
      <ConvertInfoSheet
        convert={selectedConvert}
        isOpen={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        onSave={handleSaveConvertInfo}
        onSaveFriends={handleSaveFriends}
        onSaveTeachers={handleSaveTeachers}
        canWrite={true}
        saving={sheetSaving}
        availableMembers={availableMembers}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <CalendarClock className="h-8 w-8 text-primary" />
            <div>
              <CardTitle>Bautismos en los Próximos 7 Días</CardTitle>
              <CardDescription>
                Futuros miembros con bautismos programados para esta semana.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre del Futuro Miembro</TableHead>
                  <TableHead>Fecha Programada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcomingBaptisms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="h-24 text-center">
                      No hay bautismos programados para los próximos 7 días.
                    </TableCell>
                  </TableRow>
                ) : (
                  upcomingBaptisms.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        {item.baptismDate ? format(item.baptismDate.toDate(), 'd LLLL yyyy', { locale: es }) : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Calendar className="h-8 w-8 text-blue-600" />
            <div>
              <CardTitle>Actividades Registradas</CardTitle>
              <CardDescription>
                Actividades próximas que requieren atención del consejo (próximas 14 días).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : upcomingActivities.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay actividades próximas registradas.
            </p>
          ) : (
            <div className="space-y-4">
              {upcomingActivities.map((activity) => (
                <div key={activity.id} className="p-4 border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-lg">{activity.title}</h4>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <CalendarClock className="h-4 w-4" />
                        <span>{format(activity.date.toDate(), 'd LLLL yyyy', { locale: es })}</span>
                        {activity.time && <span>• {activity.time}</span>}
                      </div>
                      {activity.location && (
                        <p className="text-sm text-muted-foreground mt-1">
                          📍 {activity.location}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-blue-600 border-blue-600">
                      Próxima
                    </Badge>
                  </div>
                  {activity.description && (
                    <p className="text-sm text-gray-700 mt-2">{activity.description}</p>
                  )}
                  {activity.context && (
                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                      <strong>Contexto:</strong> {activity.context}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle>Necesidades Urgentes de Ministración</CardTitle>
              <CardDescription>
                Familias que requieren atención inmediata según lo reportado.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : urgentNeeds.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay necesidades urgentes reportadas.
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {urgentNeeds.map((item, index) => (
                <AccordionItem value={`item-${index}`} key={`${item.companionshipId}-${item.name}`}>
                  <AccordionTrigger>
                    <div className='flex items-center justify-between w-full pr-4'>
                      <div>
                        <span className='font-semibold'>{item.name}</span>
                        <p className='text-sm text-muted-foreground font-normal'>Asignados a: {item.companions.join(' y ')}</p>
                      </div>
                      <Badge variant="destructive">Urgente</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="p-4 bg-muted/50 rounded-md space-y-4">
                      <p className="text-sm">
                        <span className="font-semibold">Observación:</span> {item.observation}
                      </p>
                      <Button size="sm" onClick={() => handleResolveUrgentNeed(item.companionshipId, item.name)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Marcar como Resuelto
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <UserMinus className="h-8 w-8 text-orange-500" />
            <div>
              <CardTitle>Miembros Menos Activos</CardTitle>
              <CardDescription>
                Miembros que requieren seguimiento y apoyo del consejo de barrio.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : lessActiveMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay miembros menos activos registrados.
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Menos Activo Desde</TableHead>
                      <TableHead>Observación</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lessActiveMembers.map((member) => (
                      <TableRow key={member.id} className={member.councilCompleted ? 'bg-green-500/10' : ''}>
                        <TableCell className="font-medium">{member.firstName} {member.lastName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-orange-600 border-orange-600">
                            Menos Activo
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.lessActiveSince
                            ? format((member.lessActiveSince as any).toDate ? (member.lessActiveSince as any).toDate() : member.lessActiveSince, 'd LLLL yyyy', { locale: es })
                            : member.inactiveSince
                              ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, 'd LLLL yyyy', { locale: es })
                              : '—'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={member.lessActiveObservation || (member as any).inactiveObservation || ''}>
                          {member.lessActiveObservation || (member as any).inactiveObservation || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {member.councilCompleted ? (
                            <Badge variant="default">Completado</Badge>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleMarkLessActiveMemberCompleted(member.id)}>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Marcar Completado
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-4">
                {lessActiveMembers.map((member) => (
                  <Card key={member.id} className={member.councilCompleted ? 'bg-green-500/10' : ''}>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold">{member.firstName} {member.lastName}</p>
                          {(member.lessActiveSince || member.inactiveSince) && (
                            <p className="text-sm text-muted-foreground">
                              Menos activo desde: {member.lessActiveSince
                                ? format((member.lessActiveSince as any).toDate ? (member.lessActiveSince as any).toDate() : member.lessActiveSince, 'd LLL yyyy', { locale: es })
                                : member.inactiveSince
                                  ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, 'd LLL yyyy', { locale: es })
                                  : null}
                            </p>
                          )}
                          {(member.lessActiveObservation || (member as any).inactiveObservation) && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Obs: {member.lessActiveObservation || (member as any).inactiveObservation}
                            </p>
                          )}
                          <Badge variant="outline" className="text-orange-600 border-orange-600 mt-2">
                            Menos Activo
                          </Badge>
                        </div>
                        {member.councilCompleted ? (
                          <Badge variant="default">Completado</Badge>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => handleMarkLessActiveMemberCompleted(member.id)}>
                            <UserCheck className="mr-2 h-4 w-4" />
                            Completar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Inactive Members Section */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <UserMinus className="h-8 w-8 text-red-500" />
            <div>
              <CardTitle>Miembros Inactivos</CardTitle>
              <CardDescription>
                Miembros que no están asistiendo y requieren atención del consejo de barrio.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : inactiveMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay miembros inactivos registrados.
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Inactivo Desde</TableHead>
                      <TableHead>Observación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.firstName} {member.lastName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-red-600 border-red-600">
                            Inactivo
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.inactiveSince
                            ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, 'd LLLL yyyy', { locale: es })
                            : 'N/A'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={member.inactiveObservation || ''}>
                          {member.inactiveObservation || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-4">
                {inactiveMembers.map((member) => (
                  <Card key={member.id}>
                    <CardContent className="pt-4 space-y-4">
                      <div>
                        <p className="font-bold">{member.firstName} {member.lastName}</p>
                        <p className="text-sm text-muted-foreground">
                          Inactivo desde: {member.inactiveSince
                            ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, 'd LLL yyyy', { locale: es })
                            : 'N/A'}
                        </p>
                        {member.inactiveObservation && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Obs: {member.inactiveObservation}
                          </p>
                        )}
                        <Badge variant="outline" className="text-red-600 border-red-600 mt-2">
                          Inactivo
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Deceased Members Section */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Users className="h-8 w-8 text-gray-600" />
            <div>
              <CardTitle>Miembros Fallecidos</CardTitle>
              <CardDescription>
                Miembros que requieren obra vicaria del templo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : deceasedMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              No hay miembros fallecidos que requieran atención.
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {deceasedMembers.map((member, index) => {
                const allComplete = hasAllTempleOrdinances(member);
                const missingOrdinances = getMissingTempleOrdinances(member);
                const daysUntilRemoval = getDaysUntilRemoval(member);

                return (
                  <AccordionItem value={`deceased-${index}`} key={member.id}>
                    <AccordionTrigger>
                      <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-3">
                          {member.photoURL ? (
                            <Image
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={36}
                              height={36}
                              className="w-9 h-9 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                              <Users className="w-5 h-5 text-gray-500" />
                            </div>
                          )}
                          <span className="font-semibold">{member.firstName} {member.lastName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {allComplete ? (
                            <Badge variant="default" className="bg-green-500">
                              Completado
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-600">
                              Necesita Obra Vicaria
                            </Badge>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="p-4 bg-muted/50 rounded-md space-y-4">
                        {allComplete ? (
                          <>
                            <div className="flex items-center gap-2 text-green-600">
                              <BadgeCheck className="w-5 h-5" />
                              <span className="font-semibold">Todas las ordenanzas completadas</span>
                            </div>
                            {daysUntilRemoval !== null && daysUntilRemoval > 0 && (
                              <p className="text-sm text-muted-foreground">
                                Desaparecerá de esta lista en {daysUntilRemoval} días.
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-amber-600">
                              <AlertCircle className="w-5 h-5" />
                              <span className="font-semibold">Ordenanzas faltantes:</span>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {missingOrdinances.map((ordinance) => (
                                <Badge key={ordinance} variant="outline" className="text-amber-600 border-amber-600">
                                  {TempleOrdinanceLabels[ordinance]}
                                </Badge>
                              ))}
                            </div>
                          </>
                        )}
                        {member.deathDate && (
                          <p className="text-sm text-muted-foreground">
                            Fecha de fallecimiento: {format(member.deathDate.toDate(), 'd LLLL yyyy', { locale: es })}
                          </p>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

    </div >
  );
}
