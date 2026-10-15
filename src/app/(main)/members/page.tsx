'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { OfflineImage } from '@/components/offline-image';
import { Plus, Search, Filter, Edit, Trash2, Users, UserCheck, UserX, Eye, ChevronUp, AlertTriangle, KeyRound, Library } from 'lucide-react';
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
import { useI18n } from '@/contexts/i18n-context';
import { usePermission } from '@/hooks/use-permission';
import { useMembersLocal } from '@/hooks/use-members-local';
import type { Member, MemberStatus } from '@/lib/types';
import { MemberForm } from '@/components/members/member-form';
import { updateMember, getMemberById } from '@/lib/members-data';
import { createNotificationsForAll } from '@/lib/notification-helpers';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { safeGetDate, safeFormatDate } from '@/lib/date-utils';
import { differenceInYears } from 'date-fns';
import {
  getMemberLifecycleKind,
  getMemberLifecycleBadgeKey,
  getMemberLifecycleBadgeVariant,
  getDigitalAccountCoverBadges,
} from '@/lib/member-lifecycle';

const statusConfig = {
  active: {
    variant: 'default' as const,
    icon: UserCheck,
    color: 'text-green-600'
  },
  less_active: {
    variant: 'secondary' as const,
    icon: UserX,
    color: 'text-yellow-600'
  },
  inactive: {
    variant: 'destructive' as const,
    icon: UserX,
    color: 'text-red-600'
  },
  deceased: {
    variant: 'secondary' as const,
    icon: UserX,
    color: 'text-muted-foreground'
  }
};

const PAGE_SIZE = 10;

