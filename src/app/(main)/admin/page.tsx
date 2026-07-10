"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  UserCog,
  Shield,
  Activity,
  AlertTriangle,
  TrendingUp,
  HeartHandshake,
  BookUser,
  Cake,
  Wrench,
  ScrollText,
  History,
  Eye,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  MapPin,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDocs, getCountFromServer, query, where, orderBy, limit as fbLimit, Timestamp } from "firebase/firestore";
import {
  usersCollection,
  membersCollection,
  activitiesCollection,
  futureMembersCollection,
  birthdaysCollection,
  servicesCollection,
  adminAuditCollection,
} from "@/lib/collections";
import { normalizeRole, type UserRole } from "@/lib/roles";
import { isRecentConvertMember } from "@/lib/converts-from-members";
import { normalizeMemberStatus } from "@/lib/members-data";
import { useAuth } from "@/contexts/auth-context";
import { getAppName } from "@/lib/app-config";
import logger from "@/lib/logger";
import type { AuditAction } from "@/lib/audit-logger";
import { format } from "date-fns";
import { useI18n } from "@/contexts/i18n-context";
import { getDateFnsLocale } from "@/lib/i18n-date";

interface SystemStats {
  totalUsers: number;
  totalMembers: number;
  totalActivities: number;
  totalConverts: number;
  totalFutureMembers: number;
  totalBirthdays: number;
  totalServices: number;
  usersByRole: Record<UserRole, number>;
  recentMembers: number;
}

interface AuditEntry {
  id: string;
  action: AuditAction;
  actorUid: string;
  actorName?: string;
  targetId: string;
  targetName?: string;
  details?: Record<string, unknown>;
  barrioOrg?: string;
  createdAt?: Timestamp;
}

