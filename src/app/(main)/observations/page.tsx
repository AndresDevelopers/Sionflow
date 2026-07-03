'use client';



import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Image from 'next/image';

import type { ChangeEvent } from 'react';

import { Users, AlertTriangle, UserX, UserCheck, Eye, ChevronUp, HeartPulse, Plus, Trash2, Loader2, Check, ChevronsUpDown, X, Pencil } from 'lucide-react';

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

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';

import { Skeleton } from '@/components/ui/skeleton';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';

import { cn } from '@/lib/utils';

import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import { z } from 'zod';

import { useToast } from '@/hooks/use-toast';

import { useAuth } from '@/contexts/auth-context';

import type { Member, Companionship, Family, HealthConcern } from '@/lib/types';

import { OrdinanceLabels } from '@/lib/types';

import { getMembersByStatus } from '@/lib/members-data';

import { fetchHealthConcerns, createHealthConcern, deleteHealthConcern, updateHealthConcern } from '@/lib/health-concerns';

import { format, subMonths, differenceInYears } from 'date-fns';

import { es } from 'date-fns/locale';

import { useRouter } from 'next/navigation';

import { getDocs, query, orderBy } from 'firebase/firestore';

import { ministeringCollection } from '@/lib/collections';



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

const HEALTH_PHOTO_MAX_SIZE = 5 * 1024 * 1024;

const healthConcernSchema = z.object({
  firstName: z.string().min(2, { message: 'El nombre es obligatorio.' }),
  lastName: z.string().min(2, { message: 'El apellido es obligatorio.' }),
  address: z.string().min(5, { message: 'La dirección es obligatoria.' }),
  observation: z.string().min(5, { message: 'La observación es obligatoria.' }),
  helperIds: z.array(z.string()).min(1, { message: 'Selecciona al menos un miembro de apoyo.' }),
});

type HealthConcernFormValues = z.infer<typeof healthConcernSchema>;
const DEFAULT_HEALTH_FORM_VALUES: HealthConcernFormValues = {
  firstName: '',
  lastName: '',
  address: '',
  observation: '',
  helperIds: [],
};

const getInitials = (first: string, last: string) => `${(first?.[0] ?? '').toUpperCase()}${(last?.[0] ?? '').toUpperCase()}`.trim() || 'PS';

const renderPhoneWithAge = (member: Member, fallback: string = 'Sin teléfono') => {
  let text = member.phoneNumber || fallback;
  if (member.birthDate) {
    const age = differenceInYears(new Date(), member.birthDate.toDate());
    text += ` - ${age} Edad`;
  }
  return text;
};



