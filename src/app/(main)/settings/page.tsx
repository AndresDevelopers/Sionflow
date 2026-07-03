'use client';

import { useTheme } from 'next-themes';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/contexts/i18n-context';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '@/contexts/auth-context';
import { deleteUser, updateProfile } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import logger from '@/lib/logger';
import { normalizeDateForEcuadorStorage } from '@/lib/date-utils';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { doc, getDoc, updateDoc, Timestamp, setDoc } from 'firebase/firestore';
import { usersCollection, storage } from '@/lib/collections';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertCircle, CalendarIcon, User, Camera, Loader2, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  canViewSettings,
  normalizeRole,
  type UserRole,
} from '@/lib/roles';
import { navigationItems } from '@/lib/navigation';
import {
  deleteNotificationToken,
  getExistingNotificationToken,
  requestNotificationPermission,
} from '@/lib/firebase-messaging';
import {
  clearCurrentPushSubscription,
  getCurrentPushSubscriptionToken,
  saveCurrentPushSubscription,
} from '@/lib/push-subscription';

const profileSchema = z.object({
  name: z.string().min(2, { message: "El nombre es requerido." }),
  birthDate: z.date({
    required_error: "La fecha de nacimiento es requerida.",
  }),
  memberId: z.string().trim().optional(),
});

type FormValues = z.infer<typeof profileSchema>;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB



