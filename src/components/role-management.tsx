'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { usersCollection } from '@/lib/collections';
import { doc, getDoc, getDocs, updateDoc, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import {
  assignableRoles,
  canManageSettings,
  normalizeRole,
  type UserRole,
} from '@/lib/roles';
import { navigationItems } from '@/lib/navigation';
import { textSections, type TextSection } from '@/lib/text-sections';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Eye, Loader2 } from 'lucide-react';

interface UserData {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  visiblePages: string[];
  createdAt?: Timestamp;
}

export default function RoleManagement() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const defaultVisiblePages = useMemo(
    () => navigationItems.map((item) => item.href),
    []
  );
  const roleMeta = useMemo<
    Record<
      UserRole,
      {
        label: string;
        description: string;
      }
    >
  >(
    () => ({
      user: {
        label: 'Miembro',
        description: 'Acceso limitado, sin configuraciones.',
      },
      counselor: {
        label: 'Consejero',
        description: 'Puede ver todo salvo editar ajustes.',
      },
      president: {
        label: 'Presidente',
        description: 'Puede ver todo salvo editar ajustes.',
      },
      secretary: {
        label: 'Secretario',
        description: 'Control total y gestión de permisos.',
      },
      other: {
        label: 'Otro',
        description: 'Acceso personalizado con selección de textos específicos.',
      },
    }),
    []
  );

  // Verificar si el usuario actual tiene rol "secretary"
  useEffect(() => {
    const checkUserRole = async () => {
      if (!firebaseUser) return;

      try {
        const userDocRef = doc(usersCollection, firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          const role = normalizeRole(userData.role);
          setUserRole(role);

          if (canManageSettings(role)) {
            setHasAccess(true);
          } else {
            setHasAccess(false);
          }
        }
      } catch (error) {
        logger.error({ error, message: 'Error checking user role' });
        setHasAccess(false);
      }
    };

    checkUserRole();
  }, [firebaseUser]);

  const updateUserVisibility = async (userId: string, pages: string[]) => {
    if (!firebaseUser) return;

    setIsSaving(userId);

    try {
      const userDocRef = doc(usersCollection, userId);
      const updateData: any = {
        visiblePages: pages,
        updatedAt: Timestamp.now(),
      };
      
      await updateDoc(userDocRef, updateData);

      setUsers((prev) =>
        prev.map((user) =>
          user.uid === userId ? { ...user, visiblePages: pages } : user
        )
      );
    } catch (error) {
      logger.error({ error, message: 'Error saving user visibility', userId });
      toast({
        title: 'Error',
        description: 'No se pudo guardar la visibilidad del usuario.',
        variant: 'destructive',
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
      prev.map((user) => {
        if (user.uid !== userId) return user;

        const current = user.visiblePages ?? [];
        const next = checked
          ? Array.from(new Set([...current, href]))
          : current.filter((item) => item !== href);

        return { ...user, visiblePages: next };
      })
    );
  };

  // Cargar todos los usuarios
  useEffect(() => {
    const fetchUsers = async () => {
      if (!hasAccess) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const querySnapshot = await getDocs(usersCollection);
        const usersList: UserData[] = [];

        querySnapshot.forEach((doc) => {
          const data = doc.data();
          usersList.push({
            uid: doc.id,
            name: data.name || 'Sin nombre',
            email: data.email || 'Sin email',
            role: normalizeRole(data.role),
            visiblePages: Array.isArray(data.visiblePages)
              ? data.visiblePages
              : defaultVisiblePages,
            createdAt: data.createdAt,
          });
        });

        // Ordenar por fecha de creación (más recientes primero)
        usersList.sort((a, b) => {
          const dateA = a.createdAt?.toMillis() ?? 0;
          const dateB = b.createdAt?.toMillis() ?? 0;
          return dateB - dateA;
        });

        setUsers(usersList);
      } catch (error) {
        logger.error({ error, message: 'Error loading users' });
        toast({
          title: 'Error',
          description: 'No se pudieron cargar los usuarios.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, [defaultVisiblePages, hasAccess, toast]);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (!firebaseUser) return;

    setIsSaving(userId);

    try {
      const normalizedRole = normalizeRole(newRole);
      const userDocRef = doc(usersCollection, userId);
      await updateDoc(userDocRef, {
        role: normalizedRole,
        updatedAt: Timestamp.now(),
      });

      // Actualizar la lista local
      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.uid === userId ? { ...user, role: normalizedRole } : user
        )
      );

      toast({
        title: 'Éxito',
        description: 'El rol del usuario ha sido actualizado.',
      });

      logger.info({
        message: 'User role updated',
        userId,
        newRole: normalizedRole,
        changedBy: firebaseUser.uid,
      });
    } catch (error) {
      logger.error({ error, message: 'Error updating user role', userId });
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el rol del usuario.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(null);
    }
  };

  if (!hasAccess) {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertCircle className="h-5 w-5" />
            Acceso Restringido
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">
          <p className="text-amber-800 dark:text-amber-200">
            Solo el secretario designado puede administrar los roles desde la página de Ajustes.
            El presidente y los consejeros tienen acceso al resto de la aplicación, pero deben
            coordinar cambios de permisos con el secretario.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="gap-2">
        <CardTitle className="text-base font-semibold sm:text-lg">
          Gestión de Roles de Usuarios
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Define qué líderes pueden administrar y apoyar al quórum sin salirte de la
          pantalla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No hay usuarios registrados.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {users.map((user) => (
                <div
                  key={user.uid}
                  className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium leading-tight text-foreground">
                        {user.name}
                      </p>
                      <p className="text-xs text-muted-foreground break-all">
                        {user.email}
                      </p>
                    </div>
                    <Button
                      asChild
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Ver perfil de ${user.name}`}
                    >
                      <Link href={`/profile?uid=${user.uid}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`role-${user.uid}`} className="text-xs uppercase tracking-wide text-muted-foreground">
                      Rol asignado
                    </Label>
                    <Select
                      value={user.role}
                      onValueChange={(newRole) =>
                        handleRoleChange(user.uid, normalizeRole(newRole))
                      }
                      disabled={isSaving === user.uid}
                    >
                      <SelectTrigger
                        id={`role-${user.uid}`}
                        className="h-11 rounded-md text-left"
                      >
                        <SelectValue placeholder="Selecciona un rol" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {assignableRoles.map((roleOption) => (
                          <SelectItem key={roleOption} value={roleOption}>
                            {roleMeta[roleOption].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {roleMeta[user.role].description}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Lugares visibles
                    </Label>
                    <div className="grid gap-2">
                      {navigationItems.map((item) => (
                        <label
                          key={item.href}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                        >
                          <Checkbox
                            checked={user.visiblePages.includes(item.href)}
                            onCheckedChange={(value) =>
                              handleVisibilityToggle(
                                user.uid,
                                item.href,
                                value === true
                              )
                            }
                          />
                          <span className="text-foreground">{item.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateUserVisibility(user.uid, defaultVisiblePages)
                        }
                        disabled={isSaving === user.uid}
                      >
                        Todo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateUserVisibility(user.uid, [])}
                        disabled={isSaving === user.uid}
                      >
                        Ninguno
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          updateUserVisibility(user.uid, user.visiblePages)
                        }
                        disabled={isSaving === user.uid}
                      >
                        Guardar
                      </Button>
                      {isSaving === user.uid && (
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-48">Rol</TableHead>
                      <TableHead>Lugares visibles</TableHead>
                      <TableHead className="w-32 text-center">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <React.Fragment key={user.uid}>
                        <TableRow>
                          <TableCell className="font-medium">{user.name}</TableCell>
                          <TableCell className="break-all">{user.email}</TableCell>
                          <TableCell>
                            <Select
                              value={user.role}
                              onValueChange={(newRole) =>
                                handleRoleChange(user.uid, normalizeRole(newRole))
                              }
                              disabled={isSaving === user.uid}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Selecciona un rol" />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableRoles.map((roleOption) => (
                                  <SelectItem key={roleOption} value={roleOption}>
                                    {roleMeta[roleOption].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {roleMeta[user.role].description}
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {navigationItems.map((item) => (
                                <label
                                  key={item.href}
                                  className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                                >
                                  <Checkbox
                                    checked={user.visiblePages.includes(item.href)}
                                    onCheckedChange={(value) =>
                                      handleVisibilityToggle(
                                        user.uid,
                                        item.href,
                                        value === true
                                      )
                                    }
                                  />
                                  <span className="text-foreground">
                                    {item.label}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Button
                                asChild
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9"
                                aria-label={`Ver perfil de ${user.name}`}
                              >
                                <Link href={`/profile?uid=${user.uid}`}>
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  updateUserVisibility(user.uid, defaultVisiblePages)
                                }
                                disabled={isSaving === user.uid}
                              >
                                Todo
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateUserVisibility(user.uid, [])}
                                disabled={isSaving === user.uid}
                              >
                                Ninguno
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  updateUserVisibility(user.uid, user.visiblePages)
                                }
                                disabled={isSaving === user.uid}
                              >
                                Guardar
                              </Button>
                              {isSaving === user.uid && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
