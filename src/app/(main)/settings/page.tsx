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
import {
  deleteUser,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import logger from '@/lib/logger';
import { normalizeDateForEcuadorStorage } from '@/lib/date-utils';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { doc, getDoc, updateDoc, deleteDoc, Timestamp, setDoc } from 'firebase/firestore';
import { usersCollection, storage, membersCollection } from '@/lib/collections';
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
import { getDateFnsLocale } from "@/lib/i18n-date";
import { CalendarIcon, User, Camera, Loader2, X, Link2, Search, Lock, Mail, KeyRound, Mic, MapPin } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { compressProfileImage } from '@/lib/image-compression';
import { getMembersForSelector } from '@/lib/members-data';
import type { Member } from '@/lib/types';
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

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const createProfileSchema = (t: TranslateFn) =>
  z.object({
    name: z.string().min(2, { message: t('settings.profile.validation.name') }),
    birthDate: z.date({
      required_error: t('settings.profile.validation.birthDate'),
    }),
    memberId: z.string().trim().optional(),
  });

type FormValues = z.infer<ReturnType<typeof createProfileSchema>>;

const createPasswordSchema = (t: TranslateFn) =>
  z.object({
    currentPassword: z.string().min(1, { message: t('settings.security.currentPasswordRequired') }),
    newPassword: z
      .string()
      .min(6, { message: t('settings.security.passwordMinLength') })
      .regex(/[A-Za-z]/, { message: t('settings.security.passwordNeedsLetter') })
      .regex(/\d/, { message: t('settings.security.passwordNeedsNumber') }),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: t('settings.security.passwordMismatch'),
    path: ["confirmPassword"],
  });

type PasswordValues = z.infer<ReturnType<typeof createPasswordSchema>>;

const createEmailSchema = (t: TranslateFn) =>
  z.object({
    newEmail: z.string().email({ message: t('settings.security.emailInvalid') }),
    currentPassword: z.string().min(1, { message: t('settings.security.confirmPasswordRequired') }),
  });

type EmailValues = z.infer<ReturnType<typeof createEmailSchema>>;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB



export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const { user, firebaseUser, refreshAuth, barrioOrg } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMainPageSaving, setIsMainPageSaving] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [isEmailSaving, setIsEmailSaving] = useState(false);

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
  const [micEnabled, setMicEnabled] = useState(false);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [isMicLoading, setIsMicLoading] = useState(true);
  const [isGpsLoading, setIsGpsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  // Track original birthDate to detect user edits vs sync pulls
  const originalBirthDateRef = useRef<Date | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [visiblePages, setVisiblePages] = useState<string[]>([]);
  const [mainPage, setMainPage] = useState<string>('/');
  const [isCheckingRole, setIsCheckingRole] = useState(true);

  // Synced member state
  const [syncedMemberId, setSyncedMemberId] = useState<string | null>(null);
  const [syncedMemberName, setSyncedMemberName] = useState<string | null>(null);
  const [membersForSync, setMembersForSync] = useState<Member[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [syncMemberSearch, setSyncMemberSearch] = useState('');
  const [syncDropdownOpen, setSyncDropdownOpen] = useState(false);
  const syncDropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const loadNotificationPreferences = async () => {
      if (!user) {
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
  }, [user, defaultCategoryPrefs]);

  // Load permission prefs (available for all roles)
  useEffect(() => {
    const loadPermissionPreferences = async () => {
      if (!user) {
        setIsMicLoading(false);
        setIsGpsLoading(false);
        return;
      }

      try {
        const userDocRef = doc(usersCollection, user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
          setMicEnabled(userData.micPermissionEnabled === true);
          setGpsEnabled(userData.gpsPermissionEnabled === true);
        } else {
          setMicEnabled(false);
          setGpsEnabled(false);
        }
      } catch (error) {
        logger.error({ error, message: 'Error loading permission preferences' });
        setMicEnabled(false);
        setGpsEnabled(false);
      } finally {
        setIsMicLoading(false);
        setIsGpsLoading(false);
      }
    };

    loadPermissionPreferences();
  }, [user]);

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

  // Click outside to close sync dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (syncDropdownRef.current && !syncDropdownRef.current.contains(e.target as Node)) {
        setSyncDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load members for sync selector
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadMembers() {
      setIsMembersLoading(true);
      try {
        const members = await getMembersForSelector(false, barrioOrg);
        if (!cancelled && members) {
          setMembersForSync(members as Member[]);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setIsMembersLoading(false);
      }
    }
    loadMembers();
    return () => { cancelled = true; };
  }, [user]);

  // Filter members for sync dropdown
  const filteredSyncMembers = membersForSync.filter(m =>
    `${m.firstName} ${m.lastName}`.toLowerCase().includes(syncMemberSearch.toLowerCase())
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(createProfileSchema(t)),
    defaultValues: {
      name: '',
      memberId: '',
    },
  });

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(createPasswordSchema(t)),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(createEmailSchema(t)),
    defaultValues: {
      newEmail: '',
      currentPassword: '',
    },
  });

  // Keep synced member name and birthDate up-to-date
  useEffect(() => {
    if (!syncedMemberId) return;
    let cancelled = false;

    async function refreshSyncedMemberData() {
      try {
        const memberRef = doc(membersCollection, syncedMemberId!);
        const memberSnap = await getDoc(memberRef);
        if (!cancelled && memberSnap.exists()) {
          const mData = memberSnap.data();
          setSyncedMemberName(`${mData.firstName} ${mData.lastName}`);

          // Pull birthDate from member — member is authoritative
          if (mData.birthDate) {
            const memberBirth = (mData.birthDate as Timestamp).toDate();
            form.setValue('birthDate', memberBirth);
            originalBirthDateRef.current = memberBirth;
          }
        }
      } catch {
        // silently fail, keep current values
      }
    }

    refreshSyncedMemberData();
    return () => { cancelled = true; };
  }, [syncedMemberId, form]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!firebaseUser) {
        setIsCheckingRole(false);
        return;
      }

      setIsProfileLoading(true);
      setIsCheckingRole(true);

      try {
        const userDocRef = doc(usersCollection, firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const userData = userDoc.data();
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

          // Store original birthDate for change detection
          originalBirthDateRef.current = userData.birthDate
            ? (userData.birthDate as Timestamp).toDate()
            : null;

          // Load synced member
          setSyncedMemberId(userData.syncedMemberId || null);
          setSyncedMemberName(userData.syncedMemberName || null);

          // Use Firestore photoURL as primary source (may come from synced member), fallback to Firebase Auth
          const firestorePhotoURL = userData.photoURL || null;
          setPreviewUrl(firestorePhotoURL || firebaseUser.photoURL || null);
        } else {
          form.reset({
            name: firebaseUser.displayName || '',
            memberId: '',
          });
          originalBirthDateRef.current = null;
          setSyncedMemberId(null);
          setSyncedMemberName(null);
          setPreviewUrl(firebaseUser.photoURL || null);
        }
      } catch (error) {
        logger.error({ error, message: 'Error loading settings profile data' });
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
    let finalPhotoURL: string | null = null;

    try {
      if (selectedFile) {
        // User uploaded a new photo (compressed client-side)
        const optimized = await compressProfileImage(selectedFile);
        const storageRef = ref(storage, `profile_pictures/users/${firebaseUser.uid}/${Date.now()}_${optimized.name}`);
        await uploadBytes(storageRef, optimized, { contentType: optimized.type });
        finalPhotoURL = await getDownloadURL(storageRef);

        if (firebaseUser.photoURL && firebaseUser.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, firebaseUser.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: "Could not delete old profile picture" }));
        }
      } else if (!previewUrl) {
        // User removed the photo
        if (firebaseUser.photoURL && firebaseUser.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, firebaseUser.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: "Image to be removed could not be deleted" }));
        }
        finalPhotoURL = null;
      } else {
        // Keep current photo (from Firebase Auth, Firestore, or synced member)
        finalPhotoURL = previewUrl;
      }

      await updateProfile(firebaseUser, {
        displayName: values.name,
        photoURL: finalPhotoURL,
      });

      const userDocRef = doc(usersCollection, firebaseUser.uid);
      const userUpdateData: Record<string, unknown> = {
        name: values.name,
        birthDate: Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate)),
        photoURL: finalPhotoURL,
        mainPage: mainPage,
        memberId: values.memberId?.trim() || null,
        syncedMemberId: syncedMemberId || null,
        syncedMemberName: syncedMemberName || null,
      };

      await setDoc(userDocRef, userUpdateData, { merge: true });

      // Bidirectional sync with selected member
      if (syncedMemberId) {
        const memberRef = doc(membersCollection, syncedMemberId);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          const mData = memberSnap.data();

          // 1) Push user data to member
          const memberUpdate: Record<string, unknown> = {};

          // Name: parse first/last name from user's full name
          const nameParts = (values.name || '').trim().split(/\s+/);
          if (nameParts.length >= 2) {
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ');
            memberUpdate.firstName = firstName;
            memberUpdate.lastName = lastName;
          } else if (nameParts.length === 1) {
            memberUpdate.firstName = nameParts[0];
          }

          if (values.birthDate) {
            // Only push birthDate to member if the user explicitly changed it
            const currentBirthDate = values.birthDate;
            const originalBirth = originalBirthDateRef.current;
            const userChangedBirthDate =
              !originalBirth ||
              normalizeDateForEcuadorStorage(currentBirthDate).getTime() !== normalizeDateForEcuadorStorage(originalBirth).getTime();

            if (userChangedBirthDate) {
              memberUpdate.birthDate = Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate));
            }
          }
          if (values.memberId?.trim()) {
            memberUpdate.memberId = values.memberId.trim();
          }
          // Only push photo if user uploaded a new one (not on delete)
          if (selectedFile && finalPhotoURL) {
            memberUpdate.photoURL = finalPhotoURL;
          }

          if (Object.keys(memberUpdate).length > 0) {
            await updateDoc(memberRef, { ...memberUpdate, updatedAt: Timestamp.now() });
          }

          // 2) Pull member data to user (only if user doesn't have it)
          const pullUpdates: Record<string, unknown> = {};

          const userDocSnap = await getDoc(userDocRef);
          const currentUserData = userDocSnap.exists() ? userDocSnap.data() : {};

          // Pull phone number
          if (mData.phoneNumber && !currentUserData.phoneNumber) {
            pullUpdates.phoneNumber = mData.phoneNumber;
          }
          // Pull email
          if (mData.email && !currentUserData.email && !firebaseUser.email) {
            pullUpdates.email = mData.email;
          }
          // Pull address
          if (mData.address && !currentUserData.address) {
            pullUpdates.address = mData.address;
          }
          // Pull birthDate from member — member is authoritative
          if (mData.birthDate) {
            const memberBirthMs = (mData.birthDate as Timestamp).toDate().getTime();
            const userBirthTime = currentUserData.birthDate
              ? (currentUserData.birthDate as Timestamp).toDate().getTime()
              : 0;
            if (!currentUserData.birthDate || userBirthTime !== memberBirthMs) {
              pullUpdates.birthDate = mData.birthDate;
              form.setValue('birthDate', (mData.birthDate as Timestamp).toDate());
            }
          }
          // Pull memberId if user doesn't have one
          if (mData.memberId && !currentUserData.memberId) {
            pullUpdates.memberId = mData.memberId;
            form.setValue('memberId', mData.memberId);
          }
          // Pull photo from member if user doesn't have one
          if (mData.photoURL && !finalPhotoURL && !currentUserData.photoURL) {
            pullUpdates.photoURL = mData.photoURL;
            finalPhotoURL = mData.photoURL;
            setPreviewUrl(mData.photoURL);
          }

          if (Object.keys(pullUpdates).length > 0) {
            await setDoc(userDocRef, pullUpdates, { merge: true });
          }

          // If photo was pulled from member, update Firebase Auth too
          if (finalPhotoURL && !firebaseUser.photoURL) {
            await updateProfile(firebaseUser, {
              displayName: values.name,
              photoURL: finalPhotoURL,
            });
          }

          logger.info({
            message: 'Bidirectional sync completed',
            syncedMemberId,
            pushedFields: Object.keys(memberUpdate),
            pulledFields: Object.keys(pullUpdates),
          });
        }
      }

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
      // 1. Eliminar el documento del usuario en Firestore (c_users/{uid})
      await deleteDoc(doc(usersCollection, firebaseUser.uid));
      // 2. Eliminar la cuenta de Firebase Auth
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

  const onChangePassword = async (values: PasswordValues) => {
    if (!firebaseUser || !firebaseUser.email) return;
    setIsPasswordSaving(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, values.currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, values.newPassword);
      toast({
        title: t('settings.security.passwordUpdatedTitle'),
        description: t('settings.security.passwordUpdatedDescription'),
      });
      passwordForm.reset();
    } catch (error: any) {
      logger.error({ error, message: "Error changing password" });
      let description = t('settings.security.errorUnexpected');
      const code = error?.code as string | undefined;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
        description = t('settings.security.errorWrongPassword');
      } else if (code === 'auth/requires-recent-login') {
        description = t('settings.security.errorRequiresRecentLogin');
      } else if (code === 'auth/weak-password') {
        description = t('settings.security.errorWeakPassword');
      } else if (code === 'auth/network-request-failed') {
        description = t('settings.security.errorNetwork');
      }
      toast({
        title: t('settings.security.passwordUpdatedTitle'),
        description,
        variant: 'destructive',
      });
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const onChangeEmail = async (values: EmailValues) => {
    if (!firebaseUser || !firebaseUser.email) return;
    if (values.newEmail.toLowerCase() === firebaseUser.email.toLowerCase()) {
      emailForm.setError('newEmail', {
        type: 'manual',
        message: t('settings.security.emailSameAsCurrent'),
      });
      return;
    }
    setIsEmailSaving(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email!, values.currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await verifyBeforeUpdateEmail(firebaseUser, values.newEmail);
      toast({
        title: t('settings.security.emailVerificationSentTitle'),
        description: t('settings.security.emailVerificationSentDescription'),
      });
      emailForm.reset();
    } catch (error: any) {
      logger.error({ error, message: "Error changing email" });
      let description = t('settings.security.errorUnexpected');
      const code = error?.code as string | undefined;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
        description = t('settings.security.errorInvalidCredential');
      } else if (code === 'auth/requires-recent-login') {
        description = t('settings.security.errorRequiresRecentLogin');
      } else if (code === 'auth/email-already-in-use') {
        description = t('settings.security.errorEmailInUse');
      } else if (code === 'auth/invalid-email') {
        description = t('settings.security.errorInvalidEmail');
      } else if (code === 'auth/network-request-failed') {
        description = t('settings.security.errorNetwork');
      }
      toast({
        title: t('settings.security.errorUnexpected'),
        description,
        variant: 'destructive',
      });
    } finally {
      setIsEmailSaving(false);
    }
  };

  const handleInAppNotificationChange = async (checked: boolean) => {
    if (!user) {
      toast({
        title: t('common.error'),
        description: t('settings.toast.mustSignIn'),
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
        title: checked ? t('settings.toast.inAppEnabledTitle') : t('settings.toast.inAppDisabledTitle'),
        description: checked
          ? t('settings.toast.inAppEnabledDesc')
          : t('settings.toast.inAppDisabledDesc'),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update in-app notification preference' });
      toast({
        title: t('common.error'),
        description: t('settings.toast.inAppUpdateError'),
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
        title: t('common.error'),
        description: t('settings.toast.mustSignIn'),
        variant: 'destructive',
      });
      return;
    }

    setIsPushNotificationLoading(true);

    try {
      const userDocRef = doc(usersCollection, user.uid);

      if (checked) {
        // Request permission + token BEFORE flipping the server flag, so Cloud
        // Functions never see pushEnabled=true without a registered FCM token.
        const token = await requestNotificationPermission();
        if (!token) {
          throw new Error(t('settings.toast.pushUpdateError'));
        }

        const saved = await saveCurrentPushSubscription(user.uid, token);
        if (!saved) {
          throw new Error(t('settings.toast.pushUpdateError'));
        }

        await setDoc(userDocRef, {
          pushNotificationsEnabled: true
        }, { merge: true });

        setPushNotificationsEnabled(true);
        setFcmToken(token);
      } else {
        await deleteNotificationToken();
        await clearCurrentPushSubscription(user.uid);
        await setDoc(userDocRef, {
          pushNotificationsEnabled: false
        }, { merge: true });

        setPushNotificationsEnabled(false);
        setFcmToken(null);
      }

      toast({
        title: checked ? t('settings.toast.pushEnabledTitle') : t('settings.toast.pushDisabledTitle'),
        description: checked
          ? t('settings.toast.pushEnabledDesc')
          : t('settings.toast.pushDisabledDesc'),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update push notification preference' });
      toast({
        title: t('common.error'),
        description: t('settings.toast.pushUpdateError'),
        variant: 'destructive',
      });
      // Keep UI in sync with the last known successful state
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
        title: t('common.error'),
        description: t('settings.toast.categoryPrefError'),
        variant: 'destructive',
      });
    } finally {
      setIsCategoryPrefsSaving(false);
    }
  };

  const handleMicPermissionChange = async (checked: boolean) => {
    if (!user) {
      toast({
        title: t('common.error'),
        description: t('settings.toast.mustSignIn'),
        variant: 'destructive',
      });
      return;
    }

    setIsMicLoading(true);

    try {
      if (checked) {
        // Request microphone permission before saving
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        } catch {
          toast({
            title: t('settings.toast.subscriptionPermissionDeniedTitle'),
            description: t('memberForm.toast.gpsPermissionDenied'),
            variant: 'destructive',
          });
          setIsMicLoading(false);
          return;
        }
      }

      const userDocRef = doc(usersCollection, user.uid);
      await updateDoc(userDocRef, { micPermissionEnabled: checked });
      setMicEnabled(checked);

      toast({
        title: checked ? t('settings.permissions.microphoneEnabledTitle') : t('settings.permissions.microphoneDisabledTitle'),
        description: checked
          ? t('settings.permissions.microphoneEnabledDesc')
          : t('settings.permissions.microphoneDisabledDesc'),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update microphone permission preference' });
      toast({
        title: t('common.error'),
        description: t('settings.permissions.updateError'),
        variant: 'destructive',
      });
      setMicEnabled(!checked);
    } finally {
      setIsMicLoading(false);
    }
  };

  const handleGpsPermissionChange = async (checked: boolean) => {
    if (!user) {
      toast({
        title: t('common.error'),
        description: t('settings.toast.mustSignIn'),
        variant: 'destructive',
      });
      return;
    }

    setIsGpsLoading(true);

    try {
      if (checked) {
        // Request geolocation permission before saving
        if (!navigator.geolocation) {
          toast({
            title: t('memberForm.toast.gpsUnavailableTitle'),
            description: t('memberForm.toast.gpsUnavailableDesc'),
            variant: 'destructive',
          });
          setIsGpsLoading(false);
          return;
        }

        try {
          await new Promise<void>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve(),
              (err) => reject(err),
              { timeout: 10000 }
            );
          });
        } catch {
          toast({
            title: t('memberForm.toast.gpsPermissionDenied'),
            description: t('memberForm.toast.gpsUnavailableNow'),
            variant: 'destructive',
          });
          setIsGpsLoading(false);
          return;
        }
      }

      const userDocRef = doc(usersCollection, user.uid);
      await updateDoc(userDocRef, { gpsPermissionEnabled: checked });
      setGpsEnabled(checked);

      toast({
        title: checked ? t('settings.permissions.gpsEnabledTitle') : t('settings.permissions.gpsDisabledTitle'),
        description: checked
          ? t('settings.permissions.gpsEnabledDesc')
          : t('settings.permissions.gpsDisabledDesc'),
      });
    } catch (error) {
      logger.error({ error, message: 'Failed to update GPS permission preference' });
      toast({
        title: t('common.error'),
        description: t('settings.permissions.updateError'),
        variant: 'destructive',
      });
      setGpsEnabled(!checked);
    } finally {
      setIsGpsLoading(false);
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
      label: t('settings.cat.observations.label'),
      description: t('settings.cat.observations.description'),
      page: '/observations',
      inAppDetail: t('settings.cat.detail.weekly'),
      pushDetail: t('settings.cat.detail.weekly'),
    },
    {
      key: 'converts',
      label: t('settings.cat.converts.label'),
      description: t('settings.cat.converts.description'),
      page: '/converts',
      inAppDetail: t('settings.cat.detail.weekly'),
      pushDetail: t('settings.cat.detail.weekly'),
    },
    {
      key: 'futureMembers',
      label: t('settings.cat.futureMembers.label'),
      description: t('settings.cat.futureMembers.description'),
      page: '/missionary-work',
      inAppDetail: t('settings.cat.detail.baptism3days'),
      pushDetail: t('settings.cat.detail.baptism3days'),
    },
    {
      key: 'birthdays',
      label: t('settings.cat.birthdays.label'),
      description: t('settings.cat.birthdays.description'),
      page: '/birthdays',
      inAppDetail: t('settings.cat.detail.birthday'),
      pushDetail: t('settings.cat.detail.birthday'),
    },
    {
      key: 'familySearch',
      label: t('settings.cat.familySearch.label'),
      description: t('settings.cat.familySearch.description'),
      page: '/family-search',
      inAppDetail: t('settings.cat.detail.weekly'),
      pushDetail: t('settings.cat.detail.weekly'),
    },
    {
      key: 'missionaryWork',
      label: t('settings.cat.missionaryWork.label'),
      description: t('settings.cat.missionaryWork.description'),
      page: '/missionary-work',
      inAppDetail: t('settings.cat.detail.weekly'),
      pushDetail: t('settings.cat.detail.weekly'),
    },
    {
      key: 'service',
      label: t('settings.cat.service.label'),
      description: t('settings.cat.service.description'),
      page: '/service',
      inAppDetail: t('settings.cat.detail.service'),
      pushDetail: t('settings.cat.detail.service'),
    },
    {
      key: 'council',
      label: t('settings.cat.council.label'),
      description: t('settings.cat.council.description'),
      page: '/council',
      inAppDetail: t('settings.cat.detail.council'),
      pushDetail: t('settings.cat.detail.council'),
    },
    {
      key: 'activities',
      label: t('settings.cat.activities.label'),
      description: t('settings.cat.activities.description'),
      page: '/reports/activities',
      inAppDetail: t('settings.cat.detail.activity'),
      pushDetail: t('settings.cat.detail.activity'),
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
        <Card className="xl:col-span-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {t('settings.security.title')}
            </CardTitle>
            <CardDescription>
              {t('settings.security.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            {/* ── Change Password ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{t('settings.security.changePassword')}</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.security.changePasswordDescription')}
              </p>
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-3">
                  <FormField
                    control={passwordForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settings.security.currentPasswordLabel')}</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settings.security.newPasswordLabel')}</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settings.security.confirmPasswordLabel')}</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isPasswordSaving} className="w-full">
                    {isPasswordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isPasswordSaving ? t('settings.security.saving') : t('settings.security.updatePasswordButton')}
                  </Button>
                </form>
              </Form>
            </div>

            {/* ── Change Email ── */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{t('settings.security.changeEmail')}</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.security.changeEmailDescription')}
              </p>
              <Form {...emailForm}>
                <form onSubmit={emailForm.handleSubmit(onChangeEmail)} className="space-y-3">
                  <FormField
                    control={emailForm.control}
                    name="newEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settings.security.newEmailLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="email"
                            placeholder={firebaseUser?.email ?? 'tu@correo.com'}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={emailForm.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settings.security.currentPasswordForEmailLabel')}</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isEmailSaving} className="w-full">
                    {isEmailSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEmailSaving ? t('settings.security.saving') : t('settings.security.updateEmailButton')}
                  </Button>
                </form>
              </Form>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('Profile')}</CardTitle>
            <CardDescription>
              {t('settings.profile.cardDescription')}
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
                          {/* Loading overlay during upload */}
                          {isSubmitting && (
                            <div className="absolute inset-0 bg-black/60 rounded-full flex flex-col items-center justify-center gap-1 z-10">
                              <Loader2 className="h-8 w-8 text-white animate-spin" />
                              <span className="text-white text-[10px] font-medium">{t('settings.profile.uploading')}</span>
                            </div>
                          )}
                          {/* Hover overlay (hidden during upload) */}
                          {!isSubmitting && (
                            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button type="button" variant="ghost" size="icon" className="h-full w-full text-white" onClick={() => fileInputRef.current?.click()}>
                                <Camera className="h-8 w-8" />
                              </Button>
                            </div>
                          )}
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
                          <FormLabel>{t('settings.profile.name')}</FormLabel>
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
                          <FormLabel>{t('settings.profile.birthDate')}</FormLabel>
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
                                    format(field.value, 'd LLLL yyyy', { locale: getDateFnsLocale() })
                                  ) : (
                                    <span>{t('settings.profile.selectDate')}</span>
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
                                locale={getDateFnsLocale()}
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
                          <FormLabel>{t('settings.profile.memberId')}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={t('settings.profile.memberIdPlaceholder')} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* ── Sync Member Selector ── */}
                    <div className="space-y-2" ref={syncDropdownRef}>
                      <Label className="text-sm font-medium flex items-center gap-1.5">
                        <Link2 className="h-4 w-4 text-muted-foreground" />
                        {t('settings.profile.syncLabel')}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.profile.syncDescription')}
                      </p>

                      {syncedMemberId && syncedMemberName ? (
                        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm flex-1 truncate">{syncedMemberName}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setSyncedMemberId(null);
                              setSyncedMemberName(null);
                              setSyncMemberSearch('');
                            }}
                          >
                            {t('settings.profile.unlink')}
                          </Button>
                        </div>
                      ) : (
                        <div className="relative">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="text"
                              placeholder={t('settings.profile.searchMember')}
                              value={syncMemberSearch}
                              onChange={(e) => {
                                setSyncMemberSearch(e.target.value);
                                if (!syncDropdownOpen) setSyncDropdownOpen(true);
                              }}
                              onFocus={() => setSyncDropdownOpen(true)}
                              disabled={isMembersLoading}
                              className="pl-9"
                            />
                          </div>

                          {syncDropdownOpen && (
                            <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg">
                              {isMembersLoading ? (
                                <div className="flex items-center justify-center p-4">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              ) : filteredSyncMembers.length > 0 ? (
                                <ul className="max-h-52 overflow-auto py-1">
                                  {filteredSyncMembers.map((member) => (
                                    <li key={member.id}>
                                      <button
                                        type="button"
                                        className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                                        onClick={() => {
                                          setSyncedMemberId(member.id);
                                          setSyncedMemberName(`${member.firstName} ${member.lastName}`);
                                          setSyncMemberSearch('');
                                          setSyncDropdownOpen(false);
                                        }}
                                      >
                                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span>{member.firstName} {member.lastName}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : syncMemberSearch ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {t('settings.profile.noMembersFound')}
                                </div>
                              ) : (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                  {t('settings.profile.typeToSearch')}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="submit"
                  disabled={isSubmitting || isProfileLoading}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting ? t('settings.profile.saving') : t('settings.profile.saveChanges')}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </Card>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t('settings.mainPage.title')}</CardTitle>
            <CardDescription>
              {t('settings.mainPage.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="main-page-select" className="text-sm font-medium">
                {t('settings.mainPage.label')}
              </Label>
              <select
                id="main-page-select"
                value={mainPage}
                onChange={(e) => handleMainPageChange(e.target.value)}
                disabled={isMainPageSaving || isProfileLoading}
                aria-label={t('settings.mainPage.aria')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {navigationItems
                  .filter((item) => visiblePages.includes(item.href))
                  .map((item) => (
                    <option key={item.href} value={item.href}>
                      {t(item.i18nKey)}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t('settings.mainPage.hint')}
              </p>
              {isMainPageSaving && (
                <p className="text-xs text-muted-foreground">{t('settings.mainPage.saving')}</p>
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
                {t('settings.theme.label')}
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
                  <span className="text-sm font-medium">{t('settings.theme.light')}</span>
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
                  <span className="text-sm font-medium">{t('settings.theme.dark')}</span>
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
                  <span className="text-sm font-medium">{t('settings.theme.system')}</span>
                  {theme === 'system' && (
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {theme === 'system'
                  ? t('settings.theme.hintSystem')
                  : theme === 'dark'
                    ? t('settings.theme.hintDark')
                    : t('settings.theme.hintLight')}
              </p>
              {isThemeSaving && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('settings.theme.saving')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="xl:col-span-full">
          <CardHeader>
            <CardTitle>{t('settings.permissions.title')}</CardTitle>
            <CardDescription>
              {t('settings.permissions.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* ── Micrófono ─────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Mic className="h-5 w-5 text-muted-foreground" />
                </div>
                <Label htmlFor="mic-permission-switch" className="flex flex-col space-y-1 cursor-pointer">
                  <span className="text-sm font-medium sm:text-base">{t('settings.permissions.microphone')}</span>
                  <span className="text-xs font-normal leading-snug text-muted-foreground sm:text-sm">
                    {t('settings.permissions.microphoneHint')}
                  </span>
                </Label>
              </div>
              <Switch
                id="mic-permission-switch"
                checked={micEnabled}
                onCheckedChange={handleMicPermissionChange}
                disabled={isMicLoading}
              />
            </div>

            <div className="border-t" />

            {/* ── GPS / Ubicación ─────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                <Label htmlFor="gps-permission-switch" className="flex flex-col space-y-1 cursor-pointer">
                  <span className="text-sm font-medium sm:text-base">{t('settings.permissions.gps')}</span>
                  <span className="text-xs font-normal leading-snug text-muted-foreground sm:text-sm">
                    {t('settings.permissions.gpsHint')}
                  </span>
                </Label>
              </div>
              <Switch
                id="gps-permission-switch"
                checked={gpsEnabled}
                onCheckedChange={handleGpsPermissionChange}
                disabled={isGpsLoading}
              />
            </div>
          </CardContent>
        </Card>
        <Card className="xl:col-span-full">
          <CardHeader>
            <CardTitle>{t('Notifications')}</CardTitle>
            <CardDescription>
              {t('Configure how you receive notifications.')} {t('settings.notifications.visiblePagesOnly')}
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
                    {t('settings.notifications.inAppCategories')}
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
                      {t('settings.notifications.noVisiblePages')}
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
                    {t('settings.notifications.pushCategories')}
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
                      {t('settings.notifications.noVisiblePages')}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive xl:col-span-full">
          <CardHeader>
            <CardTitle className="text-destructive">{t('settings.danger.title')}</CardTitle>
            <CardDescription>
              {t('settings.danger.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">{t('settings.danger.deleteButton')}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('settings.danger.confirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('settings.danger.confirmDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteAccount} disabled={isDeleting}>
                    {isDeleting ? t('settings.danger.deleting') : t('settings.danger.confirmDelete')}
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