const AUDIT_META: Record<AuditAction, { icon: typeof ScrollText; color: string }> = {
  "user.role_changed": { icon: ShieldCheck, color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  "user.visibility_changed": { icon: Eye, color: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
  "user.bulk_role_changed": { icon: ShieldAlert, color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  "member.status_changed": { icon: UserCog, color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  "member.deleted": { icon: Trash2, color: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  "user.permission_changed": { icon: ShieldCheck, color: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  "user.bulk_permission_changed": { icon: ShieldAlert, color: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  "user.deleted": { icon: Trash2, color: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

const ROLE_COLORS: Record<UserRole, string> = {
  user: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  counselor: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  president: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  secretary: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  other: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export default function AdminHomePage() {
  const { barrioOrg, barrio, organizacion } = useAuth();
  const { t } = useI18n();
  const dateLocale = getDateFnsLocale();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [isAuditLoading, setIsAuditLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // Counts via aggregation (1 read each) + limited docs only where field breakdown is needed
        const [
          usersSnap,
          membersCountSnap,
          membersRecentSnap,
          activitiesCountSnap,
          futureCountSnap,
          birthdaysCountSnap,
          servicesCountSnap,
        ] = await Promise.all([
          getDocs(query(usersCollection, where('barrioOrg', '==', barrioOrg))),
          getCountFromServer(query(membersCollection, where('barrioOrg', '==', barrioOrg))),
          getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg), fbLimit(500))),
          getCountFromServer(query(activitiesCollection, where('barrioOrg', '==', barrioOrg))),
          getCountFromServer(query(futureMembersCollection, where('barrioOrg', '==', barrioOrg))),
          getCountFromServer(query(birthdaysCollection, where('barrioOrg', '==', barrioOrg))),
          getCountFromServer(query(servicesCollection, where('barrioOrg', '==', barrioOrg))),
        ]);

        const usersByRole: Record<UserRole, number> = {
          user: 0,
          counselor: 0,
          president: 0,
          secretary: 0,
          other: 0,
        };

        let totalUsers = 0;
        usersSnap.forEach((d) => {
          const data = d.data();
          totalUsers++;
          const r = normalizeRole(data.role);
          usersByRole[r] = (usersByRole[r] || 0) + 1;
        });

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let recentMembers = 0;
        let totalConverts = 0;
        const totalMembers = membersCountSnap.data().count;
        membersRecentSnap.forEach((d) => {
          const data = d.data();
          const createdAt = data.createdAt as Timestamp | undefined;
          if (createdAt && typeof createdAt.toMillis === "function") {
            if (createdAt.toMillis() >= sevenDaysAgo) recentMembers += 1;
          }
          if (
            isRecentConvertMember({
              baptismDate: data.baptismDate,
              status: normalizeMemberStatus(data.status),
            })
          ) {
            totalConverts += 1;
          }
        });

        const totalActivities = activitiesCountSnap.data().count;
        const totalFuture = futureCountSnap.data().count;
        const totalBirthdays = birthdaysCountSnap.data().count;
        const totalServices = servicesCountSnap.data().count;

        setStats({
          totalUsers,
          totalMembers,
          totalActivities,
          totalConverts,
          totalFutureMembers: totalFuture,
          totalBirthdays,
          totalServices,
          usersByRole,
          recentMembers,
        });
      } catch (err) {
        logger.error({ error: err, message: "Error loading admin stats" });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [barrioOrg]);

  useEffect(() => {
    const loadAudit = async () => {
      if (!barrioOrg) return;
      try {
        setIsAuditLoading(true);
        const q = query(
          adminAuditCollection,
          where("barrioOrg", "==", barrioOrg),
          orderBy("createdAt", "desc"),
          fbLimit(50)
        );
        const snap = await getDocs(q).catch(() => null);
        const list: AuditEntry[] = [];
        if (snap) {
          snap.forEach((d) => {
            const data = d.data();
            list.push({ id: d.id, ...(data ?? {}) } as AuditEntry);
          });
        }
        setAuditEntries(list.slice(0, 10));
      } catch (err) {
        logger.error({ error: err, message: "Error loading audit preview" });
      } finally {
        setIsAuditLoading(false);
      }
    };
    loadAudit();
  }, [barrioOrg]);

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            {t("admin.title")}
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          {t("admin.subtitle")}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          icon={Users}
          label={t("admin.stat.registeredUsers")}
          value={stats?.totalUsers}
          isLoading={isLoading}
          href="/admin/users"
          description={t("admin.stat.registeredUsers.description", { appName: getAppName() })}
        />
        <AdminStatCard
          icon={UserCog}
          label={t("admin.stat.members")}
          value={stats?.totalMembers}
          isLoading={isLoading}
          description={t("admin.stat.members.description")}
        />
        <AdminStatCard
          icon={TrendingUp}
          label={t("admin.stat.newThisWeek")}
          value={stats?.recentMembers}
          isLoading={isLoading}
          description={t("admin.stat.newThisWeek.description")}
        />
        <AdminStatCard
          icon={Activity}
          label={t("admin.stat.activities")}
          value={stats?.totalActivities}
          isLoading={isLoading}
          description={t("admin.stat.activities.description")}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          icon={HeartHandshake}
          label={t("admin.stat.converts")}
          value={stats?.totalConverts}
          isLoading={isLoading}
          description={t("admin.stat.converts.description")}
        />
        <AdminStatCard
          icon={BookUser}
          label={t("admin.stat.futureMembers")}
          value={stats?.totalFutureMembers}
          isLoading={isLoading}
          description={t("admin.stat.futureMembers.description")}
        />
        <AdminStatCard
          icon={Cake}
          label={t("admin.stat.birthdays")}
          value={stats?.totalBirthdays}
          isLoading={isLoading}
          description={t("admin.stat.birthdays.description")}
        />
        <AdminStatCard
          icon={Wrench}
          label={t("admin.stat.services")}
          value={stats?.totalServices}
          isLoading={isLoading}
          description={t("admin.stat.services.description")}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("admin.roles.title")}</CardTitle>
            <CardDescription>{t("admin.roles.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              (Object.keys(ROLE_COLORS) as UserRole[]).map((r) => {
                const count = stats?.usersByRole[r] ?? 0;
                const total = stats?.totalUsers ?? 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={r} className="flex items-center gap-3">
                    <Badge className={ROLE_COLORS[r]} variant="secondary">
                      {t(`role.${r}`)}
                    </Badge>
                    <div className="flex-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-16 text-right text-sm font-medium">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              {t("admin.activity.title")}
            </CardTitle>
            <CardDescription>
              {t("admin.activity.description", { barrio, organizacion })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isAuditLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : auditEntries.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t("admin.activity.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {auditEntries.slice(0, 5).map((entry) => {
                  const meta = AUDIT_META[entry.action as AuditAction] || {
                    icon: ScrollText,
                    color: "bg-muted text-foreground",
                  };
                  const Icon = meta.icon;
                  const date = entry.createdAt?.toDate?.();
                  const bo = entry.barrioOrg || "";
                  const parts = bo ? bo.split("|") : [];
                  const barrio = parts[0] || "";
                  const organizacion = parts[1] || "";
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2 rounded-md border p-2.5"
                    >
                      <div className={`rounded p-1.5 ${meta.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium">{t(`audit.action.${entry.action}`)}</span>
                          {entry.targetName && (
                            <span className="truncate text-xs text-muted-foreground">
                              {entry.targetName}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("admin.audit.byPrefix", { actor: entry.actorName || entry.actorUid })}{" "}
                          {date
                            ? format(date, "d MMM, HH:mm", { locale: dateLocale })
                            : "—"}
                        </p>
                        {(barrio || organizacion) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                            <MapPin className="h-2.5 w-2.5" />
                            {barrio}
                            {barrio && organizacion && " · "}
                            {organizacion}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <Button asChild variant="ghost" size="sm" className="w-full text-xs">
                     <Link href="/admin/audit">
                    <ScrollText className="mr-1 h-3.5 w-3.5" />
                    {t("admin.activity.viewFull")}
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertTriangle className="h-5 w-5" />
            {t("admin.warning.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-amber-800 dark:text-amber-200">
          {t("admin.warning.text")}
        </CardContent>
      </Card>
    </section>
  );
}

function AdminStatCard({
  icon: Icon,
  label,
  value,
  isLoading,
  href,
  description,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  isLoading: boolean;
  href?: string;
  description?: string;
}) {
  const content = (
    <Card className={href ? "transition-colors hover:bg-muted/40" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium min-w-0 truncate">{label}</CardTitle>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value ?? 0}</div>
        )}
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}
