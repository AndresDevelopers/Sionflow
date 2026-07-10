'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import * as z from 'zod';
import Image from 'next/image';
import { Upload, X, CalendarIcon, MapPin, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { cn } from '@/lib/utils';
import { getAppName } from "@/lib/app-config";
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import type { Member, MemberStatus, Ordinance } from '@/lib/types';
import { OrdinanceLabels } from '@/lib/types';
import { createMember, updateMember, uploadMemberPhoto, uploadBaptismPhotos, getMembersForSelector, searchMembersByName, getMemberById } from '@/lib/members-data';
import { syncMinisteringAssignments } from '@/lib/ministering-sync';
import { createNotificationsForAll } from '@/lib/notification-helpers';
import { Timestamp } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { safeGetDate } from '@/lib/date-utils';
import { normalizeDateForEcuadorStorage } from '@/lib/date-utils';

const createMemberFormSchema = (t: (key: string) => string) =>
  z.object({
    firstName: z.string().min(1, t('memberForm.validation.firstName')),
    lastName: z.string().min(1, t('memberForm.validation.lastName')),
    phoneNumber: z.string().optional(),
    memberId: z.string().optional(),
    address: z.string().optional(),
    birthDate: z.date().optional(),
    baptismDate: z.date().optional(),
    deathDate: z.date().optional(),
    status: z.enum(['active', 'less_active', 'inactive', 'deceased'] as const),
    photoURL: z.string().nullable().optional(),
    baptismPhotos: z.array(z.string()).optional(),
    ordinances: z.array(z.enum(['baptism', 'confirmation', 'elder_ordination', 'endowment', 'sealed_spouse', 'sealed_to_father', 'sealed_to_mother', 'high_priest_ordination', 'aronico_ordination'] as const)).optional(),
    templeOrdinances: z.array(z.enum(['baptism', 'confirmation', 'initiatory', 'endowment', 'sealed_to_father', 'sealed_to_mother', 'sealed_to_spouse'] as const)).optional(),
    ministeringTeachers: z.array(z.string()).optional(),
    isUrgent: z.boolean().optional(),
    isInCouncil: z.boolean().optional(),
    inactiveSince: z.date().optional(),
    inactiveObservation: z.string().optional(),
    lessActiveSince: z.date().optional(),
    lessActiveObservation: z.string().optional(),
  });

const normalizeMemberStatus = (status?: string | null): MemberStatus => {
  if (!status) return 'active';

  const normalized = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(normalized)) return 'deceased';
  if (['inactive', 'inactivo'].includes(normalized)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(normalized)) {
    return 'less_active';
  }
  if (['active', 'activo'].includes(normalized)) return 'active';

  return 'active';
};

type MemberFormValues = z.infer<ReturnType<typeof createMemberFormSchema>>;

interface MemberFormProps {
  member?: Member | null;
  onClose: () => void;
}

