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
import { getDocs, query, orderBy, limit as fbLimit, Timestamp } from "firebase/firestore";
import {
  usersCollection,
  membersCollection,
  activitiesCollection,
  convertsCollection,
  futureMembersCollection,
  birthdaysCollection,
  servicesCollection,
  adminAuditCollection,
} from "@/lib/collections";
import { normalizeRole, type UserRole } from "@/lib/roles";
import { useAuth } from "@/contexts/auth-context";
import logger from "@/lib/logger";
import type { AuditAction } from "@/lib/audit-logger";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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

const AUDIT_META: Record<AuditAction, { label: string; icon: typeof ScrollText; color: string }> = {
  "user.role_changed": { label: "Cambio de rol", icon: ShieldCheck, color: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  "user.visibility_changed": { label: "Visibilidad", icon: Eye, color: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
  "user.bulk_role_changed": { label: "Roles masivos", icon: ShieldAlert, color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  "member.status_changed": { label: "Estado miembro", icon: UserCog, color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  "member.deleted": { label: "Miembro eliminado", icon: Trash2, color: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

const ROLE_LABELS: Record<UserRole, string> = {
  user: "Miembro",
  counselor: "Consejero",
  president: "Presidente",
  secretary: "Secretario",
  other: "Otro",
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
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [isAuditLoading, setIsAuditLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [usersSnap, membersSnap, activitiesSnap, convertsSnap, futureSnap, birthdaysSnap, servicesSnap] = await Promise.all([
          getDocs(usersCollection),
          getDocs(membersCollection),
          getDocs(activitiesCollection),
          getDocs(convertsCollection),
          getDocs(futureMembersCollection),
          getDocs(birthdaysCollection),
          getDocs(servicesCollection),
        ]);

        // Helper to filter strictly by barrioOrg
        const matchesBarrio = (docBarrioOrg?: string) =>
          docBarrioOrg === barrioOrg;

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
          if (!matchesBarrio(data.barrioOrg as string | undefined)) return;
          totalUsers++;
          const r = normalizeRole(data.role);
          usersByRole[r] = (usersByRole[r] || 0) + 1;
        });

        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let recentMembers = 0;
        let totalMembers = 0;
        membersSnap.forEach((d) => {
          const data = d.data();
          if (!matchesBarrio(data.barrioOrg as string | undefined)) return;
          totalMembers++;
          const createdAt = data.createdAt as Timestamp | undefined;
          if (createdAt && typeof createdAt.toMillis === "function") {
            if (createdAt.toMillis() >= sevenDaysAgo) recentMembers += 1;
          }
        });

        let totalActivities = 0;
        activitiesSnap.forEach((d) => {
          if (matchesBarrio(d.data().barrioOrg as string | undefined)) totalActivities++;
        });
        let totalConverts = 0;
        convertsSnap.forEach((d) => {
          if (matchesBarrio(d.data().barrioOrg as string | undefined)) totalConverts++;
        });
        let totalFuture = 0;
        futureSnap.forEach((d) => {
          if (matchesBarrio(d.data().barrioOrg as string | undefined)) totalFuture++;
        });
        let totalBirthdays = 0;
        birthdaysSnap.forEach((d) => {
          if (matchesBarrio(d.data().barrioOrg as string | undefined)) totalBirthdays++;
        });
        let totalServices = 0;
        servicesSnap.forEach((d) => {
          if (matchesBarrio(d.data().barrioOrg as string | undefined)) totalServices++;
        });

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
  }, []);

  useEffect(() => {
    const loadAudit = async () => {
      if (!barrioOrg) return;
      try {
        setIsAuditLoading(true);
        const q = query(
          adminAuditCollection,
          orderBy("createdAt", "desc"),
          fbLimit(50)
        );
        const snap = await getDocs(q).catch(() => null);
        const list: AuditEntry[] = [];
        if (snap) {
          snap.forEach((d) => {
            const data = d.data();
            const docBarrioOrg = data.barrioOrg as string | undefined;
            // Solo entradas del mismo barrio
            if (docBarrioOrg !== barrioOrg) return;
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
            Panel de Administración
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          Control total del sistema. Gestiona usuarios, miembros y configuraciones avanzadas.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          icon={Users}
          label="Usuarios registrados"
          value={stats?.totalUsers}
          isLoading={isLoading}
          href="/admin/users"
          description="Cuentas con acceso a QuorumFlow"
        />
        <AdminStatCard
          icon={UserCog}
          label="Miembros del quórum"
          value={stats?.totalMembers}
          isLoading={isLoading}
          href="/admin/members"
          description="En la base de datos"
        />
        <AdminStatCard
          icon={TrendingUp}
          label="Nuevos esta semana"
          value={stats?.recentMembers}
          isLoading={isLoading}
          description="Miembros agregados en los últimos 7 días"
        />
        <AdminStatCard
          icon={Activity}
          label="Actividades"
          value={stats?.totalActivities}
          isLoading={isLoading}
          description="Actividades registradas"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard
          icon={HeartHandshake}
          label="Conversos"
          value={stats?.totalConverts}
          isLoading={isLoading}
          description="Conversos recientes"
        />
        <AdminStatCard
          icon={BookUser}
          label="Futuros miembros"
          value={stats?.totalFutureMembers}
          isLoading={isLoading}
          description="En proceso"
        />
        <AdminStatCard
          icon={Cake}
          label="Cumpleaños"
          value={stats?.totalBirthdays}
          isLoading={isLoading}
          description="Registrados"
        />
        <AdminStatCard
          icon={Wrench}
          label="Servicios"
          value={stats?.totalServices}
          isLoading={isLoading}
          description="Proyectos de servicio"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución de roles</CardTitle>
            <CardDescription>Cuentas activas por nivel de acceso</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              (Object.keys(ROLE_LABELS) as UserRole[]).map((r) => {
                const count = stats?.usersByRole[r] ?? 0;
                const total = stats?.totalUsers ?? 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={r} className="flex items-center gap-3">
                    <Badge className={ROLE_COLORS[r]} variant="secondary">
                      {ROLE_LABELS[r]}
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
              Última actividad
            </CardTitle>
            <CardDescription>
              Cambios recientes en {barrio} · {organizacion}
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
                No hay actividad registrada en tu barrio aún.
              </div>
            ) : (
              <div className="space-y-2">
                {auditEntries.slice(0, 5).map((entry) => {
                  const meta = AUDIT_META[entry.action as AuditAction] || {
                    label: entry.action,
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
                          <span className="text-xs font-medium">{meta.label}</span>
                          {entry.targetName && (
                            <span className="truncate text-xs text-muted-foreground">
                              {entry.targetName}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Por {entry.actorName || entry.actorUid} ·{" "}
                          {date
                            ? format(date, "d MMM, HH:mm", { locale: es })
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
                    Ver bitácora completa
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
            Aviso de administrador
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-amber-800 dark:text-amber-200">
          Los cambios realizados aquí afectan a todos los usuarios y datos del sistema.
          Procede con responsabilidad y coordina con la presidencia del quórum antes
          de realizar cambios importantes.
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
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
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
