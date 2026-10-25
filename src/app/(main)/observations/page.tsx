'use client';



import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { OfflineImage } from '@/components/offline-image';

import type { ChangeEvent } from 'react';

import { Users, AlertTriangle, UserX, UserCheck, Eye, ChevronUp, HeartPulse, Plus, Trash2, Loader2, Check, ChevronsUpDown, X, Pencil, MapPin, BadgeCheck, CalendarClock, FileX2, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ObservationListDialog,
  OBSERVATION_LIST_PAGE_SIZE,
} from '@/components/observations/observation-list-dialog';

import {

  Card,

  CardContent,

  CardDescription,

  CardHeader,

  CardTitle,

} from '@/components/ui/card';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { Label } from '@/components/ui/label';

import { Checkbox } from '@/components/ui/checkbox';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

import { cn } from '@/lib/utils';

import {
  resolveLocationCodeToAddress,
  reverseGeocodeToAddress,
  looksLikeCoordinates,
} from '@/lib/geocode-address';

import { saveCurrentDeviceGpsPermission, getCurrentDevicePermissions } from '@/lib/device-permissions';

import { useForm, useWatch } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { z } from 'zod';

import { useToast } from '@/hooks/use-toast';

import { useAuth } from '@/contexts/auth-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

import type { Member, Companionship, Family, HealthConcern } from '@/lib/types';

import { getMembersByStatus } from '@/lib/members-data';

import { getAge, safeGetDate } from '@/lib/date-utils';
import { offlineDataKey, readOfflineData, writeOfflineData } from '@/lib/offline-data-store';

import {
  getTempleRecommendDaysLeft,
  getTempleRecommendStatus,
} from '@/lib/temple-recommend';

import { fetchHealthConcerns, createHealthConcern, deleteHealthConcern, updateHealthConcern } from '@/lib/health-concerns';

import { format, subMonths } from 'date-fns';

import { getDateFnsLocale } from "@/lib/i18n-date";

import { useRouter } from 'next/navigation';

import { query, orderBy, where } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';

import { ministeringCollection } from '@/lib/collections';



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

const HEALTH_PHOTO_MAX_SIZE = 5 * 1024 * 1024;

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const createHealthConcernSchema = (t: TranslateFn) =>
  z.object({
    firstName: z.string().min(2, { message: t('observations.health.validation.firstName') }),
    lastName: z.string().min(2, { message: t('observations.health.validation.lastName') }),
    // Address may be empty while using location-code mode; final length is checked after resolve.
    address: z.string(),
    observation: z.string().min(5, { message: t('observations.health.validation.observation') }),
    helperIds: z.array(z.string()),
    /** Free-text helpers (Sociedad de Socorro). Comma-separated names. */
    helperNamesText: z.string(),
  });

type HealthConcernFormValues = z.infer<ReturnType<typeof createHealthConcernSchema>>;
const DEFAULT_HEALTH_FORM_VALUES: HealthConcernFormValues = {
  firstName: '',
  lastName: '',
  address: '',
  observation: '',
  helperIds: [],
  helperNamesText: '',
};

/** Split free-text helper names (comma / semicolon / newline). */
const parseHelperNamesText = (text: string): string[] =>
  text
    .split(/[,;\n]+/)
    .map((name) => name.trim())
    .filter(Boolean);

/** Display labels for helpers: prefer member lookup, then saved names (manual RS entry). */
const getHealthHelperLabels = (
  concern: HealthConcern,
  membersById: Map<string, Member>,
  unregisteredLabel: string
): string[] => {
  const helperIds = Array.isArray(concern.helperIds) ? concern.helperIds.filter(Boolean) : [];
  const helperNames = Array.isArray(concern.helperNames)
    ? concern.helperNames.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
    : [];

  if (helperIds.length > 0) {
    return helperIds.map((helperId, index) => {
      const helper = membersById.get(helperId);
      if (helper) return `${helper.firstName} ${helper.lastName}`.trim();
      return helperNames[index] || unregisteredLabel;
    });
  }

  // Manual entry (e.g. Sociedad de Socorro): only names, no member ids
  return helperNames;
};

const getInitials = (first: string, last: string) => `${(first?.[0] ?? '').toUpperCase()}${(last?.[0] ?? '').toUpperCase()}`.trim() || 'PS';

const renderPhoneWithAge = (member: Member, fallback: string, ageLabel: (age: number) => string) => {
  let text = member.phoneNumber || fallback;
  const age = getAge(member.birthDate);
  if (age !== null) {
    text += ` - ${ageLabel(age)}`;
  }
  return text;
};

/** Texto sin acentos ni mayúsculas para buscar dentro de los listados. */
const normalizeListSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const matchesMemberSearch = (
  person: Pick<Member, 'firstName' | 'lastName'>,
  term: string
): boolean =>
  term.length === 0 ||
  normalizeListSearch(`${person.firstName} ${person.lastName}`).includes(term);

const matchesTextSearch = (
  values: Array<string | undefined | null>,
  term: string
): boolean =>
  term.length === 0 ||
  normalizeListSearch(values.filter(Boolean).join(' ')).includes(term);

function ObservationListSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9"
      />
    </div>
  );
}



const formatRecommendDate = (value: unknown): string => {
  const date = safeGetDate(value);
  if (!date) return '';
  return format(date, 'd MMM yyyy', { locale: getDateFnsLocale() });
};

type ObservationListKey =
  | 'health'
  | 'withoutEndowment'
  | 'withoutElder'
  | 'withoutHigherPriesthood'
  | 'withoutMinistering'
  | 'withTempleRecommend'
  | 'withoutTempleRecommend'
  | 'templeRecommendExpiring'
  | 'inactiveNewConverts'
  | 'inactive'
  | 'familyFocus'
  | 'problematic';

type ObservationsCacheSnapshot = {
  members: Member[];
  companionships: Companionship[];
  healthConcerns: HealthConcern[];
  savedAt?: number;
};

function OrdinancesBadges({ ordinances, t }: { ordinances?: string[]; t: TranslateFn }) {
  if (!ordinances || ordinances.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('common.none')}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {ordinances.map((ordinance) => (
        <Badge key={ordinance} variant="outline" className="text-[10px]">
          {t(`ordinance.${ordinance}`)}
        </Badge>
      ))}
    </div>
  );
}

function TempleRecommendExpirationBadge({ expiration, t }: { expiration: unknown; t: TranslateFn }) {
  const daysLeft = getTempleRecommendDaysLeft(expiration);
  const dateLabel = formatRecommendDate(expiration);

  if (daysLeft === null) {
    return <span className="text-xs text-muted-foreground">{t('common.notSpecified')}</span>;
  }

  const expired = daysLeft < 0;

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {dateLabel && (
        <span>{t('observations.templeRecommend.expiresOn', { date: dateLabel })}</span>
      )}
      <Badge
        variant={expired || daysLeft <= 5 ? 'destructive' : 'secondary'}
        className="text-[10px]"
      >
        {expired
          ? t('observations.templeRecommend.expired')
          : t('observations.templeRecommend.daysLeft', { days: daysLeft })}
      </Badge>
    </div>
  );
}

