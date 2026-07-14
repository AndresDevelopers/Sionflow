"use client";

import { useEffect, useState } from "react";
import { getDocs, query, where } from "firebase/firestore";
import { usersCollection } from "@/lib/collections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/contexts/i18n-context";
import { useAuth } from "@/contexts/auth-context";
import { auth } from "@/lib/firebase";
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

type CollectionStat = { totalScanned: number; missing: number; updated?: number };

/**
 * Migration UI: stamps barrioOrg on legacy documents that lack it.
 * Uses Admin API (bypasses client rules that hide unscoped docs).
 * Only assigns the caller's own barrioOrg — never cross-tenant.
 */
export default function MigratePage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const { barrioOrg, user } = useAuth();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationCounts, setMigrationCounts] = useState<Record<string, CollectionStat>>({});

  useEffect(() => {
    if (!barrioOrg) return;
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when barrioOrg changes
  }, [barrioOrg]);

  const loadUsers = async () => {
    if (!barrioOrg) return;
    setIsLoadingUsers(true);
    try {
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

  const callMigrateApi = async (action: "analyze" | "migrate") => {
    if (!barrioOrg || !user) {
      toast({
        title: t("admin.migrate.toast.selectUser"),
        description: t("admin.migrate.toast.selectUserDesc"),
        variant: "destructive",
      });
      return;
    }

    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) {
      toast({
        title: t("common.error"),
        description: t("admin.migrate.toast.errorDesc"),
        variant: "destructive",
      });
      return;
    }

    setIsMigrating(true);
    setMigrationStatus([]);
    try {
      const res = await fetch("/api/admin/migrate-barrio-org", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          targetBarrioOrg: barrioOrg,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        totalMissing?: number;
        totalUpdated?: number;
        collections?: Record<string, CollectionStat>;
      };

      if (!res.ok) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }

      setMigrationCounts(payload.collections || {});

      if (action === "analyze") {
        toast({
          title: t("admin.migrate.toast.analysisComplete"),
          description: t("admin.migrate.toast.analysisCompleteDesc"),
        });
      } else {
        const log = [
          `✅ Updated ${payload.totalUpdated ?? 0} documents with barrioOrg=${barrioOrg}`,
          t("admin.migrate.separator"),
          t("admin.migrate.completed"),
        ];
        setMigrationStatus(log);
        toast({
          title: t("admin.migrate.toast.migrationComplete"),
          description: t("admin.migrate.toast.migrationCompleteDesc"),
        });
      }
    } catch (err) {
      logger.error({ error: err, message: "Error in migrate-barrio-org API" });
      setMigrationStatus([t("admin.migrate.errorDuring")]);
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("admin.migrate.toast.errorDesc"),
        variant: "destructive",
      });
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
        {barrioOrg ? (
          <p className="text-sm text-muted-foreground">
            Scope: <Badge variant="outline">{barrioOrg}</Badge> (solo este tenant)
          </p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            {t("admin.migrate.usersTitle") || "Usuarios del barrio"}
          </CardTitle>
          <CardDescription>
            Referencia de usuarios en tu barrioOrg. La migración solo rellena documentos sin
            barrioOrg con <strong>tu</strong> barrio actual (nunca otro tenant).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {users.map((u) => (
                <li key={u.uid} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-muted-foreground">{u.email}</span>
                  <Badge variant="secondary">{u.role}</Badge>
                </li>
              ))}
              {users.length === 0 ? (
                <li className="text-muted-foreground">—</li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Documentos sin barrioOrg
          </CardTitle>
          <CardDescription>
            El análisis y la migración usan Admin SDK (servidor) porque las reglas de Firestore
            ocultan documentos sin barrioOrg al cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isMigrating || !barrioOrg}
              onClick={() => void callMigrateApi("analyze")}
            >
              {isMigrating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("admin.migrate.analyze") || "Analizar"}
            </Button>
            <Button
              type="button"
              disabled={isMigrating || !barrioOrg || totalMissingAll === 0}
              onClick={() => void callMigrateApi("migrate")}
            >
              {isMigrating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {t("admin.migrate.migrateAll") || "Migrar faltantes"}
              {totalMissingAll > 0 ? ` (${totalMissingAll})` : ""}
            </Button>
          </div>

          {Object.keys(migrationCounts).length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(migrationCounts).map(([name, stat]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="truncate font-mono text-xs">{name}</span>
                  <div className="flex gap-2">
                    <Badge variant="outline">scan {stat.totalScanned}</Badge>
                    <Badge variant={stat.missing > 0 ? "destructive" : "secondary"}>
                      missing {stat.missing}
                    </Badge>
                    {typeof stat.updated === "number" ? (
                      <Badge variant="default">upd {stat.updated}</Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {migrationStatus.length > 0 ? (
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
              {migrationStatus.join("\n")}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
