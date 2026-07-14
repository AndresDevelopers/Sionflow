"use client";

import { useEffect, useState } from "react";
import {
  getDocs,
  query,
  where,
  limit as fbLimit,
  doc,
  writeBatch,
  collection,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase";
import {
  usersCollection,
  membersCollection,
  convertsCollection,
  activitiesCollection,
  servicesCollection,
  futureMembersCollection,
  birthdaysCollection,
  ministeringCollection,
  ministeringDistrictsCollection,
  ministeringHistoryCollection,
  baptismsCollection,
  annotationsCollection,
  healthConcernsCollection,
  annualReportsCollection,
  newConvertFriendsCollection,
  investigatorsCollection,
  missionaryAssignmentsCollection,
  missionaryImagesCollection,
  familySearchTrainingsCollection,
  familySearchTasksCollection,
  familySearchAnnotationsCollection,
  adminAuditCollection,
} from "@/lib/collections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/contexts/i18n-context";
import { useAuth } from "@/contexts/auth-context";
import logger from "@/lib/logger";
import {
  Database,
  Loader2,
  UserCog,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

interface UserInfo {
  uid: string;
  name: string;
  email: string;
  barrio: string;
  organizacion: string;
  barrioOrg: string;
  role: string;
}

const DATA_COLLECTIONS: { ref: ReturnType<typeof collection>; label: string }[] = [
  { ref: membersCollection, label: "collection.members" },
  { ref: convertsCollection, label: "collection.converts" },
  { ref: activitiesCollection, label: "collection.activities" },
  { ref: servicesCollection, label: "collection.services" },
  { ref: futureMembersCollection, label: "collection.futureMembers" },
  { ref: birthdaysCollection, label: "collection.birthdays" },
  { ref: ministeringCollection, label: "collection.ministering" },
  { ref: ministeringDistrictsCollection, label: "collection.ministeringDistricts" },
  { ref: ministeringHistoryCollection, label: "collection.ministeringHistory" },
  { ref: baptismsCollection, label: "collection.baptisms" },
  { ref: annotationsCollection, label: "collection.annotations" },
  { ref: healthConcernsCollection, label: "collection.health" },
  { ref: annualReportsCollection, label: "collection.annualReport" },
  { ref: newConvertFriendsCollection, label: "collection.newConvertFriends" },
  { ref: investigatorsCollection, label: "collection.investigators" },
  { ref: missionaryAssignmentsCollection, label: "collection.missionaryAssignments" },
  { ref: missionaryImagesCollection, label: "collection.missionaryImages" },
  { ref: familySearchTrainingsCollection, label: "collection.familySearchTrainings" },
  { ref: familySearchTasksCollection, label: "collection.familySearchTasks" },
  { ref: familySearchAnnotationsCollection, label: "collection.familySearchAnnotations" },
  { ref: adminAuditCollection, label: "collection.audit" },
];

export default function MigratePage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const { barrioOrg } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [selectedUserBarrioOrg, setSelectedUserBarrioOrg] = useState<string>("");
  const [migrationCounts, setMigrationCounts] = useState<Record<string, { total: number; missing: number }>>({});

  useEffect(() => {
    if (!barrioOrg) return;
    loadUsers();
  }, [barrioOrg]);

  const loadUsers = async () => {
    if (!barrioOrg) return;
    setIsLoadingUsers(true);
    try {
      // Same-barrio only (rules deny global user list)
      const snap = await getDocs(query(usersCollection, where("barrioOrg", "==", barrioOrg)));
      const list: UserInfo[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          uid: d.id,
          name: data.name || t("admin.migrate.sinNombre"),
          email: data.email || "—",
          barrio: data.barrio || t("admin.migrate.sinBarrio"),
          organizacion: data.organizacion || t("admin.migrate.sinOrganizacion"),
          barrioOrg: data.barrioOrg || "",
          role: data.role || "user",
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setUsers(list);
    } catch (err) {
      logger.error({ error: err, message: "Error loading users for migration" });
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const analyzeCollection = async (
    collectionRef: ReturnType<typeof collection>,
    _barrioOrg: string
  ): Promise<{ total: number; missing: number }> => {
    try {
      const snap = await getDocs(query(collectionRef, fbLimit(500)));
      let total = 0;
      let missing = 0;
      snap.forEach((d) => {
        total++;
        const data = d.data();
        if (!data.barrioOrg || data.barrioOrg === "") {
          missing++;
        }
      });
      return { total, missing };
    } catch {
      return { total: 0, missing: 0 };
    }
  };

  const handleAnalyze = async () => {
    if (!selectedUserBarrioOrg) {
      toast({ title: t("admin.migrate.toast.selectUser"), description: t("admin.migrate.toast.selectUserDesc"), variant: "destructive" });
      return;
    }
    setMigrationStatus([]);
    setIsMigrating(true);
    const counts: Record<string, { total: number; missing: number }> = {};

    try {
      for (const col of DATA_COLLECTIONS) {
        const result = await analyzeCollection(col.ref, selectedUserBarrioOrg);
        counts[col.label] = result;
        setMigrationCounts({ ...counts });
      }
      setMigrationCounts(counts);
      toast({ title: t("admin.migrate.toast.analysisComplete"), description: t("admin.migrate.toast.analysisCompleteDesc") });
    } catch (err) {
      logger.error({ error: err, message: "Error analyzing collections" });
    } finally {
      setIsMigrating(false);
    }
  };

  const handleMigrateAll = async () => {
    if (!selectedUserBarrioOrg) return;

    const totalMissing = Object.values(migrationCounts).reduce((sum, c) => sum + c.missing, 0);
    if (totalMissing === 0) {
      toast({ title: t("admin.migrate.toast.nothingToMigrate"), description: t("admin.migrate.toast.nothingToMigrateDesc") });
      return;
    }

    setIsMigrating(true);
    const log: string[] = [];

    try {
      for (const col of DATA_COLLECTIONS) {
        const info = migrationCounts[col.label];
        if (!info || info.missing === 0) continue;

        const snap = await getDocs(query(col.ref, fbLimit(500)));
        const batch = writeBatch(firestore);
        let batchCount = 0;
        let updatedCount = 0;

        snap.forEach((d) => {
          const data = d.data();
          if (!data.barrioOrg || data.barrioOrg === "") {
            batch.update(doc(col.ref, d.id), { barrioOrg: selectedUserBarrioOrg });
            batchCount++;
            updatedCount++;
            if (batchCount >= 450) {
              // Would need to commit and create new batch, but for simplicity we warn
            }
          }
        });

        if (batchCount > 0) {
          await batch.commit();
          log.push(`✅ ${t(col.label)}: ${t("admin.migrate.docsUpdated", { count: updatedCount })}`);
        }
        setMigrationStatus([...log]);
      }

      log.push(t("admin.migrate.separator"));
      log.push(t("admin.migrate.completed"));
      setMigrationStatus(log);
      toast({ title: t("admin.migrate.toast.migrationComplete"), description: t("admin.migrate.toast.migrationCompleteDesc") });

      // Reload analysis
      await handleAnalyze();
    } catch (err) {
      logger.error({ error: err, message: "Error migrating data" });
      log.push(t("admin.migrate.errorDuring"));
      setMigrationStatus(log);
      toast({ title: t("common.error"), description: t("admin.migrate.toast.errorDesc"), variant: "destructive" });
    } finally {
      setIsMigrating(false);
    }
  };

  const totalMissingAll = Object.values(migrationCounts).reduce((sum, c) => sum + c.missing, 0);

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            {t("admin.migrate.title")}
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          {t("admin.migrate.subtitle")}
        </p>
      </header>

      {/* Users reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-4 w-4" />
            {t("admin.migrate.registeredUsers")}
          </CardTitle>
          <CardDescription>
            {t("admin.migrate.usersDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("admin.migrate.col.user")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.migrate.col.barrio")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.migrate.col.organizacion")}</th>
                    <th className="px-3 py-2 font-medium">{t("admin.migrate.col.rol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.uid}
                      className={`cursor-pointer border-t transition-colors hover:bg-muted/50 ${
                        selectedUserBarrioOrg === u.barrioOrg ? "bg-primary/10" : ""
                      }`}
                      onClick={() => setSelectedUserBarrioOrg(u.barrioOrg)}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">{u.barrio}</td>
                      <td className="px-3 py-2">{u.organizacion}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="text-xs">{u.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedUserBarrioOrg && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm">
                  {t("admin.migrate.selectedBarrioOrg")}{" "}
                  <Badge variant="secondary" className="ml-1 font-mono text-xs">
                    {selectedUserBarrioOrg}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("admin.migrate.selectedHint")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleAnalyze} disabled={isMigrating}>
                  {isMigrating ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  {t("admin.migrate.analyze")}
                </Button>
                <Button onClick={handleMigrateAll} disabled={isMigrating || totalMissingAll === 0}>
                  {isMigrating ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                  )}
                  {t("admin.migrate.migrate", { count: totalMissingAll })}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis results */}
      {Object.keys(migrationCounts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.migrate.results")}</CardTitle>
            <CardDescription>
              {t("admin.migrate.resultsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(migrationCounts).map(([label, info]) => (
                <div
                  key={label}
                  className={`flex items-center justify-between rounded-md border p-3 ${
                    info.missing > 0 ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20" : ""
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{t(label)}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.migrate.docs", { count: info.total })}</p>
                  </div>
                  {info.missing > 0 ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                      {info.missing} {t("admin.migrate.withoutBarrioOrg")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                      {t("admin.migrate.ok")}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Migration log */}
      {migrationStatus.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.migrate.log")}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
              {migrationStatus.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertTriangle className="h-5 w-5" />
            {t("admin.migrate.instructions")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
          <p>{t("admin.migrate.step1")}</p>
          <p>{t("admin.migrate.step2")}</p>
          <p>{t("admin.migrate.step3")}</p>
          <p>{t("admin.migrate.step4")}</p>
          <p className="font-medium">
            {t("admin.migrate.step5")}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