function MemberObservationRow({
  member,
  extra,
  onViewProfile,
  t,
}: {
  member: Member;
  extra?: ReactNode;
  onViewProfile: (memberId: string) => void;
  t: TranslateFn;
}) {
  const statusInfo = statusConfig[member.status] ?? statusConfig.active;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="flex items-start gap-3 py-3">
      {member.photoURL ? (
        <OfflineImage
          src={member.photoURL}
          alt={`${member.firstName} ${member.lastName}`}
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Users className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-tight">
          {member.firstName} {member.lastName}
        </p>
        <p className="text-xs text-muted-foreground">
          {renderPhoneWithAge(member, t('common.notSpecified'), (age) =>
            t('observations.ageSuffix', { age })
          )}
        </p>
        {extra}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Badge variant={statusInfo.variant} className="gap-1">
          <StatusIcon className="h-3 w-3" />
          {t(`member.status.${member.status}`)}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewProfile(member.id)}
          title={t('common.viewProfile')}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ObservationsPage() {

  const { user, loading: authLoading, barrioOrg, organizacion } = useAuth();
  const { canWrite } = usePermission();
  const { t } = useI18n();

  const orgKey = `${organizacion} ${barrioOrg}`.toLowerCase();
  const isElderesQuorum = orgKey.includes('élder') || orgKey.includes('elder');
  /** Sociedad de Socorro: free-text helpers instead of member picker */
  const isSociedadSocorro =
    orgKey.includes('socorro') ||
    orgKey.includes('relief society') ||
    orgKey.includes('relief-society');

  const { toast } = useToast();

  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);

  const [companionships, setCompanionships] = useState<Companionship[]>([]);

  const [loading, setLoading] = useState(true);

  const [showScrollTop, setShowScrollTop] = useState(false);



  const [healthConcerns, setHealthConcerns] = useState<HealthConcern[]>([]);

  const [healthLoading, setHealthLoading] = useState(true);

  const [healthDialogOpen, setHealthDialogOpen] = useState(false);

  const [savingHealthConcern, setSavingHealthConcern] = useState(false);

  const [deletingHealthConcernId, setDeletingHealthConcernId] = useState<string | null>(null);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [helperPickerOpen, setHelperPickerOpen] = useState(false);

  const [editingHealthConcern, setEditingHealthConcern] = useState<HealthConcern | null>(null);

  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);

  /** Optional mode: enter lat/lng or Plus Code instead of typing the address */
  const [useLocationCode, setUseLocationCode] = useState(false);

  const [locationCode, setLocationCode] = useState('');

  const [resolvingCode, setResolvingCode] = useState(false);

  const [gettingLocation, setGettingLocation] = useState(false);

  /** Pre-creation popup: choose an existing member or add manually */
  const [healthPickerOpen, setHealthPickerOpen] = useState(false);

  const [healthPickerStep, setHealthPickerStep] = useState<'options' | 'memberList'>('options');

  /** Solo un listado abierto a la vez; se pagina de 15 en 15 desde el cache local */
  const [openList, setOpenList] = useState<ObservationListKey | null>(null);

  const [listPage, setListPage] = useState(1);

  /** Búsqueda y filtro del listado abierto; se reinician al abrir o cerrar */
  const [listSearch, setListSearch] = useState('');

  const [expiringListFilter, setExpiringListFilter] = useState<'all' | 'expiring_soon' | 'expired'>('all');



  const photoInputRef = useRef<HTMLInputElement>(null);

  const observationsCacheKey = useMemo(
    () => (barrioOrg ? offlineDataKey('observations', barrioOrg) : null),
    [barrioOrg]
  );

  const hydratedCacheKeyRef = useRef<string | null>(null);

  const hasServerSnapshotRef = useRef(false);

  const healthForm = useForm<HealthConcernFormValues>({

    resolver: zodResolver(createHealthConcernSchema(t)),

    defaultValues: DEFAULT_HEALTH_FORM_VALUES,

  });

  const watchFirstName = useWatch({ control: healthForm.control, name: 'firstName' });

  const watchLastName = useWatch({ control: healthForm.control, name: 'lastName' });

  const isEditingHealthConcern = Boolean(editingHealthConcern);



  const membersById = useMemo(() => {

    const map = new Map<string, Member>();

    members.forEach(member => {

      map.set(member.id, member);

    });

    return map;

  }, [members]);



  const fetchMembers = useCallback(async (opts?: { quiet?: boolean }) => {

    if (authLoading || !user) return;



    if (!opts?.quiet) setLoading(true);

    try {

      const allMembers = await getMembersByStatus(undefined, { barrioOrg });

      hasServerSnapshotRef.current = true;

      setMembers(allMembers);

    } catch (error) {

      console.error('Error fetching members:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadMembersError'),

        variant: 'destructive'

      });

    } finally {

      setLoading(false);

    }

  }, [authLoading, user, toast, t, barrioOrg]);



  const fetchCompanionships = useCallback(async () => {

    try {

      const q = query(
        ministeringCollection,
        where('barrioOrg', '==', barrioOrg),
        orderBy('companions')
      );

      const snapshot = await getDocs(q);

      const comps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Companionship));

      hasServerSnapshotRef.current = true;

      setCompanionships(comps);

    } catch (error) {

      console.error('Error fetching companionships:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadCompanionshipsError'),

        variant: 'destructive'

      });

    }

  }, [toast, t, barrioOrg]);
  const loadHealthConcerns = useCallback(async (opts?: { quiet?: boolean }) => {

    if (authLoading || !user) {

      return;

    }



    if (!opts?.quiet) setHealthLoading(true);



    try {

      const healthData = await fetchHealthConcerns(barrioOrg);

      hasServerSnapshotRef.current = true;

      setHealthConcerns(healthData);

    } catch (error) {

      console.error('Error fetching health concerns:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.loadHealthError'),

        variant: 'destructive'

      });

    } finally {

      setHealthLoading(false);

    }



  }, [authLoading, user, toast, t, barrioOrg]);










  const hydrateFromCache = useCallback(() => {
    if (!observationsCacheKey) return false;

    const cached = readOfflineData<ObservationsCacheSnapshot>(observationsCacheKey);
    if (!cached) return false;

    if (Array.isArray(cached.members)) setMembers(cached.members);
    if (Array.isArray(cached.companionships)) setCompanionships(cached.companionships);
    if (Array.isArray(cached.healthConcerns)) setHealthConcerns(cached.healthConcerns);
    setLoading(false);
    setHealthLoading(false);
    return true;
  }, [observationsCacheKey]);

  // Cache first (works offline), then refresh in the background.
  // Cloud Function sync signals call the same fetchers via useOnManualRefresh below.
  useEffect(() => {
    if (authLoading || !user || !observationsCacheKey) return;
    if (hydratedCacheKeyRef.current === observationsCacheKey) return;

    hydratedCacheKeyRef.current = observationsCacheKey;
    const hadCache = hydrateFromCache();

    if (!hadCache) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cambio de barrioOrg: limpiar el tenant anterior antes del fetch
      setMembers([]);
      setCompanionships([]);
      setHealthConcerns([]);
    }

    void (async () => {
      await Promise.all([
        fetchMembers({ quiet: hadCache }),
        fetchCompanionships(),
        loadHealthConcerns({ quiet: hadCache }),
      ]);
    })();
  }, [
    authLoading,
    user,
    observationsCacheKey,
    hydrateFromCache,
    fetchMembers,
    fetchCompanionships,
    loadHealthConcerns,
  ]);

  // Keep the local snapshot fresh for the next visit / offline use
  useEffect(() => {
    if (!observationsCacheKey || !hasServerSnapshotRef.current) return;

    writeOfflineData(observationsCacheKey, {
      members,
      companionships,
      healthConcerns,
      savedAt: Date.now(),
    } satisfies ObservationsCacheSnapshot);
  }, [observationsCacheKey, members, companionships, healthConcerns]);

  useOnManualRefresh(async () => {
    await Promise.all([
      fetchMembers({ quiet: true }),
      fetchCompanionships(),
      loadHealthConcerns(),
    ]);
    return true;
  });




  useEffect(() => {

    const handleScroll = () => {

      setShowScrollTop(window.scrollY > 300);

    };

    window.addEventListener('scroll', handleScroll);

    return () => window.removeEventListener('scroll', handleScroll);

  }, []);



  const handleViewProfile = (memberId: string) => {

    router.push(`/members/${memberId}`);

  };



  const resetHealthForm = () => {

    healthForm.reset(DEFAULT_HEALTH_FORM_VALUES);

    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }

    setPhotoPreview(null);

    setPhotoFile(null);

    setHelperPickerOpen(false);

    setEditingHealthConcern(null);

    setRemoveExistingPhoto(false);

    setUseLocationCode(false);

    setLocationCode('');

    setResolvingCode(false);

    setGettingLocation(false);

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

  };

  const applyResolvedAddress = (formattedAddress: string) => {
    healthForm.setValue('address', formattedAddress, { shouldValidate: true });
    setUseLocationCode(false);
    setLocationCode('');
  };

  const handleResolveLocationCode = async (codeOverride?: string): Promise<string | null> => {
    const code = (codeOverride ?? locationCode).trim();
    if (!code) {
      toast({
        title: t('common.error'),
        description: t('memberForm.toast.locationCodeEmpty'),
        variant: 'destructive',
      });
      return null;
    }

    setResolvingCode(true);
    try {
      const address = await resolveLocationCodeToAddress(code);
      if (!address) {
        toast({
          title: t('memberForm.toast.addressLookupError'),
          description: t('memberForm.toast.locationCodeNotFound'),
          variant: 'destructive',
        });
        return null;
      }
      applyResolvedAddress(address);
      toast({
        title: t('memberForm.toast.locationCodeResolvedTitle'),
        description: t('memberForm.toast.locationCodeResolvedDesc'),
      });
      return address;
    } catch (error) {
      console.error('Error resolving location code:', error);
      toast({
        title: t('common.error'),
        description: t('memberForm.toast.addressLookupError'),
        variant: 'destructive',
      });
      return null;
    } finally {
      setResolvingCode(false);
    }
  };

  const handleGetCurrentLocation = async () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      toast({
        title: t('memberForm.toast.gpsUnavailableTitle'),
        description: t('memberForm.toast.gpsUnavailableDesc'),
        variant: 'destructive',
      });
      return;
    }

    if (user) {
      try {
        const perms = await getCurrentDevicePermissions(user.uid);
        if (!perms.gpsEnabled) {
          toast({
            title: t('settings.permissions.gps'),
            description: t('memberForm.toast.gpsDisabledInSettings'),
            variant: 'destructive',
          });
          return;
        }
      } catch {
        // If we can't check, let the native prompt be the gate
      }
    }

    setGettingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (user) {
          saveCurrentDeviceGpsPermission(user.uid, true).catch(() => {});
        }

        const { latitude, longitude } = position.coords;
        try {
          const formattedAddress = await reverseGeocodeToAddress(latitude, longitude);
          if (!formattedAddress) {
            setUseLocationCode(true);
            setLocationCode(`${latitude}, ${longitude}`);
            healthForm.setValue('address', '', { shouldValidate: false });
            toast({
              title: t('memberForm.toast.partialAddressTitle'),
              description: t('memberForm.toast.partialAddressDesc'),
            });
            return;
          }
          applyResolvedAddress(formattedAddress);
          toast({
            title: t('memberForm.toast.locationObtainedTitle'),
            description: t('memberForm.toast.locationObtainedDesc'),
          });
        } catch (error) {
          console.error('Error reverse geocoding:', error);
          setUseLocationCode(true);
          setLocationCode(`${latitude}, ${longitude}`);
          healthForm.setValue('address', '', { shouldValidate: false });
          toast({
            title: t('memberForm.toast.partialAddressTitle'),
            description: t('memberForm.toast.partialAddressDesc'),
          });
        } finally {
          setGettingLocation(false);
        }
      },
      (error) => {
        setGettingLocation(false);
        let message = t('memberForm.toast.gpsGenericError');
        if (error.code === error.PERMISSION_DENIED) {
          message = t('memberForm.toast.gpsPermissionDenied');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = t('memberForm.toast.gpsUnavailableNow');
        } else if (error.code === error.TIMEOUT) {
          message = t('memberForm.toast.gpsTimeout');
        }
        toast({
          title: t('memberForm.toast.gpsErrorTitle'),
          description: message,
          variant: 'destructive',
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };



  const handleOpenHealthDialog = (concern?: HealthConcern) => {

    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }

    if (concern) {

      setEditingHealthConcern(concern);

      healthForm.reset({

        firstName: concern.firstName ?? '',

        lastName: concern.lastName ?? '',

        address: concern.address ?? '',

        observation: concern.observation ?? '',

        helperIds: Array.isArray(concern.helperIds) ? concern.helperIds : [],

        helperNamesText: Array.isArray(concern.helperNames)
          ? concern.helperNames.filter(Boolean).join(', ')
          : '',

      });

      setPhotoPreview(concern.photoURL ?? null);

      setPhotoFile(null);

      setRemoveExistingPhoto(false);

      setHelperPickerOpen(false);

      setUseLocationCode(false);

      setLocationCode('');

      setResolvingCode(false);

      setGettingLocation(false);

      if (photoInputRef.current) {

        photoInputRef.current.value = '';

      }

    } else {

      resetHealthForm();

    }

    setHealthDialogOpen(true);

  };

  const handleSelectExistingMember = (member: Member) => {

    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }

    setEditingHealthConcern(null);

    healthForm.reset({

      firstName: member.firstName,

      lastName: member.lastName,

      address: member.address ?? '',

      observation: '',

      helperIds: [],

      helperNamesText: '',

    });

    setPhotoPreview(member.photoURL ?? null);

    setPhotoFile(null);

    setRemoveExistingPhoto(false);

    setHelperPickerOpen(false);

    setUseLocationCode(false);

    setLocationCode('');

    setResolvingCode(false);

    setGettingLocation(false);

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

    setHealthPickerOpen(false);

    setHealthPickerStep('options');

    setHealthDialogOpen(true);

  };

  const handleManualAdd = () => {

    resetHealthForm();

    setHealthPickerOpen(false);

    setHealthPickerStep('options');

    setHealthDialogOpen(true);

  };



  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {

    const file = event.target.files?.[0];

    if (!file) {

      return;

    }



    if (file.size > HEALTH_PHOTO_MAX_SIZE) {

      toast({

        title: t('observations.toast.photoTooLargeTitle'),

        description: t('observations.toast.photoTooLargeDescription'),

        variant: 'destructive'

      });

      if (photoInputRef.current) {

        photoInputRef.current.value = '';

      }

      return;

    }



    if (photoPreview && photoPreview.startsWith('blob:')) {

      URL.revokeObjectURL(photoPreview);

    }



    const previewUrl = URL.createObjectURL(file);

    setPhotoPreview(previewUrl);

    setPhotoFile(file);

    setRemoveExistingPhoto(false);

  };



  const handleRemovePhoto = () => {

    if (photoFile) {

      if (photoPreview && photoPreview.startsWith('blob:')) {

        URL.revokeObjectURL(photoPreview);

      }

      setPhotoFile(null);

      if (editingHealthConcern?.photoURL) {

        setPhotoPreview(editingHealthConcern.photoURL);

        setRemoveExistingPhoto(false);

      } else {

        setPhotoPreview(null);

      }

    } else {

      if (photoPreview && photoPreview.startsWith('blob:')) {

        URL.revokeObjectURL(photoPreview);

      }

      setPhotoPreview(null);

      setRemoveExistingPhoto(Boolean(editingHealthConcern?.photoURL));

    }

    setPhotoFile(null);

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

  };



  const toggleHelper = (memberId: string) => {

    const currentHelpers = healthForm.getValues('helperIds');

    const updatedHelpers = currentHelpers.includes(memberId)

      ? currentHelpers.filter(id => id !== memberId)

      : [...currentHelpers, memberId];

    healthForm.setValue('helperIds', updatedHelpers, { shouldValidate: true });

  };



  const handleHealthSubmit = async (values: HealthConcernFormValues) => {

    if (!user) {

      toast({

        title: t('common.error'),

        description: t('observations.toast.mustSignIn'),

        variant: 'destructive'

      });

      return;

    }

    // If user entered a location code, resolve it to a real address before saving
    let resolvedAddressFromCode: string | null = null;
    if (useLocationCode && locationCode.trim()) {
      resolvedAddressFromCode = await handleResolveLocationCode(locationCode);
      if (!resolvedAddressFromCode) {
        return;
      }
    }

    let addressToSave = (
      resolvedAddressFromCode ??
      values.address?.trim() ??
      healthForm.getValues('address')?.trim() ??
      ''
    ).trim();

    // Never persist raw lat/lng as the address
    if (addressToSave && looksLikeCoordinates(addressToSave)) {
      const converted = await resolveLocationCodeToAddress(addressToSave);
      if (!converted) {
        setUseLocationCode(true);
        setLocationCode(addressToSave);
        healthForm.setValue('address', '', { shouldValidate: false });
        toast({
          title: t('memberForm.toast.partialAddressTitle'),
          description: t('memberForm.toast.partialAddressDesc'),
          variant: 'destructive',
        });
        return;
      }
      addressToSave = converted;
      healthForm.setValue('address', converted, { shouldValidate: true });
    }

    if (addressToSave.length < 5) {
      healthForm.setError('address', {
        type: 'manual',
        message: t('observations.health.validation.address'),
      });
      return;
    }

    let helperIdsToSave: string[] = [];
    let helperNames: string[] = [];

    if (isSociedadSocorro) {
      helperNames = parseHelperNamesText(values.helperNamesText ?? '');
      if (helperNames.length < 1) {
        healthForm.setError('helperNamesText', {
          type: 'manual',
          message: t('observations.health.validation.helpersManual'),
        });
        return;
      }
      helperIdsToSave = [];
    } else {
      helperIdsToSave = values.helperIds;
      if (helperIdsToSave.length < 1) {
        healthForm.setError('helperIds', {
          type: 'manual',
          message: t('observations.health.validation.helpers'),
        });
        return;
      }
      helperNames = helperIdsToSave.map((id) => {
        const helper = membersById.get(id);
        if (helper) {
          return `${helper.firstName} ${helper.lastName}`;
        }
        return t('observations.health.memberUnregistered');
      });
    }

    setSavingHealthConcern(true);



    try {

      if (editingHealthConcern) {

        const updatedConcern = await updateHealthConcern({

          concern: editingHealthConcern,

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: addressToSave,

          observation: values.observation.trim(),

          helperIds: helperIdsToSave,

          helperNames,

          performedBy: user.uid,

          photoFile,

          removePhoto: removeExistingPhoto && !photoFile,

        });



        setHealthConcerns((prev) => prev.map((item) => (item.id === updatedConcern.id ? updatedConcern : item)));



        toast({

          title: t('observations.toast.healthUpdatedTitle'),

          description: t('observations.toast.healthUpdatedDescription'),

        });

      } else {

        const newConcern = await createHealthConcern({

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: addressToSave,

          observation: values.observation.trim(),

          helperIds: helperIdsToSave,

          helperNames,

          createdBy: user.uid,
          barrioOrg,
          photoFile,
          photoURL: photoPreview && !photoFile ? photoPreview : undefined,

        });



        setHealthConcerns((prev) => [newConcern, ...prev]);



        toast({

          title: t('observations.toast.healthCreatedTitle'),

          description: t('observations.toast.healthCreatedDescription'),

        });

      }



      setHealthDialogOpen(false);

      resetHealthForm();

    } catch (error) {

      console.error('Error saving health concern:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.healthSaveError'),

        variant: 'destructive'

      });

    } finally {

      setSavingHealthConcern(false);

    }

  };



  const handleDeleteHealthConcern = async (concern: HealthConcern) => {

    const confirmed = window.confirm(
      t('observations.confirm.deleteHealth', {
        firstName: concern.firstName,
        lastName: concern.lastName,
      })
    );

    if (!confirmed) {

      return;

    }



    setDeletingHealthConcernId(concern.id);



    try {

      await deleteHealthConcern(concern.id, concern.photoPath, concern.photoURL);

      setHealthConcerns((prev) => prev.filter((item) => item.id !== concern.id));

      if (editingHealthConcern?.id === concern.id) {

        resetHealthForm();

        setHealthDialogOpen(false);

      }

      toast({

        title: t('observations.toast.healthDeletedTitle'),

        description: t('observations.toast.healthDeletedDescription'),

      });

    } catch (error) {

      console.error('Error deleting health concern:', error);

      toast({

        title: t('common.error'),

        description: t('observations.toast.healthDeleteError'),

        variant: 'destructive'

      });

    } finally {

      setDeletingHealthConcernId(null);

    }

  };



  // Filtrar miembros por criterios

  const membersWithoutEndowment = members.filter(member =>

    !member.ordinances || !member.ordinances.includes('endowment')

  );



  const membersWithoutElderOrdination = members.filter(member =>

    !member.ordinances || !member.ordinances.includes('elder_ordination')

  );



  const membersWithoutHigherPriesthood = members.filter(member =>

    !member.ordinances || (!member.ordinances.includes('elder_ordination') && !member.ordinances.includes('high_priest_ordination'))

  );



  const membersWithoutMinistering = members.filter(member =>

    !member.ministeringTeachers || member.ministeringTeachers.length === 0

  );

  // Recomendación para el templo
  const membersWithTempleRecommend = members.filter((member) => {
    const status = getTempleRecommendStatus(member);
    return status === 'active' || status === 'expiring_soon';
  });

  const membersWithoutTempleRecommend = members.filter(
    (member) => member.hasTempleRecommend !== true
  );

  const membersTempleRecommendExpiring = members
    .filter((member) => {
      const status = getTempleRecommendStatus(member);
      return status === 'expiring_soon' || status === 'expired';
    })
    .sort((a, b) => {
      const aDays = getTempleRecommendDaysLeft(a.templeRecommendExpirationDate) ?? 0;
      const bDays = getTempleRecommendDaysLeft(b.templeRecommendExpirationDate) ?? 0;
      return aDays - bDays;
    });



  const inactiveMembers = members.filter(member => member.status === 'inactive');

  const twentyFourMonthsAgo = subMonths(new Date(), 24);
  const inactiveNewConverts = members.filter(member => {
    const baptismDate = safeGetDate(member.baptismDate);
    return member.status === 'inactive' && baptismDate !== null && baptismDate > twentyFourMonthsAgo;
  });



  // Filter companionships where companions are less active or inactive

  const problematicCompanionships = companionships.filter(companionship => {

    return companionship.companions.some(companionName => {

      const member = members.find(m =>

        `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

      );

      return member && (member.status === 'less_active' || member.status === 'inactive');

    });

  });



  const membersByFullName = useMemo(() => {

    const map = new Map<string, Member>();

    members.forEach(member => {

      map.set(`${member.firstName} ${member.lastName}`.toLowerCase(), member);

    });

    return map;

  }, [members]);



  const membersByLastName = useMemo(() => {

    const map = new Map<string, Member[]>();

    members.forEach(member => {

      const key = member.lastName.toLowerCase();

      const existing = map.get(key) ?? [];

      existing.push(member);

      map.set(key, existing);

    });

    return map;

  }, [members]);



  const resolveFamilyMembers = useCallback((familyName: string): Member[] => {

    const normalized = familyName.trim().toLowerCase();

    if (normalized.startsWith('familia ')) {

      const lastName = normalized.replace('familia ', '').trim();

      return membersByLastName.get(lastName) ?? [];

    }



    const directMatch = membersByFullName.get(normalized);

    if (directMatch) {

      return [directMatch];

    }



    return membersByLastName.get(normalized) ?? [];

  }, [membersByFullName, membersByLastName]);



  type FlaggedFamily = {

    family: Family;

    members: Member[];

  };



  type FamilyFocusCompanionship = Companionship & {

    flaggedFamilies: FlaggedFamily[];

  };



  const familyFocusCompanionships: FamilyFocusCompanionship[] = useMemo(() => {

    return companionships.map((companionship) => {

      const flaggedFamilies = companionship.families

        .map<FlaggedFamily | null>((family) => {

          const relatedMembers = resolveFamilyMembers(family.name);

          const flaggedMembers = relatedMembers.filter(member =>

            member.status === 'inactive' || member.status === 'less_active'

          );

          return flaggedMembers.length > 0 ? { family, members: flaggedMembers } : null;

        })

        .filter((entry): entry is FlaggedFamily => entry !== null);



      if (flaggedFamilies.length === 0) {

        return null;

      }



      return { ...companionship, flaggedFamilies };

    }).filter((entry): entry is FamilyFocusCompanionship => entry !== null);

  }, [companionships, resolveFamilyMembers]);



  const observationCounts = {

    withoutEndowment: membersWithoutEndowment.length,

    withoutElderOrdination: membersWithoutElderOrdination.length,

    withoutHigherPriesthood: membersWithoutHigherPriesthood.length,

    withoutMinistering: membersWithoutMinistering.length,

    withTempleRecommend: membersWithTempleRecommend.length,

    withoutTempleRecommend: membersWithoutTempleRecommend.length,

    templeRecommendExpiring: membersTempleRecommendExpiring.length,

    inactiveNewConverts: inactiveNewConverts.length,

    inactive: inactiveMembers.length,

    familyFocusCompanionships: familyFocusCompanionships.length,

    problematicCompanionships: problematicCompanionships.length,

    healthConcerns: healthConcerns.length

  };

  const listPageFor = (total: number) =>
    Math.min(listPage, Math.max(1, Math.ceil(total / OBSERVATION_LIST_PAGE_SIZE)));

  const openObservationList = (key: ObservationListKey) => {
    setListPage(1);
    setListSearch('');
    setExpiringListFilter('all');
    setOpenList(key);
  };

  const handleListOpenChange = (key: ObservationListKey, open: boolean) => {
    setOpenList(open ? key : null);
    if (!open) {
      setListSearch('');
      setExpiringListFilter('all');
    }
  };

  const handleListSearchChange = (value: string) => {
    setListSearch(value);
    setListPage(1);
  };

  const handleExpiringFilterChange = (value: 'all' | 'expiring_soon' | 'expired') => {
    setExpiringListFilter(value);
    setListPage(1);
  };

  /** Término normalizado del buscador del listado abierto */
  const searchTerm = normalizeListSearch(listSearch);

  const matchesExpiringListFilter = (member: Member) =>
    expiringListFilter === 'all' || getTempleRecommendStatus(member) === expiringListFilter;

  const filteredHealthConcerns = healthConcerns.filter((concern) =>
    matchesMemberSearch(concern, searchTerm)
  );

  const filteredFamilyFocusCompanionships = familyFocusCompanionships.filter((companionship) =>
    matchesTextSearch(
      [
        ...companionship.companions,
        ...companionship.families.map((family) => family.name),
        ...companionship.flaggedFamilies.flatMap((flagged) => [
          flagged.family.name,
          ...flagged.members.map((member) => `${member.firstName} ${member.lastName}`),
        ]),
      ],
      searchTerm
    )
  );

  const filteredProblematicCompanionships = problematicCompanionships.filter((companionship) =>
    matchesTextSearch(
      [
        ...companionship.companions,
        ...companionship.families.map((family) => family.name),
      ],
      searchTerm
    )
  );

  const healthListPage = listPageFor(filteredHealthConcerns.length);
  const healthListStart = (healthListPage - 1) * OBSERVATION_LIST_PAGE_SIZE;
  const familyFocusListPage = listPageFor(filteredFamilyFocusCompanionships.length);
  const familyFocusListStart = (familyFocusListPage - 1) * OBSERVATION_LIST_PAGE_SIZE;
  const problematicListPage = listPageFor(filteredProblematicCompanionships.length);
  const problematicListStart = (problematicListPage - 1) * OBSERVATION_LIST_PAGE_SIZE;

  const memberLists: Array<{
    key: ObservationListKey;
    title: string;
    description: string;
    emptyText: string;
    icon: LucideIcon;
    iconClassName: string;
    items: Member[];
    renderExtra?: (member: Member) => ReactNode;
  }> = [
    {
      key: 'withoutEndowment',
      title: t('observations.endowment.sectionTitle'),
      description: t('observations.endowment.sectionDescription'),
      emptyText: t('observations.endowment.empty'),
      icon: AlertTriangle,
      iconClassName: 'text-orange-600',
      items: membersWithoutEndowment,
      renderExtra: (member) => (
        <OrdinancesBadges ordinances={member.ordinances} t={t} />
      ),
    },
    {
      key: 'withoutElder',
      title: t('observations.elder.sectionTitle'),
      description: t('observations.elder.sectionDescription'),
      emptyText: t('observations.elder.empty'),
      icon: UserCheck,
      iconClassName: 'text-purple-600',
      items: membersWithoutElderOrdination,
      renderExtra: (member) => (
        <OrdinancesBadges ordinances={member.ordinances} t={t} />
      ),
    },
    {
      key: 'withoutHigherPriesthood',
      title: t('observations.higherPriesthood.sectionTitle'),
      description: t('observations.higherPriesthood.sectionDescription'),
      emptyText: t('observations.higherPriesthood.empty'),
      icon: UserCheck,
      iconClassName: 'text-indigo-600',
      items: membersWithoutHigherPriesthood,
      renderExtra: (member) => (
        <OrdinancesBadges ordinances={member.ordinances} t={t} />
      ),
    },
    {
      key: 'withoutMinistering',
      title: t('observations.ministering.sectionTitle'),
      description: t('observations.ministering.sectionDescription'),
      emptyText: t('observations.ministering.empty'),
      icon: UserX,
      iconClassName: 'text-blue-600',
      items: membersWithoutMinistering,
    },
    {
      key: 'withTempleRecommend',
      title: t('observations.templeRecommend.withTitle'),
      description: t('observations.templeRecommend.withDescription'),
      emptyText: t('observations.templeRecommend.withEmpty'),
      icon: BadgeCheck,
      iconClassName: 'text-emerald-600',
      items: membersWithTempleRecommend,
      renderExtra: (member) => (
        <TempleRecommendExpirationBadge
          expiration={member.templeRecommendExpirationDate}
          t={t}
        />
      ),
    },
    {
      key: 'withoutTempleRecommend',
      title: t('observations.templeRecommend.withoutTitle'),
      description: t('observations.templeRecommend.withoutDescription'),
      emptyText: t('observations.templeRecommend.withoutEmpty'),
      icon: FileX2,
      iconClassName: 'text-slate-600',
      items: membersWithoutTempleRecommend,
    },
    {
      key: 'templeRecommendExpiring',
      title: t('observations.templeRecommend.expiringTitle'),
      description: t('observations.templeRecommend.expiringDescription'),
      emptyText: t('observations.templeRecommend.expiringEmpty'),
      icon: CalendarClock,
      iconClassName: 'text-rose-600',
      items: membersTempleRecommendExpiring,
      renderExtra: (member) => (
        <TempleRecommendExpirationBadge
          expiration={member.templeRecommendExpirationDate}
          t={t}
        />
      ),
    },
    {
      key: 'inactiveNewConverts',
      title: t('observations.inactiveConverts.sectionTitle'),
      description: t('observations.inactiveConverts.sectionDescription'),
      emptyText: t('observations.inactiveConverts.empty'),
      icon: UserX,
      iconClassName: 'text-amber-600',
      items: inactiveNewConverts,
      renderExtra: (member) => {
        const baptismDate = safeGetDate(member.baptismDate);
        if (!baptismDate) return null;
        return (
          <p className="text-xs text-muted-foreground">
            {t('observations.baptismLabel', {
              date: format(baptismDate, 'd MMM yyyy', { locale: getDateFnsLocale() }),
            })}
          </p>
        );
      },
    },
    {
      key: 'inactive',
      title: t('observations.inactive.sectionTitle'),
      description: t('observations.inactive.sectionDescription'),
      emptyText: t('observations.inactive.empty'),
      icon: UserX,
      iconClassName: 'text-red-600',
      items: inactiveMembers,
      renderExtra: (member) => {
        const lastActive = safeGetDate(member.lastActiveDate);
        return (
          <p className="text-xs text-muted-foreground">
            {t('observations.lastActivityLabel', {
              date: lastActive
                ? format(lastActive, 'd MMM yyyy', { locale: getDateFnsLocale() })
                : t('observations.never'),
            })}
          </p>
        );
      },
    },
  ];

  return (

    <section className="page-section">

      {/* Header */}

      <div className="flex flex-col gap-2">

        <h1 className="text-balance text-fluid-title font-semibold tracking-tight">{t('observations.title')}</h1>

        <p className="text-balance text-fluid-subtitle text-muted-foreground">

          {t('observations.subtitle')}

        </p>

      </div>



      {/* Stats Cards */}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">

        <Card className="cursor-pointer" onClick={() => openObservationList('withoutEndowment')}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutEndowment')}</CardTitle>

            <AlertTriangle className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.withoutEndowment}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutEndowmentDesc')}</p>

          </CardContent>

        </Card>

        {isElderesQuorum && (
        <Card className="cursor-pointer" onClick={() => openObservationList('withoutElder')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutElder')}</CardTitle>
            <UserCheck className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{observationCounts.withoutElderOrdination}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutElderDesc')}</p>
          </CardContent>
        </Card>
        )}
        {isElderesQuorum && (
        <Card className="cursor-pointer" onClick={() => openObservationList('withoutHigherPriesthood')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutHigherPriesthood')}</CardTitle>
            <UserCheck className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">{observationCounts.withoutHigherPriesthood}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutHigherPriesthoodDesc')}</p>
          </CardContent>
        </Card>
        )}

        <Card className="cursor-pointer" onClick={() => openObservationList('withoutMinistering')}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutMinistering')}</CardTitle>

            <UserX className="h-4 w-4 text-blue-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-blue-600">{observationCounts.withoutMinistering}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutMinisteringDesc')}</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('withTempleRecommend')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.templeRecommend')}</CardTitle>
            <BadgeCheck className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{observationCounts.withTempleRecommend}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.templeRecommendDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('withoutTempleRecommend')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.withoutTempleRecommend')}</CardTitle>
            <FileX2 className="h-4 w-4 text-slate-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-600">{observationCounts.withoutTempleRecommend}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.withoutTempleRecommendDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('templeRecommendExpiring')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.templeRecommendExpiring')}</CardTitle>
            <CalendarClock className="h-4 w-4 text-rose-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">{observationCounts.templeRecommendExpiring}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.templeRecommendExpiringDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('inactiveNewConverts')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.inactiveNewConverts')}</CardTitle>
            <UserX className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{observationCounts.inactiveNewConverts}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.inactiveNewConvertsDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('inactive')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('observations.stats.inactive')}</CardTitle>
            <UserX className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{observationCounts.inactive}</div>
            <p className="text-xs text-muted-foreground">{t('observations.stats.inactiveDesc')}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('familyFocus')}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.familyFocus')}</CardTitle>

            <Users className="h-4 w-4 text-sky-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-sky-600">{observationCounts.familyFocusCompanionships}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.familyFocusDesc')}</p>

          </CardContent>

        </Card>



        <Card className="cursor-pointer" onClick={() => openObservationList('problematic')}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.problematicCompanionships')}</CardTitle>

            <Users className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.problematicCompanionships}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.problematicCompanionshipsDesc')}</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => openObservationList('health')}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">{t('observations.stats.health')}</CardTitle>

            <HeartPulse className="h-4 w-4 text-rose-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-rose-600">{observationCounts.healthConcerns}</div>

            <p className="text-xs text-muted-foreground">{t('observations.stats.healthDesc')}</p>

          </CardContent>

        </Card>

      </div>



      {/* Listados: se abren desde las tarjetas y solo montan 15 registros por página */}

      {memberLists.map((list) => {
        const baseItems =
          list.key === 'templeRecommendExpiring'
            ? list.items.filter((member) => matchesExpiringListFilter(member))
            : list.items;
        const filteredItems = baseItems.filter((member) =>
          matchesMemberSearch(member, searchTerm)
        );
        const page = listPageFor(filteredItems.length);
        const start = (page - 1) * OBSERVATION_LIST_PAGE_SIZE;

        return (
          <ObservationListDialog
            key={list.key}
            open={openList === list.key}
            onOpenChange={(open) => handleListOpenChange(list.key, open)}
            title={list.title}
            description={list.description}
            icon={list.icon}
            iconClassName={list.iconClassName}
            total={filteredItems.length}
            page={page}
            onPageChange={setListPage}
            emptyText={searchTerm ? t('observations.list.noSearchResults') : list.emptyText}
            loading={loading}
            toolbar={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <ObservationListSearch
                  value={listSearch}
                  onChange={handleListSearchChange}
                  placeholder={t('observations.list.searchMember')}
                />
                {list.key === 'templeRecommendExpiring' && (
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { value: 'all', label: t('common.all') },
                        {
                          value: 'expiring_soon',
                          label: t('observations.templeRecommend.filterExpiring'),
                        },
                        {
                          value: 'expired',
                          label: t('observations.templeRecommend.filterExpired'),
                        },
                      ] as const
                    ).map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={expiringListFilter === option.value ? 'default' : 'outline'}
                        onClick={() => handleExpiringFilterChange(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            }
          >
            {filteredItems.slice(start, start + OBSERVATION_LIST_PAGE_SIZE).map((member) => (

              <MemberObservationRow

                key={member.id}

                member={member}

                extra={list.renderExtra?.(member)}

                onViewProfile={handleViewProfile}

                t={t}

              />

            ))}

          </ObservationListDialog>

        );

      })}

      {/* Apoyo de salud */}

      <ObservationListDialog

        open={openList === 'health'}

        onOpenChange={(open) => handleListOpenChange('health', open)}

        title={t('observations.health.sectionTitle')}

        description={t('observations.health.sectionDescription')}

        icon={HeartPulse}

        iconClassName="text-rose-600"

        total={filteredHealthConcerns.length}

        page={healthListPage}

        onPageChange={setListPage}

        emptyText={
          searchTerm ? t('observations.list.noSearchResults') : t('observations.health.empty')
        }

        loading={healthLoading}

        toolbar={
          <ObservationListSearch
            value={listSearch}
            onChange={handleListSearchChange}
            placeholder={t('observations.list.searchMember')}
          />
        }

        actions={
          canWrite ? (
            <Button
              size="sm"
              onClick={() => {
                setHealthPickerStep('options');
                setHealthPickerOpen(true);
              }}
              disabled={savingHealthConcern}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('observations.health.addPerson')}
            </Button>
          ) : undefined
        }

      >

        {filteredHealthConcerns

          .slice(healthListStart, healthListStart + OBSERVATION_LIST_PAGE_SIZE)

          .map((concern) => {

            const helperLabels = getHealthHelperLabels(

              concern,

              membersById,

              t('observations.health.memberUnregistered')

            );

            const createdAtDate = safeGetDate(concern.createdAt);

            const createdAtLabel = createdAtDate

              ? format(createdAtDate, 'd MMM yyyy', { locale: getDateFnsLocale() })

              : t('observations.health.dateUnavailable');

            return (

              <div key={concern.id} className="flex items-start gap-3 py-3">

                <Avatar className="h-9 w-9 shrink-0">

                  <AvatarImage

                    src={concern.photoURL || undefined}

                    alt={`${concern.firstName} ${concern.lastName}`}

                  />

                  <AvatarFallback>{getInitials(concern.firstName, concern.lastName)}</AvatarFallback>

                </Avatar>

                <div className="min-w-0 flex-1 space-y-1">

                  <p className="font-medium leading-tight">

                    {concern.firstName} {concern.lastName}

                  </p>

                  <p className="text-xs text-muted-foreground">

                    {t('observations.health.registeredOn', { date: createdAtLabel })}

                  </p>

                  <p className="text-sm text-muted-foreground break-words">{concern.address}</p>

                  <p className="text-sm break-words">{concern.observation}</p>

                  <div className="flex flex-wrap gap-1">

                    {helperLabels.length > 0 ? (

                      helperLabels.map((helperName, index) => (

                        <Badge

                          key={`${concern.id}-helper-${index}-${helperName}`}

                          variant="outline"

                          className="text-xs font-normal"

                        >

                          {helperName}

                        </Badge>

                      ))

                    ) : (

                      <span className="text-xs text-muted-foreground">{t('common.unassigned')}</span>

                    )}

                  </div>

                </div>

                {canWrite && (

                  <div className="flex shrink-0 flex-col gap-2">

                    <Button

                      variant="outline"

                      size="sm"

                      onClick={() => handleOpenHealthDialog(concern)}

                      disabled={savingHealthConcern}

                      title={t('observations.health.editTitle')}

                    >

                      <Pencil className="h-4 w-4" />

                    </Button>

                    <Button

                      variant="outline"

                      size="sm"

                      onClick={() => handleDeleteHealthConcern(concern)}

                      disabled={deletingHealthConcernId === concern.id}

                      title={t('observations.health.deleteTitle')}

                    >

                      {deletingHealthConcernId === concern.id ? (

                        <Loader2 className="h-4 w-4 animate-spin" />

                      ) : (

                        <Trash2 className="h-4 w-4" />

                      )}

                    </Button>

                  </div>

                )}

              </div>

            );

          })}

      </ObservationListDialog>

      {/* Familias en seguimiento */}

      <ObservationListDialog

        open={openList === 'familyFocus'}

        onOpenChange={(open) => handleListOpenChange('familyFocus', open)}

        title={t('observations.familyFocus.sectionTitle')}

        description={t('observations.familyFocus.sectionDescription')}

        icon={Users}

        iconClassName="text-sky-600"

        total={filteredFamilyFocusCompanionships.length}

        page={familyFocusListPage}

        onPageChange={setListPage}

        emptyText={
          searchTerm
            ? t('observations.list.noSearchResults')
            : t('observations.familyFocus.empty')
        }

        loading={loading}

        toolbar={
          <ObservationListSearch
            value={listSearch}
            onChange={handleListSearchChange}
            placeholder={t('observations.list.searchCompanionship')}
          />
        }

      >

        {filteredFamilyFocusCompanionships

          .slice(familyFocusListStart, familyFocusListStart + OBSERVATION_LIST_PAGE_SIZE)

          .map((companionship) => (

            <div key={companionship.id} className="flex items-start gap-3 py-3">

              <div className="min-w-0 flex-1 space-y-2">

                <p className="font-medium leading-tight">

                  {companionship.companions.join(' · ')}

                </p>

                {companionship.flaggedFamilies.map((flagged) => (

                  <div key={flagged.family.name} className="space-y-1">

                    <p className="text-xs font-medium text-muted-foreground">

                      {flagged.family.name}

                    </p>

                    <div className="flex flex-wrap gap-1">

                      {flagged.members.map((member) => {

                        const statusInfo = statusConfig[member.status];

                        const StatusIcon = statusInfo.icon;

                        return (

                          <Badge key={member.id} variant={statusInfo.variant} className="gap-1 text-[10px]">

                            <StatusIcon className="h-3 w-3" />

                            {member.firstName} {member.lastName}

                          </Badge>

                        );

                      })}

                    </div>

                  </div>

                ))}

              </div>

              <Button

                variant="outline"

                size="sm"

                onClick={() => router.push(`/ministering/${companionship.id}`)}

                title={t('observations.viewCompanionship')}

              >

                <Eye className="h-4 w-4" />

              </Button>

            </div>

          ))}

      </ObservationListDialog>

      {/* Compañerías problemáticas */}

      <ObservationListDialog

        open={openList === 'problematic'}

        onOpenChange={(open) => handleListOpenChange('problematic', open)}

        title={t('observations.problematic.sectionTitle')}

        description={t('observations.problematic.sectionDescription')}

        icon={Users}

        iconClassName="text-orange-600"

        total={filteredProblematicCompanionships.length}

        page={problematicListPage}

        onPageChange={setListPage}

        emptyText={
          searchTerm
            ? t('observations.list.noSearchResults')
            : t('observations.problematic.empty')
        }

        loading={loading}

        toolbar={
          <ObservationListSearch
            value={listSearch}
            onChange={handleListSearchChange}
            placeholder={t('observations.list.searchCompanionship')}
          />
        }

      >

        {filteredProblematicCompanionships

          .slice(problematicListStart, problematicListStart + OBSERVATION_LIST_PAGE_SIZE)

          .map((companionship) => {

            const inactiveCompanions = companionship.companions.filter((companionName) => {

              const member = members.find(

                (m) => `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

              );

              return member && (member.status === 'less_active' || member.status === 'inactive');

            });

            return (

              <div key={companionship.id} className="flex items-start gap-3 py-3">

                <div className="min-w-0 flex-1 space-y-2">

                  <p className="font-medium leading-tight">

                    {companionship.companions.join(' · ')}

                  </p>

                  <p className="text-xs text-muted-foreground">

                    {companionship.families.map((family) => family.name).join(' · ')}

                  </p>

                  <div className="flex flex-wrap gap-1">

                    {inactiveCompanions.map((companionName, index) => {

                      const member = members.find(

                        (m) => `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                      );

                      if (!member) return null;

                      const statusInfo = statusConfig[member.status];

                      const StatusIcon = statusInfo.icon;

                      return (

                        <Badge key={`${companionName}-${index}`} variant={statusInfo.variant} className="gap-1 text-[10px]">

                          <StatusIcon className="h-3 w-3" />

                          {companionName} · {t(`member.status.${member.status}`)}

                        </Badge>

                      );

                    })}

                  </div>

                </div>

                <Button

                  variant="outline"

                  size="sm"

                  onClick={() => router.push(`/ministering/${companionship.id}`)}

                  title={t('observations.viewCompanionshipButton')}

                >

                  <Eye className="h-4 w-4" />

                </Button>

              </div>

            );

          })}

      </ObservationListDialog>

      <Dialog
        open={healthPickerOpen}
        onOpenChange={(open) => {
          setHealthPickerOpen(open);
          if (!open) {
            setHealthPickerStep('options');
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>{t('observations.health.picker.title')}</DialogTitle>
            <DialogDescription>
              {t('observations.health.picker.description')}
            </DialogDescription>
          </DialogHeader>
          {healthPickerStep === 'options' ? (
            <div className="grid gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex h-auto min-w-0 items-center justify-start gap-3 whitespace-normal py-4"
                onClick={() => setHealthPickerStep('memberList')}
              >
                <UserCheck className="h-5 w-5 shrink-0 text-green-600" />
                <span className="min-w-0 text-left">
                  <span className="block font-medium">{t('observations.health.picker.existing')}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t('observations.health.picker.existingHint')}
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex h-auto min-w-0 items-center justify-start gap-3 whitespace-normal py-4"
                onClick={handleManualAdd}
              >
                <Plus className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 text-left">
                  <span className="block font-medium">{t('observations.health.picker.manual')}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t('observations.health.picker.manualHint')}
                  </span>
                </span>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col overflow-hidden">
              <div className="mb-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setHealthPickerStep('options')}
                >
                  <ChevronUp className="mr-1 h-4 w-4 rotate-180" />
                  {t('observations.health.picker.back')}
                </Button>
              </div>
              {loading ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.loadingMembers')}</div>
              ) : members.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.noMembersAvailable')}</div>
              ) : (
                <Command className="max-h-[min(50vh,360px)]">
                  <CommandInput placeholder={t('observations.health.searchMember')} />
                  <CommandList className="max-h-[min(42vh,300px)] overflow-y-auto overscroll-contain">
                    <CommandEmpty>{t('observations.health.noMembersFound')}</CommandEmpty>
                    <CommandGroup>
                      {members.map((member) => {
                        const statusInfo = statusConfig[member.status];
                        return (
                          <CommandItem
                            key={member.id}
                            value={`${member.firstName} ${member.lastName}`}
                            onSelect={() => handleSelectExistingMember(member)}
                          >
                            <div className="flex items-center gap-2 w-full min-w-0">
                              <Avatar className="h-6 w-6 shrink-0">
                                <AvatarImage src={member.photoURL || undefined} alt={`${member.firstName} ${member.lastName}`} />
                                <AvatarFallback>{getInitials(member.firstName, member.lastName)}</AvatarFallback>
                              </Avatar>
                              <span className="flex-1 truncate">{member.firstName} {member.lastName}</span>
                              <Badge variant={statusInfo.variant} className="text-[10px] shrink-0">
                                {t(`member.status.${member.status}`)}
                              </Badge>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={healthDialogOpen}
        onOpenChange={(open) => {
          setHealthDialogOpen(open);
          if (!open) {
            resetHealthForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0 pr-12">
            <DialogTitle>
              {isEditingHealthConcern ? t('observations.health.dialog.editTitle') : t('observations.health.dialog.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {isEditingHealthConcern
                ? t('observations.health.dialog.editDescription')
                : t('observations.health.dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <Form {...healthForm}>
            <form onSubmit={(e) => void healthForm.handleSubmit(handleHealthSubmit)(e)} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={photoPreview || undefined} alt={t('observations.health.photoAlt')} />
                    <AvatarFallback>{getInitials(watchFirstName, watchLastName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={savingHealthConcern}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {photoPreview ? t('observations.health.changePhoto') : t('observations.health.uploadPhoto')}
                    </Button>
                    {photoPreview && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleRemovePhoto}
                        disabled={savingHealthConcern}
                      >
                        <X className="mr-2 h-4 w-4" />
                        {t('observations.health.removePhoto')}
                      </Button>
                    )}
                  </div>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                  aria-label={t('observations.health.selectPhotoAria')}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={healthForm.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('observations.health.firstName')}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={t('observations.health.firstName')} disabled={savingHealthConcern} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={healthForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('observations.health.lastName')}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={t('observations.health.lastName')} disabled={savingHealthConcern} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={healthForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t('observations.health.address')}</FormLabel>

                        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                          <Checkbox
                            id="health-use-location-code"
                            checked={useLocationCode}
                            disabled={savingHealthConcern || resolvingCode || gettingLocation}
                            onCheckedChange={(checked) => {
                              const enabled = checked === true;
                              setUseLocationCode(enabled);
                              if (enabled) {
                                const current = field.value || '';
                                if (looksLikeCoordinates(current)) {
                                  setLocationCode(current);
                                  field.onChange('');
                                }
                              } else {
                                setLocationCode('');
                              }
                            }}
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <Label
                              htmlFor="health-use-location-code"
                              className="cursor-pointer text-sm font-medium leading-none"
                            >
                              {t('memberForm.useLocationCode')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {t('memberForm.useLocationCodeHint')}
                            </p>
                          </div>
                        </div>

                        {useLocationCode ? (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <Input
                                placeholder={t('memberForm.locationCodePlaceholder')}
                                value={locationCode}
                                onChange={(e) => setLocationCode(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleResolveLocationCode();
                                  }
                                }}
                                disabled={savingHealthConcern || resolvingCode}
                                aria-label={t('memberForm.locationCodeLabel')}
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void handleResolveLocationCode()}
                                disabled={savingHealthConcern || resolvingCode || !locationCode.trim()}
                                title={t('memberForm.resolveLocationCodeTitle')}
                              >
                                {resolvingCode ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  t('memberForm.resolveLocationCode')
                                )}
                              </Button>
                            </div>
                            {field.value ? (
                              <div className="rounded-md border bg-background px-3 py-2 text-sm">
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">
                                  {t('memberForm.resolvedAddressLabel')}
                                </p>
                                <p className="text-foreground">{field.value}</p>
                              </div>
                            ) : null}
                            <FormDescription>
                              {t('memberForm.locationCodeDescription')}
                            </FormDescription>
                          </div>
                        ) : (
                          <>
                            <div className="flex gap-2">
                              <FormControl>
                                <Input
                                  placeholder={t('observations.health.addressPlaceholder')}
                                  {...field}
                                  value={field.value || ''}
                                  disabled={savingHealthConcern || gettingLocation}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => void handleGetCurrentLocation()}
                                disabled={savingHealthConcern || gettingLocation}
                                title={t('memberForm.gpsTitle')}
                                aria-label={t('memberForm.gpsAria')}
                              >
                                {gettingLocation ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MapPin className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <FormDescription>
                              {t('memberForm.addressDescription')}
                            </FormDescription>
                          </>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={healthForm.control}
                    name="observation"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>{t('observations.health.observation')}</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t('observations.health.observationPlaceholder')}
                            rows={4}
                            disabled={savingHealthConcern}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {isSociedadSocorro ? (
                    <FormField
                      control={healthForm.control}
                      name="helperNamesText"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>{t('observations.health.helpersManualLabel')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ''}
                              placeholder={t('observations.health.helpersManualPlaceholder')}
                              disabled={savingHealthConcern}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('observations.health.helpersManualHint')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <FormField
                      control={healthForm.control}
                      name="helperIds"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>{t('observations.health.helpersLabel')}</FormLabel>
                          <FormControl>
                            <div className="space-y-3">
                              <Popover open={helperPickerOpen} onOpenChange={setHelperPickerOpen}>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className={cn('w-full justify-between', field.value.length === 0 && 'text-muted-foreground')}
                                    disabled={loading || savingHealthConcern}
                                  >
                                    {field.value.length > 0
                                      ? t('observations.health.helpersSelected', { count: field.value.length })
                                      : t('observations.health.selectMembers')}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  sideOffset={8}
                                  collisionPadding={16}
                                  className="w-[min(320px,90vw)] p-0 flex flex-col overflow-hidden"
                                  onWheel={(e) => e.stopPropagation()}
                                  onTouchMove={(e) => e.stopPropagation()}
                                >
                                  {loading ? (
                                    <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.loadingMembers')}</div>
                                  ) : members.length === 0 ? (
                                    <div className="px-3 py-6 text-sm text-muted-foreground">{t('observations.health.noMembersAvailable')}</div>
                                  ) : (
                                    <Command className="max-h-[min(50vh,360px)]">
                                      <CommandInput placeholder={t('observations.health.searchMember')} />
                                      <CommandList className="max-h-[min(42vh,300px)] overflow-y-auto overscroll-contain">
                                        <CommandEmpty>{t('observations.health.noMembersFound')}</CommandEmpty>
                                        <CommandGroup>
                                          {members.map((member) => {
                                            const isSelected = field.value.includes(member.id);
                                            const statusInfo = statusConfig[member.status];
                                            return (
                                              <CommandItem
                                                key={member.id}
                                                value={`${member.firstName} ${member.lastName}`}
                                                onSelect={() => {
                                                  toggleHelper(member.id);
                                                  setHelperPickerOpen(true);
                                                }}
                                              >
                                                <div className="flex items-center gap-2 w-full min-w-0">
                                                  <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                                  <span className="flex-1 truncate">{member.firstName} {member.lastName}</span>
                                                  <Badge variant={statusInfo.variant} className="text-[10px] shrink-0">
                                                    {t(`member.status.${member.status}`)}
                                                  </Badge>
                                                </div>
                                              </CommandItem>
                                            );
                                          })}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  )}
                                </PopoverContent>
                              </Popover>
                              <div className="flex flex-wrap gap-2">
                                {field.value.length === 0 ? (
                                  <span className="text-sm text-muted-foreground">
                                    {t('observations.health.selectAtLeastOne')}
                                  </span>
                                ) : (
                                  field.value.map((helperId, index) => {
                                    const helper = membersById.get(helperId);
                                    const helperName = helper
                                      ? `${helper.firstName} ${helper.lastName}`
                                      : t('observations.health.memberUnregistered');
                                    return (
                                      <Badge
                                        key={`${helperId}-${index}`}
                                        variant="secondary"
                                        className="flex items-center gap-1"
                                      >
                                        {helperName}
                                        <button
                                          type="button"
                                          onClick={() => toggleHelper(helperId)}
                                          className="rounded-full p-0.5 hover:bg-muted"
                                          aria-label={t('observations.health.removeHelperAria', { name: helperName })}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </Badge>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </div>
              <DialogFooter className="shrink-0 border-t px-6 py-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHealthDialogOpen(false);
                    resetHealthForm();
                  }}
                  disabled={savingHealthConcern}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={savingHealthConcern || resolvingCode || gettingLocation}>
                  {savingHealthConcern ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isEditingHealthConcern ? t('common.updating') : t('common.saving')}
                    </>
                  ) : (
                    isEditingHealthConcern ? t('observations.health.updateRecord') : t('observations.health.saveRecord')
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {showScrollTop && (

        <Button

          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}

          className="fixed bottom-4 right-4 z-50 rounded-full p-3 shadow-lg bg-primary hover:bg-primary/90"

          size="icon"

          title={t('observations.scrollTop')}

        >

          <ChevronUp className="h-5 w-5" />

        </Button>

      )}

    </section>

  );

}
