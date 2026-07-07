
'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  BookUser,
  Gavel,
  HeartHandshake,
  Users,
  BadgeCheck,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { useI18n } from "@/contexts/i18n-context";
import { getDashboardData, getActivityOverviewData, getMembersByStatus } from "@/lib/dashboard-data";
import { getDeceasedMembers } from "@/lib/members-data";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { VoiceAnnotations } from "@/components/shared/voice-annotations";
import { BirthdaysDashboardCard } from "@/components/dashboard/birthdays-dashboard-card";
import type { Annotation, Member, TempleOrdinance } from "@/lib/types";
import { TempleOrdinanceLabels } from "@/lib/types";
import {
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { annotationsCollection, membersCollection } from "@/lib/collections";
import logger from "@/lib/logger";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActivityOverviewData } from "@/lib/activity-overview";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";


function StatCardSkeleton() {
  return (
     <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-4 w-4" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-[50px] mb-2" />
        <Skeleton className="h-3 w-[150px]" />
      </CardContent>
    </Card>
  )
}

// Moved from server actions to be called on the client
async function getAnnotations(source: 'dashboard', barrioOrg?: string): Promise<Annotation[]> {
    try {
        const q = query(
            annotationsCollection,
            where('barrioOrg', '==', barrioOrg),
            where('source', '==', source),
            where('isResolved', '==', false)
        );

        const snapshot = await getDocs(q);
        const data = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Annotation))
            .sort((a, b) => {
                const dateA = a.createdAt?.toMillis?.() ?? 0;
                const dateB = b.createdAt?.toMillis?.() ?? 0;
                return dateB - dateA;
            });

        return data;

    } catch (error: any) {
        let errorMessage = "Error fetching annotations.";
        if (error.code === 'failed-precondition') {
            errorMessage = "Query failed. It's likely you're missing a composite index in Firestore. Please check the browser's console for a link to create it.";
        }
        logger.error({ error, message: errorMessage, source });
        console.error(errorMessage, error);
        return [];
    }
}

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

// Check if member has all temple ordinances completed
function hasAllTempleOrdinances(member: Member): boolean {
    const memberOrdinances = getAllOrdinances(member);
    return ALL_TEMPLE_ORDINANCES.every(ord => memberOrdinances.includes(ord));
}

// Get missing temple ordinances for a member
function getMissingTempleOrdinances(member: Member): TempleOrdinance[] {
    const memberOrdinances = getAllOrdinances(member);
    return ALL_TEMPLE_ORDINANCES.filter(ord => !memberOrdinances.includes(ord));
}

// Filter deceased members based on ordinances logic
function filterDeceasedMembers(members: Member[]): Member[] {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return members.filter(member => {
        const allComplete = hasAllTempleOrdinances(member);

        if (allComplete) {
            // If all ordinances are complete, only show if within 7 days of status change
            const completedAt = member.templeWorkCompletedAt?.toDate();
            if (completedAt) {
                return completedAt > sevenDaysAgo;
            }
            // If no completion date, show anyway (for backwards compatibility)
            return true;
        }
        // Show members who need temple work
        return true;
    });
}


