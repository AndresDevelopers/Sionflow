"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import {
  Users,
  Search,
  Trash2,
  Eye,
  Edit,
  Filter,
  Loader2,
  UserCog,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { membersCollection } from "@/lib/collections";
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import { logAdminAction } from "@/lib/audit-logger";
import { useAuth } from "@/contexts/auth-context";
import type { Member, MemberStatus } from "@/lib/types";

const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Activo",
  less_active: "Menos activo",
  inactive: "Inactivo",
  deceased: "Fallecido",
};

const STATUS_COLORS: Record<MemberStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  less_active: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  inactive: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  deceased: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export default function AdminMembersPage() {
  const { toast } = useToast();
  const { firebaseUser, barrioOrg } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MemberStatus | "all">("all");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const snap = await getDocs(membersCollection);
        const list: Member[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const memberBarrioOrg = (data.barrioOrg as string) || "";
          // Solo miembros del mismo barrio
          if (memberBarrioOrg !== barrioOrg) return;
          list.push({ id: d.id, ...data } as Member);
        });
        list.sort((a, b) => {
          const aName = `${a.firstName} ${a.lastName}`.toLowerCase();
          const bName = `${b.firstName} ${b.lastName}`.toLowerCase();
          return aName.localeCompare(bName);
        });
        setMembers(list);
      } catch (err) {
        logger.error({ error: err, message: "Error loading admin members" });
        toast({
          title: "Error",
          description: "No se pudieron cargar los miembros.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [toast, barrioOrg]);

  const filtered = useMemo(() => {
    let list = members;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => {
        const fullName = `${m.firstName} ${m.lastName}`.toLowerCase();
        return (
          fullName.includes(q) ||
          (m.phoneNumber || "").toLowerCase().includes(q) ||
          (m.memberId || "").toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter !== "all") {
      list = list.filter((m) => m.status === statusFilter);
    }
    return list;
  }, [members, search, statusFilter]);

  const handleStatusChange = async (memberId: string, status: MemberStatus) => {
    try {
      const target = members.find((m) => m.id === memberId);
      await updateDoc(doc(membersCollection, memberId), {
        status,
        updatedAt: Timestamp.now(),
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, status } : m))
      );
      if (firebaseUser && target) {
        await logAdminAction({
          action: "member.status_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: memberId,
          targetName: `${target.firstName} ${target.lastName}`,
          details: { newStatus: status, previousStatus: target.status },
          barrioOrg,
        });
      }
      toast({
        title: "Estado actualizado",
        description: `Miembro marcado como ${STATUS_LABELS[status]}.`,
      });
    } catch (err) {
      logger.error({ error: err, message: "Error updating member status" });
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (memberId: string, name: string) => {
    setIsDeleting(memberId);
    try {
      if (firebaseUser) {
        await logAdminAction({
          action: "member.deleted",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: memberId,
          targetName: name,
          barrioOrg,
        });
      }
      await deleteDoc(doc(membersCollection, memberId));
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      toast({
        title: "Miembro eliminado",
        description: `${name} fue eliminado del sistema.`,
      });
    } catch (err) {
      logger.error({ error: err, message: "Error deleting member" });
      toast({
        title: "Error",
        description: "No se pudo eliminar el miembro.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <UserCog className="h-6 w-6 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            Administración de miembros
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          Vista global de todos los miembros del quórum con control total.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{members.length}</div>
            <p className="text-xs text-muted-foreground">Total registrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {members.filter((m) => m.status === "active").length}
            </div>
            <p className="text-xs text-muted-foreground">Activos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {members.filter((m) => m.status === "less_active").length}
            </div>
            <p className="text-xs text-muted-foreground">Menos activos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {members.filter((m) => m.isUrgent).length}
            </div>
            <p className="text-xs text-muted-foreground">Urgentes</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, teléfono o ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as MemberStatus | "all")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Miembros ({filtered.length})
          </CardTitle>
          <CardDescription>
            Cambia el estado directamente o elimina el registro del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No se encontraron miembros con los filtros aplicados.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead className="w-44">Estado</TableHead>
                    <TableHead className="w-32 text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>
                            {m.firstName} {m.lastName}
                          </span>
                          {m.isUrgent && (
                            <Badge variant="destructive" className="mt-1 w-fit text-xs">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              Urgente
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.memberId || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.phoneNumber || "—"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.status}
                          onValueChange={(v) =>
                            handleStatusChange(m.id, v as MemberStatus)
                          }
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_LABELS).map(([key, label]) => (
                              <SelectItem key={key} value={key}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            aria-label="Ver perfil"
                          >
                            <Link href={`/members/${m.id}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            aria-label="Editar"
                          >
                            <Link href={`/members?edit=${m.id}`}>
                              <Edit className="h-4 w-4" />
                            </Link>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                aria-label="Eliminar"
                                disabled={isDeleting === m.id}
                              >
                                {isDeleting === m.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  ¿Eliminar a {m.firstName} {m.lastName}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acción es permanente. Se eliminará el registro
                                  del miembro, sus anotaciones, asignaciones de
                                  ministración y datos relacionados.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    handleDelete(
                                      m.id,
                                      `${m.firstName} ${m.lastName}`
                                    )
                                  }
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Eliminar permanentemente
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
