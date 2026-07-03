'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plus, Search, Filter, Edit, Trash2, Users, UserCheck, UserX, Eye, ChevronUp, AlertTriangle, IdCard } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useMembersSync } from '@/hooks/use-members-sync';
import { SyncStatus } from '@/components/shared/sync-status';
import type { Member, MemberStatus } from '@/lib/types';
import { OrdinanceLabels } from '@/lib/types';
import { MemberForm } from '@/components/members/member-form';
import { deleteMember, updateMember } from '@/lib/members-data';
import { NotificationCreators, createNotificationsForAll } from '@/lib/notification-helpers';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { safeGetDate, safeFormatDate } from '@/lib/date-utils';

const resolveOrdinanceLabel = (ordinance: string) =>
  OrdinanceLabels[ordinance as keyof typeof OrdinanceLabels] ?? ordinance;

const statusConfig = {
  active: {
    label: 'Activo',
    variant: 'default' as const,
    icon: UserCheck,
    color: 'text-green-600'
  },
  less_active: {
    label: 'Menos Activo',
    variant: 'secondary' as const,
    icon: UserX,
    color: 'text-yellow-600'
  },
  inactive: {
    label: 'Inactivo',
    variant: 'destructive' as const,
    icon: UserX,
    color: 'text-red-600'
  },
  deceased: {
    label: 'Fallecido',
    variant: 'secondary' as const,
    icon: UserX,
    color: 'text-muted-foreground'
  }
};