function DashboardPage() {
  const { language, t } = useI18n();
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(true);
  const [activityOverview, setActivityOverview] = useState<ActivityOverviewData | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [membersData, setMembersData] = useState<any>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [deceasedMembers, setDeceasedMembers] = useState<Member[]>([]);
  const [loadingDeceased, setLoadingDeceased] = useState(true);

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication

    async function loadData() {
      setLoading(true);
      const dashboardData = await getDashboardData(barrioOrg);
      setData(dashboardData);
      setLoading(false);
    }
    loadData();
  }, [authLoading, user, barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication

    async function loadActivityOverview() {
        setLoadingActivities(true);
        const summary = await getActivityOverviewData(barrioOrg);
        setActivityOverview(summary);
        setLoadingActivities(false);
    }
    queueMicrotask(() => {
      void loadActivityOverview();
    });
  }, [authLoading, user, barrioOrg])

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication

    async function loadMembersData() {
        setLoadingMembers(true);
        const data = await getMembersByStatus(barrioOrg);
        setMembersData(data);
        setLoadingMembers(false);
    }
    queueMicrotask(() => {
      void loadMembersData();
    });
  }, [authLoading, user])

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication

    async function loadDeceasedMembers() {
        setLoadingDeceased(true);
        const data = await getDeceasedMembers(barrioOrg);
        setDeceasedMembers(data);
        setLoadingDeceased(false);
    }
    queueMicrotask(() => {
      void loadDeceasedMembers();
    });
  }, [authLoading, user])

  const fetchAnnotations = useCallback(async () => {
    if (authLoading || !user) return; // Wait for authentication
    setLoadingAnnotations(true);
    const result = await getAnnotations('dashboard', barrioOrg);
    setAnnotations(result);
    setLoadingAnnotations(false);
  }, [authLoading, user, barrioOrg]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchAnnotations();
    });
  }, [fetchAnnotations])

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await deleteDoc(doc(annotationsCollection, id));
      toast({ title: 'Anotación Eliminada', description: 'La anotación ha sido eliminada permanentemente.' });
      fetchAnnotations();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error deleting annotation', id });
      toast({ title: 'Error al Eliminar', description: `Failed to delete annotation: ${errorMessage}`, variant: 'destructive' });
    }
  }

  // Handle ordinance checkbox change for deceased members
  const handleOrdinanceChange = async (memberId: string, ordinance: TempleOrdinance, checked: boolean) => {
    try {
      const memberRef = doc(membersCollection, memberId);
      const memberDoc = await getDocs(query(membersCollection, where('__name__', '==', memberId)));
      
      if (memberDoc.empty) {
        toast({ title: 'Error', description: 'Miembro no encontrado', variant: 'destructive' });
        return;
      }

      const memberData = memberDoc.docs[0].data() as Member;
      // Get ordinances from both fields for backwards compatibility
      const currentOrdinances = getAllOrdinances(memberData);
      
      let newOrdinances: TempleOrdinance[];
      if (checked) {
        // Add ordinance if not already present
        if (!currentOrdinances.includes(ordinance)) {
          newOrdinances = [...currentOrdinances, ordinance];
        } else {
          newOrdinances = currentOrdinances;
        }
      } else {
        // Remove ordinance
        newOrdinances = currentOrdinances.filter(o => o !== ordinance);
      }

      // Check if all ordinances are now complete
      const allComplete = ALL_TEMPLE_ORDINANCES.every(ord => newOrdinances.includes(ord));
      
      const updateData: any = {
        ordinances: newOrdinances,
        updatedAt: Timestamp.now()
      };

      // If all complete, set the completion date
      if (allComplete) {
        updateData.templeWorkCompletedAt = Timestamp.now();
      } else {
        // If not all complete, clear the completion date
        updateData.templeWorkCompletedAt = null;
      }

      await updateDoc(memberRef, updateData);
      
      toast({ 
        title: checked ? 'Ordenanza Registrada' : 'Ordenanza Removida', 
        description: checked 
          ? `${TempleOrdinanceLabels[ordinance]} ha sido marcada como completada.`
          : `${TempleOrdinanceLabels[ordinance]} ha sido desmarcada.`
      });

      // Reload deceased members
      const data = await getDeceasedMembers(barrioOrg);
      setDeceasedMembers(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error updating ordinance', memberId, ordinance });
      toast({ title: 'Error al Actualizar', description: `No se pudo actualizar la ordenanza: ${errorMessage}`, variant: 'destructive' });
    }
  }

  const {
    convertsCount,
    futureMembersCount,
    councilActionsCount,
  } = data || { convertsCount: 0, futureMembersCount: 0, councilActionsCount: 0 };
  const currentLocale = language === "es" ? es : enUS;
  const formatActivityDate = (date: Date) => format(date, "d LLL yyyy", { locale: currentLocale });


  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading ? <StatCardSkeleton/> : <Link href="/converts">
          <StatCard
            title={t("Total Converts")}
            value={String(convertsCount)}
            icon={<HeartHandshake className="h-4 w-4 text-muted-foreground" />}
            description={t("in the last 18 months")}
          />
        </Link>}
         {loading ? <StatCardSkeleton/> : <Link href="/future-members">
          <StatCard
            title={t("Future Members")}
            value={String(futureMembersCount)}
            icon={<BookUser className="h-4 w-4 text-muted-foreground" />}
            description={t("with baptism date set")}
          />
        </Link>}
         {loading ? <StatCardSkeleton/> : <Link href="/council">
          <StatCard
            title={t("Council Actions")}
            value={String(councilActionsCount)}
            icon={<Gavel className="h-4 w-4 text-muted-foreground" />}
            description={t("Active action items")}
          />
        </Link>}
        <BirthdaysDashboardCard />
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2">
        <Link href="/reports">
          <Card>
            <CardHeader>
              <CardTitle>{t("Activity Overview")}</CardTitle>
              <CardDescription>{t("Activity Overview Description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingActivities ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : activityOverview ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">{t("Activities this year")}</p>
                      <p className="mt-2 text-2xl font-semibold">{activityOverview.totalThisYear}</p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">{t("Upcoming in 14 days")}</p>
                      <p className="mt-2 text-2xl font-semibold">{activityOverview.upcomingCount}</p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-muted-foreground">{t("Next activity")}</p>
                        <p className="font-medium">
                          {activityOverview.nextActivity?.title ?? t("No upcoming activities")}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {activityOverview.nextActivity
                          ? formatActivityDate(activityOverview.nextActivity.date)
                          : t("No date")}
                      </Badge>
                    </div>

                    <div className="flex items-start justify-between gap-3 border-t pt-3">
                      <div>
                        <p className="text-sm text-muted-foreground">{t("Last activity")}</p>
                        <p className="font-medium">
                          {activityOverview.lastActivity?.title ?? t("No activities registered yet")}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {activityOverview.lastActivity
                          ? formatActivityDate(activityOverview.lastActivity.date)
                          : t("No date")}
                      </Badge>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("No activities registered yet")}</p>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/members">
          <Card>
            <CardHeader>
              <CardTitle>{t("Members by Status")}</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingMembers ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                    <div className="h-4 bg-gray-200 rounded w-8"></div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                    <div className="h-4 bg-gray-200 rounded w-8"></div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                    <div className="h-4 bg-gray-200 rounded w-8"></div>
                  </div>
                </div>
              ) : membersData ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-green-600">{t("Active Members")}</span>
                    <span className="text-sm font-bold">{membersData.active.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-yellow-600">{t("Less Active Members")}</span>
                    <span className="text-sm font-bold">{membersData.lessActive.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-red-600">{t("Inactive Members")}</span>
                    <span className="text-sm font-bold">{membersData.inactive.length}</span>
                  </div>
                  <hr className="my-2" />
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold">{t("Total Members")}</span>
                    <span className="text-sm font-bold">{membersData.total}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("No member data available")}</p>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Deceased Members Section - Only show if there are any */}
      {(!loadingDeceased && deceasedMembers.length > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <Users className="h-8 w-8 text-gray-600" />
              <div>
                <CardTitle>{t("deceased.title")}</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  {t("deceased.description")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {deceasedMembers.map((member) => {
                const memberOrdinances = getAllOrdinances(member);
                const allComplete = hasAllTempleOrdinances(member);

                return (
                  <div key={member.id} className="p-4 border rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3 mb-3">
                      {member.photoURL ? (
                        <Image
                          src={member.photoURL}
                          alt={`${member.firstName} ${member.lastName}`}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                          <Users className="w-5 h-5 text-gray-500" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{member.firstName} {member.lastName}</p>
                        {allComplete ? (
                          <p className="text-sm text-green-600 flex items-center gap-1">
                            <BadgeCheck className="w-4 h-4" />
                            {t("deceased.allOrdinancesComplete")}
                          </p>
                        ) : (
                          <p className="text-sm text-amber-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {t("deceased.needsTempleWork")}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* Ordinance checkboxes */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                      {ALL_TEMPLE_ORDINANCES.map((ordinance) => {
                        const isChecked = memberOrdinances.includes(ordinance as TempleOrdinance);
                        return (
                          <div key={ordinance} className="flex items-center space-x-2">
                            <Checkbox
                              id={`${member.id}-${ordinance}`}
                              checked={isChecked}
                              onCheckedChange={(checked) => handleOrdinanceChange(member.id, ordinance, checked as boolean)}
                            />
                            <label
                              htmlFor={`${member.id}-${ordinance}`}
                              className={`text-sm cursor-pointer ${isChecked ? 'text-green-600 line-through' : 'text-gray-700'}`}
                            >
                              {TempleOrdinanceLabels[ordinance]}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

       <div className="grid gap-4">
          <VoiceAnnotations
              title="Anotaciones"
              description="Añade notas rápidas o recordatorios. Marca las que necesiten seguimiento en el consejo."
              source="dashboard"
              annotations={annotations}
              isLoading={loadingAnnotations}
              onAnnotationAdded={fetchAnnotations}
              onAnnotationToggled={fetchAnnotations}
              onDeleteAnnotation={handleDeleteAnnotation}
              currentUserId={user?.uid}
           />
      </div>
    </div>
  );
}

export default function DashboardContainer() {
  return <DashboardPage />;
}