export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const { user, firebaseUser, refreshAuth } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMainPageSaving, setIsMainPageSaving] = useState(false);

  const [inAppNotificationsEnabled, setInAppNotificationsEnabled] = useState(true); // Notificaciones in-app activas por defecto
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(false); // Notificaciones push desactivadas por defecto
  const [isInAppNotificationLoading, setIsInAppNotificationLoading] = useState(true);
  const [isPushNotificationLoading, setIsPushNotificationLoading] = useState(true);
  const [, setFcmToken] = useState<string | null>(null);

  // Per-category notification preferences
  const defaultCategoryPrefs = useMemo<Record<string, boolean>>(
    () => ({
      observations: true,
      converts: true,
      futureMembers: true,
      birthdays: true,
      familySearch: true,
      missionaryWork: true,
      service: true,
      council: true,
      activities: true,
    }),
    []
  );
  const [inAppCategoryPrefs, setInAppCategoryPrefs] = useState<Record<string, boolean>>(defaultCategoryPrefs);
  const [pushCategoryPrefs, setPushCategoryPrefs] = useState<Record<string, boolean>>(defaultCategoryPrefs);
  const [isCategoryPrefsSaving, setIsCategoryPrefsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCheckingRole, setIsCheckingRole] = useState(true);
  const [hasSettingsAccess, setHasSettingsAccess] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [mainPage, setMainPage] = useState<string>('/');
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const roleFriendlyNames = useMemo<Record<UserRole, string>>(
    () => ({
      user: 'Miembro',
      counselor: 'Consejero',
      president: 'Presidente',
      secretary: 'Secretario',
      other: 'Otro',
    }),
    []
  );


  useEffect(() => {
    const loadNotificationPreferences = async () => {
      if (!hasSettingsAccess || !user) {
        setIsInAppNotificationLoading(false);
        setIsPushNotificationLoading(false);
        return;
      }

      try {
        const userDocRef = doc(usersCollection, user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          // Si no existe la preferencia, por defecto es true para in-app, false para push
          setInAppNotificationsEnabled(userData.inAppNotificationsEnabled !== false);
          setPushNotificationsEnabled(userData.pushNotificationsEnabled === true);

          // Load per-category prefs (default all true)
          const savedInApp = (userData.notificationPrefs?.inApp as Record<string, boolean>) ?? {};
          const savedPush = (userData.notificationPrefs?.push as Record<string, boolean>) ?? {};
          setInAppCategoryPrefs({ ...defaultCategoryPrefs, ...savedInApp });
          setPushCategoryPrefs({ ...defaultCategoryPrefs, ...savedPush });
        } else {
          // Usuario nuevo, activar in-app por defecto, push desactivado
          setInAppNotificationsEnabled(true);
          setPushNotificationsEnabled(false);
        }
      } catch (error) {
        logger.error({ error, message: 'Error loading notification preferences' });
        setInAppNotificationsEnabled(true);
        setPushNotificationsEnabled(false);
      } finally {
        setIsInAppNotificationLoading(false);
        setIsPushNotificationLoading(false);
      }
    };

    loadNotificationPreferences();
  }, [hasSettingsAccess, user, defaultCategoryPrefs]);

  useEffect(() => {
    const initializeFCM = async () => {
      if (!pushNotificationsEnabled || !user) {
        setFcmToken(null);
        return;
      }

      try {
        const savedToken = await getCurrentPushSubscriptionToken(user.uid);
        if (savedToken) {
          setFcmToken(savedToken);
          return;
        }

        const token = await getExistingNotificationToken();
        if (!token) {
          setFcmToken(null);
          return;
        }

        const saved = await saveCurrentPushSubscription(user.uid, token);
        if (saved) {
          setFcmToken(token);
        }
      } catch (error) {
        console.error('Error initializing FCM:', error);
      }
    };

    initializeFCM();
  }, [pushNotificationsEnabled, user]);

  const form = useForm<FormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      memberId: '',
    },
  });

  useEffect(() => {
    const fetchUserData = async () => {
      if (!firebaseUser) {
        setIsCheckingRole(false);
        setHasSettingsAccess(false);
        return;
      }

      setIsProfileLoading(true);
      setIsCheckingRole(true);

      try {
        const userDocRef = doc(usersCollection, firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        let normalizedRole: UserRole = 'user';

        if (userDoc.exists()) {
          const userData = userDoc.data();
          normalizedRole = normalizeRole(userData.role);
          const userVisiblePages = Array.isArray(userData.visiblePages) ? userData.visiblePages : navigationItems.map(item => item.href);
          setVisiblePages(userVisiblePages);

          // If current main page is not in visible pages, select first visible page
          const currentMainPage = userData.mainPage || '/';
          if (!userVisiblePages.includes(currentMainPage) && userVisiblePages.length > 0) {
            setMainPage(userVisiblePages[0]);
          } else {
            setMainPage(currentMainPage);
          }

          // Load saved theme preference
          if (userData.theme && (userData.theme === 'light' || userData.theme === 'dark' || userData.theme === 'system')) {
            setTheme(userData.theme);
          }

          form.reset({
            name: userData.name || firebaseUser.displayName || '',
            birthDate: userData.birthDate
              ? (userData.birthDate as Timestamp).toDate()
              : undefined,
            memberId: userData.memberId || '',
          });
        } else {
          form.reset({
            name: firebaseUser.displayName || '',
            memberId: '',
          });
        }

        setPreviewUrl(firebaseUser.photoURL || null);
        setUserRole(normalizedRole);

        const canView = canViewSettings(normalizedRole);
        setHasSettingsAccess(canView);

        if (!canView) {
          return;
        }
      } catch (error) {
        logger.error({ error, message: 'Error loading settings profile data' });
        setHasSettingsAccess(false);
        toast({
          title: t('settings.toast.profileLoadErrorTitle'),
          description: t('settings.toast.profileLoadErrorDescription'),
          variant: 'destructive',
        });
      } finally {
        setIsCheckingRole(false);
        setIsProfileLoading(false);
      }
    };

    fetchUserData();
  }, [firebaseUser, form, setTheme, t, toast]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: t('settings.toast.fileTooLargeTitle'),
        description: t('settings.toast.fileTooLargeDescription'),
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  const onProfileSubmit = async (values: FormValues) => {
    if (!firebaseUser) return;
    setIsSubmitting(true);
    let finalPhotoURL = firebaseUser.photoURL || null;

    try {
      if (selectedFile) {
        const storageRef = ref(storage, `profile_pictures/users/${firebaseUser.uid}/${Date.now()}_${selectedFile.name}`);
        await uploadBytes(storageRef, selectedFile);
        finalPhotoURL = await getDownloadURL(storageRef);

        if (firebaseUser.photoURL && firebaseUser.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, firebaseUser.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: "Could not delete old profile picture" }));
        }
      } else if (!previewUrl && firebaseUser.photoURL) {
        if (firebaseUser.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, firebaseUser.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: "Image to be removed could not be deleted" }));
        }
        finalPhotoURL = null;
      }

      await updateProfile(firebaseUser, {
        displayName: values.name,
        photoURL: finalPhotoURL,
      });

      const userDocRef = doc(usersCollection, firebaseUser.uid);
      await setDoc(userDocRef, {
        name: values.name,
        birthDate: Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate)),
        photoURL: finalPhotoURL,
        mainPage: mainPage,
        memberId: values.memberId?.trim() || null,
      }, { merge: true });

      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('settings.toast.profileUpdatedDescription'),
      });
      await refreshAuth();
      setSelectedFile(null);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, message: 'Error updating profile' });
      toast({
        title: t('settings.toast.profileUpdateErrorTitle'),
        description: t('settings.toast.profileUpdateErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!firebaseUser) {
      toast({
        title: t('settings.toast.deleteUserMissingTitle'),
        description: t('settings.toast.deleteUserMissingDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsDeleting(true);

    try {
      await deleteUser(firebaseUser);
      toast({
        title: t('settings.toast.accountDeletedTitle'),
        description: t('settings.toast.accountDeletedDescription'),
      });
      router.push('/login');
    } catch (error: any) {
      logger.error({ error, message: "Error deleting user account" });
      let description = t('settings.toast.accountDeleteErrorDescription');
      if (error.code === 'auth/requires-recent-login') {
        description = t('settings.toast.accountDeleteReauthDescription');
      }
      toast({
        title: t('settings.toast.accountDeleteErrorTitle'),
        description,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleInAppNotificationChange = async (checked: boolean) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'Debes iniciar sesión para cambiar esta configuración.',
        variant: 'destructive',
      });
      return;
    }

    setIsInAppNotificationLoading(true);

    try {
      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        inAppNotificationsEnabled: checked
      }, { merge: true });

      setInAppNotificationsEnabled(checked);

      toast({
        title: checked ? 'Notificaciones In-App Activadas' : 'Notificaciones In-App Desactivadas',
        description: checked
          ? 'Recibirás notificaciones dentro de la aplicación sobre actividades importantes.'
          : 'No recibirás notificaciones in-app.',
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update in-app notification preference' });
      toast({
        title: 'Error',
        description: 'No se pudo actualizar la preferencia de notificaciones in-app.',
        variant: 'destructive',
      });
      // Revertir el estado en caso de error
      setInAppNotificationsEnabled(!checked);
    } finally {
      setIsInAppNotificationLoading(false);
    }
  };

  const handlePushNotificationChange = async (checked: boolean) => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'Debes iniciar sesión para cambiar esta configuración.',
        variant: 'destructive',
      });
      return;
    }

    setIsPushNotificationLoading(true);

    try {
      const userDocRef = doc(usersCollection, user.uid);
      await setDoc(userDocRef, {
        pushNotificationsEnabled: checked
      }, { merge: true });

      setPushNotificationsEnabled(checked);

      if (checked) {
        const token = await requestNotificationPermission();
        if (!token) {
          throw new Error('No se pudo obtener un token FCM para este dispositivo');
        }

        const saved = await saveCurrentPushSubscription(user.uid, token);
        if (!saved) {
          throw new Error('No se pudo guardar la suscripcion push del dispositivo');
        }

        setFcmToken(token);
      } else {
        await deleteNotificationToken();
        await clearCurrentPushSubscription(user.uid);
        setFcmToken(null);
      }

      toast({
        title: checked ? 'Notificaciones Push Activadas' : 'Notificaciones Push Desactivadas',
        description: checked
          ? 'Recibirás notificaciones push en tu dispositivo Android/iOS.'
          : 'No recibirás notificaciones push en tu dispositivo.',
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update push notification preference' });
      toast({
        title: 'Error',
        description: 'No se pudo actualizar la preferencia de notificaciones push.',
        variant: 'destructive',
      });
      // Revertir el estado en caso de error
      setPushNotificationsEnabled(!checked);
    } finally {
      setIsPushNotificationLoading(false);
    }
  };

  const handleCategoryPrefChange = async (
    type: 'inApp' | 'push',
    category: string,
    checked: boolean
  ) => {
    if (!user) return;
    setIsCategoryPrefsSaving(true);

    const newPrefs = type === 'inApp'
      ? { ...inAppCategoryPrefs, [category]: checked }
      : { ...pushCategoryPrefs, [category]: checked };

    if (type === 'inApp') setInAppCategoryPrefs(newPrefs);
    else setPushCategoryPrefs(newPrefs);

    try {
      const userDocRef = doc(usersCollection, user.uid);
      // Use dot notation to deep-merge without overwriting the sibling key
      await updateDoc(userDocRef, {
        [`notificationPrefs.${type}`]: newPrefs,
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update category notification preference' });
      // Revert on error
      if (type === 'inApp') setInAppCategoryPrefs((prev: Record<string, boolean>) => ({ ...prev, [category]: !checked }));
      else setPushCategoryPrefs((prev: Record<string, boolean>) => ({ ...prev, [category]: !checked }));
      toast({
        title: 'Error',
        description: 'No se pudo guardar la preferencia.',
        variant: 'destructive',
      });
    } finally {
      setIsCategoryPrefsSaving(false);
    }
  };

  const handleMainPageChange = async (value: string) => {
    if (!firebaseUser || value === mainPage) {
      setMainPage(value);
      return;
    }

    setMainPage(value);
    setIsMainPageSaving(true);

    try {
      await setDoc(
        doc(usersCollection, firebaseUser.uid),
        { mainPage: value },
        { merge: true }
      );
      toast({
        title: t('settings.toast.mainPageUpdatedTitle'),
        description: t('settings.toast.mainPageUpdatedDescription'),
      });
    } catch (error) {
      logger.error({ error, message: 'Error updating main page' });
      toast({
        title: t('settings.toast.mainPageUpdateErrorTitle'),
        description: t('settings.toast.mainPageUpdateErrorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsMainPageSaving(false);
    }
  };

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);

    if (!firebaseUser) {
      return;
    }

    setIsThemeSaving(true);

    try {
      await setDoc(
        doc(usersCollection, firebaseUser.uid),
        { theme: newTheme },
        { merge: true }
      );
    } catch (error) {
      logger.error({ error, message: 'Error saving theme preference' });
    } finally {
      setIsThemeSaving(false);
    }
  };


  const notificationCategories: Array<{
    key: string;
    label: string;
    description: string;
    page: string;
    inAppDetail: string;
    pushDetail: string;
  }> = [
    {
      key: 'observations',
      label: 'Observaciones',
      description: 'Sin investidura, sin ordenanza de élderes, inactivos, familias en seguimiento, apoyo de salud',
      page: '/observations',
      inAppDetail: '1 vez a la semana',
      pushDetail: '1 vez a la semana',
    },
    {
      key: 'converts',
      label: 'Conversos',
      description: 'Nuevos conversos sin amigo asignado, sin llamamiento, sin recomendación, con observación',
      page: '/converts',
      inAppDetail: '1 vez a la semana',
      pushDetail: '1 vez a la semana',
    },
    {
      key: 'futureMembers',
      label: 'Futuros Miembros',
      description: 'Próximos bautismos o conversos',
      page: '/future-members',
      inAppDetail: '3 días antes del bautismo',
      pushDetail: '3 días antes del bautismo',
    },
    {
      key: 'birthdays',
      label: 'Cumpleaños',
      description: 'Próximos cumpleaños y cumpleaños del día',
      page: '/birthdays',
      inAppDetail: '14 días antes y el día del cumpleaños',
      pushDetail: '14 días antes y el día del cumpleaños',
    },
    {
      key: 'familySearch',
      label: 'FamilySearch',
      description: 'Familias pendientes de capacitación en FamilySearch',
      page: '/family-search',
      inAppDetail: '1 vez a la semana',
      pushDetail: '1 vez a la semana',
    },
    {
      key: 'missionaryWork',
      label: 'Obra Misional',
      description: 'Asignaciones misionales, investigadores y nuevos conversos',
      page: '/missionary-work',
      inAppDetail: '1 vez a la semana',
      pushDetail: '1 vez a la semana',
    },
    {
      key: 'service',
      label: 'Servicio',
      description: 'Próximos servicios, actualizaciones y eliminaciones',
      page: '/service',
      inAppDetail: '14 días antes, el día del servicio, al actualizar/eliminar',
      pushDetail: '14 días antes, el día del servicio, al actualizar/eliminar',
    },
    {
      key: 'council',
      label: 'Consejo',
      description: 'Necesidades urgentes de miembros y ministración, miembros menos activos',
      page: '/council',
      inAppDetail: 'Martes y miércoles a las 6 pm',
      pushDetail: 'Martes y miércoles a las 6 pm',
    },
    {
      key: 'activities',
      label: 'Actividades',
      description: 'Próximas actividades, actualizaciones y eliminaciones',
      page: '/reports/activities',
      inAppDetail: '14 días antes, el día de la actividad, al actualizar/eliminar',
      pushDetail: '14 días antes, el día de la actividad, al actualizar/eliminar',
    },
  ];

  if (isCheckingRole) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="mx-auto h-4 w-64" />
        </div>
      </div>
    );
  }

  if (!hasSettingsAccess) {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
            <AlertCircle className="h-5 w-5" />
            Acceso restringido
          </CardTitle>
          <CardDescription className="text-amber-800 dark:text-amber-200">
            Tu rol actual es {roleFriendlyNames[userRole]}. Solo la presidencia del cuórum
            (secretario, presidente o consejeros) puede abrir y configurar esta sección.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-amber-800 dark:text-amber-200">
            Puedes navegar por el resto de la aplicación con normalidad. Para ajustes de
            configuración, contacta al secretario del cuórum.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="page-section">
      <header className="flex flex-col gap-2">
        <h1 className="text-balance text-fluid-title font-semibold">
          {t('Settings')}
        </h1>
        <p className="text-balance text-fluid-subtitle text-muted-foreground">
          {t('Manage your account and application settings.')}
        </p>
      </header>
      <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('Profile')}</CardTitle>
            <CardDescription>
              Actualiza tu información de perfil.
            </CardDescription>
          </CardHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onProfileSubmit)}>
              <CardContent className="space-y-4">
                {isProfileLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-24 w-24 rounded-full mx-auto" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <>
                    <FormItem className="flex flex-col items-center">
                      <FormControl>
                        <div className="relative group">
                          <Avatar className="h-24 w-24">
                            <AvatarImage src={previewUrl ?? undefined} alt={user?.displayName || 'User'} />
                            <AvatarFallback>
                              {isSubmitting ? <Loader2 className="animate-spin" /> : <User className="h-10 w-10" />}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button type="button" variant="ghost" size="icon" className="h-full w-full text-white" onClick={() => !isSubmitting && fileInputRef.current?.click()}>
                              <Camera className="h-8 w-8" />
                            </Button>
                          </div>
                          {previewUrl && !isSubmitting && (
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              className="absolute -top-1 -right-1 h-6 w-6 rounded-full"
                              onClick={removeImage}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <Input
                        type="file"
                        className="hidden"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleImageChange}
                        disabled={isSubmitting}
                      />
                      <FormMessage />
                    </FormItem>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="birthDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Fecha de Nacimiento</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={'outline'}
                                  className={cn(
                                    'w-full pl-3 text-left font-normal',
                                    !field.value && 'text-muted-foreground'
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, 'd LLLL yyyy', { locale: es })
                                  ) : (
                                    <span>Selecciona una fecha</span>
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
                                disabled={(date) =>
                                  date > new Date() || date < new Date('1900-01-01')
                                }
                                autoFocus
                                locale={es}
                                captionLayout="dropdown"
                                startMonth={new Date(1920, 0)}
                                endMonth={new Date(new Date().getFullYear(), 11)}
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="memberId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID o cédula de miembro (opcional)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Ej: 123456" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting || isProfileLoading}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Página Principal</CardTitle>
            <CardDescription>
              Selecciona la página que se mostrará al iniciar sesión.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="main-page-select" className="text-sm font-medium">
                Página de inicio
              </Label>
              <select
                id="main-page-select"
                value={mainPage}
                onChange={(e) => handleMainPageChange(e.target.value)}
                disabled={isMainPageSaving || isProfileLoading}
                aria-label="Seleccionar página de inicio"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {navigationItems
                  .filter((item) => visiblePages.includes(item.href))
                  .map((item) => (
                    <option key={item.href} value={item.href}>
                      {item.label}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Esta será la primera página que verás al iniciar sesión.
              </p>
              {isMainPageSaving && (
                <p className="text-xs text-muted-foreground">Guardando...</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t('Appearance')}</CardTitle>
            <CardDescription>
              {t('Customize the look and feel of the application.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label className="text-sm font-medium">
                Tema de la aplicación
              </Label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => handleThemeChange('light')}
                  disabled={isThemeSaving}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all hover:bg-accent",
                    theme === 'light'
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/20",
                    isThemeSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="m4.93 4.93 1.41 1.41" />
                    <path d="m17.66 17.66 1.41 1.41" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="m6.34 17.66-1.41 1.41" />
                    <path d="m19.07 4.93-1.41 1.41" />
                  </svg>
                  <span className="text-sm font-medium">Claro</span>
                  {theme === 'light' && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleThemeChange('dark')}
                  disabled={isThemeSaving}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all hover:bg-accent",
                    theme === 'dark'
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/20",
                    isThemeSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                  <span className="text-sm font-medium">Oscuro</span>
                  {theme === 'dark' && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleThemeChange('system')}
                  disabled={isThemeSaving}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all hover:bg-accent",
                    theme === 'system'
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/20",
                    isThemeSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                  >
                    <rect width="20" height="14" x="2" y="3" rx="2" />
                    <line x1="8" x2="16" y1="21" y2="21" />
                    <line x1="12" x2="12" y1="17" y2="21" />
                  </svg>
                  <span className="text-sm font-medium">Sistema</span>
                  {theme === 'system' && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {theme === 'system'
                  ? 'El tema se ajustará automáticamente según la configuración de tu sistema operativo.'
                  : theme === 'dark'
                    ? 'Modo oscuro activado para reducir la fatiga visual.'
                    : 'Modo claro activado para mejor visibilidad en ambientes iluminados.'}
              </p>
              {isThemeSaving && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Guardando preferencia...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="xl:col-span-full">
          <CardHeader>
            <CardTitle>{t('Notifications')}</CardTitle>
            <CardDescription>
              {t('Configure how you receive notifications.')} Solo recibirás notificaciones de las páginas que tienes visibles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* ── Notificaciones In-App ─────────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label htmlFor="inapp-notifications-switch" className="flex flex-col space-y-1">
                  <span className="text-sm font-medium sm:text-base">{t('In-App Notifications')}</span>
                  <span className="text-xs font-normal leading-snug text-muted-foreground sm:text-sm">
                    {t('Receive notifications within the application about important activities.')}
                  </span>
                </Label>
                <Switch
                  id="inapp-notifications-switch"
                  checked={inAppNotificationsEnabled}
                  onCheckedChange={handleInAppNotificationChange}
                  disabled={isInAppNotificationLoading}
                />
              </div>

              {inAppNotificationsEnabled && (
                <div className="ml-2 space-y-2 border-l-2 border-muted pl-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Categorías de notificación (In-App)
                  </p>
                  {notificationCategories
                    .filter(cat => visiblePages.includes(cat.page))
                    .map(cat => (
                      <div key={`inapp-${cat.key}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-2">
                        <div className="flex flex-col space-y-0.5">
                          <span className="text-sm font-medium">{cat.label}</span>
                          <span className="text-xs text-muted-foreground">{cat.description}</span>
                          <span className="text-xs text-muted-foreground/70">{cat.inAppDetail}</span>
                        </div>
                        <Switch
                          id={`inapp-cat-${cat.key}`}
                          checked={inAppCategoryPrefs[cat.key] !== false}
                          onCheckedChange={(checked) => handleCategoryPrefChange('inApp', cat.key, checked)}
                          disabled={isCategoryPrefsSaving}
                          className="mt-1 sm:mt-0 shrink-0"
                        />
                      </div>
                    ))}
                  {notificationCategories.filter(cat => visiblePages.includes(cat.page)).length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No tienes páginas visibles configuradas para notificaciones.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t" />

            {/* ── Notificaciones Push ───────────────────────────────────── */}
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label htmlFor="push-notifications-switch" className="flex flex-col space-y-1">
                  <span className="text-sm font-medium sm:text-base">{t('Mobile Push Notifications')}</span>
                  <span className="text-xs font-normal leading-snug text-muted-foreground sm:text-sm">
                    {t('Receive push notifications on your Android/iOS device even when the app is closed.')}
                  </span>
                </Label>
                <Switch
                  id="push-notifications-switch"
                  checked={pushNotificationsEnabled}
                  onCheckedChange={handlePushNotificationChange}
                  disabled={isPushNotificationLoading}
                />
              </div>

              {pushNotificationsEnabled && (
                <div className="ml-2 space-y-2 border-l-2 border-muted pl-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Categorías de notificación (Push)
                  </p>
                  {notificationCategories
                    .filter(cat => visiblePages.includes(cat.page))
                    .map(cat => (
                      <div key={`push-${cat.key}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-2">
                        <div className="flex flex-col space-y-0.5">
                          <span className="text-sm font-medium">{cat.label}</span>
                          <span className="text-xs text-muted-foreground">{cat.description}</span>
                          <span className="text-xs text-muted-foreground/70">{cat.pushDetail}</span>
                        </div>
                        <Switch
                          id={`push-cat-${cat.key}`}
                          checked={pushCategoryPrefs[cat.key] !== false}
                          onCheckedChange={(checked) => handleCategoryPrefChange('push', cat.key, checked)}
                          disabled={isCategoryPrefsSaving}
                          className="mt-1 sm:mt-0 shrink-0"
                        />
                      </div>
                    ))}
                  {notificationCategories.filter(cat => visiblePages.includes(cat.page)).length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      No tienes páginas visibles configuradas para notificaciones.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive xl:col-span-full">
          <CardHeader>
            <CardTitle className="text-destructive">Zona de Peligro</CardTitle>
            <CardDescription>
              Estas acciones son permanentes y no se pueden deshacer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Eliminar mi cuenta</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción no se puede deshacer. Esto eliminará permanentemente tu cuenta y tu acceso a la aplicación.
                    Sin embargo, los datos que hayas ingresado (como reportes, actividades, etc.) permanecerán en el sistema.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteAccount} disabled={isDeleting}>
                    {isDeleting ? "Eliminando..." : "Sí, eliminar mi cuenta"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