export default function MembersPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { members, loading, syncStatus, lastSyncTime, fetchMembers, clearCache } = useMembersSync({
    enableInitialFetch: true, // Enable initial fetch for members page
    enableRealtimeSync: true, // Enable real-time Firestore listener
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<MemberStatus | 'all'>('all');
  const [baptismFilter, setBaptismFilter] = useState<'all' | 'baptized' | 'not_baptized'>('all');
  const [urgentFilter, setUrgentFilter] = useState<'all' | 'urgent' | 'not_urgent'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [urgentDialogOpen, setUrgentDialogOpen] = useState(false);
  const [urgentMember, setUrgentMember] = useState<Member | null>(null);
  const [urgentReason, setUrgentReason] = useState('');
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [noCedulaDialogOpen, setNoCedulaDialogOpen] = useState(false);





  // Handle edit param from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const returnToParam = urlParams.get('returnTo');
    setReturnTo(returnToParam);
    if (editId && members.length > 0) {
      const memberToEdit = members.find(m => m.id === editId);
      if (memberToEdit) {
        handleEditMember(memberToEdit);
      }
    }
  }, [members]);

  // Scroll to top button visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleDeleteMember = async (memberId: string) => {
    try {
      const response = await fetch(`/api/members/${memberId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete member');
      }

      toast({
        title: 'Éxito',
        description: 'Miembro eliminado correctamente.'
      });

      // Clear cache and refresh immediately
      clearCache();

      // Force refresh to get updated data
      await fetchMembers(true);
    } catch (error) {
      console.error('Error deleting member:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el miembro.',
        variant: 'destructive'
      });
    }
  };

  const handleEditMember = (member: Member) => {
    setEditingMember(member);
    setIsFormOpen(true);
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingMember(null);
    if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo);
      return;
    }
    // Los miembros se actualizan automáticamente via el listener en tiempo real de Firestore
  };

  const handleViewProfile = (memberId: string) => {
    router.push(`/members/${memberId}`);
  };

  const handleToggleUrgent = (member: Member) => {
    if (member.isUrgent) {
      // Unmarking - do it directly
      handleConfirmUrgent(member, false, '');
    } else {
      // Marking - show dialog for reason
      setUrgentMember(member);
      setUrgentReason('');
      setUrgentDialogOpen(true);
    }
  };

  const handleConfirmUrgent = async (member: Member, markAsUrgent: boolean, reason: string) => {
    try {
      await updateMember(member.id, {
        isUrgent: markAsUrgent,
        urgentReason: markAsUrgent ? reason : '',
      });

      if (markAsUrgent) {
        try {
          await createNotificationsForAll({
            title: '⚠️ Miembro Marcado como Urgente',
            body: `${member.firstName} ${member.lastName} ha sido marcado como urgente: ${reason}`,
            contextType: 'member',
            contextId: member.id,
            actionUrl: '/council'
          });
        } catch (notifError) {
          console.error('Error sending urgent notification:', notifError);
        }
      }

      toast({
        title: 'Éxito',
        description: `${member.firstName} ${member.lastName} ${markAsUrgent ? 'marcado como urgente' : 'desmarcado como urgente'}.`,
      });

      setUrgentDialogOpen(false);
      setUrgentMember(null);
      setUrgentReason('');

      clearCache();
      await fetchMembers(true);
    } catch (error) {
      console.error('Error toggling urgent:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del miembro.',
        variant: 'destructive',
      });
    }
  };



  const filteredMembers = members.filter(member => {
    const matchesSearch =
      member.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.lastName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
    const isBaptized = member.ordinances?.includes('baptism') ?? false;

    // Safely get baptism date
    const baptismDate = safeGetDate(member.baptismDate);
    const hasFutureBaptism = baptismDate && baptismDate > new Date();

    const matchesBaptism = baptismFilter === 'all' ||
      (baptismFilter === 'baptized' && isBaptized) ||
      (baptismFilter === 'not_baptized' && !isBaptized && hasFutureBaptism);

    // Filter for urgent status
    const matchesUrgent = urgentFilter === 'all' ||
      (urgentFilter === 'urgent' && member.isUrgent) ||
      (urgentFilter === 'not_urgent' && !member.isUrgent);

    return matchesSearch && matchesStatus && matchesBaptism && matchesUrgent;
  });

  const memberCounts = {
    active: members.filter(m => m.status === 'active').length,
    less_active: members.filter(m => m.status === 'less_active').length,
    inactive: members.filter(m => m.status === 'inactive').length,
    urgent: members.filter(m => m.isUrgent).length,
    withoutCedula: members.filter(m => !m.memberId || m.memberId.trim() === '').length,
    total: members.length
  };

  const membersWithoutCedula = members.filter(m => !m.memberId || m.memberId.trim() === '');

  return (
    <section className="page-section">
      {/* Header */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-fluid-title font-semibold tracking-tight">Miembros</h1>
          <p className="text-balance text-fluid-subtitle text-muted-foreground">
            Gestiona los miembros del quórum y su estado de actividad.
          </p>
          {/* Sync Status Indicator */}
          <SyncStatus
            syncStatus={syncStatus}
            lastSyncTime={lastSyncTime}
            className="mt-2"
          />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Agregar Miembro
              </Button>
            </DialogTrigger>
            <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-4 sm:left-[50%] sm:top-1/2 sm:h-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
              <DialogHeader>
                <DialogTitle>
                  {editingMember ? 'Editar Miembro' : 'Agregar Nuevo Miembro'}
                </DialogTitle>
                <DialogDescription>
                  {editingMember
                    ? 'Modifica la información del miembro.'
                    : 'Completa la información del nuevo miembro.'}
                </DialogDescription>
              </DialogHeader>
              <MemberForm
                member={editingMember}
                onClose={handleFormClose}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>


      {/* Stats Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">



        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberCounts.total}</div>
            <p className="text-xs text-muted-foreground">miembros registrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activos</CardTitle>
            <UserCheck className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{memberCounts.active}</div>
            <p className="text-xs text-muted-foreground">miembros activos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Menos Activos</CardTitle>
            <UserX className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{memberCounts.less_active}</div>
            <p className="text-xs text-muted-foreground">necesitan seguimiento</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactivos</CardTitle>
            <UserX className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{memberCounts.inactive}</div>
            <p className="text-xs text-muted-foreground">miembros inactivos</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Urgentes</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{memberCounts.urgent}</div>
            <p className="text-xs text-muted-foreground">miembros marcados urgentes</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setNoCedulaDialogOpen(true)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Cédula</CardTitle>
            <IdCard className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{memberCounts.withoutCedula}</div>
            <p className="text-xs text-muted-foreground">miembros sin cédula de miembro</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Lista de Miembros</CardTitle>
          <CardDescription>
            Busca y filtra los miembros por nombre o estado de actividad.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Buscar por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value: MemberStatus | 'all') => setStatusFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="less_active">Menos Activos</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
                <SelectItem value="deceased">Fallecidos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={baptismFilter} onValueChange={(value: 'all' | 'baptized' | 'not_baptized') => setBaptismFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filtrar por bautismo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="baptized">Bautizados</SelectItem>
                <SelectItem value="not_baptized">No bautizados (futuro)</SelectItem>
              </SelectContent>
            </Select>
            <Select value={urgentFilter} onValueChange={(value: 'all' | 'urgent' | 'not_urgent') => setUrgentFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <AlertTriangle className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filtrar por urgencia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="urgent">Urgentes</SelectItem>
                <SelectItem value="not_urgent">No urgentes</SelectItem>
              </SelectContent>
            </Select>

          </div>

          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Fecha de Nacimiento</TableHead>
                  <TableHead>Fecha de Fallecimiento</TableHead>
                  <TableHead>Fecha de Bautismo</TableHead>
                  <TableHead>Ordenanzas</TableHead>
                  <TableHead>Ministrantes</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-center">Urgente</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-6 w-12 mx-auto" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center">
                      {searchTerm || statusFilter !== 'all'
                        ? 'No se encontraron miembros con los filtros aplicados.'
                        : syncStatus === 'syncing'
                          ? 'Cargando miembros...'
                          : 'No hay miembros registrados. Agrega el primer miembro.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMembers.map((member) => {
                    const statusInfo = statusConfig[member.status];
                    const isDeceased = member.status === 'deceased';
                    const StatusIcon = statusInfo.icon;

                    return (
                      <TableRow
                        key={member.id}
                        className={isDeceased ? 'bg-muted/50 text-muted-foreground' : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            {member.photoURL ? (
                              <Image
                                src={member.photoURL}
                                alt={`${member.firstName} ${member.lastName}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                <Users className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <span>{member.firstName} {member.lastName}</span>
                          </div>
                        </TableCell>
                        <TableCell>{member.phoneNumber || 'No especificado'}</TableCell>
                        <TableCell>
                          {safeFormatDate(member.birthDate, 'd MMM yyyy', { locale: es })}
                        </TableCell>
                        <TableCell>
                          {member.deathDate
                            ? safeFormatDate(member.deathDate, 'd MMM yyyy', { locale: es })
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const isBaptized = member.ordinances?.includes('baptism') ?? false;
                            const baptismDate = safeGetDate(member.baptismDate);
                            if (isBaptized && baptismDate) {
                              return safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: es });
                            } else if (!isBaptized && baptismDate) {
                              return `Programado: ${safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: es })}`;
                            } else {
                              return 'No especificada';
                            }
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {member.ordinances && member.ordinances.length > 0 ? (
                              member.ordinances.map((ordinance, index) => (
                                <Badge key={`${ordinance}-${index}`} variant="outline" className="text-xs">
                                  {resolveOrdinanceLabel(ordinance)}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-sm">Ninguna</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {member.ministeringTeachers && member.ministeringTeachers.length > 0 ? (
                              member.ministeringTeachers.map((teacher, index) => (
                                <Badge key={index} variant="secondary" className="text-xs">
                                  {teacher}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-sm">Sin asignar</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusInfo.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {statusInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant={member.isUrgent ? "destructive" : "outline"}
                            size="sm"
                            onClick={() => handleToggleUrgent(member)}
                            title={member.isUrgent ? "Desmarcar como urgente" : "Marcar como urgente"}
                            className="px-2"
                          >
                            <AlertTriangle className={`h-4 w-4 ${member.isUrgent ? 'text-white' : 'text-orange-500'}`} />
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewProfile(member.id)}
                              title="Ver perfil"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditMember(member)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>¿Eliminar miembro?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta acción no se puede deshacer. Se eliminará permanentemente
                                    a {member.firstName} {member.lastName} de la base de datos.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteMember(member.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Eliminar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-4 md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))
            ) : filteredMembers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm || statusFilter !== 'all'
                    ? 'No se encontraron miembros con los filtros aplicados.'
                    : syncStatus === 'syncing'
                      ? 'Cargando miembros...'
                      : 'No hay miembros registrados. Agrega el primer miembro.'}
                </p>
              </div>
            ) : (
              filteredMembers.map((member) => {
                const statusInfo = statusConfig[member.status];
                const isDeceased = member.status === 'deceased';
                const StatusIcon = statusInfo.icon;

                return (
                  <Card key={member.id} className={isDeceased ? 'bg-muted/40 text-muted-foreground' : undefined}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {member.photoURL ? (
                            <Image
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={40}
                              height={40}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                              <Users className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <h3 className="font-semibold">{member.firstName} {member.lastName}</h3>
                            <p className="text-sm text-muted-foreground">
                              {member.phoneNumber || 'Sin teléfono'}
                            </p>
                          </div>
                        </div>
                        <Badge variant={statusInfo.variant} className="gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {statusInfo.label}
                        </Badge>
                      </div>

                      {safeGetDate(member.birthDate) && (
                        <p className="text-sm text-muted-foreground mb-3">
                          Nacimiento: {safeFormatDate(member.birthDate, 'd MMM yyyy', { locale: es })}
                        </p>
                      )}

                      {member.deathDate && (
                        <p className="text-sm text-muted-foreground mb-3">
                          Fallecimiento: {safeFormatDate(member.deathDate, 'd MMM yyyy', { locale: es })}
                        </p>
                      )}

                      {(() => {
                        const isBaptized = member.ordinances?.includes('baptism') ?? false;
                        const baptismDate = safeGetDate(member.baptismDate);
                        if (baptismDate) {
                          return (
                            <p className="text-sm text-muted-foreground mb-3">
                              Bautismo: {isBaptized ? safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: es }) : `Programado: ${safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: es })}`}
                            </p>
                          );
                        }
                        return null;
                      })()}

                      {/* Ordenanzas en móvil */}
                      {member.ordinances && member.ordinances.length > 0 && (
                        <div className="mb-3">
                          <p className="text-sm font-medium mb-2">Ordenanzas:</p>
                          <div className="flex flex-wrap gap-1">
                            {member.ordinances.map((ordinance, index) => (
                              <Badge key={`${ordinance}-${index}`} variant="outline" className="text-xs">
                                {resolveOrdinanceLabel(ordinance)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Ministrantes en móvil */}
                      <div className="mb-3">
                        <p className="text-sm font-medium mb-2">Ministrantes:</p>
                        <div className="flex flex-wrap gap-1">
                          {member.ministeringTeachers && member.ministeringTeachers.length > 0 ? (
                            member.ministeringTeachers.map((teacher, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {teacher}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">Sin asignar</span>
                          )}
                        </div>
                      </div>

                      {/* Urgente en móvil */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Button
                          variant={member.isUrgent ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => handleToggleUrgent(member)}
                          className="flex-1"
                        >
                          <AlertTriangle className={`mr-2 h-4 w-4 ${member.isUrgent ? 'text-white' : 'text-orange-500'}`} />
                          {member.isUrgent ? 'Urgente' : 'Marcar Urgente'}
                        </Button>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewProfile(member.id)}
                          className="w-full sm:w-auto"
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Ver Perfil
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditMember(member)}
                          className="w-full sm:w-auto"
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full sm:w-auto">
                              <Trash2 className="mr-2 h-4 w-4" />
                              Eliminar
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>¿Eliminar miembro?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta acción no se puede deshacer. Se eliminará permanentemente
                                a {member.firstName} {member.lastName} de la base de datos.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteMember(member.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <Button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-4 right-4 z-50"
          size="icon"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
      )}

      {/* No Cedula Dialog */}
      <Dialog open={noCedulaDialogOpen} onOpenChange={setNoCedulaDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IdCard className="h-5 w-5 text-purple-600" />
              Miembros sin Cédula
            </DialogTitle>
            <DialogDescription>
              Los siguientes miembros aún no tienen registrada su cédula de miembro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : membersWithoutCedula.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                Todos los miembros tienen su cédula registrada.
              </p>
            ) : (
              membersWithoutCedula.map((member) => {
                const statusInfo = statusConfig[member.status];
                const StatusIcon = statusInfo.icon;
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setNoCedulaDialogOpen(false);
                      handleEditMember(member);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {member.photoURL ? (
                        <Image
                          src={member.photoURL}
                          alt={`${member.firstName} ${member.lastName}`}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {member.firstName} {member.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {member.phoneNumber || 'Sin teléfono'}
                        </p>
                      </div>
                    </div>
                    <Badge variant={statusInfo.variant} className="gap-1 flex-shrink-0">
                      <StatusIcon className="h-3 w-3" />
                      {statusInfo.label}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Urgent Reason Dialog */}
      <Dialog open={urgentDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setUrgentDialogOpen(false);
          setUrgentMember(null);
          setUrgentReason('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Marcar como Urgente
            </DialogTitle>
            <DialogDescription>
              {urgentMember && `¿Por qué ${urgentMember.firstName} ${urgentMember.lastName} necesita atención urgente?`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="urgent-reason">Razón de urgencia</Label>
              <Textarea
                id="urgent-reason"
                placeholder="Describe la razón por la cual este miembro requiere atención urgente..."
                value={urgentReason}
                onChange={(e) => setUrgentReason(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setUrgentDialogOpen(false);
                setUrgentMember(null);
                setUrgentReason('');
              }}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={!urgentReason.trim()}
                onClick={() => {
                  if (urgentMember) {
                    handleConfirmUrgent(urgentMember, true, urgentReason.trim());
                  }
                }}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Marcar Urgente
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