export default function MembersPage() {
  const { toast } = useToast();
  const { barrioOrg, firebaseUser } = useAuth();
  const { t } = useI18n();
  const { canWrite } = usePermission();
  const router = useRouter();
  // Cache local-first; sync manual desde el icono del header
  const {
    members, loading, syncStatus,
    addToLocal, updateInLocal, removeFromLocal,
  } = useMembersLocal();

  const resolveOrdinanceLabel = (ordinance: string) =>
    t(`ordinance.${ordinance}`) || ordinance;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<MemberStatus | 'all'>('all');
  const [baptismFilter, setBaptismFilter] = useState<'all' | 'baptized' | 'not_baptized'>('all');
  const [urgentFilter, setUrgentFilter] = useState<'all' | 'urgent' | 'not_urgent'>('all');
  const [ldsAccountFilter, setLdsAccountFilter] = useState<'all' | 'with' | 'without'>('all');
  const [familySearchFilter, setFamilySearchFilter] = useState<'all' | 'with' | 'without'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [urgentDialogOpen, setUrgentDialogOpen] = useState(false);
  const [urgentMember, setUrgentMember] = useState<Member | null>(null);
  const [urgentReason, setUrgentReason] = useState('');
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const editingRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);





  // Handle edit param from URL
  const handleEditMember = useCallback((member: Member) => {
    editingRef.current = true;
    setEditingMember(member);
    setIsFormOpen(true);
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const returnToParam = urlParams.get('returnTo');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync returnTo from URL search params (external system)
    setReturnTo(returnToParam);
    if (editId && members.length > 0) {
      const memberToEdit = members.find(m => m.id === editId);
      if (memberToEdit) {
        handleEditMember(memberToEdit);
      }
    }
  }, [members, handleEditMember]);

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
      const idToken = await firebaseUser?.getIdToken().catch(() => null);
      if (!idToken) {
        throw new Error('No autenticado');
      }
      const response = await fetch(`/api/members/${memberId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete member');
      }

      // Eliminar del cache local inmediatamente (respuesta instantánea visual)
      removeFromLocal(memberId);

      toast({
        title: t('common.success'),
        description: t('members.toast.deleted')
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('members.toast.deleteError');
      toast({
        title: t('common.error'),
        description: message,
        variant: 'destructive'
      });
    }
  };

  const handleFormClose = (savedMember?: Member | null) => {
    const wasEditing = editingRef.current;
    editingRef.current = false;
    setIsFormOpen(false);
    setEditingMember(null);

    // Si se guardó/creó un miembro, actualizar localmente
    if (savedMember) {
      // Re-fetch del server para obtener datos reales con Timestamps correctos
      getMemberById(savedMember.id).then((fresh) => {
        if (!fresh) return;
        if (wasEditing) {
          updateInLocal(fresh);
        } else {
          addToLocal(fresh);
        }
      }).catch(() => {
        // Fallback: usar los datos que tenemos
        if (wasEditing) {
          updateInLocal(savedMember);
        } else {
          addToLocal(savedMember);
        }
      });
    }

    if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      router.push(returnTo);
      return;
    }
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
            title: t('members.notification.urgentTitle'),
            body: t('members.notification.urgentBody', {
              firstName: member.firstName,
              lastName: member.lastName,
              reason,
            }),
            contextType: 'member',
            contextId: member.id,
            actionUrl: '/council'
          }, barrioOrg);
        } catch (notifError) {
          console.error('Error sending urgent notification:', notifError);
        }
      }

      toast({
        title: t('common.success'),
        description: markAsUrgent
          ? t('members.toast.markedUrgent', { firstName: member.firstName, lastName: member.lastName })
          : t('members.toast.unmarkedUrgent', { firstName: member.firstName, lastName: member.lastName }),
      });

      setUrgentDialogOpen(false);
      setUrgentMember(null);
      setUrgentReason('');

      // Actualizar localmente sin refetch
      updateInLocal({ ...member, isUrgent: markAsUrgent, urgentReason: markAsUrgent ? reason : '' });
    } catch (error) {
      console.error('Error toggling urgent:', error);
      toast({
        title: t('common.error'),
        description: t('members.toast.urgentUpdateError'),
        variant: 'destructive',
      });
    }
  };



  const filteredMembers = members.filter(member => {
    const firstName = (member.firstName ?? '').toString().toLowerCase();
    const lastName = (member.lastName ?? '').toString().toLowerCase();
    const term = searchTerm.toLowerCase();
    const matchesSearch = firstName.includes(term) || lastName.includes(term);
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

    const hasLds = member.hasLdsAccount === true;
    const matchesLds = ldsAccountFilter === 'all' ||
      (ldsAccountFilter === 'with' && hasLds) ||
      (ldsAccountFilter === 'without' && !hasLds);

    const hasFs = member.hasFamilySearchAccount === true;
    const matchesFamilySearch = familySearchFilter === 'all' ||
      (familySearchFilter === 'with' && hasFs) ||
      (familySearchFilter === 'without' && !hasFs);

    return matchesSearch && matchesStatus && matchesBaptism && matchesUrgent && matchesLds && matchesFamilySearch;
  });

  const visibleMembers = useMemo(
    () => filteredMembers.slice(0, visibleCount),
    [filteredMembers, visibleCount],
  );

  const filterSignature = `${searchTerm}|${statusFilter}|${baptismFilter}|${urgentFilter}|${ldsAccountFilter}|${familySearchFilter}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (filterSignature !== prevFilterSignature) {
    setPrevFilterSignature(filterSignature);
    setVisibleCount(PAGE_SIZE);
  }

  const [prevFilteredMembersLength, setPrevFilteredMembersLength] = useState(filteredMembers.length);
  if (filteredMembers.length !== prevFilteredMembersLength) {
    setPrevFilteredMembersLength(filteredMembers.length);
    if (filteredMembers.length === 0) {
      setVisibleCount(0);
    } else {
      setVisibleCount((prev) => {
        const next = Math.max(prev, PAGE_SIZE);
        return Math.min(next, filteredMembers.length);
      });
    }
  }

  useEffect(() => {
    const node = loadMoreTriggerRef.current;
    if (!node) return;
    if (loading) return;
    if (visibleCount >= filteredMembers.length) return;

    if (typeof IntersectionObserver === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fallback sin IntersectionObserver (platform API no disponible)
      setVisibleCount((prev) => {
        const next = Math.min(prev + PAGE_SIZE, filteredMembers.length);
        return next === prev ? prev : next;
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => {
            const next = Math.min(prev + PAGE_SIZE, filteredMembers.length);
            return next === prev ? prev : next;
          });
        }
      });
    }, { rootMargin: '0px 0px 200px 0px' });

    observer.observe(node);

    return () => observer.disconnect();
  }, [loading, visibleCount, filteredMembers.length]);

  const memberCounts = {
    active: members.filter(m => m.status === 'active').length,
    less_active: members.filter(m => m.status === 'less_active').length,
    inactive: members.filter(m => m.status === 'inactive').length,
    urgent: members.filter(m => m.isUrgent).length,
    withoutLdsAccount: members.filter(m => m.hasLdsAccount !== true).length,
    withoutFamilySearch: members.filter(m => m.hasFamilySearchAccount !== true).length,
    total: members.length
  };

  return (
    <section className="page-section">
      {/* Header */}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-fluid-title font-semibold tracking-tight">{t('members.title')}</h1>
          <p className="text-balance text-fluid-subtitle text-muted-foreground">
            {t('members.subtitle')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            {canWrite ? (
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                {t('members.addMember')}
              </Button>
            </DialogTrigger>
            ) : null}
            <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-4 sm:left-[50%] sm:top-1/2 sm:h-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
              <DialogHeader>
                <DialogTitle>
                  {editingMember ? t('members.dialog.editTitle') : t('members.dialog.addTitle')}
                </DialogTitle>
                <DialogDescription>
                  {editingMember
                    ? t('members.dialog.editDescription')
                    : t('members.dialog.addDescription')}
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.total')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberCounts.total}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.totalDesc')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.active')}</CardTitle>
            <UserCheck className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{memberCounts.active}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.activeDesc')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.lessActive')}</CardTitle>
            <UserX className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{memberCounts.less_active}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.lessActiveDesc')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.inactive')}</CardTitle>
            <UserX className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{memberCounts.inactive}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.inactiveDesc')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.urgent')}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{memberCounts.urgent}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.urgentDesc')}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/50 ${
            ldsAccountFilter === 'without' ? 'ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : ''
          }`}
          onClick={() => setLdsAccountFilter((prev) => (prev === 'without' ? 'all' : 'without'))}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setLdsAccountFilter((prev) => (prev === 'without' ? 'all' : 'without'));
            }
          }}
          aria-pressed={ldsAccountFilter === 'without'}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.withoutLds')}</CardTitle>
            <KeyRound className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{memberCounts.withoutLdsAccount}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.withoutLdsDesc')}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/50 ${
            familySearchFilter === 'without' ? 'ring-2 ring-teal-500 bg-teal-50/50 dark:bg-teal-950/20' : ''
          }`}
          onClick={() => setFamilySearchFilter((prev) => (prev === 'without' ? 'all' : 'without'))}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setFamilySearchFilter((prev) => (prev === 'without' ? 'all' : 'without'));
            }
          }}
          aria-pressed={familySearchFilter === 'without'}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('members.stats.withoutFamilySearch')}</CardTitle>
            <Library className="h-4 w-4 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-600">{memberCounts.withoutFamilySearch}</div>
            <p className="text-xs text-muted-foreground">{t('members.stats.withoutFamilySearchDesc')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t('members.listTitle')}</CardTitle>
          <CardDescription>
            {t('members.listDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder={t('members.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value: MemberStatus | 'all') => setStatusFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t('members.filterStatusPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('members.filter.allStatuses')}</SelectItem>
                <SelectItem value="active">{t('members.filter.active')}</SelectItem>
                <SelectItem value="less_active">{t('members.filter.lessActive')}</SelectItem>
                <SelectItem value="inactive">{t('members.filter.inactive')}</SelectItem>
                <SelectItem value="deceased">{t('members.filter.deceased')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={baptismFilter} onValueChange={(value: 'all' | 'baptized' | 'not_baptized') => setBaptismFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t('members.filterBaptismPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="baptized">{t('members.filter.baptized')}</SelectItem>
                <SelectItem value="not_baptized">{t('members.filter.notBaptizedFuture')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={urgentFilter} onValueChange={(value: 'all' | 'urgent' | 'not_urgent') => setUrgentFilter(value)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <AlertTriangle className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t('members.filterUrgentPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="urgent">{t('members.filter.urgent')}</SelectItem>
                <SelectItem value="not_urgent">{t('members.filter.notUrgent')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={ldsAccountFilter}
              onValueChange={(value: 'all' | 'with' | 'without') => setLdsAccountFilter(value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <KeyRound className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t('members.filterLdsPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="with">{t('members.filter.withLds')}</SelectItem>
                <SelectItem value="without">{t('members.filter.withoutLds')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={familySearchFilter}
              onValueChange={(value: 'all' | 'with' | 'without') => setFamilySearchFilter(value)}
            >
              <SelectTrigger className="w-full sm:w-[200px]">
                <Library className="mr-2 h-4 w-4" />
                <SelectValue placeholder={t('members.filterFamilySearchPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="with">{t('members.filter.withFamilySearch')}</SelectItem>
                <SelectItem value="without">{t('members.filter.withoutFamilySearch')}</SelectItem>
              </SelectContent>
            </Select>

          </div>

          {/* Desktop Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('common.phone')}</TableHead>
                  <TableHead>{t('members.col.birthDate')}</TableHead>
                  <TableHead>{t('members.col.deathDate')}</TableHead>
                  <TableHead>{t('members.col.baptismDate')}</TableHead>
                  <TableHead>{t('members.col.ordinances')}</TableHead>
                  <TableHead>{t('members.col.ministering')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-center">{t('members.col.urgent')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
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
                      {searchTerm ||
                      statusFilter !== 'all' ||
                      baptismFilter !== 'all' ||
                      urgentFilter !== 'all' ||
                      ldsAccountFilter !== 'all' ||
                      familySearchFilter !== 'all'
                        ? t('members.empty.filtered')
                        : syncStatus === 'syncing'
                          ? t('members.empty.loading')
                          : t('members.empty.none')}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleMembers.map((member) => {
                    const statusInfo = statusConfig[member.status] ?? statusConfig.active;
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
                              <OfflineImage
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
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{member.firstName} {member.lastName}</span>
                                {member.isUrgent && (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 font-normal gap-0.5">
                                    <AlertTriangle className="h-3 w-3" />
                                    {t('members.badge.urgent')}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(() => {
                                  const kind = getMemberLifecycleKind(member);
                                  const accounts = getDigitalAccountCoverBadges(member, kind);
                                  return (
                                    <>
                                      <Badge
                                        variant={getMemberLifecycleBadgeVariant(kind)}
                                        className="text-[10px] px-1.5 py-0 h-5 font-normal"
                                      >
                                        {t(getMemberLifecycleBadgeKey(kind))}
                                      </Badge>
                                      {accounts.showLds && (
                                        <Badge
                                          variant={accounts.hasLds ? 'default' : 'outline'}
                                          className="text-[10px] px-1.5 py-0 h-5 font-normal"
                                        >
                                          {accounts.hasLds
                                            ? t('converts.badge.ldsYes')
                                            : t('converts.badge.ldsNo')}
                                        </Badge>
                                      )}
                                      {accounts.showFamilySearch && (
                                        <Badge
                                          variant={accounts.hasFamilySearch ? 'default' : 'outline'}
                                          className="text-[10px] px-1.5 py-0 h-5 font-normal"
                                        >
                                          {accounts.hasFamilySearch
                                            ? t('converts.badge.familySearchYes')
                                            : t('converts.badge.familySearchNo')}
                                        </Badge>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{member.phoneNumber || t('common.notSpecified')}</TableCell>
                        <TableCell>
                          {safeFormatDate(member.birthDate, 'd MMM yyyy', { locale: getDateFnsLocale() })}
                        </TableCell>
                        <TableCell>
                          {member.deathDate
                            ? safeFormatDate(member.deathDate, 'd MMM yyyy', { locale: getDateFnsLocale() })
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const isBaptized = member.ordinances?.includes('baptism') ?? false;
                            const baptismDate = safeGetDate(member.baptismDate);
                            if (isBaptized && baptismDate) {
                              return safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: getDateFnsLocale() });
                            } else if (!isBaptized && baptismDate) {
                              return t('members.baptismScheduled', {
                                date: safeFormatDate(member.baptismDate, 'd MMM yyyy', { locale: getDateFnsLocale() }),
                              });
                            } else {
                              return t('common.notSpecifiedFeminine');
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
                              <span className="text-muted-foreground text-sm">{t('common.none')}</span>
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
                              <span className="text-muted-foreground text-sm">{t('common.unassigned')}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusInfo.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {t(`member.status.${member.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {canWrite ? (
                          <Button
                            variant={member.isUrgent ? "destructive" : "outline"}
                            size="sm"
                            onClick={() => handleToggleUrgent(member)}
                            title={member.isUrgent ? t('members.unmarkUrgent') : t('members.markUrgent')}
                            className="px-2"
                          >
                            <AlertTriangle className={`h-4 w-4 ${member.isUrgent ? 'text-white' : 'text-orange-500'}`} />
                          </Button>
                          ) : (
                            member.isUrgent ? <AlertTriangle className="h-4 w-4 text-orange-500" /> : null
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewProfile(member.id)}
                              title={t('common.viewProfileTitle')}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canWrite && (
                            <>
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
                                  <AlertDialogTitle>{t('members.deleteDialog.title')}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t('members.deleteDialog.description', {
                                      firstName: member.firstName,
                                      lastName: member.lastName,
                                    })}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteMember(member.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    {t('common.delete')}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            </>
                            )}
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
                  {searchTerm ||
                  statusFilter !== 'all' ||
                  baptismFilter !== 'all' ||
                  urgentFilter !== 'all' ||
                  ldsAccountFilter !== 'all' ||
                  familySearchFilter !== 'all'
                    ? t('members.empty.filtered')
                    : syncStatus === 'syncing'
                      ? t('members.empty.loading')
                      : t('members.empty.none')}
                </p>
              </div>
            ) : (
              visibleMembers.map((member) => {
                const statusInfo = statusConfig[member.status] ?? statusConfig.active;
                const isDeceased = member.status === 'deceased';
                const StatusIcon = statusInfo.icon;

                const isBaptized = member.ordinances?.includes('baptism') ?? false;
                const baptismDate = safeGetDate(member.baptismDate);
                const birthDate = safeGetDate(member.birthDate);
                const age = birthDate ? differenceInYears(new Date(), birthDate) : null;
                const hasTeachers = !!(member.ministeringTeachers && member.ministeringTeachers.length > 0);
                const badgeClass = 'text-[10px] px-1.5 py-0 h-5 font-normal';
                const lifecycleKind = getMemberLifecycleKind(member);
                const lifecycleLabel = t(getMemberLifecycleBadgeKey(lifecycleKind));
                const lifecycleVariant = getMemberLifecycleBadgeVariant(lifecycleKind);
                const accountBadges = getDigitalAccountCoverBadges(member, lifecycleKind);

                return (
                  <Card
                    key={member.id}
                    className={
                      isDeceased
                        ? 'bg-muted/40 text-muted-foreground'
                        : member.isUrgent
                          ? 'border-orange-500/40 bg-orange-500/[0.03]'
                          : undefined
                    }
                  >
                    <CardContent className="pt-4">
                      {/* Portada: foto, nombre, contacto y estado */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-start gap-3 min-w-0">
                          {member.photoURL ? (
                            <OfflineImage
                              src={member.photoURL}
                              alt={`${member.firstName} ${member.lastName}`}
                              width={48}
                              height={48}
                              className="w-12 h-12 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <Users className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <h3 className="font-semibold leading-snug">
                              {member.firstName} {member.lastName}
                            </h3>
                            {member.phoneNumber && (
                              <a
                                href={`tel:${member.phoneNumber.replace(/\D/g, '')}`}
                                className="text-sm text-primary hover:underline"
                              >
                                {member.phoneNumber}
                              </a>
                            )}
                            {(birthDate || age != null) && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {birthDate
                                  ? t('members.birthLabel', {
                                      date: safeFormatDate(member.birthDate, 'd MMM yyyy', {
                                        locale: getDateFnsLocale(),
                                      }),
                                    })
                                  : null}
                                {age != null ? ` · ${t('members.ageLabel', { age })}` : null}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant={statusInfo.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {t(`member.status.${member.status}`)}
                          </Badge>
                          {member.isUrgent && (
                            <Badge variant="destructive" className={`${badgeClass} gap-0.5`}>
                              <AlertTriangle className="h-3 w-3" />
                              {t('members.badge.urgent')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Etiquetas de identificación del miembro */}
                      <div className="mb-3 flex flex-wrap gap-1">
                        <Badge variant={lifecycleVariant} className={badgeClass}>
                          {lifecycleLabel}
                        </Badge>
                        {accountBadges.showLds && (
                          <Badge
                            variant={accountBadges.hasLds ? 'default' : 'outline'}
                            className={badgeClass}
                          >
                            {accountBadges.hasLds
                              ? t('converts.badge.ldsYes')
                              : t('converts.badge.ldsNo')}
                          </Badge>
                        )}
                        {accountBadges.showFamilySearch && (
                          <Badge
                            variant={accountBadges.hasFamilySearch ? 'default' : 'outline'}
                            className={badgeClass}
                          >
                            {accountBadges.hasFamilySearch
                              ? t('converts.badge.familySearchYes')
                              : t('converts.badge.familySearchNo')}
                          </Badge>
                        )}
                      </div>

                      {member.deathDate && (
                        <p className="text-sm text-muted-foreground mb-2">
                          {t('members.deathLabel', {
                            date: safeFormatDate(member.deathDate, 'd MMM yyyy', {
                              locale: getDateFnsLocale(),
                            }),
                          })}
                        </p>
                      )}

                      {baptismDate && (
                        <p className="text-sm text-muted-foreground mb-2">
                          {isBaptized
                            ? t('members.baptismLabel', {
                                date: safeFormatDate(member.baptismDate, 'd MMM yyyy', {
                                  locale: getDateFnsLocale(),
                                }),
                              })
                            : t('members.baptismLabel', {
                                date: t('members.baptismScheduled', {
                                  date: safeFormatDate(member.baptismDate, 'd MMM yyyy', {
                                    locale: getDateFnsLocale(),
                                  }),
                                }),
                              })}
                        </p>
                      )}

                      {/* Ordenanzas: nombres reales, no solo el conteo */}
                      {member.ordinances && member.ordinances.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">
                            {t('members.ordinancesLabel')}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {member.ordinances.map((ordinance, index) => (
                              <Badge key={`${ordinance}-${index}`} variant="outline" className="text-xs">
                                {resolveOrdinanceLabel(ordinance)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Ministrantes: nombres reales; alerta solo si faltan */}
                      <div className="mb-3">
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">
                          {t('members.ministeringLabel')}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {hasTeachers ? (
                            member.ministeringTeachers!.map((teacher, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {teacher}
                              </Badge>
                            ))
                          ) : (
                            <Badge
                              variant="outline"
                              className={`${badgeClass} border-amber-500/50 text-amber-700 dark:text-amber-400`}
                            >
                              {t('members.badge.ministeringNo')}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Urgente en móvil */}
                      {canWrite && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Button
                          variant={member.isUrgent ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => handleToggleUrgent(member)}
                          className="flex-1"
                        >
                          <AlertTriangle className={`mr-2 h-4 w-4 ${member.isUrgent ? 'text-white' : 'text-orange-500'}`} />
                          {member.isUrgent ? t('members.col.urgent') : t('members.markUrgentButton')}
                        </Button>
                      </div>
                      )}

                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewProfile(member.id)}
                          className="w-full sm:w-auto"
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          {t('common.viewProfile')}
                        </Button>
                        {canWrite && (
                        <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditMember(member)}
                          className="w-full sm:w-auto"
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          {t('common.edit')}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full sm:w-auto">
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('common.delete')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('members.deleteDialog.title')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('members.deleteDialog.description', {
                                  firstName: member.firstName,
                                  lastName: member.lastName,
                                })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteMember(member.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Infinite Scroll Trigger */}
          <div ref={loadMoreTriggerRef} className="h-1" aria-hidden="true" />

          {!loading && filteredMembers.length > 0 && visibleCount >= filteredMembers.length && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              {t('members.empty.endOfList')}
            </div>
          )}
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
              {t('members.urgentDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {urgentMember && t('members.urgentDialog.description', {
                firstName: urgentMember.firstName,
                lastName: urgentMember.lastName,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="urgent-reason">{t('members.urgentDialog.reasonLabel')}</Label>
              <Textarea
                id="urgent-reason"
                placeholder={t('members.urgentDialog.reasonPlaceholder')}
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
                {t('common.cancel')}
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
                {t('members.urgentDialog.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