export default function ObservationsPage() {

  const { user, loading: authLoading, barrioOrg } = useAuth();

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



  const healthConcernsRef = useRef<HTMLDivElement>(null);

  const withoutEndowmentRef = useRef<HTMLDivElement>(null);
  const withoutElderOrdinationRef = useRef<HTMLDivElement>(null);

  const withoutHigherPriesthoodRef = useRef<HTMLDivElement>(null);

  const withoutMinisteringRef = useRef<HTMLDivElement>(null);

  const inactiveRef = useRef<HTMLDivElement>(null);

  const inactiveNewConvertsRef = useRef<HTMLDivElement>(null);

  const familyFocusCompanionshipsRef = useRef<HTMLDivElement>(null);

  const problematicCompanionshipsRef = useRef<HTMLDivElement>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  const healthForm = useForm<HealthConcernFormValues>({

    resolver: zodResolver(healthConcernSchema),

    defaultValues: DEFAULT_HEALTH_FORM_VALUES,

  });

  const watchFirstName = healthForm.watch('firstName');

  const watchLastName = healthForm.watch('lastName');

  const isEditingHealthConcern = Boolean(editingHealthConcern);



  const membersById = useMemo(() => {

    const map = new Map<string, Member>();

    members.forEach(member => {

      map.set(member.id, member);

    });

    return map;

  }, [members]);



  const fetchMembers = useCallback(async () => {

    if (authLoading || !user) return;



    setLoading(true);

    try {

      const allMembers = await getMembersByStatus(undefined, { barrioOrg });

      setMembers(allMembers);

    } catch (error) {

      console.error('Error fetching members:', error);

      toast({

        title: 'Error',

        description: 'No se pudieron cargar los miembros.',

        variant: 'destructive'

      });

    } finally {

      setLoading(false);

    }

  }, [authLoading, user, toast]);



  const fetchCompanionships = useCallback(async () => {

    try {

      const q = query(ministeringCollection, orderBy('companions'));

      const snapshot = await getDocs(q);

      const comps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Companionship));

      setCompanionships(comps);

    } catch (error) {

      console.error('Error fetching companionships:', error);

      toast({

        title: 'Error',

        description: 'No se pudieron cargar las compañerías.',

        variant: 'destructive'

      });

    }

  }, [toast]);
  const loadHealthConcerns = useCallback(async () => {

    if (authLoading || !user) {

      return;

    }



    setHealthLoading(true);



    try {

      const healthData = await fetchHealthConcerns(barrioOrg);

      setHealthConcerns(healthData);

    } catch (error) {

      console.error('Error fetching health concerns:', error);

      toast({

        title: 'Error',

        description: 'No se pudieron cargar los registros de salud.',

        variant: 'destructive'

      });

    } finally {

      setHealthLoading(false);

    }



  }, [authLoading, user, toast]);










  useEffect(() => {



    fetchMembers();



    fetchCompanionships();



    loadHealthConcerns();



  }, [fetchMembers, fetchCompanionships, loadHealthConcerns]);




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

    if (photoInputRef.current) {

      photoInputRef.current.value = '';

    }

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

      });

      setPhotoPreview(concern.photoURL ?? null);

      setPhotoFile(null);

      setRemoveExistingPhoto(false);

      setHelperPickerOpen(false);

      if (photoInputRef.current) {

        photoInputRef.current.value = '';

      }

    } else {

      resetHealthForm();

    }

    setHealthDialogOpen(true);

  };



  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {

    const file = event.target.files?.[0];

    if (!file) {

      return;

    }



    if (file.size > HEALTH_PHOTO_MAX_SIZE) {

      toast({

        title: 'Imagen demasiado grande',

        description: 'El tamaño máximo permitido es de 5MB.',

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

        title: 'Error',

        description: 'Debes iniciar sesión para guardar.',

        variant: 'destructive'

      });

      return;

    }



    setSavingHealthConcern(true);



    try {

      const helperNames = values.helperIds.map((id) => {

        const helper = membersById.get(id);

        if (helper) {

          return `${helper.firstName} ${helper.lastName}`;

        }

        return 'Miembro sin registro';

      });



      if (editingHealthConcern) {

        const updatedConcern = await updateHealthConcern({

          concern: editingHealthConcern,

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: values.address.trim(),

          observation: values.observation.trim(),

          helperIds: values.helperIds,

          helperNames,

          performedBy: user.uid,

          photoFile,

          removePhoto: removeExistingPhoto && !photoFile,

        });



        setHealthConcerns((prev) => prev.map((item) => (item.id === updatedConcern.id ? updatedConcern : item)));



        toast({

          title: 'Registro actualizado',

          description: 'La información de salud se actualizó correctamente.',

        });

      } else {

        const newConcern = await createHealthConcern({

          firstName: values.firstName.trim(),

          lastName: values.lastName.trim(),

          address: values.address.trim(),

          observation: values.observation.trim(),

          helperIds: values.helperIds,

          helperNames,

          createdBy: user.uid,
          barrioOrg,
          photoFile,

        });



        setHealthConcerns((prev) => [newConcern, ...prev]);



        toast({

          title: 'Registro creado',

          description: 'Se agregó el registro de salud correctamente.',

        });

      }



      setHealthDialogOpen(false);

      resetHealthForm();

    } catch (error) {

      console.error('Error saving health concern:', error);

      toast({

        title: 'Error',

        description: 'No se pudo guardar el registro. Inténtalo de nuevo.',

        variant: 'destructive'

      });

    } finally {

      setSavingHealthConcern(false);

    }

  };



  const handleDeleteHealthConcern = async (concern: HealthConcern) => {

    const confirmed = window.confirm(`¿Eliminar el registro de ${concern.firstName} ${concern.lastName}?`);

    if (!confirmed) {

      return;

    }



    setDeletingHealthConcernId(concern.id);



    try {

      await deleteHealthConcern(concern.id, concern.photoPath);

      setHealthConcerns((prev) => prev.filter((item) => item.id !== concern.id));

      if (editingHealthConcern?.id === concern.id) {

        resetHealthForm();

        setHealthDialogOpen(false);

      }

      toast({

        title: 'Registro eliminado',

        description: 'Se eliminó el registro de salud correctamente.',

      });

    } catch (error) {

      console.error('Error deleting health concern:', error);

      toast({

        title: 'Error',

        description: 'No se pudo eliminar el registro. Inténtalo de nuevo.',

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



  const inactiveMembers = members.filter(member => member.status === 'inactive');

  const twentyFourMonthsAgo = subMonths(new Date(), 24);
  const inactiveNewConverts = members.filter(member =>
    member.status === 'inactive' &&
    member.baptismDate?.toDate &&
    member.baptismDate.toDate() > twentyFourMonthsAgo
  );



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

    inactiveNewConverts: inactiveNewConverts.length,

    inactive: inactiveMembers.length,

    familyFocusCompanionships: familyFocusCompanionships.length,

    problematicCompanionships: problematicCompanionships.length,

    healthConcerns: healthConcerns.length

  };



  return (

    <section className="page-section">

      {/* Header */}

      <div className="flex flex-col gap-2">

        <h1 className="text-balance text-fluid-title font-semibold tracking-tight">Observaciones</h1>

        <p className="text-balance text-fluid-subtitle text-muted-foreground">

          Seguimiento de miembros que requieren atención especial.

        </p>

      </div>



      {/* Stats Cards */}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">

        <Card className="cursor-pointer" onClick={() => withoutEndowmentRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Sin Investidura</CardTitle>

            <AlertTriangle className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.withoutEndowment}</div>

            <p className="text-xs text-muted-foreground">miembros sin ordenanza de investidura</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => withoutElderOrdinationRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Sin Ordenanza de Elderes</CardTitle>

            <UserCheck className="h-4 w-4 text-purple-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-purple-600">{observationCounts.withoutElderOrdination}</div>

            <p className="text-xs text-muted-foreground">miembros sin ordenanza de élder</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => withoutHigherPriesthoodRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Sin Sacerdocio Mayor</CardTitle>

            <UserCheck className="h-4 w-4 text-indigo-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-indigo-600">{observationCounts.withoutHigherPriesthood}</div>

            <p className="text-xs text-muted-foreground">miembros sin sacerdocio mayor</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => withoutMinisteringRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Sin Ministrantes</CardTitle>

            <UserX className="h-4 w-4 text-blue-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-blue-600">{observationCounts.withoutMinistering}</div>

            <p className="text-xs text-muted-foreground">miembros sin maestros ministrantes</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => inactiveNewConvertsRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nuevos Conversos Inactivos</CardTitle>
            <UserX className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{observationCounts.inactiveNewConverts}</div>
            <p className="text-xs text-muted-foreground">conversos recientes marcados como inactivos</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => inactiveRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inactivos</CardTitle>
            <UserX className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{observationCounts.inactive}</div>
            <p className="text-xs text-muted-foreground">miembros inactivos</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => familyFocusCompanionshipsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Familias en seguimiento</CardTitle>

            <Users className="h-4 w-4 text-sky-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-sky-600">{observationCounts.familyFocusCompanionships}</div>

            <p className="text-xs text-muted-foreground">compañerismos con familias menos activas o inactivas</p>

          </CardContent>

        </Card>



        <Card className="cursor-pointer" onClick={() => problematicCompanionshipsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Compañerías Problemáticas</CardTitle>

            <Users className="h-4 w-4 text-orange-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-orange-600">{observationCounts.problematicCompanionships}</div>

            <p className="text-xs text-muted-foreground">compañerías con compañeros inactivos</p>

          </CardContent>

        </Card>

        <Card className="cursor-pointer" onClick={() => healthConcernsRef.current?.scrollIntoView({ behavior: 'smooth' })}>

          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">

            <CardTitle className="text-sm font-medium">Apoyo de Salud</CardTitle>

            <HeartPulse className="h-4 w-4 text-rose-600" />

          </CardHeader>

          <CardContent>

            <div className="text-2xl font-bold text-rose-600">{observationCounts.healthConcerns}</div>

            <p className="text-xs text-muted-foreground">personas con seguimiento de salud</p>

          </CardContent>

        </Card>

      </div>



      {/* Sección Salud */}
      <Card ref={healthConcernsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-rose-600" />
            Personas con Necesidades de Salud
          </CardTitle>
          <CardDescription>
            Registra y coordina el apoyo para quienes enfrentan desafíos de salud dentro del barrio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-sm text-muted-foreground">
              Agrega manualmente a los hermanos o amigos que requieren visitas, ayuda específica o seguimiento por motivos de salud.
            </p>
            <Button onClick={() => handleOpenHealthDialog()} disabled={savingHealthConcern} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Agregar persona
            </Button>
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Observación</TableHead>
                  <TableHead>Miembros de apoyo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {healthLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-64" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-36" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : healthConcerns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No hay personas registradas con seguimiento de salud.
                    </TableCell>
                  </TableRow>
                ) : (
                  healthConcerns.map((concern) => {
                    const helperIds = Array.isArray(concern.helperIds) ? concern.helperIds : [];
                    const helpers = helperIds.length > 0
                      ? helperIds.map((helperId, index) => {
                        const helper = membersById.get(helperId);
                        const helperName = helper
                          ? `${helper.firstName} ${helper.lastName}`
                          : (concern.helperNames?.[index] ?? 'Miembro sin registro');
                        return (
                          <Badge key={`${concern.id}-${helperId}-${index}`} variant="outline" className="text-xs font-normal">
                            {helperName}
                          </Badge>
                        );
                      })
                      : [];

                    const createdAtLabel = concern.createdAt
                      ? format(concern.createdAt.toDate(), 'd MMM yyyy', { locale: es })
                      : 'Fecha no disponible';

                    return (
                      <TableRow key={concern.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={concern.photoURL || undefined}
                                alt={`${concern.firstName} ${concern.lastName}`}
                              />
                              <AvatarFallback>{getInitials(concern.firstName, concern.lastName)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{concern.firstName} {concern.lastName}</p>
                              <p className="text-xs text-muted-foreground">Registrado el {createdAtLabel}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="text-sm text-muted-foreground break-words">{concern.address}</p>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="text-sm text-muted-foreground break-words">{concern.observation}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {helpers.length > 0 ? helpers : <span className="text-sm text-muted-foreground">Sin asignar</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenHealthDialog(concern)}
                              disabled={savingHealthConcern}
                              title="Editar registro"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteHealthConcern(concern)}
                              disabled={deletingHealthConcernId === concern.id}
                              title="Eliminar registro"
                            >
                              {deletingHealthConcernId === concern.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden space-y-4">
            {healthLoading ? (
              Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-36 w-full" />
              ))
            ) : healthConcerns.length === 0 ? (
              <div className="py-12 text-center">
                <HeartPulse className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No hay personas registradas con seguimiento de salud.
                </p>
              </div>
            ) : (
              healthConcerns.map((concern) => {
                const helperIds = Array.isArray(concern.helperIds) ? concern.helperIds : [];
                const helpers = helperIds.length > 0
                  ? helperIds.map((helperId, index) => {
                    const helper = membersById.get(helperId);
                    const helperName = helper
                      ? `${helper.firstName} ${helper.lastName}`
                      : (concern.helperNames?.[index] ?? 'Miembro sin registro');
                    return (
                      <Badge key={`${concern.id}-${helperId}-${index}`} variant="outline" className="text-xs font-normal">
                        {helperName}
                      </Badge>
                    );
                  })
                  : [];

                const createdAtLabel = concern.createdAt
                  ? format(concern.createdAt.toDate(), 'd MMM yyyy', { locale: es })
                  : 'Fecha no disponible';

                return (
                  <Card key={concern.id}>
                    <CardContent className="space-y-4 pt-4">
                      <div className="flex items-start gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage
                            src={concern.photoURL || undefined}
                            alt={`${concern.firstName} ${concern.lastName}`}
                          />
                          <AvatarFallback>{getInitials(concern.firstName, concern.lastName)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{concern.firstName} {concern.lastName}</h3>
                          <p className="text-sm text-muted-foreground">{concern.address}</p>
                          <p className="text-xs text-muted-foreground mt-1">Registrado el {createdAtLabel}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Observación</p>
                        <p className="mt-1 text-sm text-muted-foreground">{concern.observation}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Miembros de apoyo</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {helpers.length > 0 ? helpers : <span className="text-sm text-muted-foreground">Sin asignar</span>}
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenHealthDialog(concern)}
                          disabled={savingHealthConcern}
                          title="Editar registro"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteHealthConcern(concern)}
                          disabled={deletingHealthConcernId === concern.id}
                          title="Eliminar registro"
                        >
                          {deletingHealthConcernId === concern.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sección Sin Investidura */}

      <Card ref={withoutEndowmentRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <AlertTriangle className="h-5 w-5 text-orange-600" />

            Miembros Sin Ordenanza de Investidura

          </CardTitle>

          <CardDescription>

            Miembros que no han recibido la ordenanza del templo de investidura.

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Nombre</TableHead>

                  <TableHead>Teléfono</TableHead>

                  <TableHead>Estado</TableHead>

                  <TableHead>Ordenanzas Recibidas</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutEndowment.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      Todos los miembros han recibido la investidura.

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutEndowment.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

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

                        <TableCell>{renderPhoneWithAge(member, 'No especificado')}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {statusInfo.label}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {OrdinanceLabels[ordinance]}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">Ninguna</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title="Ver perfil"

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutEndowment.length === 0 ? (

              <div className="text-center py-12">

                <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  Todos los miembros han recibido la investidura.

                </p>

              </div>

            ) : (

              membersWithoutEndowment.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

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

                              {renderPhoneWithAge(member, 'Sin teléfono')}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {statusInfo.label}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Ordenanzas:</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {OrdinanceLabels[ordinance]}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">Ninguna</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          Ver Perfil

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Sin Ordenanza de Elderes */}

      <Card ref={withoutElderOrdinationRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserCheck className="h-5 w-5 text-purple-600" />

            Miembros Sin Ordenanza de Elderes

          </CardTitle>

          <CardDescription>

            Miembros que no han recibido la ordenanza de élder (sacerdocio mayor).

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Nombre</TableHead>

                  <TableHead>Teléfono</TableHead>

                  <TableHead>Estado</TableHead>

                  <TableHead>Ordenanzas Recibidas</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutElderOrdination.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      Todos los miembros han recibido la ordenanza de élder.

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutElderOrdination.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

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

                        <TableCell>{renderPhoneWithAge(member, 'No especificado')}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {statusInfo.label}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {OrdinanceLabels[ordinance]}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">Ninguna</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title="Ver perfil"

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutElderOrdination.length === 0 ? (

              <div className="text-center py-12">

                <UserCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  Todos los miembros han recibido la ordenanza de élder.

                </p>

              </div>

            ) : (

              membersWithoutElderOrdination.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

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

                              {renderPhoneWithAge(member, 'Sin teléfono')}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {statusInfo.label}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Ordenanzas:</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {OrdinanceLabels[ordinance]}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">Ninguna</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          Ver Perfil

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Sin Sacerdocio Mayor */}

      <Card ref={withoutHigherPriesthoodRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserCheck className="h-5 w-5 text-indigo-600" />

            Miembros Sin Sacerdocio Mayor

          </CardTitle>

          <CardDescription>

            Miembros que no han recibido la ordenanza de élder ni de sumo sacerdote (sacerdocio mayor).

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Nombre</TableHead>

                  <TableHead>Teléfono</TableHead>

                  <TableHead>Estado</TableHead>

                  <TableHead>Ordenanzas Recibidas</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-36" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutHigherPriesthood.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      Todos los miembros han recibido el sacerdocio mayor.

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutHigherPriesthood.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

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

                        <TableCell>{renderPhoneWithAge(member, 'No especificado')}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {statusInfo.label}

                          </Badge>

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {member.ordinances && member.ordinances.length > 0 ? (

                              member.ordinances.map((ordinance) => (

                                <Badge key={ordinance} variant="outline" className="text-xs">

                                  {OrdinanceLabels[ordinance]}

                                </Badge>

                              ))

                            ) : (

                              <span className="text-muted-foreground text-sm">Ninguna</span>

                            )}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title="Ver perfil"

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutHigherPriesthood.length === 0 ? (

              <div className="text-center py-12">

                <UserCheck className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  Todos los miembros han recibido el sacerdocio mayor.

                </p>

              </div>

            ) : (

              membersWithoutHigherPriesthood.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

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

                              {renderPhoneWithAge(member, 'Sin teléfono')}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {statusInfo.label}

                        </Badge>

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Ordenanzas:</p>

                        <div className="flex flex-wrap gap-1">

                          {member.ordinances && member.ordinances.length > 0 ? (

                            member.ordinances.map((ordinance) => (

                              <Badge key={ordinance} variant="outline" className="text-xs">

                                {OrdinanceLabels[ordinance]}

                              </Badge>

                            ))

                          ) : (

                            <span className="text-muted-foreground text-sm">Ninguna</span>

                          )}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          Ver Perfil

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Sin Maestros Ministrantes */}

      <Card ref={withoutMinisteringRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserX className="h-5 w-5 text-blue-600" />

            Miembros Sin Maestros Ministrantes

          </CardTitle>

          <CardDescription>

            Miembros que no tienen asignados maestros ministrantes.

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Nombre</TableHead>

                  <TableHead>Teléfono</TableHead>

                  <TableHead>Estado</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : membersWithoutMinistering.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={4} className="h-24 text-center">

                      Todos los miembros tienen maestros ministrantes asignados.

                    </TableCell>

                  </TableRow>

                ) : (

                  membersWithoutMinistering.map((member) => {

                    const statusInfo = statusConfig[member.status];

                    const StatusIcon = statusInfo.icon;



                    return (

                      <TableRow key={member.id}>

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

                        <TableCell>{renderPhoneWithAge(member, 'No especificado')}</TableCell>

                        <TableCell>

                          <Badge variant={statusInfo.variant} className="gap-1">

                            <StatusIcon className="h-3 w-3" />

                            {statusInfo.label}

                          </Badge>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => handleViewProfile(member.id)}

                            title="Ver perfil"

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : membersWithoutMinistering.length === 0 ? (

              <div className="text-center py-12">

                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  Todos los miembros tienen maestros ministrantes asignados.

                </p>

              </div>

            ) : (

              membersWithoutMinistering.map((member) => {

                const statusInfo = statusConfig[member.status];

                const StatusIcon = statusInfo.icon;



                return (

                  <Card key={member.id}>

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

                              {renderPhoneWithAge(member, 'Sin teléfono')}

                            </p>

                          </div>

                        </div>

                        <Badge variant={statusInfo.variant} className="gap-1">

                          <StatusIcon className="h-3 w-3" />

                          {statusInfo.label}

                        </Badge>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          Ver Perfil

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Nuevos Conversos Inactivos */}
      <Card ref={inactiveNewConvertsRef}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-amber-600" />
            Nuevos Conversos Inactivos
          </CardTitle>
          <CardDescription>
            Conversos bautizados en los últimos 24 meses que están marcados como inactivos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Fecha de Bautismo</TableHead>
                  <TableHead>Última Actividad</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : inactiveNewConverts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      No hay nuevos conversos inactivos.
                    </TableCell>
                  </TableRow>
                ) : (
                  inactiveNewConverts.map((member) => (
                    <TableRow key={member.id}>
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
                      <TableCell>
                        {member.baptismDate
                          ? format(member.baptismDate.toDate(), 'd MMM yyyy', { locale: es })
                          : 'No especificada'}
                      </TableCell>
                      <TableCell>
                        {member.lastActiveDate
                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: es })
                          : 'Nunca'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewProfile(member.id)}
                          title="Ver perfil"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))
            ) : inactiveNewConverts.length === 0 ? (
              <div className="text-center py-12">
                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No hay nuevos conversos inactivos.
                </p>
              </div>
            ) : (
              inactiveNewConverts.map((member) => (
                <Card key={member.id}>
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
                            Bautismo: {member.baptismDate
                              ? format(member.baptismDate.toDate(), 'd MMM yyyy', { locale: es })
                              : 'No especificada'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mb-3">
                      Última actividad: {member.lastActiveDate
                        ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: es })
                        : 'Nunca'}
                    </p>

                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewProfile(member.id)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Ver Perfil
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sección Miembros Inactivos */}

      <Card ref={inactiveRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <UserX className="h-5 w-5 text-red-600" />

            Miembros Inactivos

          </CardTitle>

          <CardDescription>

            Miembros marcados como inactivos que requieren seguimiento especial.

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Nombre</TableHead>

                  <TableHead>Teléfono</TableHead>

                  <TableHead>Fecha de Nacimiento</TableHead>

                  <TableHead>Última Actividad</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-28" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : inactiveMembers.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={5} className="h-24 text-center">

                      No hay miembros inactivos.

                    </TableCell>

                  </TableRow>

                ) : (

                  inactiveMembers.map((member) => (

                    <TableRow key={member.id}>

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

                      <TableCell>{renderPhoneWithAge(member, 'No especificado')}</TableCell>

                      <TableCell>

                        {member.birthDate

                          ? format(member.birthDate.toDate(), 'd MMM yyyy', { locale: es })

                          : 'No especificada'}

                      </TableCell>

                      <TableCell>

                        {member.lastActiveDate

                          ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: es })

                          : 'Nunca'}

                      </TableCell>

                      <TableCell className="text-right">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => handleViewProfile(member.id)}

                          title="Ver perfil"

                        >

                          <Eye className="h-4 w-4" />

                        </Button>

                      </TableCell>

                    </TableRow>

                  ))

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : inactiveMembers.length === 0 ? (

              <div className="text-center py-12">

                <UserX className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  No hay miembros inactivos.

                </p>

              </div>

            ) : (

              inactiveMembers.map((member) => (

                <Card key={member.id}>

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

                            {renderPhoneWithAge(member, 'Sin teléfono')}

                          </p>

                        </div>

                      </div>

                    </div>






                    <p className="text-sm text-muted-foreground mb-3">

                      Última actividad: {member.lastActiveDate

                        ? format(member.lastActiveDate.toDate(), 'd MMM yyyy', { locale: es })

                        : 'Nunca'}

                    </p>



                    <div className="flex justify-end">

                      <Button

                        variant="outline"

                        size="sm"

                        onClick={() => handleViewProfile(member.id)}

                      >

                        <Eye className="mr-2 h-4 w-4" />

                        Ver Perfil

                      </Button>

                    </div>

                  </CardContent>

                </Card>

              ))

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Compañerismos con familias menos activas */}

      <Card ref={familyFocusCompanionshipsRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <Users className="h-5 w-5 text-sky-600" />

            Familias que necesitan visita

          </CardTitle>

          <CardDescription>Compañerismos con familias asignadas donde hay miembros menos activos o inactivos.</CardDescription>

        </CardHeader>

        <CardContent>

          {/* Desktop Table */}

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Compañerismo</TableHead>

                  <TableHead>Familias y estado</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-52" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : familyFocusCompanionships.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">

                      No hay familias menos activas asignadas actualmente.

                    </TableCell>

                  </TableRow>

                ) : (

                  familyFocusCompanionships.map((companionship) => (

                    <TableRow key={companionship.id}>

                      <TableCell className="font-medium">

                        {companionship.companions.map((c, i) => (

                          <div key={i}>

                            <span>{c}</span>

                            {i < companionship.companions.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </TableCell>

                      <TableCell>

                        {companionship.flaggedFamilies.map((flagged, index) => (

                          <div key={flagged.family.name} className="space-y-1 py-1">

                            <p className="font-medium">{flagged.family.name}</p>

                            <div className="flex flex-wrap gap-1">

                              {flagged.members.map((member) => {

                                const statusInfo = statusConfig[member.status];

                                const StatusIcon = statusInfo.icon;

                                return (

                                  <Badge key={member.id} variant={statusInfo.variant} className="gap-1">

                                    <StatusIcon className="h-3 w-3" />

                                    {member.firstName} {member.lastName}

                                  </Badge>

                                );

                              })}

                            </div>

                            {index < companionship.flaggedFamilies.length - 1 && <div className="my-2 h-px bg-muted" />}

                          </div>

                        ))}

                      </TableCell>

                      <TableCell className="text-right">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => router.push(`/ministering/${companionship.id}`)}

                          title="Ver compañerismo"

                        >

                          <Eye className="h-4 w-4" />

                        </Button>

                      </TableCell>

                    </TableRow>

                  ))

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)

            ) : familyFocusCompanionships.length === 0 ? (

              <div className="text-center py-12">

                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">No hay familias menos activas asignadas actualmente.</p>

              </div>

            ) : (

              familyFocusCompanionships.map((companionship) => (

                <Card key={companionship.id}>

                  <CardContent className="pt-4 space-y-4">

                    <div>

                      <p className="text-sm font-medium mb-2">Compañeros:</p>

                      {companionship.companions.map((c, i) => (

                        <div key={i}>

                          <p>{c}</p>

                          {i < companionship.companions.length - 1 && <hr className="my-1" />}

                        </div>

                      ))}

                    </div>

                    <div>

                      <p className="text-sm font-medium mb-2">Familias por animar:</p>

                      {companionship.flaggedFamilies.map((flagged) => (

                        <div key={flagged.family.name} className="mb-3 last:mb-0">

                          <p className="font-semibold">{flagged.family.name}</p>

                          <div className="mt-1 flex flex-wrap gap-1">

                            {flagged.members.map((member) => {

                              const statusInfo = statusConfig[member.status];

                              const StatusIcon = statusInfo.icon;

                              return (

                                <Badge key={member.id} variant={statusInfo.variant} className="gap-1">

                                  <StatusIcon className="h-3 w-3" />

                                  {member.firstName}

                                </Badge>

                              );

                            })}

                          </div>

                        </div>

                      ))}

                    </div>

                    <div className="flex justify-end">

                      <Button

                        variant="outline"

                        size="sm"

                        onClick={() => router.push(`/ministering/${companionship.id}`)}

                      >

                        <Eye className="mr-2 h-4 w-4" />Ver más

                      </Button>

                    </div>

                  </CardContent>

                </Card>

              ))

            )}

          </div>

        </CardContent>

      </Card>



      {/* Sección Compañerías Problemáticas */}

      <Card ref={problematicCompanionshipsRef}>

        <CardHeader>

          <CardTitle className="flex items-center gap-2">

            <Users className="h-5 w-5 text-orange-600" />

            Compañerías con Compañeros Inactivos o Menos Activos

          </CardTitle>

          <CardDescription>

            Compañerías de ministración donde uno o más compañeros están marcados como inactivos o menos activos.

          </CardDescription>

        </CardHeader>

        <CardContent>

          <div className="hidden md:block">

            <Table>

              <TableHeader>

                <TableRow>

                  <TableHead>Compañeros</TableHead>

                  <TableHead>Familias Asignadas</TableHead>

                  <TableHead>Estado de Compañeros</TableHead>

                  <TableHead className="text-right">Acciones</TableHead>

                </TableRow>

              </TableHeader>

              <TableBody>

                {loading ? (

                  Array.from({ length: 3 }).map((_, i) => (

                    <TableRow key={i}>

                      <TableCell><Skeleton className="h-5 w-40" /></TableCell>

                      <TableCell><Skeleton className="h-5 w-48" /></TableCell>

                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>

                      <TableCell className="text-right"><Skeleton className="h-8 w-24" /></TableCell>

                    </TableRow>

                  ))

                ) : problematicCompanionships.length === 0 ? (

                  <TableRow>

                    <TableCell colSpan={4} className="h-24 text-center">

                      Todas las compañerías tienen compañeros activos.

                    </TableCell>

                  </TableRow>

                ) : (

                  problematicCompanionships.map((companionship) => {

                    const inactiveCompanions = companionship.companions.filter(companionName => {

                      const member = members.find(m =>

                        `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                      );

                      return member && (member.status === 'less_active' || member.status === 'inactive');

                    });



                    return (

                      <TableRow key={companionship.id}>

                        <TableCell className="font-medium">

                          {companionship.companions.map((c, i) => (

                            <div key={i}>

                              <span>{c}</span>

                              {i < companionship.companions.length - 1 && <hr className="my-1" />}

                            </div>

                          ))}

                        </TableCell>

                        <TableCell>

                          {companionship.families.map((f, i) => (

                            <div key={i}>

                              <span>{f.name}</span>

                              {i < companionship.families.length - 1 && <hr className="my-1" />}

                            </div>

                          ))}

                        </TableCell>

                        <TableCell>

                          <div className="flex flex-wrap gap-1">

                            {inactiveCompanions.map((companionName, i) => {

                              const member = members.find(m =>

                                `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                              );

                              if (!member) return null;

                              const statusInfo = statusConfig[member.status];

                              const StatusIcon = statusInfo.icon;

                              return (

                                <Badge key={i} variant={statusInfo.variant} className="gap-1">

                                  <StatusIcon className="h-3 w-3" />

                                  {statusInfo.label}

                                </Badge>

                              );

                            })}

                          </div>

                        </TableCell>

                        <TableCell className="text-right">

                          <Button

                            variant="outline"

                            size="sm"

                            onClick={() => router.push(`/ministering/${companionship.id}`)}

                            title="Ver compañería"

                          >

                            <Eye className="h-4 w-4" />

                          </Button>

                        </TableCell>

                      </TableRow>

                    );

                  })

                )}

              </TableBody>

            </Table>

          </div>



          {/* Mobile Cards */}

          <div className="md:hidden space-y-4">

            {loading ? (

              Array.from({ length: 2 }).map((_, i) => (

                <Skeleton key={i} className="h-32 w-full" />

              ))

            ) : problematicCompanionships.length === 0 ? (

              <div className="text-center py-12">

                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />

                <p className="text-muted-foreground">

                  Todas las compañerías tienen compañeros activos.

                </p>

              </div>

            ) : (

              problematicCompanionships.map((companionship) => {

                const inactiveCompanions = companionship.companions.filter(companionName => {

                  const member = members.find(m =>

                    `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                  );

                  return member && (member.status === 'less_active' || member.status === 'inactive');

                });



                return (

                  <Card key={companionship.id}>

                    <CardContent className="pt-4">

                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Compañeros:</p>

                        {companionship.companions.map((c, i) => (

                          <div key={i}>

                            <p>{c}</p>

                            {i < companionship.companions.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Familias:</p>

                        {companionship.families.map((f, i) => (

                          <div key={i}>

                            <p>{f.name}</p>

                            {i < companionship.families.length - 1 && <hr className="my-1" />}

                          </div>

                        ))}

                      </div>



                      <div className="mb-3">

                        <p className="text-sm font-medium mb-2">Estado de Compañeros:</p>

                        <div className="flex flex-wrap gap-1">

                          {inactiveCompanions.map((companionName, i) => {

                            const member = members.find(m =>

                              `${m.firstName} ${m.lastName}`.toLowerCase() === companionName.toLowerCase()

                            );

                            if (!member) return null;

                            const statusInfo = statusConfig[member.status];

                            const StatusIcon = statusInfo.icon;

                            return (

                              <Badge key={i} variant={statusInfo.variant} className="gap-1">

                                <StatusIcon className="h-3 w-3" />

                                {statusInfo.label}

                              </Badge>

                            );

                          })}

                        </div>

                      </div>



                      <div className="flex justify-end">

                        <Button

                          variant="outline"

                          size="sm"

                          onClick={() => router.push(`/ministering/${companionship.id}`)}

                        >

                          <Eye className="mr-2 h-4 w-4" />

                          Ver Compañería

                        </Button>

                      </div>

                    </CardContent>

                  </Card>

                );

              })

            )}

          </div>

        </CardContent>

      </Card>



      <Dialog
        open={healthDialogOpen}
        onOpenChange={(open) => {
          setHealthDialogOpen(open);
          if (!open) {
            resetHealthForm();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditingHealthConcern ? 'Editar persona con necesidades de salud' : 'Agregar persona con necesidades de salud'}
            </DialogTitle>
            <DialogDescription>
              {isEditingHealthConcern
                ? 'Actualiza la información para mantener coordinado el apoyo de salud.'
                : 'Completa la información para organizar las visitas y el apoyo necesario.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...healthForm}>
            <form onSubmit={healthForm.handleSubmit(handleHealthSubmit)} className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={photoPreview || undefined} alt="Foto seleccionada" />
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
                    {photoPreview ? 'Cambiar foto' : 'Subir foto'}
                  </Button>
                  {photoPreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleRemovePhoto}
                      disabled={savingHealthConcern}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Quitar
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
                aria-label="Seleccionar foto para preocupación de salud"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={healthForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Nombre" disabled={savingHealthConcern} />
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
                      <FormLabel>Apellido</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Apellido" disabled={savingHealthConcern} />
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
                      <FormLabel>Dirección</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Dirección o punto de referencia"
                          disabled={savingHealthConcern}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="observation"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Observación</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Detalle la situación de salud y acciones sugeridas."
                          rows={4}
                          disabled={savingHealthConcern}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={healthForm.control}
                  name="helperIds"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Miembros que ayudarán</FormLabel>
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
                                  ? `${field.value.length} miembro${field.value.length > 1 ? 's' : ''} seleccionados`
                                  : 'Seleccionar miembros'}
                                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              sideOffset={8}
                              className="w-[min(320px,90vw)] max-h-[min(60vh,420px)] overflow-y-auto p-0"
                            >
                              {loading ? (
                                <div className="px-3 py-6 text-sm text-muted-foreground">Cargando miembros...</div>
                              ) : members.length === 0 ? (
                                <div className="px-3 py-6 text-sm text-muted-foreground">No hay miembros disponibles.</div>
                              ) : (
                                <Command>
                                  <CommandInput placeholder="Buscar miembro..." />
                                  <CommandEmpty>No se encontraron miembros.</CommandEmpty>
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
                                          <div className="flex items-center gap-2">
                                            <Check className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                                            <span className="flex-1">{member.firstName} {member.lastName}</span>
                                            <Badge variant={statusInfo.variant} className="text-[10px]">
                                              {statusInfo.label}
                                            </Badge>
                                          </div>
                                        </CommandItem>
                                      );
                                    })}
                                  </CommandGroup>
                                </Command>
                              )}
                            </PopoverContent>
                          </Popover>
                          <div className="flex flex-wrap gap-2">
                            {field.value.length === 0 ? (
                              <span className="text-sm text-muted-foreground">
                                Selecciona al menos un miembro que brindará apoyo.
                              </span>
                            ) : (
                              field.value.map((helperId, index) => {
                                const helper = membersById.get(helperId);
                                const helperName = helper
                                  ? `${helper.firstName} ${helper.lastName}`
                                  : 'Miembro sin registro';
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
                                      aria-label={`Quitar ${helperName}`}
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
              </div>
              <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHealthDialogOpen(false);
                    resetHealthForm();
                  }}
                  disabled={savingHealthConcern}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={savingHealthConcern}>
                  {savingHealthConcern ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isEditingHealthConcern ? 'Actualizando...' : 'Guardando...'}
                    </>
                  ) : (
                    isEditingHealthConcern ? 'Actualizar registro' : 'Guardar registro'
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

          title="Volver al inicio"

        >

          <ChevronUp className="h-5 w-5" />

        </Button>

      )}

    </section>

  );

}
