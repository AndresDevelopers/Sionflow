"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { usersCollection } from "@/lib/collections";
import {
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import { logAdminAction } from "@/lib/audit-logger";
import {
  assignableRoles,
  normalizeRole,
  normalizePermission,
  getDefaultPermission,
  type UserRole,
  type UserPermission,
  PERMISSION_META,
} from "@/lib/roles";
import { navigationItems } from "@/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Eye,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";

interface UserData {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  permission: UserPermission;
  visiblePages: string[];
  createdAt?: Timestamp;
}

const ROLE_META: Record<UserRole, { label: string; description: string; color: string }> = {
  user: {
    label: "Miembro",
    description: "Acceso limitado.",
    color: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  counselor: {
    label: "Consejero",
    description: "Ve todo salvo editar ajustes.",
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  president: {
    label: "Presidente",
    description: "Ve todo salvo editar ajustes.",
    color: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  },
  secretary: {
    label: "Secretario",
    description: "Control total.",
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  other: {
    label: "Otro",
    description: "Acceso personalizado.",
    color: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

export default function AdminUsersPage() {
  const { firebaseUser, barrioOrg } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [filtered, setFiltered] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<UserRole | "">("");
  const [bulkPermission, setBulkPermission] = useState<UserPermission | "">("");
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savedVisibilityUids, setSavedVisibilityUids] = useState<Set<string>>(new Set());

  const defaultVisiblePages = useMemo(
    () => navigationItems.map((item) => item.href),
    []
  );

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const snap = await getDocs(usersCollection);
        const list: UserData[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const userBarrioOrg = data.barrioOrg as string || "";
          // Solo usuarios del mismo barrio
          if (userBarrioOrg !== barrioOrg) return;
          list.push({
            uid: d.id,
            name: data.name || "Sin nombre",
            email: data.email || "Sin email",
            role: normalizeRole(data.role),
            permission: normalizePermission(data.permission),
            visiblePages: Array.isArray(data.visiblePages)
              ? data.visiblePages
              : defaultVisiblePages,
            createdAt: data.createdAt,
          });
        });
        list.sort((a, b) => {
          const aT = a.createdAt?.toMillis() ?? 0;
          const bT = b.createdAt?.toMillis() ?? 0;
          return bT - aT;
        });
        setUsers(list);
      } catch (err) {
        logger.error({ error: err, message: "Error loading admin users" });
        toast({
          title: "Error",
          description: "No se pudieron cargar los usuarios.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [defaultVisiblePages, toast, barrioOrg]);

  useEffect(() => {
    let list = users;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      );
    }
    if (roleFilter !== "all") {
      list = list.filter((u) => u.role === roleFilter);
    }
    setFiltered(list);
  }, [users, search, roleFilter]);

  const getDefaultVisiblePages = (role: UserRole): string[] => {
    if (role === "user") return [];
    return defaultVisiblePages;
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setIsSaving(userId);
    try {
      const normalized = normalizeRole(newRole);
      const defaultPerm = getDefaultPermission(normalized);
      const defaultPages = getDefaultVisiblePages(normalized);
      const target = users.find((u) => u.uid === userId);
      await updateDoc(doc(usersCollection, userId), {
        role: normalized,
        permission: defaultPerm,
        visiblePages: defaultPages,
        updatedAt: Timestamp.now(),
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === userId
            ? { ...u, role: normalized, permission: defaultPerm, visiblePages: defaultPages }
            : u
        )
      );
      if (firebaseUser) {
        await logAdminAction({
          action: "user.role_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: userId,
          targetName: target?.name,
          details: { newRole: normalized, previousRole: target?.role },
          barrioOrg,
        });
      }
      toast({
        title: "Rol actualizado",
        description: `El usuario ahora es ${ROLE_META[normalized].label}.`,
      });
    } catch (err) {
      logger.error({ error: err, message: "Error updating role", userId });
      toast({
        title: "Error",
        description: "No se pudo actualizar el rol.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(null);
    }
  };

  const handlePermissionChange = async (userId: string, newPermission: UserPermission) => {
    setIsSaving(userId);
    try {
      const target = users.find((u) => u.uid === userId);
      await updateDoc(doc(usersCollection, userId), {
        permission: newPermission,
        updatedAt: Timestamp.now(),
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === userId ? { ...u, permission: newPermission } : u))
      );
      if (firebaseUser) {
        await logAdminAction({
          action: "user.permission_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: userId,
          targetName: target?.name,
          details: { newPermission, previousPermission: target?.permission },
          barrioOrg,
        });
      }
      toast({
        title: "Permiso actualizado",
        description: `Ahora tiene acceso: ${PERMISSION_META[newPermission].label}.`,
      });
    } catch (err) {
      logger.error({ error: err, message: "Error updating permission", userId });
      toast({
        title: "Error",
        description: "No se pudo actualizar el permiso.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(null);
    }
  };

  const updateUserVisibility = async (userId: string, pages: string[]) => {
    setIsSaving(userId);
    try {
      const target = users.find((u) => u.uid === userId);
      await updateDoc(doc(usersCollection, userId), {
        visiblePages: pages,
        updatedAt: Timestamp.now(),
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === userId ? { ...u, visiblePages: pages } : u))
      );
      if (firebaseUser) {
        await logAdminAction({
          action: "user.visibility_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: userId,
          targetName: target?.name,
          details: { pageCount: pages.length },
          barrioOrg,
        });
      }
    } catch (err) {
      logger.error({ error: err, message: "Error updating visibility" });
      toast({
        title: "Error",
        description: "No se pudo guardar la visibilidad.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(null);
    }
  };

  const handleVisibilityToggle = async (
    userId: string,
    href: string,
    checked: boolean
  ) => {
    const user = users.find((u) => u.uid === userId);
    if (!user || user.role === "user") return;

    const current = user.visiblePages ?? [];
    const next = checked
      ? Array.from(new Set([...current, href]))
      : current.filter((h) => h !== href);

    setUsers((prev) =>
      prev.map((u) => (u.uid === userId ? { ...u, visiblePages: next } : u))
    );

    try {
      await updateDoc(doc(usersCollection, userId), {
        visiblePages: next,
        updatedAt: Timestamp.now(),
      });
      setSavedVisibilityUids((prev) => {
        const nextSet = new Set(prev);
        nextSet.add(userId);
        return nextSet;
      });
      setTimeout(() => {
        setSavedVisibilityUids((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(userId);
          return nextSet;
        });
      }, 1500);
    } catch (err) {
      logger.error({ error: err, message: "Error updating visibility" });
    }
  };

  const handleBulkRole = async () => {
    if (!bulkRole || selectedUids.size === 0) return;
    setIsBulkSaving(true);
    try {
      const defaultPerm = getDefaultPermission(bulkRole);
      const defaultPages = getDefaultVisiblePages(bulkRole);
      const promises = Array.from(selectedUids).map((uid) =>
        updateDoc(doc(usersCollection, uid), {
          role: bulkRole,
          permission: defaultPerm,
          visiblePages: defaultPages,
          updatedAt: Timestamp.now(),
        })
      );
      await Promise.all(promises);
      const targetUids = Array.from(selectedUids);
      setUsers((prev) =>
        prev.map((u) =>
          selectedUids.has(u.uid)
            ? { ...u, role: bulkRole, permission: defaultPerm, visiblePages: defaultPages }
            : u
        )
      );
      if (firebaseUser) {
        await logAdminAction({
          action: "user.bulk_role_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: targetUids.join(","),
          details: { newRole: bulkRole, count: targetUids.length },
          barrioOrg,
        });
      }
      toast({
        title: "Roles actualizados",
        description: `${selectedUids.size} usuarios ahora son ${ROLE_META[bulkRole].label}.`,
      });
      setSelectedUids(new Set());
      setBulkRole("");
    } catch (err) {
      logger.error({ error: err, message: "Error bulk updating roles" });
      toast({
        title: "Error",
        description: "No se pudieron actualizar los roles.",
        variant: "destructive",
      });
    } finally {
      setIsBulkSaving(false);
    }
  };

  const handleBulkPermission = async () => {
    if (!bulkPermission || selectedUids.size === 0) return;
    setIsBulkSaving(true);
    try {
      const promises = Array.from(selectedUids).map((uid) =>
        updateDoc(doc(usersCollection, uid), {
          permission: bulkPermission,
          updatedAt: Timestamp.now(),
        })
      );
      await Promise.all(promises);
      setUsers((prev) =>
        prev.map((u) => (selectedUids.has(u.uid) ? { ...u, permission: bulkPermission } : u))
      );
      if (firebaseUser) {
        await logAdminAction({
          action: "user.bulk_permission_changed",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: Array.from(selectedUids).join(","),
          details: { newPermission: bulkPermission, count: selectedUids.size },
          barrioOrg,
        });
      }
      toast({
        title: "Permisos actualizados",
        description: `${selectedUids.size} usuarios ahora tienen acceso: ${PERMISSION_META[bulkPermission].label}.`,
      });
      setBulkPermission("");
    } catch (err) {
      logger.error({ error: err, message: "Error bulk updating permissions" });
      toast({
        title: "Error",
        description: "No se pudieron actualizar los permisos.",
        variant: "destructive",
      });
    } finally {
      setIsBulkSaving(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedUids(new Set(filtered.map((u) => u.uid)));
    } else {
      setSelectedUids(new Set());
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const uid = deleteTarget.uid;
      await deleteDoc(doc(usersCollection, uid));
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      setSelectedUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
      if (firebaseUser) {
        await logAdminAction({
          action: "user.deleted",
          actorUid: firebaseUser.uid,
          actorName: firebaseUser.displayName || undefined,
          targetId: uid,
          targetName: deleteTarget.name,
          barrioOrg,
        });
      }
      toast({
        title: "Usuario eliminado",
        description: `Se eliminó a ${deleteTarget.name}.`,
      });
    } catch (err) {
      logger.error({ error: err, message: "Error deleting user", uid: deleteTarget.uid });
      toast({
        title: "Error",
        description: "No se pudo eliminar el usuario.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const allSelected =
    filtered.length > 0 && selectedUids.size === filtered.length;

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <UserCog className="h-6 w-6 text-primary" />
          <h1 className="text-balance text-fluid-title font-semibold">
            Gestión de usuarios
          </h1>
        </div>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          Asigna roles, controla permisos y modera el acceso al sistema.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "all")}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por rol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los roles</SelectItem>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_META[r].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedUids.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {selectedUids.size} usuario{selectedUids.size > 1 ? "s" : ""} seleccionado
              {selectedUids.size > 1 ? "s" : ""}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as UserRole)}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Asignar rol..." />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_META[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkRole}
                disabled={!bulkRole || isBulkSaving}
                size="sm"
              >
                {isBulkSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Aplicando...
                  </>
                ) : (
                  "Aplicar"
                )}
              </Button>
              <Select value={bulkPermission} onValueChange={(v) => setBulkPermission(v as UserPermission)}>
                <SelectTrigger className="w-full sm:w-48 mt-2 sm:mt-0">
                  <SelectValue placeholder="Asignar permiso..." />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERMISSION_META) as UserPermission[]).map((p) => (
                    <SelectItem key={p} value={p}>{PERMISSION_META[p].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkPermission}
                disabled={!bulkPermission || isBulkSaving}
                size="sm"
              >
                {isBulkSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Aplicando...
                  </>
                ) : (
                  "Aplicar"
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedUids(new Set())}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Usuarios ({filtered.length})
          </CardTitle>
          <CardDescription>
            Haz clic en el rol para cambiarlo. Marca varios para acciones masivas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No se encontraron usuarios con los filtros aplicados.
            </div>
          ) : (
            <>
              {/* Desktop: Table view (visible sm+) */}
              <div className="hidden sm:block overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(v) => toggleAll(v === true)}
                          aria-label="Seleccionar todos"
                        />
                      </TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-48">Rol</TableHead>
                      <TableHead className="w-36">Permiso</TableHead>
                      <TableHead>Visibilidad</TableHead>
                      <TableHead className="w-24 text-center">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((user) => (
                      <TableRow key={user.uid}>
                        <TableCell>
                          <Checkbox
                            checked={selectedUids.has(user.uid)}
                            onCheckedChange={(v) => {
                              setSelectedUids((prev) => {
                                const next = new Set(prev);
                                if (v === true) next.add(user.uid);
                                else next.delete(user.uid);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="break-all text-sm text-muted-foreground">
                          {user.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <Select
                              value={user.role}
                              onValueChange={(v) =>
                                handleRoleChange(user.uid, normalizeRole(v))
                              }
                              disabled={isSaving === user.uid}
                            >
                              <SelectTrigger className="h-9 w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableRoles.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {ROLE_META[r].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Badge
                              variant="secondary"
                              className={`w-fit text-xs ${ROLE_META[user.role].color}`}
                            >
                              {ROLE_META[user.role].description}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.permission}
                            onValueChange={(v) =>
                              handlePermissionChange(user.uid, v as UserPermission)
                            }
                            disabled={isSaving === user.uid || user.role === "user"}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(PERMISSION_META) as UserPermission[]).map((p) => (
                                <SelectItem key={p} value={p}>
                                  {PERMISSION_META[p].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
                              <span>{user.visiblePages.length} páginas</span>
                              {savedVisibilityUids.has(user.uid) && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in">
                                  ✓ Guardado
                                </span>
                              )}
                            </summary>
                            <div className="mt-2 flex flex-col gap-1.5">
                              {navigationItems
                                .filter((item) => item.href !== '/church-chat')
                                .map((item) => (
                                <label
                                  key={item.href}
                                  className={`flex items-center gap-2 rounded border px-2 py-1 ${
                                    user.role === "user" ? "opacity-50" : ""
                                  }`}
                                >
                                  <Checkbox
                                    checked={user.visiblePages.includes(item.href)}
                                    onCheckedChange={(v) =>
                                      handleVisibilityToggle(
                                        user.uid,
                                        item.href,
                                        v === true
                                      )
                                    }
                                    disabled={user.role === "user"}
                                  />
                                  <span>{item.label}</span>
                                </label>
                              ))}
                              <div className="flex gap-1 pt-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    updateUserVisibility(
                                      user.uid,
                                      defaultVisiblePages
                                    )
                                  }
                                  disabled={user.role === "user"}
                                >
                                  Todo
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => updateUserVisibility(user.uid, [])}
                                  disabled={user.role === "user"}
                                >
                                  Ninguno
                                </Button>
                                {isSaving === user.uid && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                              </div>
                            </div>
                          </details>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              asChild
                              size="icon"
                              variant="ghost"
                              aria-label={`Ver perfil de ${user.name}`}
                            >
                              <Link href={`/profile?uid=${user.uid}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Eliminar a ${user.name}`}
                              onClick={() => setDeleteTarget(user)}
                              disabled={isSaving === user.uid || isDeleting}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: Card view (visible only below sm) */}
              <div className="flex flex-col gap-3 sm:hidden">
                {filtered.map((user) => (
                  <Card key={user.uid} className="relative">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedUids.has(user.uid)}
                              onCheckedChange={(v) => {
                                setSelectedUids((prev) => {
                                  const next = new Set(prev);
                                  if (v === true) next.add(user.uid);
                                  else next.delete(user.uid);
                                  return next;
                                });
                              }}
                            />
                            <h3 className="font-medium truncate">{user.name}</h3>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground break-all ml-8">
                            {user.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            asChild
                            size="icon"
                            variant="ghost"
                            className="shrink-0"
                            aria-label={`Ver perfil de ${user.name}`}
                          >
                            <Link href={`/profile?uid=${user.uid}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Eliminar a ${user.name}`}
                            onClick={() => setDeleteTarget(user)}
                            disabled={isSaving === user.uid || isDeleting}
                            className="shrink-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 ml-8 space-y-3">
                        {/* Role selector */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Rol</Label>
                          <div className="mt-1 flex items-center gap-2">
                            <Select
                              value={user.role}
                              onValueChange={(v) =>
                                handleRoleChange(user.uid, normalizeRole(v))
                              }
                              disabled={isSaving === user.uid}
                            >
                              <SelectTrigger className="h-9 flex-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableRoles.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {ROLE_META[r].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Badge
                              variant="secondary"
                              className={`shrink-0 text-xs ${ROLE_META[user.role].color}`}
                            >
                              {ROLE_META[user.role].label}
                            </Badge>
                          </div>
                        </div>

                        {/* Permission selector */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Permiso</Label>
                          <div className="mt-1">
                            <Select
                              value={user.permission}
                              onValueChange={(v) =>
                                handlePermissionChange(user.uid, v as UserPermission)
                              }
                              disabled={isSaving === user.uid || user.role === "user"}
                            >
                              <SelectTrigger className="h-9 w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(PERMISSION_META) as UserPermission[]).map((p) => (
                                  <SelectItem key={p} value={p}>
                                    {PERMISSION_META[p].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Visibility */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Visibilidad</Label>
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-primary hover:underline inline-flex items-center gap-1.5">
                              <span>{user.visiblePages.length} páginas visibles</span>
                              {savedVisibilityUids.has(user.uid) && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium animate-in fade-in">
                                  ✓ Guardado
                                </span>
                              )}
                            </summary>
                            <div className="mt-2 flex flex-col gap-1.5">
                              {navigationItems
                                .filter((item) => item.href !== '/church-chat')
                                .map((item) => (
                                <label
                                  key={item.href}
                                  className={`flex items-center gap-2 rounded border px-2 py-1 ${
                                    user.role === "user" ? "opacity-50" : ""
                                  }`}
                                >
                                  <Checkbox
                                    checked={user.visiblePages.includes(item.href)}
                                    onCheckedChange={(v) =>
                                      handleVisibilityToggle(
                                        user.uid,
                                        item.href,
                                        v === true
                                      )
                                    }
                                    disabled={user.role === "user"}
                                  />
                                  <span>{item.label}</span>
                                </label>
                              ))}
                              <div className="flex gap-1 pt-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    updateUserVisibility(
                                      user.uid,
                                      defaultVisiblePages
                                    )
                                  }
                                  disabled={user.role === "user"}
                                >
                                  Todo
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => updateUserVisibility(user.uid, [])}
                                  disabled={user.role === "user"}
                                >
                                  Ninguno
                                </Button>
                                {isSaving === user.uid && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                              </div>
                            </div>
                          </details>
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

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar usuario</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas eliminar a{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span>{" "}
              ({deleteTarget?.email})?
              <br />
              Esta acción no se puede deshacer. El usuario perderá acceso al sistema y sus datos serán eliminados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
