
'use client'

export const dynamic = 'force-dynamic';

import { query, orderBy, where, Timestamp, doc, updateDoc, deleteDoc, collection, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { getDocs, getDoc } from '@/lib/firestore-query';


import type { Member, FutureMember, Companionship, Family, Annotation, Service, Activity, NewConvertFriendship, Ordinance, TempleOrdinance } from '@/lib/types';

import { getLessActiveMembers, getUrgentMembers, normalizeMemberStatus, updateMember, getDeceasedMembers, getInactiveMembers } from '@/lib/members-data';
import { createNotificationsForAll } from '@/lib/notification-helpers';
import { useCallback, useEffect, useState } from 'react';
import { OfflineImage } from '@/components/offline-image';
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
import { getDateFnsLocale } from "@/lib/i18n-date";
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
import { useI18n } from '@/contexts/i18n-context';
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
  const { t, language } = useI18n();
  const dateFmtLong = language === 'en' ? 'EEEE, MMMM d' : "eeee, d 'de' LLLL";
  const dateFmtMedium = language === 'en' ? 'MMMM d, yyyy' : "d 'de' LLLL, yyyy";
  const dateFmtShort = language === 'en' ? 'MMM d, yyyy' : 'd LLLL yyyy';
  const dateFmtTiny = language === 'en' ? 'MMM d, yyyy' : 'd LLL yyyy';
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
          toast({ title: t("council.error.fetchingTitle"), description: t("council.error.fetchingDescription"), variant: "destructive" });
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
          toast({ title: t("council.error.annotationNotFoundTitle"), description: t("council.error.annotationNotFoundDescription"), variant: 'destructive' });
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
        toast({ title: t("council.action.annotationResolvedTitle"), description: t("council.action.annotationResolvedDescription") });
      fetchAllData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error resolving annotation', id });
      toast({ title: t("council.error.resolveFailedTitle"), description: t("council.error.resolveFailedDescription", { errorMessage }), variant: 'destructive' });
    }
  }

    const handleDeleteAnnotation = async (id: string) => {
      try {
        await deleteDoc(doc(annotationsCollection, id));
        toast({ title: t("council.action.annotationDeletedTitle"), description: t("council.action.annotationDeletedDescription") });
        fetchAllData();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, message: 'Error deleting annotation', id });
        toast({ title: t("council.error.deleteFailedTitle"), description: t("council.error.deleteFailedDescription", { errorMessage }), variant: 'destructive' });
      }
    }

  // ── Convert Info Sheet handlers ────────────────────────────────────────
  const handleSaveConvertInfo = async (convertId: string, calling: string, notes: string, recommendationActive: boolean, selfRelianceCourse: boolean) => {
    setSheetSaving(true);
    try {
      const infoRef = convertInfoCollection(convertId);
      await setDoc(infoRef, { calling, notes, recommendationActive, selfRelianceCourse, barrioOrg, updatedAt: Timestamp.now() }, { merge: true });
      toast({ title: t("council.action.convertInfoSavedTitle"), description: t("council.action.convertInfoSavedDescription") });
    } catch (error) {
      logger.error({ error, convertId, message: 'Error saving convert info from council' });
      toast({ title: t("council.error.saveFailedTitle"), description: t("council.error.saveFailedDescription"), variant: 'destructive' });
    }
    setSheetSaving(false);
  };

  const handleSaveFriends = async (convertId: string, convertName: string, friends: string[], friendshipId?: string) => {
    setSheetSaving(true);
    try {
      if (friendshipId) {
        if (friends.length === 0) {
          await deleteDoc(doc(newConvertFriendsCollection, friendshipId));
          toast({ title: t("council.action.friendsRemovedTitle"), description: t("council.action.friendsRemovedDescription") });
        } else {
          await updateDoc(doc(newConvertFriendsCollection, friendshipId), { friends, updatedAt: Timestamp.now() });
          toast({ title: t("council.action.friendsUpdatedTitle"), description: t("council.action.friendsUpdatedDescription") });
        }
      } else if (friends.length > 0) {
        await addDoc(newConvertFriendsCollection, {
          convertId,
          convertName,
          friends,
          assignedAt: serverTimestamp(),
          barrioOrg,
        });
        toast({ title: t("council.action.friendsAssignedTitle"), description: t("council.action.friendsAssignedDescription") });
      }
    } catch (error) {
      logger.error({ error, convertId, message: 'Error saving friends from council' });
      toast({ title: t("council.error.saveFailedTitle"), description: t("council.error.saveFriendsErrorDescription"), variant: 'destructive' });
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
      toast({ title: t("council.action.teachersSavedTitle"), description: t("council.action.teachersSavedDescription") });
    } catch (error) {
      logger.error({ error, memberId, message: 'Error saving teachers from council' });
      toast({ title: t("council.error.saveFailedTitle"), description: t("council.error.saveTeachersErrorDescription"), variant: 'destructive' });
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
      toast({ title: t("common.error"), description: t("council.action.convertLoadErrorDescription"), variant: 'destructive' });
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
      toast({ title: t("council.action.memberCompletedTitle"), description: t("council.action.memberCompletedDescription") });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error marking council as completed' });
      toast({ title: t("council.error.markCompletedFailedTitle"), description: t("council.error.markCompletedFailedDescription"), variant: 'destructive' });
    }
  }

  const handleResolveUrgentNeed = async (companionshipId: string, familyName: string) => {
    try {
      const companionshipRef = doc(ministeringCollection, companionshipId);
      const companionshipSnap = await getDoc(companionshipRef);

      if (!companionshipSnap.exists())       throw new Error("Companionship not found");

      const companionship = companionshipSnap.data() as Companionship;
      const familyIndex = companionship.families.findIndex(f => f.name === familyName);
      if (familyIndex === -1) throw new Error("Family not found");

      const updatedFamilies = [...companionship.families];
      updatedFamilies[familyIndex] = { ...updatedFamilies[familyIndex], isUrgent: false, observation: '' };
      await updateDoc(companionshipRef, { families: updatedFamilies });
      toast({ title: t("council.action.urgentNeedResolvedTitle"), description: t("council.action.urgentNeedResolvedDescription") });
      fetchAllData();
    } catch (error) {
      logger.error({ error, companionshipId, familyName, message: 'Error resolving urgent need' });
      toast({ title: t("council.error.resolveUrgentFailedTitle"), description: t("council.error.resolveUrgentFailedDescription"), variant: 'destructive' });
    }
  }

  const handleMarkServiceNotified = async (serviceId: string) => {
    try {
      const serviceRef = doc(servicesCollection, serviceId);
      await updateDoc(serviceRef, { councilNotified: true });
      toast({ title: t("council.action.serviceNotifiedTitle"), description: t("council.action.serviceNotifiedDescription") });
      fetchAllData();
    } catch (error) {
      logger.error({ error, serviceId, message: 'Error marking service as notified' });
      toast({ title: t("council.error.markNotifiedFailedTitle"), description: t("council.error.markNotifiedFailedDescription"), variant: 'destructive' });
    }
  };

  const handleMarkLessActiveMemberCompleted = async (memberId: string) => {
    try {
      const memberRef = doc(collection(firestore, 'c_miembros'), memberId);
      await updateDoc(memberRef, {
        councilCompleted: true,
        councilCompletedAt: Timestamp.now()
      });
      toast({ title: t("council.action.memberCompletedTitle"), description: t("council.action.lessActiveCompletedDescription") });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error marking less active member as completed' });
      toast({ title: t("council.error.markCompletedFailedTitle"), description: t("council.error.markCompletedFailedDescription"), variant: 'destructive' });
    }
  };

  const sendDailyUrgentNotifications = async (members: Member[]) => {
    const now = new Date();
    for (const member of members) {
      const lastNotified = member.urgentNotifiedAt?.toDate();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      if (!lastNotified || lastNotified < twentyFourHoursAgo) {
        try {
          const memberName = `${member.firstName} ${member.lastName}`;
          await createNotificationsForAll({
            title: t("council.notification.urgentMemberTitle"),
            body: member.urgentReason
              ? t("council.notification.urgentMemberBodyWithReason", { name: memberName, reason: member.urgentReason })
              : t("council.notification.urgentMemberBody", { name: memberName }),
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
      toast({ title: t("council.action.memberCompletedTitle"), description: t("council.action.urgentMemberResolvedDescription") });
      fetchAllData();
    } catch (error) {
      logger.error({ error, memberId, message: 'Error resolving urgent member' });
      toast({ title: t("common.error"), description: t("council.error.urgentMemberResolveDescription"), variant: 'destructive' });
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
            title={t("council.voiceAnnotations.title")}
            description={t("council.voiceAnnotations.description")}
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
              <CardTitle>{t("council.services.title")}</CardTitle>
              <CardDescription>
                {t("council.services.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-2 font-semibold">{t("council.services.next7Days")}</h3>
            {loading ? <Skeleton className="h-24 w-full" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("council.table.service")}</TableHead>
                    <TableHead>{t("council.table.date")}</TableHead>
                    <TableHead className="text-right">{t("council.table.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servicesIn7Days.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center">
                        {t("council.services.emptyWeek")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    servicesIn7Days.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>{format(item.date.toDate(), dateFmtLong, { locale: getDateFnsLocale() })}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => handleMarkServiceNotified(item.id)}>
                            <BellRing className="mr-2 h-4 w-4" />
                            {t("council.services.markNotified")}
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
            <h3 className="mb-2 font-semibold">{t("council.services.future")}</h3>
            {loading ? <Skeleton className="h-24 w-full" /> : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("council.table.service")}</TableHead>
                    <TableHead>{t("council.table.date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {futureServices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="h-24 text-center">
                        {t("council.services.emptyFuture")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    futureServices.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>{format(item.date.toDate(), dateFmtMedium, { locale: getDateFnsLocale() })}</TableCell>
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
              <CardTitle>{t("council.urgentMembers.title")}</CardTitle>
              <CardDescription>
                {t("council.urgentMembers.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : urgentMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.urgentMembers.empty")}
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {urgentMembers.map((member, index) => (
                <AccordionItem value={`urgent-${index}`} key={member.id}>
                  <AccordionTrigger>
                    <div className="flex flex-wrap items-center justify-between w-full pr-4 gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {member.photoURL ? (
                          <OfflineImage
                            src={member.photoURL}
                            alt={`${member.firstName} ${member.lastName}`}
                            width={36}
                            height={36}
                            className="w-9 h-9 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                            <AlertTriangle className="w-5 h-5 text-orange-500" />
                          </div>
                        )}
                        <span className="font-semibold truncate">{member.firstName} {member.lastName}</span>
                      </div>
                      <Badge variant="destructive" className="shrink-0">{t("council.badge.urgent")}</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="p-4 bg-muted/50 rounded-md space-y-4">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                        <p className="text-sm">
                          <span className="font-semibold">{t("council.urgentMembers.reason")}</span> {member.urgentReason || t("council.urgentMembers.reasonNone")}
                        </p>
                      </div>
                      {member.phoneNumber && (
                        <p className="text-sm text-muted-foreground">
                          {t("council.urgentMembers.phone", { phone: member.phoneNumber })}
                        </p>
                      )}
                      <Button size="sm" onClick={() => handleResolveUrgentMember(member.id)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        {t("council.markResolved")}
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
              <CardTitle>{t("council.converts.title")}</CardTitle>
              <CardDescription>
                {t("council.converts.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : councilConverts.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.converts.empty")}
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("council.table.photo")}</TableHead>
                      <TableHead>{t("council.table.baptism")}</TableHead>
                      <TableHead className="text-right">{t("council.table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {councilConverts.map((item) => (
                      <TableRow key={item.id} className={item.councilCompleted ? 'bg-green-500/10' : ''}>
                        <TableCell>
                          {item.photoURL ? (
                            <OfflineImage
                              src={item.photoURL}
                              alt={t("council.photoAlt", { name: `${item.firstName} ${item.lastName}` })}
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
                            <span>{item.baptismDate ? format(item.baptismDate.toDate(), dateFmtShort, { locale: getDateFnsLocale() }) : t("council.na")}</span>
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
                              <Badge variant="default">{t("council.badge.completed")}</Badge>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => handleMarkCouncilCompleted(item.id)}>
                                <UserCheck className="mr-2 h-4 w-4" />
                                {t("council.markCompleted")}
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
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                        <div className="flex items-center gap-3">
                          {item.photoURL ? (
                            <OfflineImage
                              src={item.photoURL}
                              alt={t("council.photoAlt", { name: `${item.firstName} ${item.lastName}` })}
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
                            <p className="font-bold text-foreground break-words">{item.firstName} {item.lastName}</p>
                            <p className="text-sm text-muted-foreground">
                              {t("council.baptismLabel", { date: item.baptismDate ? format(item.baptismDate.toDate(), dateFmtTiny, { locale: getDateFnsLocale() }) : t("council.na") })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 sm:shrink-0">
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
                            <Badge variant="default">{t("council.badge.completed")}</Badge>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleMarkCouncilCompleted(item.id)}>
                              <UserCheck className="mr-2 h-4 w-4" />
                              {t("council.complete")}
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
              <CardTitle>{t("council.baptisms.title")}</CardTitle>
              <CardDescription>
                {t("council.baptisms.description")}
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
                  <TableHead>{t("council.baptisms.futureMemberName")}</TableHead>
                  <TableHead>{t("council.baptisms.scheduledDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcomingBaptisms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="h-24 text-center">
                      {t("council.baptisms.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  upcomingBaptisms.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        {item.baptismDate ? format(item.baptismDate.toDate(), dateFmtShort, { locale: getDateFnsLocale() }) : t("council.na")}
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
              <CardTitle>{t("council.activities.title")}</CardTitle>
              <CardDescription>
                {t("council.activities.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : upcomingActivities.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.activities.empty")}
            </p>
          ) : (
            <div className="space-y-4">
              {upcomingActivities.map((activity) => (
                <div key={activity.id} className="p-4 border rounded-lg space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-lg break-words">{activity.title}</h4>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
                        <CalendarClock className="h-4 w-4 shrink-0" />
                        <span>{format(activity.date.toDate(), dateFmtShort, { locale: getDateFnsLocale() })}</span>
                        {activity.time && <span>• {activity.time}</span>}
                      </div>
                      {activity.location && (
                        <p className="text-sm text-muted-foreground mt-1 break-words">
                          📍 {activity.location}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-blue-600 border-blue-600 shrink-0">
                      {t("council.activities.upcoming")}
                    </Badge>
                  </div>
                  {activity.description && (
                    <p className="text-sm text-gray-700 mt-2 break-words">{activity.description}</p>
                  )}
                  {activity.context && (
                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded break-words">
                      <strong>{t("council.activities.context")}</strong> {activity.context}
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
              <CardTitle>{t("council.ministeringUrgent.title")}</CardTitle>
              <CardDescription>
                {t("council.ministeringUrgent.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : urgentNeeds.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.ministeringUrgent.empty")}
            </p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {urgentNeeds.map((item, index) => (
                <AccordionItem value={`item-${index}`} key={`${item.companionshipId}-${item.name}`}>
                  <AccordionTrigger>
                    <div className='flex flex-wrap items-center justify-between w-full pr-4 gap-2'>
                      <div className="min-w-0">
                        <span className='font-semibold break-words'>{item.name}</span>
                        <p className='text-sm text-muted-foreground font-normal break-words'>{t("council.ministeringUrgent.assignedTo", { names: item.companions.join(t("council.and")) })}</p>
                      </div>
                      <Badge variant="destructive" className="shrink-0">{t("council.badge.urgent")}</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="p-4 bg-muted/50 rounded-md space-y-4">
                      <p className="text-sm">
                        <span className="font-semibold">{t("council.observation")}</span> {item.observation}
                      </p>
                      <Button size="sm" onClick={() => handleResolveUrgentNeed(item.companionshipId, item.name)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        {t("council.markResolved")}
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
              <CardTitle>{t("council.lessActive.title")}</CardTitle>
              <CardDescription>
                {t("council.lessActive.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : lessActiveMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.lessActive.empty")}
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("council.table.name")}</TableHead>
                      <TableHead>{t("council.table.status")}</TableHead>
                      <TableHead>{t("council.lessActive.since")}</TableHead>
                      <TableHead>{t("council.table.observation")}</TableHead>
                      <TableHead className="text-right">{t("council.table.action")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lessActiveMembers.map((member) => (
                      <TableRow key={member.id} className={member.councilCompleted ? 'bg-green-500/10' : ''}>
                        <TableCell className="font-medium">{member.firstName} {member.lastName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-orange-600 border-orange-600">
                            {t("council.lessActive.badge")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.lessActiveSince
                            ? format((member.lessActiveSince as any).toDate ? (member.lessActiveSince as any).toDate() : member.lessActiveSince, dateFmtShort, { locale: getDateFnsLocale() })
                            : member.inactiveSince
                              ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, dateFmtShort, { locale: getDateFnsLocale() })
                              : t("council.dash")}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={member.lessActiveObservation || (member as any).inactiveObservation || ''}>
                          {member.lessActiveObservation || (member as any).inactiveObservation || t("council.dash")}
                        </TableCell>
                        <TableCell className="text-right">
                          {member.councilCompleted ? (
                            <Badge variant="default">{t("council.badge.completed")}</Badge>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => handleMarkLessActiveMemberCompleted(member.id)}>
                              <UserCheck className="mr-2 h-4 w-4" />
                              {t("council.markCompleted")}
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
                              {t("council.lessActive.sinceLabel", {
                                date: member.lessActiveSince
                                  ? format((member.lessActiveSince as any).toDate ? (member.lessActiveSince as any).toDate() : member.lessActiveSince, dateFmtTiny, { locale: getDateFnsLocale() })
                                  : member.inactiveSince
                                    ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, dateFmtTiny, { locale: getDateFnsLocale() })
                                    : t("council.na"),
                              })}
                            </p>
                          )}
                          {(member.lessActiveObservation || (member as any).inactiveObservation) && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {t("council.obsShort", {
                                text: member.lessActiveObservation || (member as any).inactiveObservation,
                              })}
                            </p>
                          )}
                          <Badge variant="outline" className="text-orange-600 border-orange-600 mt-2">
                            {t("council.lessActive.badge")}
                          </Badge>
                        </div>
                        {member.councilCompleted ? (
                          <Badge variant="default">{t("council.badge.completed")}</Badge>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => handleMarkLessActiveMemberCompleted(member.id)}>
                            <UserCheck className="mr-2 h-4 w-4" />
                            {t("council.complete")}
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
              <CardTitle>{t("council.inactive.title")}</CardTitle>
              <CardDescription>
                {t("council.inactive.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : inactiveMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.inactive.empty")}
            </p>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("council.table.name")}</TableHead>
                      <TableHead>{t("council.table.status")}</TableHead>
                      <TableHead>{t("council.inactive.since")}</TableHead>
                      <TableHead>{t("council.table.observation")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.firstName} {member.lastName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-red-600 border-red-600">
                            {t("council.inactive.badge")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.inactiveSince
                            ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, dateFmtShort, { locale: getDateFnsLocale() })
                            : t("council.na")}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={member.inactiveObservation || ''}>
                          {member.inactiveObservation || t("council.dash")}
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
                          {t("council.inactive.sinceLabel", {
                            date: member.inactiveSince
                              ? format((member.inactiveSince as any).toDate ? (member.inactiveSince as any).toDate() : member.inactiveSince, dateFmtTiny, { locale: getDateFnsLocale() })
                              : t("council.na"),
                          })}
                        </p>
                        {member.inactiveObservation && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {t("council.obsShort", { text: member.inactiveObservation })}
                          </p>
                        )}
                        <Badge variant="outline" className="text-red-600 border-red-600 mt-2">
                          {t("council.inactive.badge")}
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
              <CardTitle>{t("council.deceased.title")}</CardTitle>
              <CardDescription>
                {t("council.deceased.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : deceasedMembers.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground h-24 flex items-center justify-center">
              {t("council.deceased.empty")}
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
                      <div className="flex flex-wrap items-center justify-between w-full pr-4 gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={t("council.photoAlt", { name: `${member.firstName} ${member.lastName}` })}
                              width={36}
                              height={36}
                              className="w-9 h-9 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                              <Users className="w-5 h-5 text-gray-500" />
                            </div>
                          )}
                          <span className="font-semibold truncate">{member.firstName} {member.lastName}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {allComplete ? (
                            <Badge variant="default" className="bg-green-500">
                              {t("council.badge.completed")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-600">
                              {t("council.deceased.needsWork")}
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
                              <span className="font-semibold">{t("council.deceased.allComplete")}</span>
                            </div>
                            {daysUntilRemoval !== null && daysUntilRemoval > 0 && (
                              <p className="text-sm text-muted-foreground">
                                {t("council.deceased.willDisappear", { days: daysUntilRemoval })}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 text-amber-600">
                              <AlertCircle className="w-5 h-5" />
                              <span className="font-semibold">{t("council.deceased.missingOrdinances")}</span>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {missingOrdinances.map((ordinance) => (
                                <Badge key={ordinance} variant="outline" className="text-amber-600 border-amber-600">
                                  {t(`templeOrdinance.${ordinance}`)}
                                </Badge>
                              ))}
                            </div>
                          </>
                        )}
                        {member.deathDate && (
                          <p className="text-sm text-muted-foreground">
                            {t("council.deceased.deathDate", {
                              date: format(member.deathDate.toDate(), dateFmtShort, { locale: getDateFnsLocale() }),
                            })}
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