export function MemberForm({ member, onClose }: MemberFormProps) {
  const { user, loading: authLoading, barrioOrg, organizacion } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const memberFormSchema = useMemo(() => createMemberFormSchema(t), [t]);
  const [loading, setLoading] = useState(false);
  const [resolvedMember, setResolvedMember] = useState<Member | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [baptismPhotoFiles, setBaptismPhotoFiles] = useState<File[]>([]);
  const [baptismPhotoPreviews, setBaptismPhotoPreviews] = useState<string[]>([]);
  const [availableMembers, setAvailableMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  // Estados para el diálogo de duplicados
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicateMembers, setDuplicateMembers] = useState<Member[]>([]);
  const [allowContinueWithDuplicate, setAllowContinueWithDuplicate] = useState(false);
  const [duplicateDecisionMade, setDuplicateDecisionMade] = useState(false);

  // Estado local para el input de fecha de fallecimiento (mantiene texto DD/MM/YYYY)
  const [deathDateInput, setDeathDateInput] = useState('');



  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phoneNumber: '',
      memberId: '',
      status: 'active',
      photoURL: undefined,
      baptismDate: undefined,
      deathDate: undefined,
      ordinances: [],
      templeOrdinances: [],
      ministeringTeachers: [],
      inactiveSince: undefined,
      inactiveObservation: '',
      lessActiveSince: undefined,
      lessActiveObservation: '',
    },
  });

  // Cargar datos reales del miembro (por ID) para asegurar estado correcto
  useEffect(() => {
    let isActive = true;

    if (!member?.id) {
      setResolvedMember(member ?? null);
      return () => {
        isActive = false;
      };
    }

    getMemberById(member.id)
      .then((freshMember) => {
        if (isActive) {
          setResolvedMember(freshMember ?? member);
        }
      })
      .catch(() => {
        if (isActive) {
          setResolvedMember(member);
        }
      });

    return () => {
      isActive = false;
    };
  }, [member]);

  // Cargar datos del miembro al formulario
  useEffect(() => {
    // Reset loading state when member changes
    setLoading(false);

    // Reset duplicate states when loading a member
    setDuplicateMembers([]);
    setShowDuplicateDialog(false);
    setAllowContinueWithDuplicate(false);
    setDuplicateDecisionMade(false);

    const currentMember = resolvedMember ?? member;

    if (currentMember) {
      // Convertir Timestamps a Date y preparar valores para el formulario
      const birthDateValue = safeGetDate((currentMember as any).birthDate) ?? undefined;
      const baptismDateValue = safeGetDate((currentMember as any).baptismDate) ?? undefined;
      const deathDateValue = safeGetDate((currentMember as any).deathDate) ?? undefined;
      const memberStatus = normalizeMemberStatus(currentMember.status);

      const valuesToSet = {
        firstName: currentMember.firstName || '',
        lastName: currentMember.lastName || '',
        phoneNumber: currentMember.phoneNumber || '',
        memberId: currentMember.memberId || '',
        address: currentMember.address || '',
        birthDate: birthDateValue,
        baptismDate: baptismDateValue,
        deathDate: deathDateValue,
        status: memberStatus,
        photoURL: (currentMember.photoURL && currentMember.photoURL.trim()) ?? undefined,
        baptismPhotos: currentMember.baptismPhotos || [],
        ordinances: memberStatus === 'deceased'
          ? ((currentMember as any).templeOrdinances || [])
          : (currentMember.ordinances || []),
        templeOrdinances: (currentMember as any).templeOrdinances || [],
        ministeringTeachers: currentMember.ministeringTeachers || [],
        isUrgent: currentMember.isUrgent || false,
        isInCouncil: currentMember.isInCouncil || false,
        inactiveSince: safeGetDate((currentMember as any).inactiveSince) ?? undefined,
        inactiveObservation: (currentMember as any).inactiveObservation || '',
        lessActiveSince: safeGetDate((currentMember as any).lessActiveSince) ?? undefined,
        lessActiveObservation: (currentMember as any).lessActiveObservation || '',
      };

      // Reset form with new values and trigger validation
      form.reset(valuesToSet);
      form.setValue('status', valuesToSet.status, { shouldValidate: true });

      // Set photo preview - treat empty strings as no photo
      const photoUrl = currentMember.photoURL && currentMember.photoURL.trim() ? currentMember.photoURL : null;
      setPhotoPreview(photoUrl);
      setPhotoFile(null); // Clear any selected file when loading existing member

      // Set baptism photos
      setBaptismPhotoPreviews(currentMember.baptismPhotos || []);
      setBaptismPhotoFiles([]); // Clear any selected files when loading existing member

      // Actualizar el estado local del input de fecha de fallecimiento
      setDeathDateInput(formatDateForDisplay(deathDateValue));

    } else {
      // Reset to empty form for new member
      form.reset({
        firstName: '',
        lastName: '',
        phoneNumber: '',
        memberId: '',
        status: 'active',
        photoURL: undefined,
        birthDate: undefined,
        baptismDate: undefined,
        deathDate: undefined,
        baptismPhotos: [],
        ordinances: [],
        templeOrdinances: [],
        ministeringTeachers: [],
        isUrgent: false,
        isInCouncil: false,
        inactiveSince: undefined,
        inactiveObservation: '',
        lessActiveSince: undefined,
        lessActiveObservation: '',
      });
      form.setValue('status', 'active', { shouldValidate: true });
      setPhotoPreview(null);
      setPhotoFile(null);
      setBaptismPhotoPreviews([]);
      setBaptismPhotoFiles([]);

      // Limpiar el input de fecha de fallecimiento
      setDeathDateInput('');

      // Reset duplicate states for new member
      setDuplicateMembers([]);
      setShowDuplicateDialog(false);
      setAllowContinueWithDuplicate(false);
      setDuplicateDecisionMade(false);
    }
  }, [member, resolvedMember, form]);

  // Cargar miembros disponibles para ministrantes
  const loadAvailableMembers = useCallback(async () => {
    if (!user) {
      console.log('👤 No user available for loading members');
      return;
    }

    setLoadingMembers(true);
    try {
      console.log('📎 Loading available members for ministering assignment...');
      // Obtener todos los miembros (incluyendo inactivos) para maestros ministrantes
      const members = await getMembersForSelector(true, barrioOrg);
      console.log(`📊 Found ${members.length} available members`);

      // Filtrar el miembro actual si estamos editando
      const filteredMembers = member
        ? members.filter(m => m.id !== member.id)
        : members;

      console.log(`🎣 After filtering: ${filteredMembers.length} members available`);
      setAvailableMembers(filteredMembers);
    } catch (error) {
      console.error('❌ Error loading members for ministering:', error);
      setAvailableMembers([]); // Set empty array as fallback
      // Don't show toast for this error to avoid interrupting user flow
      console.warn('Members for ministering will not be available due to loading error');
    } finally {
      setLoadingMembers(false);
    }
  }, [member, user]);

  // Cargar miembros disponibles cuando el componente se monta
  useEffect(() => {
    if (user && !authLoading) {
      // Usar setTimeout para evitar bloquear el renderizado inicial
      const timer = setTimeout(() => {
        loadAvailableMembers();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [authLoading, loadAvailableMembers, user]);

  // Función para verificar duplicados
  const checkForDuplicates = useCallback(async (firstName: string, lastName: string) => {
    // Solo verificar para nuevos miembros
    if (member) return;

    if (!firstName?.trim() || !lastName?.trim()) {
      setDuplicateMembers([]);
      setShowDuplicateDialog(false);
      setAllowContinueWithDuplicate(false);
      setDuplicateDecisionMade(false);
      return;
    }

    try {
      const duplicates = await searchMembersByName(firstName, lastName);
      setDuplicateMembers(duplicates);
      if (duplicates.length > 0) {
        setShowDuplicateDialog(true);
        setAllowContinueWithDuplicate(false);
        setDuplicateDecisionMade(false);
      } else {
        setShowDuplicateDialog(false);
        setAllowContinueWithDuplicate(false);
        setDuplicateDecisionMade(false);
      }
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      setDuplicateMembers([]);
      setShowDuplicateDialog(false);
      setAllowContinueWithDuplicate(false);
      setDuplicateDecisionMade(false);
    } finally {
    }
  }, [member]);

  const watchedFirstName = useWatch({ control: form.control, name: 'firstName' });
  const watchedLastName = useWatch({ control: form.control, name: 'lastName' });
  const watchedStatus = useWatch({ control: form.control, name: 'status' });

  // Efecto para verificar duplicados automáticamente al escribir
  useEffect(() => {
    const firstName = watchedFirstName;
    const lastName = watchedLastName;

    if (!firstName?.trim() || !lastName?.trim()) {
      setDuplicateMembers([]);
      setShowDuplicateDialog(false);
      setAllowContinueWithDuplicate(false);
      setDuplicateDecisionMade(false);
      return;
    }

    // Verificar inmediatamente si ambos campos tienen al menos 2 caracteres
    if (firstName.trim().length >= 2 && lastName.trim().length >= 2) {
      const timeoutId = setTimeout(() => {
        checkForDuplicates(firstName, lastName);
      }, 150); // Reducir debounce a 150ms para ser más responsivo

      return () => clearTimeout(timeoutId);
    } else {
      // Limpiar duplicados si no hay suficientes caracteres
      setDuplicateMembers([]);
      setShowDuplicateDialog(false);
      setAllowContinueWithDuplicate(false);
      setDuplicateDecisionMade(false);
    }
  }, [checkForDuplicates, watchedFirstName, watchedLastName]);

  useEffect(() => {
    if (watchedStatus !== 'deceased') {
      form.setValue('deathDate', undefined);
      setDeathDateInput('');
    }
  }, [form, watchedStatus]);

  useEffect(() => {
    if (watchedStatus !== 'inactive') {
      form.setValue('inactiveSince', undefined);
      form.setValue('inactiveObservation', '');
    }
  }, [form, watchedStatus]);

  useEffect(() => {
    if (watchedStatus !== 'less_active') {
      form.setValue('lessActiveSince', undefined);
      form.setValue('lessActiveObservation', '');
    }
  }, [form, watchedStatus]);

  // Función para parsear fecha desde string DD/MM/YYYY
  const parseDate = (dateString: string, maxYear: number): Date | undefined => {
    if (!dateString.trim()) return undefined;

    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const match = dateString.match(dateRegex);

    if (!match) return undefined;

    const [, dayStr, monthStr, yearStr] = match;
    const day = parseInt(dayStr, 10);
    const month = parseInt(monthStr, 10) - 1; // JS months are 0-indexed
    const year = parseInt(yearStr, 10);

    // Validate ranges
    if (day < 1 || day > 31 || month < 0 || month > 11 || year < 1900 || year > maxYear) {
      return undefined;
    }

    const date = new Date(year, month, day);

    // Check if date is valid (handles invalid dates like Feb 30)
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
      return undefined;
    }

    return date;
  };

  // Función para formatear fecha para mostrar
  const formatDateForDisplay = (date: Date | undefined): string => {
    if (!date || isNaN(date.getTime())) {
      return '';
    }
    try {
      return format(date, 'dd/MM/yyyy');
    } catch (error) {
      return '';
    }
  };

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: t('common.error'),
          description: t('memberForm.toast.invalidImage'),
          variant: 'destructive'
        });
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: t('common.error'),
          description: t('memberForm.toast.imageTooLarge'),
          variant: 'destructive'
        });
        return;
      }

      setPhotoFile(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    // Clear the photoURL field in the form to ensure proper update
    form.setValue('photoURL', undefined);
  };

  const baptismPhotosInputRef = useRef<HTMLInputElement>(null);

  const handleBaptismPhotosChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      // Validar que sean imágenes
      const validFiles = files.filter(file => file.type.startsWith('image/'));

      if (validFiles.length !== files.length) {
        toast({
          title: t('memberForm.toast.invalidFormatTitle'),
          description: t('memberForm.toast.imagesOnly'),
          variant: 'destructive'
        });
        return;
      }

      // Limitar a 10 fotos máximo
      const totalFiles = [...baptismPhotoFiles, ...validFiles];
      if (totalFiles.length > 10) {
        toast({
          title: t('memberForm.toast.limitExceededTitle'),
          description: t('memberForm.toast.maxBaptismPhotos'),
          variant: 'destructive'
        });
        return;
      }

      setBaptismPhotoFiles(prev => [...prev, ...validFiles]);

      // Crear previews
      validFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const preview = e.target?.result as string;
          setBaptismPhotoPreviews(prev => [...prev, preview]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeBaptismPhoto = (index: number) => {
    setBaptismPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setBaptismPhotoPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleGetCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      toast({
        title: t('memberForm.toast.gpsUnavailableTitle'),
        description: t('memberForm.toast.gpsUnavailableDesc'),
        variant: 'destructive',
      });
      return;
    }

    setGettingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=es`,
            { headers: { 'User-Agent': `${getAppName()}/1.0` } }
          );
          if (!response.ok) {
            throw new Error(t('memberForm.toast.addressLookupError'));
          }
          const data = await response.json();
          const formattedAddress = data.display_name || `${latitude}, ${longitude}`;
          form.setValue('address', formattedAddress, { shouldValidate: true });
          toast({
            title: t('memberForm.toast.locationObtainedTitle'),
            description: t('memberForm.toast.locationObtainedDesc'),
          });
        } catch (error) {
          console.error('Error reverse geocoding:', error);
          form.setValue('address', `${latitude}, ${longitude}`, { shouldValidate: true });
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

  const onSubmit = async (values: MemberFormValues) => {
    console.log('🚀 Starting member submission:', {
      isEditing: !!member,
      memberId: member?.id,
      values,
      user: user?.uid
    });

    if (!user) {
      console.error('❌ No user authenticated');
      return;
    }

    // Verificar si hay duplicados sin resolver
    if (duplicateMembers.length > 0 && !allowContinueWithDuplicate) {
      setShowDuplicateDialog(true);
      return;
    }

    setLoading(true);
    try {
      // Handle photo URL
      let photoURL = member?.photoURL; // Start with existing photo
      if (photoFile) {
        // Upload new photo
        photoURL = await uploadMemberPhoto(photoFile, user.uid);
      } else if (photoPreview === null && member?.photoURL) {
        // Photo was removed - delete from storage
        try {
          if (member.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
            const photoRef = ref(storage, member.photoURL);
            await deleteObject(photoRef);
            console.log('✅ Old member photo deleted from storage');
          }
        } catch (error) {
          console.warn('⚠️ Could not delete old member photo from storage:', error);
          // Continue with the update even if deletion fails
        }
        photoURL = null as any;
      }
      // else keep existing photoURL

      // Subir fotos de bautismo
      let baptismPhotoURLs: string[] = [];
      if (baptismPhotoFiles.length > 0) {
        try {
          const uploadedPhotos = await uploadBaptismPhotos(baptismPhotoFiles, user.uid);
          baptismPhotoURLs = uploadedPhotos;

          // Mantener las fotos existentes que no fueron eliminadas
          if (member?.baptismPhotos) {
            const existingPhotos = member.baptismPhotos.filter(url =>
              baptismPhotoPreviews.includes(url)
            );
            baptismPhotoURLs = [...existingPhotos, ...uploadedPhotos];
          }
        } catch (error) {
          console.error('Error uploading baptism photos:', error);
          toast({
            title: t('memberForm.toast.baptismPhotoUploadWarnTitle'),
            description: t('memberForm.toast.baptismPhotoUploadWarnDesc'),
            variant: 'destructive'
          });
          // Mantener las fotos existentes en caso de error
          baptismPhotoURLs = member?.baptismPhotos || [];
        }
      } else {
        // Si no hay nuevas fotos, mantener las existentes
        baptismPhotoURLs = member?.baptismPhotos || [];
      }

      // Eliminar fotos de bautismo que fueron removidas
      if (member?.baptismPhotos) {
        const photosToDelete = member.baptismPhotos.filter(url =>
          !baptismPhotoPreviews.includes(url)
        );

        for (const photoUrl of photosToDelete) {
          try {
            if (photoUrl.startsWith('https://firebasestorage.googleapis.com')) {
              const photoRef = ref(storage, photoUrl);
              await deleteObject(photoRef);
            }
          } catch (error) {
            console.warn('Could not delete baptism photo:', error);
          }
        }
      }

      // Verificar si es un bautismo de los últimos 2 años
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const isRecentBaptism = !!(values.baptismDate && values.baptismDate >= twoYearsAgo);

      // Verificar si hay cambios en la fecha de bautismo
      const previousBaptismDate = member?.baptismDate?.toDate ? member.baptismDate.toDate() :
        member?.baptismDate instanceof Date ? member.baptismDate : null;
      const previousWasRecent = !!(previousBaptismDate && previousBaptismDate >= twoYearsAgo);
      const previousBaptismTime = previousBaptismDate?.getTime() ?? null;
      const newBaptismTime = values.baptismDate?.getTime() ?? null;
      const baptismDateChanged = previousBaptismTime !== newBaptismTime;
      const baptismDateRemoved = !!member?.baptismDate && !values.baptismDate;
      const fullMemberName = `${values.firstName.trim()} ${values.lastName.trim()}`;
      const previousMemberName = member
        ? `${member.firstName?.trim() || ''} ${member.lastName?.trim() || ''}`.trim()
        : '';

      // Preparar datos del miembro para actualizar (datos serializables)
      console.log('💾 Preparing member data for update:', {
        status: values.status,
        statusType: typeof values.status,
        allValues: values
      });
      const memberData = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        status: values.status,
        // Manejar campos opcionales: usar el valor del formulario si está presente, sino undefined para limpiar
        phoneNumber: values.phoneNumber?.trim() ? values.phoneNumber.trim() : undefined,
        memberId: values.memberId?.trim() ? values.memberId.trim() : undefined,
        address: values.address?.trim() ? values.address.trim() : '',
        birthDate: values.birthDate ? values.birthDate.toISOString() : undefined,
        baptismDate: values.baptismDate ? values.baptismDate.toISOString() : undefined,
        deathDate: values.status === 'deceased'
          ? values.deathDate
            ? values.deathDate.toISOString()
            : null
          : null,
        photoURL: photoURL as any,
        baptismPhotos: baptismPhotoURLs,
        ordinances: values.status === 'deceased' ? [] : (values.ordinances || []),
        templeOrdinances: values.status === 'deceased' ? (values.ordinances || []) : [],
        ministeringTeachers: values.ministeringTeachers || [],
      };

      console.log('📤 Final member data to send:', memberData);
      console.log('📅 Date conversions:', {
        birthDate: {
          original: values.birthDate,
          isoString: values.birthDate ? values.birthDate.toISOString() : undefined
        },
        baptismDate: {
          original: values.baptismDate,
          isoString: values.baptismDate ? values.baptismDate.toISOString() : undefined
        }
      });

      // Conversos recientes = solo baptismDate del miembro (sin c_conversos).
      // Limpiar registros legacy en c_conversos / bautismos automáticos si cambió o se quitó la fecha.
      const shouldCleanupLegacyConvertRecords =
        baptismDateRemoved ||
        (previousWasRecent && !isRecentBaptism) ||
        (previousWasRecent && isRecentBaptism && baptismDateChanged) ||
        (previousMemberName && previousMemberName !== fullMemberName && previousWasRecent);

      if (shouldCleanupLegacyConvertRecords && barrioOrg) {
        const { cleanupConvertAndBaptismRecords } = await import('@/lib/member-service');
        const namesToClean = new Set(
          [fullMemberName, previousMemberName].filter((n) => n && n.trim())
        );
        for (const name of namesToClean) {
          await cleanupConvertAndBaptismRecords({
            memberId: member?.id,
            memberName: name,
            barrioOrg,
          });
        }
      }

      if (member) {
        // Get previous ministering teachers before update
        const previousTeachers = member.ministeringTeachers || [];

        await updateMember(member.id, {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          status: values.status,
          phoneNumber: values.phoneNumber?.trim() ? values.phoneNumber.trim() : undefined,
          memberId: values.memberId?.trim() ? values.memberId.trim() : undefined,
          address: values.address?.trim() ? values.address.trim() : '',
          birthDate: values.birthDate
            ? Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate))
            : null as any,
          baptismDate: values.baptismDate ? Timestamp.fromDate(values.baptismDate) : (null as any),
          deathDate: values.status === 'deceased'
            ? values.deathDate
              ? Timestamp.fromDate(values.deathDate)
              : null
            : null,
          photoURL: photoURL as any,
          baptismPhotos: baptismPhotoURLs,
          ordinances: values.status === 'deceased' ? [] : (values.ordinances || []),
          templeOrdinances: values.status === 'deceased' ? (values.ordinances || []) : [],
          ministeringTeachers: values.ministeringTeachers || [],
          isUrgent: values.isUrgent || false,
          isInCouncil: values.isInCouncil || false,
          inactiveSince: values.status === 'inactive'
            ? values.inactiveSince
              ? Timestamp.fromDate(values.inactiveSince)
              : member.inactiveSince
                ? null // El usuario borró la fecha, enviar null para limpiarla
                : Timestamp.now() // Primera vez que se marca inactivo, usar fecha actual
            : null,
          inactiveObservation: values.status === 'inactive'
            ? values.inactiveObservation?.trim() || ''
            : undefined,
          lessActiveSince: values.status === 'less_active'
            ? values.lessActiveSince
              ? Timestamp.fromDate(values.lessActiveSince)
              : member.lessActiveSince
                ? null // El usuario borró la fecha, enviar null para limpiarla
                : Timestamp.now() // Primera vez que se marca menos activo, usar fecha actual
            : null,
          lessActiveObservation: values.status === 'less_active'
            ? values.lessActiveObservation?.trim() || ''
            : undefined,
        });
        const currentTeachers = values.ministeringTeachers || [];
        if (JSON.stringify(previousTeachers.sort()) !== JSON.stringify(currentTeachers.sort())) {
          try {
            await syncMinisteringAssignments(
              { ...member, ...memberData, id: member.id } as any,
              previousTeachers,
              barrioOrg
            );
            console.log('✅ Ministering assignments synced');
          } catch (error) {
            console.error('⚠️ Error syncing ministering assignments:', error);
            // Don't fail the whole operation if sync fails
          }
        }

        toast({
          title: t('memberForm.toast.updatedTitle'),
          description: t('memberForm.toast.updatedDescription', {
            firstName: values.firstName,
            lastName: values.lastName,
          }),
        });
        console.log('✅ Member updated successfully:', { memberId: member.id, updatedData: memberData });

        // Send notification if marked as urgent and wasn't urgent before
        if (values.isUrgent && !member.isUrgent) {
          try {
            await createNotificationsForAll({
              title: t('memberForm.notification.urgentTitle'),
              body: t('memberForm.notification.urgentBody', {
                firstName: values.firstName,
                lastName: values.lastName,
              }),
              contextType: 'member',
              contextId: member.id,
              actionUrl: '/members'
            }, barrioOrg);
          } catch (notifError) {
            console.error('Error sending urgent notification from form:', notifError);
          }
        }
      } else {
        const newMember: any = {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          status: values.status,
          phoneNumber: values.phoneNumber?.trim() ? values.phoneNumber.trim() : undefined,
          memberId: values.memberId?.trim() ? values.memberId.trim() : undefined,
          address: values.address?.trim() ? values.address.trim() : '',
          birthDate: values.birthDate
            ? Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate))
            : undefined,
          baptismDate: values.baptismDate ? Timestamp.fromDate(values.baptismDate) : undefined,
          deathDate: values.status === 'deceased' && values.deathDate
            ? Timestamp.fromDate(values.deathDate)
            : undefined,
          baptismPhotos: baptismPhotoURLs,
          ordinances: values.status === 'deceased' ? [] : (values.ordinances || []),
          templeOrdinances: values.status === 'deceased' ? (values.ordinances || []) : [],
          ministeringTeachers: values.ministeringTeachers || [],
          isUrgent: values.isUrgent || false,
          isInCouncil: values.isInCouncil || false,
          inactiveSince: values.status === 'inactive'
            ? values.inactiveSince
              ? Timestamp.fromDate(values.inactiveSince)
              : Timestamp.now()
            : undefined,
          inactiveObservation: values.status === 'inactive'
            ? values.inactiveObservation?.trim() || ''
            : undefined,
          lessActiveSince: values.status === 'less_active'
            ? values.lessActiveSince
              ? Timestamp.fromDate(values.lessActiveSince)
              : Timestamp.now()
            : undefined,
          lessActiveObservation: values.status === 'less_active'
            ? values.lessActiveObservation?.trim() || ''
            : undefined,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: user.uid,
        };

        // Only add photoURL if it exists
        if (photoURL) {
          newMember.photoURL = photoURL;
        }

        const newMemberId = await createMember(newMember as any, barrioOrg);

        // Sync ministering assignments for new member if teachers assigned
        const currentTeachers = values.ministeringTeachers || [];
        if (currentTeachers.length > 0) {
          try {
            await syncMinisteringAssignments(
              { ...newMember, id: newMemberId } as any,
              [],
              barrioOrg
            );
            console.log('✅ Ministering assignments synced for new member');
          } catch (error) {
            console.error('⚠️ Error syncing ministering assignments:', error);
            // Don't fail the whole operation if sync fails
          }
        }

        toast({
          title: t('memberForm.toast.createdTitle'),
          description: t('memberForm.toast.createdDescription', {
            firstName: values.firstName,
            lastName: values.lastName,
          }),
        });
        console.log('✅ New member created successfully:', { memberId: newMemberId, memberData: newMember });

        // Send notification if new member is marked as urgent
        if (values.isUrgent) {
          try {
            await createNotificationsForAll({
              title: t('memberForm.notification.urgentTitle'),
              body: t('memberForm.notification.urgentBody', {
                firstName: values.firstName,
                lastName: values.lastName,
              }),
              contextType: 'member',
              contextId: newMemberId,
              actionUrl: '/members'
            }, barrioOrg);
          } catch (notifError) {
            console.error('Error sending urgent notification for new member:', notifError);
          }
        }
      }

      onClose();
    } catch (error) {
      console.error('Error saving member:', error);

      let errorMessage = member
        ? t('memberForm.toast.updateError')
        : t('memberForm.toast.createError');

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Diálogo de duplicados */}
      <AlertDialog open={showDuplicateDialog} onOpenChange={(open) => {
        if (!open && !duplicateDecisionMade) {
          // Si el usuario cierra el diálogo sin tomar una decisión, se considera como cancelar
          setShowDuplicateDialog(false);
          setAllowContinueWithDuplicate(false);
          setDuplicateDecisionMade(false);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('memberForm.duplicate.title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {t('memberForm.duplicate.description', {
                  firstName: form.getValues('firstName'),
                  lastName: form.getValues('lastName'),
                })}
                {duplicateMembers.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-2">{t('memberForm.duplicate.found')}</div>
                    <div className="space-y-2">
                      {duplicateMembers.map((dupMember) => (
                        <div key={dupMember.id} className="flex items-center gap-3 p-2 bg-muted rounded-md">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={dupMember.photoURL} />
                            <AvatarFallback className="text-xs">
                              {dupMember.firstName.charAt(0)}{dupMember.lastName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{dupMember.firstName} {dupMember.lastName}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {t('memberForm.duplicate.status', {
                                status: t(`member.status.${dupMember.status}`),
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-sm text-blue-800">
                    {t('memberForm.duplicate.whatToDo')}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowDuplicateDialog(false);
              setAllowContinueWithDuplicate(false);
              setDuplicateDecisionMade(true);
              onClose(); // Cerrar el formulario
            }}>
              {t('memberForm.duplicate.cancelExit')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowDuplicateDialog(false);
              setAllowContinueWithDuplicate(true);
              setDuplicateDecisionMade(true);
            }}>
              {t('memberForm.duplicate.continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Form key={member?.id || 'new'} {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6">
          {/* Photo Upload */}
          <div className="space-y-4">
            <Label>{t('memberForm.photoLabel')}</Label>
            <div className="flex items-center gap-4">
              <Avatar className="w-20 h-20">
                <AvatarImage src={photoPreview || undefined} />
                <AvatarFallback className="text-lg">
                  {form.watch('firstName')?.[0]?.toUpperCase()}
                  {form.watch('lastName')?.[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Label htmlFor="photo-upload" className="cursor-pointer">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <span>
                        <Upload className="mr-2 h-4 w-4" />
                        {t('memberForm.uploadPhoto')}
                      </span>
                    </Button>
                  </Label>
                  <Input
                    id="photo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                  {photoPreview && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={removePhoto}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('memberForm.remove')}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('memberForm.photoHint')}
                </p>
              </div>
            </div>
          </div>

          {/* Name Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('memberForm.firstName')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('memberForm.firstNamePlaceholder')}
                      {...field}
                      onBlur={(e) => {
                        field.onBlur();
                        const firstName = e.target.value.trim();
                        const lastName = form.getValues('lastName')?.trim() || '';
                        checkForDuplicates(firstName, lastName);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('memberForm.lastName')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('memberForm.lastNamePlaceholder')}
                      {...field}
                      onBlur={(e) => {
                        field.onBlur();
                        const lastName = e.target.value.trim();
                        const firstName = form.getValues('firstName')?.trim() || '';
                        checkForDuplicates(firstName, lastName);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Phone Number */}
          <FormField
            control={form.control}
            name="phoneNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('memberForm.phone')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('memberForm.phonePlaceholder')}
                    type="tel"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('memberForm.phoneDescription')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Member ID */}
          <FormField
            control={form.control}
            name="memberId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('memberProfile.memberId')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('memberForm.memberIdPlaceholder')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t('memberProfile.memberIdDescription')}
                </FormDescription>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                  {t('memberProfile.memberIdPrivacy')}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Address with GPS */}
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('memberForm.address')}</FormLabel>
                <div className="flex gap-2">
                  <FormControl>
                    <Input
                      placeholder={t('memberForm.addressPlaceholder')}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleGetCurrentLocation}
                    disabled={gettingLocation}
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
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Birth Date */}
          <FormField
            control={form.control}
            name="birthDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t('memberForm.birthDate')}</FormLabel>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'flex-1 pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            <span className="capitalize">
                              {format(field.value, "d 'de' LLLL 'de' yyyy", { locale: getDateFnsLocale() })}
                            </span>
                          ) : (
                            <span>{t('common.selectDate')}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        defaultMonth={field.value}
                        disabled={(date) =>
                          date > new Date() || date < new Date('1900-01-01')
                        }
                        locale={getDateFnsLocale()}
                      />
                    </PopoverContent>
                  </Popover>
                  {field.value && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => field.onChange(undefined)}
                      title={t('memberForm.clearDate')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Baptism Date */}
          <FormField
            control={form.control}
            name="baptismDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t('memberForm.baptismDate')}</FormLabel>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            'flex-1 pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            <span className="capitalize">
                              {format(field.value, "d 'de' LLLL 'de' yyyy", { locale: getDateFnsLocale() })}
                            </span>
                          ) : (
                            <span>{t('common.selectDate')}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        defaultMonth={field.value}
                        disabled={(date) => date < new Date('1900-01-01')}
                        locale={getDateFnsLocale()}
                      />
                    </PopoverContent>
                  </Popover>
                  {field.value && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => field.onChange(undefined)}
                      title={t('memberForm.clearDate')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Baptism Photos */}
          <div className="space-y-4">
            <Label>{t('memberForm.baptismPhotosLabel')}</Label>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Label htmlFor="baptism-photos-upload" className="cursor-pointer">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      {t('memberForm.addPhotos')}
                    </span>
                  </Button>
                </Label>
                <Input
                  id="baptism-photos-upload"
                  ref={baptismPhotosInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleBaptismPhotosChange}
                  className="hidden"
                />
              </div>

              {baptismPhotoPreviews.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {baptismPhotoPreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      <div className="relative w-full h-24 rounded-md border overflow-hidden">
                        <Image
                          src={preview}
                          alt={t('memberForm.baptismPhotoAlt', { index: index + 1 })}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBaptismPhoto(index)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t('memberForm.removeBaptismPhotoTitle')}
                        aria-label={t('memberForm.removeBaptismPhotoAria', { index: index + 1 })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {t('memberForm.baptismPhotosHint')}
              </p>
            </div>
          </div>

          {/* Ordenanzas - Combined with temple ordinances for deceased members */}
          <FormField
            control={form.control}
            name="ordinances"
            render={({ field }) => {
              // When status is deceased, include temple-specific ordinances in the same section
              const isDeceased = watchedStatus === 'deceased';
              
              // Base ordinances that all members must have - always show these
              const baseOrdinances: Ordinance[] = ['baptism', 'confirmation'];
              
              // Regular ordinances excluding baptism and confirmation
              // Priesthood ordinances are only hidden for Sociedad de Socorro
              const isSocorro = organizacion === 'Sociedad de Socorro';
              const regularOrdinances = (Object.keys(OrdinanceLabels) as Ordinance[]).filter(
                o => o !== 'baptism' && o !== 'confirmation'
                  && !(isSocorro && (o === 'high_priest_ordination' || o === 'elder_ordination' || o === 'aronico_ordination'))
              );
              
              // Temple-specific ordinances for deceased members
              const templeOrdinances: Ordinance[] = isDeceased
                ? ['initiatory', 'endowment', 'sealed_to_father', 'sealed_to_mother', 'sealed_to_spouse'] as Ordinance[]
                : [];
              
              const allOrdinances = isDeceased
                ? [...baseOrdinances, ...templeOrdinances]
                : [...baseOrdinances, ...regularOrdinances];
              
              // Get labels for combined list
              const getOrdinanceLabel = (ordinance: string): string => {
                const ordinanceLabel = t(`ordinance.${ordinance}`);
                if (ordinanceLabel !== `ordinance.${ordinance}`) {
                  return ordinanceLabel;
                }
                const templeLabel = t(`templeOrdinance.${ordinance}`);
                if (templeLabel !== `templeOrdinance.${ordinance}`) {
                  return templeLabel;
                }
                return ordinance;
              };

              return (
                <FormItem>
                  <FormLabel>
                    {isDeceased ? t('memberForm.ordinancesTemple') : t('memberForm.ordinancesReceived')}
                  </FormLabel>
                  <FormDescription>
                    {isDeceased
                      ? t('memberForm.ordinancesTempleDesc')
                      : t('memberForm.ordinancesReceivedDesc')}
                  </FormDescription>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                    {allOrdinances.map((ordinance) => {
                      return (
                        <div key={ordinance} className="flex items-center space-x-2">
                          <Checkbox
                            checked={field.value?.includes(ordinance) || false}
                            onCheckedChange={(checked) => {
                              const currentOrdinances = field.value || [];
                              if (checked) {
                                field.onChange([...currentOrdinances, ordinance as Ordinance]);
                              } else {
                                field.onChange(currentOrdinances.filter(o => o !== ordinance));
                              }
                            }}
                          />
                          <Label className="text-sm font-normal cursor-pointer" htmlFor={ordinance}>
                            {getOrdinanceLabel(ordinance)}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          {/* Maestros Ministrantes */}
          <FormField
            control={form.control}
            name="ministeringTeachers"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('memberForm.ministeringTeachers')}</FormLabel>
                <FormDescription>
                  {t('memberForm.ministeringTeachersDesc')}
                </FormDescription>
                <div className="max-h-48 overflow-y-auto border rounded-md p-3">
                  {loadingMembers ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      {t('memberForm.loadingMembers')}
                    </div>
                  ) : availableMembers.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      {t('memberForm.noMembersToAssign')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {availableMembers.map((availableMember) => {
                        const memberName = `${availableMember.firstName} ${availableMember.lastName}`;
                        const isSelected = field.value?.includes(memberName) || false;

                        return (
                          <div key={availableMember.id} className="flex items-center space-x-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                const currentTeachers = field.value || [];
                                if (checked) {
                                  field.onChange([...currentTeachers, memberName]);
                                } else {
                                  field.onChange(currentTeachers.filter(name => name !== memberName));
                                }
                              }}
                            />
                            <div className="flex items-center space-x-2 flex-1">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={availableMember.photoURL} />
                                <AvatarFallback className="text-xs">
                                  {availableMember.firstName.charAt(0)}{availableMember.lastName.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <Label className="text-sm font-normal cursor-pointer">
                                  {memberName}
                                </Label>
                                {availableMember.status && (
                                  <p className="text-xs text-muted-foreground capitalize">
                                    {t(`member.status.${availableMember.status}`)}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {field.value && field.value.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('memberForm.ministeringSelected', { count: field.value.length })}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Status */}
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('memberForm.statusLabel')}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={normalizeMemberStatus(field.value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('memberForm.statusPlaceholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">{t('member.status.active')}</SelectItem>
                    <SelectItem value="less_active">{t('member.status.less_active')}</SelectItem>
                    <SelectItem value="inactive">{t('member.status.inactive')}</SelectItem>
                    <SelectItem value="deceased">{t('member.status.deceased')}</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t('memberForm.statusDescription')}
                </FormDescription>

                <FormMessage />
              </FormItem>
            )}
          />

          {watchedStatus === 'deceased' && (
            <FormField
              control={form.control}
              name="deathDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('memberForm.deathDate')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('memberForm.deathDatePlaceholder')}
                      value={deathDateInput}
                      onChange={(e) => {
                        const inputValue = e.target.value;
                        setDeathDateInput(inputValue);

                        const parsedDate = parseDate(inputValue, new Date().getFullYear());
                        if (parsedDate || !inputValue.trim()) {
                          field.onChange(parsedDate);
                        }
                      }}
                      onBlur={(e) => {
                        const inputValue = e.target.value;
                        const parsedDate = parseDate(inputValue, new Date().getFullYear());

                        if (parsedDate) {
                          const formattedDate = formatDateForDisplay(parsedDate);
                          setDeathDateInput(formattedDate);
                          field.onChange(parsedDate);
                        } else if (!inputValue.trim()) {
                          setDeathDateInput('');
                          field.onChange(undefined);
                        } else {
                          field.onChange(undefined);
                        }

                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('memberForm.deathDateDescription')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {watchedStatus === 'inactive' && (
            <>
              <FormField
                control={form.control}
                name="inactiveSince"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('memberForm.inactiveSince')}</FormLabel>
                    <div className="flex gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                'flex-1 pl-3 text-left font-normal',
                                !form.watch('inactiveSince') && 'text-muted-foreground'
                              )}
                            >
                              {form.watch('inactiveSince') ? (
                                <span className="capitalize">
                                  {format(form.watch('inactiveSince')!, "d 'de' LLLL 'de' yyyy", { locale: getDateFnsLocale() })}
                                </span>
                              ) : (
                                <span>{t('common.selectDate')}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.watch('inactiveSince')}
                            onSelect={(date) => form.setValue('inactiveSince', date, { shouldDirty: true, shouldValidate: true })}
                            defaultMonth={form.watch('inactiveSince')}
                            disabled={(date) =>
                              date > new Date() || date < new Date('1900-01-01')
                            }
                            locale={getDateFnsLocale()}
                          />
                        </PopoverContent>
                      </Popover>
                      {form.watch('inactiveSince') && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => form.setValue('inactiveSince', undefined, { shouldDirty: true, shouldValidate: true })}
                          title={t('memberForm.clearDate')}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormDescription>
                      {t('memberForm.inactiveSinceDesc')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inactiveObservation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('memberForm.inactiveObservation')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('memberForm.inactiveObservationPlaceholder')}
                        value={field.value || ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={field.disabled}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('memberForm.inactiveObservationDesc')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {watchedStatus === 'less_active' && (
            <>
              <FormField
                control={form.control}
                name="lessActiveSince"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('memberForm.lessActiveSince')}</FormLabel>
                    <div className="flex gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                'flex-1 pl-3 text-left font-normal',
                                !form.watch('lessActiveSince') && 'text-muted-foreground'
                              )}
                            >
                              {form.watch('lessActiveSince') ? (
                                <span className="capitalize">
                                  {format(form.watch('lessActiveSince')!, "d 'de' LLLL 'de' yyyy", { locale: getDateFnsLocale() })}
                                </span>
                              ) : (
                                <span>{t('common.selectDate')}</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={form.watch('lessActiveSince')}
                            onSelect={(date) => form.setValue('lessActiveSince', date, { shouldDirty: true, shouldValidate: true })}
                            defaultMonth={form.watch('lessActiveSince')}
                            disabled={(date) =>
                              date > new Date() || date < new Date('1900-01-01')
                            }
                            locale={getDateFnsLocale()}
                          />
                        </PopoverContent>
                      </Popover>
                      {form.watch('lessActiveSince') && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => form.setValue('lessActiveSince', undefined, { shouldDirty: true, shouldValidate: true })}
                          title={t('memberForm.clearDate')}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormDescription>
                      {t('memberForm.lessActiveSinceDesc')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lessActiveObservation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('memberForm.lessActiveObservation')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('memberForm.lessActiveObservationPlaceholder')}
                        value={field.value || ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={field.disabled}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('memberForm.lessActiveObservationDesc')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 space-y-2 space-y-reverse sm:space-y-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-current" />
                  {member ? t('common.updating') : t('common.creating')}
                </>
              ) : (
                member ? t('memberForm.updateMember') : t('memberForm.createMember')
              )}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
}
