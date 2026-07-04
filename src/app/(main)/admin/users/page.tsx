"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { usersCollection } from "@/lib/collections";
import {
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
  type UserRole,
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
  Eye,
  Loader2,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";

interface UserData {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
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
  const [isBulkSaving, setIsBulkSaving] = useState(false);

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

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setIsSaving(userId);
    try {
      const normalized = normalizeRole(newRole);
      const target = users.find((u) => u.uid === userId);
      await updateDoc(doc(usersCollection, userId), {
        role: normalized,
        updatedAt: Timestamp.now(),
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === userId ? { ...u, role: normalized } : u))
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

  const handleVisibilityToggle = (
    userId: string,
    href: string,
    checked: boolean
  ) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.uid !== userId) return u;
        const current = u.visiblePages ?? [];
        const next = checked
          ? Array.from(new Set([...current, href]))
          : current.filter((h) => h !== href);
        return { ...u, visiblePages: next };
      })
    );
  };

  const handleBulkRole = async () => {
    if (!bulkRole || selectedUids.size === 0) return;
    setIsBulkSaving(true);
    try {
      const promises = Array.from(selectedUids).map((uid) =>
        updateDoc(doc(usersCollection, uid), {
          role: bulkRole,
          updatedAt: Timestamp.now(),
        })
      );
      await Promise.all(promises);
      const targetUids = Array.from(selectedUids);
      setUsers((prev) =>
        prev.map((u) => (selectedUids.has(u.uid) ? { ...u, role: bulkRole } : u))
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

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedUids(new Set(filtered.map((u) => u.uid)));
    } else {
      setSelectedUids(new Set());
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
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              {user.visiblePages.length} páginas
                            </summary>
                            <div className="mt-2 flex flex-col gap-1.5">
                              {navigationItems
                                .filter((item) => item.href !== '/church-chat')
                                .map((item) => (
                                <label
                                  key={item.href}
                                  className="flex items-center gap-2 rounded border px-2 py-1"
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
                                >
                                  Todo
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => updateUserVisibility(user.uid, [])}
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

                        {/* Visibility */}
                        <div>
                          <Label className="text-xs text-muted-foreground">Visibilidad</Label>
                          <details className="mt-1 text-xs">
                            <summary className="cursor-pointer text-primary hover:underline">
                              {user.visiblePages.length} páginas visibles
                            </summary>
                            <div className="mt-2 flex flex-col gap-1.5">
                              {navigationItems
                                .filter((item) => item.href !== '/church-chat')
                                .map((item) => (
                                <label
                                  key={item.href}
                                  className="flex items-center gap-2 rounded border px-2 py-1"
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
                                >
                                  Todo
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => updateUserVisibility(user.uid, [])}
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
    </section>
  );
}
