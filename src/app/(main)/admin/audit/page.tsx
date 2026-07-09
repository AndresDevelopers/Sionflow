"use client";

import { useEffect, useState } from "react";
import { getDocs, orderBy, query, limit, where, Timestamp } from "firebase/firestore";
import {
  ScrollText,
  UserCog,
  Eye,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  History,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminAuditCollection } from "@/lib/collections";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import logger from "@/lib/logger";
import type { AuditAction } from "@/lib/audit-logger";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface AuditDoc {
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

const ACTION_META: Record<
  AuditAction,
  { label: string; icon: typeof UserCog; color: string }
> = {
  "user.role_changed": {
    label: "Cambio de rol",
    icon: ShieldCheck,
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  "user.visibility_changed": {
    label: "Cambio de visibilidad",
    icon: Eye,
    color: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
  "user.bulk_role_changed": {
    label: "Cambio masivo de roles",
    icon: ShieldAlert,
    color: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  "member.status_changed": {
    label: "Cambio de estado de miembro",
    icon: UserCog,
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  "member.deleted": {
    label: "Miembro eliminado",
    icon: Trash2,
    color: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  "user.permission_changed": {
    label: "Cambio de permiso",
    icon: ShieldCheck,
    color: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  "user.bulk_permission_changed": {
    label: "Permisos masivos",
    icon: ShieldAlert,
    color: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  "user.deleted": {
    label: "Usuario eliminado",
    icon: Trash2,
    color: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

export default function AdminAuditPage() {
  const { toast } = useToast();
  const { barrioOrg } = useAuth();
  const [entries, setEntries] = useState<AuditDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<AuditAction | "all">("all");

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        // Filtrar por barrio/organizacion directamente en Firestore
        // usando el índice compuesto barrioOrg ASC + createdAt DESC
        const q = query(
          adminAuditCollection,
          where("barrioOrg", "==", barrioOrg),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const snap = await getDocs(q).catch(() => null);

        const list: AuditDoc[] = [];
        if (snap) {
          snap.forEach((d) => {
            const data = d.data();
            list.push({ id: d.id, ...(data ?? {}) } as AuditDoc);
          });
        }
        setEntries(list);
      } catch (err) {
        logger.error({ error: err, message: "Error loading audit log" });
        toast({
          title: "Aviso",
          description: "No se pudo cargar la bitácora. La colección puede no existir todavía.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [toast, barrioOrg]);

  const filtered = filter === "all" ? entries : entries.filter((e) => e.action === filter);

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            Bitácora de auditoría
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          Historial de cambios administrativos de tu barrio y organización.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Eventos ({filtered.length})
          </CardTitle>
          <CardDescription>
            Se muestran los últimos 200 eventos. Filtra por tipo para acotar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={filter} onValueChange={(v) => setFilter(v as AuditAction | "all")}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los eventos</SelectItem>
              {Object.entries(ACTION_META).map(([key, meta]) => (
                <SelectItem key={key} value={key}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay eventos registrados con el filtro actual.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((entry) => {
                const meta = ACTION_META[entry.action] || {
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
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <div className={`rounded-md p-2 ${meta.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className={meta.color}>
                          {meta.label}
                        </Badge>
                        {entry.targetName && (
                          <span className="text-sm font-medium truncate">
                            {entry.targetName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Por {entry.actorName || entry.actorUid} ·{" "}
                        {date
                          ? format(date, "PPPp", { locale: es })
                          : "Fecha desconocida"}
                      </p>
                      {(barrio || organizacion) && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
                          <MapPin className="h-3 w-3" />
                          {barrio}
                          {barrio && organizacion && " · "}
                          {organizacion}
                        </p>
                      )}
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Ver detalles
                          </summary>
                          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[10px]">
                            {JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
