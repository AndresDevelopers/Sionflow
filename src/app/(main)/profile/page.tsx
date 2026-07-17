
'use client';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { OfflineImage } from '@/components/offline-image';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { usersCollection, storage, membersCollection } from '@/lib/collections';
import { compressProfileImage } from '@/lib/image-compression';
import type { Member } from '@/lib/types';
import { format, differenceInYears } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Camera, Pencil, Save, X, Link2, Mail, Church, Droplets, Loader2 } from 'lucide-react';
import { PhoneLink, AddressLink } from '@/lib/contact-links';
import { OrdinanceLabels } from '@/lib/types';

interface UserProfileData {
    name?: string;
    lastName?: string;
    email?: string;
    photoURL?: string | null;
    birthDate?: Timestamp;
    memberId?: string | null;
    syncedMemberId?: string | null;
    syncedMemberName?: string | null;
    phoneNumber?: string;
    address?: string;
}

export default function ProfilePage() {
    const { t } = useI18n();
    const { user, loading: authLoading, userRole } = useAuth();
    const searchParams = useSearchParams();
    const [profileData, setProfileData] = useState<UserProfileData | null>(null);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editValues, setEditValues] = useState({
        name: '',
        lastName: '',
        birthDate: '',
        memberId: '',
    });
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [removeImage, setRemoveImage] = useState(false);
    const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null);

    // Synced member data
    const [syncedMember, setSyncedMember] = useState<Member | null>(null);
    const [loadingSyncedMember, setLoadingSyncedMember] = useState(false);

    const targetUid = searchParams.get('uid') ?? user?.uid ?? null;
    const isViewingOtherUser = Boolean(targetUid && user?.uid && targetUid !== user.uid);
    const canEditProfile = userRole === 'secretary' && isViewingOtherUser;

    useEffect(() => {
        const fetchUserData = async () => {
            if (!targetUid) return;
            setLoadingProfile(true);
            try {
                const userDocRef = doc(usersCollection, targetUid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                    const data = userDoc.data() as UserProfileData;
                    setProfileData(data);
                    setEditValues({
                        name: data.name ?? '',
                        lastName: data.lastName ?? '',
                        birthDate: data.birthDate
                            ? format(data.birthDate.toDate(), 'yyyy-MM-dd')
                            : '',
                        memberId: data.memberId ?? '',
                    });
                    setPreviewUrl(data.photoURL ?? null);
                    setSelectedFile(null);
                    setRemoveImage(false);
                } else {
                    setProfileData(null);
                    setPreviewUrl(null);
                    setSelectedFile(null);
                    setRemoveImage(false);
                }
            } catch (error) {
                console.error("Error fetching user profile data:", error);
            } finally {
                setLoadingProfile(false);
                setIsEditing(false);
            }
        };

        fetchUserData();
    }, [targetUid]);

    // Load synced member data when user has a syncedMemberId
    useEffect(() => {
        if (!profileData?.syncedMemberId) {
            setSyncedMember(null);
            setLoadingSyncedMember(false);
            return;
        }

        let cancelled = false;
        setLoadingSyncedMember(true);

        async function loadSyncedMember() {
            try {
                const memberRef = doc(membersCollection, profileData!.syncedMemberId!);
                const memberSnap = await getDoc(memberRef);
                if (!cancelled && memberSnap.exists()) {
                    const mData = memberSnap.data() as Record<string, unknown>;
                    setSyncedMember({
                        id: memberSnap.id,
                        ...mData,
                    } as Member);
                } else if (!cancelled) {
                    setSyncedMember(null);
                }
            } catch {
                if (!cancelled) setSyncedMember(null);
            } finally {
                if (!cancelled) setLoadingSyncedMember(false);
            }
        }

        loadSyncedMember();
        return () => { cancelled = true; };
    }, [profileData?.syncedMemberId, profileData?.syncedMemberName]);

    const loading = authLoading || loadingProfile;

    // ── Derived values: use synced member data as fallback ──
    const syncedFullName = syncedMember
        ? `${syncedMember.firstName} ${syncedMember.lastName}`.trim()
        : null;

    const profileFullName = profileData
        ? `${profileData.name ?? ''} ${profileData.lastName ?? ''}`.trim()
        : '';

    const displayName = isViewingOtherUser
        ? profileFullName || syncedFullName || t('profile.fallbackUser')
        : profileFullName || user?.displayName || syncedFullName || t('profile.fallbackUser');

    const displayEmail = isViewingOtherUser
        ? profileData?.email ?? syncedMember?.email ?? undefined
        : profileData?.email ?? user?.email ?? syncedMember?.email ?? undefined;

    const basePhotoUrl = isViewingOtherUser
        ? profileData?.photoURL ?? syncedMember?.photoURL ?? undefined
        : profileData?.photoURL ?? user?.photoURL ?? syncedMember?.photoURL ?? undefined;

    const displayPhoto = isEditing && canEditProfile ? previewUrl ?? undefined : basePhotoUrl;

    const effectiveBirthDate = syncedMember?.birthDate ?? profileData?.birthDate ?? undefined;
    const effectiveMemberId = profileData?.memberId ?? syncedMember?.memberId ?? undefined;

    const initialsSource = displayName || displayEmail || 'U';
    const displayInitials = initialsSource.charAt(0).toUpperCase();

    const handleCancelEdit = () => {
        setEditValues({
            name: profileData?.name ?? '',
            lastName: profileData?.lastName ?? '',
            birthDate: profileData?.birthDate
                ? format(profileData.birthDate.toDate(), 'yyyy-MM-dd')
                : '',
            memberId: profileData?.memberId ?? '',
        });
        setPreviewUrl(profileData?.photoURL ?? null);
        setSelectedFile(null);
        setRemoveImage(false);
        setIsEditing(false);
    };

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }

        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setRemoveImage(false);
    };

    const handleRemoveImage = () => {
        if (previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }
        setSelectedFile(null);
        setPreviewUrl(null);
        setRemoveImage(true);
    };

    const handleSaveEdit = async () => {
        if (!targetUid) return;
        const trimmedName = editValues.name.trim();
        const trimmedLastName = editValues.lastName.trim();
        if (!trimmedName) return;

        setIsSaving(true);
        try {
            let nextPhotoUrl: string | null | undefined = basePhotoUrl;

            if (selectedFile) {
                const optimized = await compressProfileImage(selectedFile);
                // Path under the uploader's uid (Storage rules: owner write only).
                // Secretary may set another user's photoURL; object lives under their own tree.
                const uploaderUid = user?.uid ?? targetUid;
                const { userScopedStoragePath } = await import('@/lib/storage-paths');
                const path = userScopedStoragePath(uploaderUid, 'profile_pictures/users', optimized.name);
                const storageRef = ref(storage, path);
                await uploadBytes(storageRef, optimized, { contentType: optimized.type });
                nextPhotoUrl = await getDownloadURL(storageRef);

                if (basePhotoUrl?.startsWith('https://firebasestorage.googleapis.com')) {
                    const oldImageRef = ref(storage, basePhotoUrl);
                    await deleteObject(oldImageRef).catch((error) =>
                        console.warn('Could not delete old profile picture', error)
                    );
                }
            }

            if (removeImage && basePhotoUrl?.startsWith('https://firebasestorage.googleapis.com')) {
                const oldImageRef = ref(storage, basePhotoUrl);
                await deleteObject(oldImageRef).catch((error) =>
                    console.warn('Could not delete profile picture', error)
                );
                nextPhotoUrl = null;
            }

            const updates: Partial<UserProfileData> & { updatedAt: Timestamp } = {
                name: trimmedName,
                lastName: trimmedLastName || undefined,
                memberId: editValues.memberId.trim() || null,
                updatedAt: Timestamp.now(),
            };

            if (nextPhotoUrl !== basePhotoUrl) {
                updates.photoURL = nextPhotoUrl ?? null;
            }

            if (editValues.birthDate) {
                updates.birthDate = Timestamp.fromDate(new Date(editValues.birthDate));
            }

            await updateDoc(doc(usersCollection, targetUid), updates);
            setProfileData((prev) =>
                prev
                    ? {
                        ...prev,
                        ...updates,
                    }
                    : (updates as UserProfileData)
            );
            setPreviewUrl((updates.photoURL as string | null | undefined) ?? basePhotoUrl ?? null);
            setSelectedFile(null);
            setRemoveImage(false);
            setIsEditing(false);
        } catch (error) {
            console.error('Error updating user profile data:', error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="page-section">
            <div className="flex flex-col gap-2">
                <h1 className="text-balance text-fluid-title font-semibold">{t('Profile')}</h1>
                <p className="text-balance text-fluid-subtitle text-muted-foreground">
                    {t('View and manage your profile information.')}
                </p>
            </div>
            <Card className="mx-auto w-full max-w-md">
                <CardHeader className="items-center text-center">
                    {canEditProfile && (
                        <div className="flex w-full justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t('profile.editAria')}
                                onClick={() => setIsEditing(true)}
                                disabled={loading || isEditing}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                    {loading ? (
                        <Skeleton className="h-24 w-24 rounded-full mb-4" />
                    ) : (
                        <div className="relative">
                            <Avatar className="h-24 w-24 mb-4">
                                {displayPhoto ? (
                                    <OfflineImage
                                        src={displayPhoto}
                                        alt={displayName}
                                        width={100}
                                        height={100}
                                        className="rounded-full"
                                        data-ai-hint="profile picture"
                                    />
                                ) : (
                                    <AvatarFallback>{displayInitials}</AvatarFallback>
                                )}
                            </Avatar>
                            {/* Loading overlay during upload */}
                            {isSaving && isEditing && (
                                <div className="absolute inset-0 bg-black/60 rounded-full flex flex-col items-center justify-center gap-1 z-10 mb-4">
                                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                                    <span className="text-white text-[10px] font-medium">{t('profile.uploading')}</span>
                                </div>
                            )}
                            {isEditing && canEditProfile && !isSaving && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-12 w-12 text-white"
                                        onClick={() => fileInputRef?.click()}
                                    >
                                        <Camera className="h-6 w-6" />
                                    </Button>
                                </div>
                            )}
                            {isEditing && canEditProfile && previewUrl && !isSaving && (
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    className="absolute -top-1 -right-1 h-6 w-6 rounded-full"
                                    onClick={handleRemoveImage}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center gap-2">
                            <Skeleton className="h-7 w-32" />
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-4 w-40" />
                        </div>
                    ) : (
                        <>
                            <CardTitle className="text-2xl">{displayName}</CardTitle>
                            {displayEmail && <CardDescription>{displayEmail}</CardDescription>}
                            {effectiveBirthDate && (
                                <CardDescription>
                                    {t('profile.birthLabel', {
                                      date: format(effectiveBirthDate.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() }),
                                      age: differenceInYears(new Date(), effectiveBirthDate.toDate()),
                                    })}
                                </CardDescription>
                            )}
                            {effectiveMemberId && (
                                <CardDescription>
                                    {t('profile.memberIdLabel', { id: effectiveMemberId })}
                                </CardDescription>
                            )}
                        </>
                    )}

                </CardHeader>
                <CardContent>
                    {/* ── Synced Member Info ── */}
                    {loadingSyncedMember && (
                        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                            <Skeleton className="h-4 w-36" />
                            <Skeleton className="h-3.5 w-full" />
                            <Skeleton className="h-3.5 w-3/4" />
                        </div>
                    )}

                    {!loadingSyncedMember && syncedMember && profileData?.syncedMemberName && (
                        <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-primary">
                                <Link2 className="h-4 w-4" />
                                {t('profile.syncedWith', { name: `${syncedMember.firstName} ${syncedMember.lastName}` })}
                            </div>

                            <div className="grid gap-2 text-sm">
                                {syncedMember.phoneNumber && (
                                    <PhoneLink value={syncedMember.phoneNumber} />
                                )}

                                {syncedMember.email && (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Mail className="h-3.5 w-3.5 shrink-0" />
                                        <span>{syncedMember.email}</span>
                                    </div>
                                )}

                                {syncedMember.address && (
                                    <AddressLink value={syncedMember.address} />
                                )}

                                {syncedMember.birthDate && !profileData?.birthDate && (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Church className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                            {t('profile.birthWithYears', {
                                              date: format(syncedMember.birthDate.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() }),
                                              age: differenceInYears(new Date(), syncedMember.birthDate.toDate()),
                                            })}
                                        </span>
                                    </div>
                                )}

                                {syncedMember.baptismDate && (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Droplets className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                            {t('profile.baptismLabel', {
                                              date: format(syncedMember.baptismDate.toDate(), 'd LLLL yyyy', { locale: getDateFnsLocale() }),
                                            })}
                                        </span>
                                    </div>
                                )}

                                {syncedMember.status && (
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                            syncedMember.status === 'active' && 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                                            syncedMember.status === 'less_active' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                                            syncedMember.status === 'inactive' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
                                            syncedMember.status === 'deceased' && 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
                                        )}>
                                            {syncedMember.status === 'active' && t('member.status.active')}
                                            {syncedMember.status === 'less_active' && t('member.status.less_active')}
                                            {syncedMember.status === 'inactive' && t('member.status.inactive')}
                                            {syncedMember.status === 'deceased' && t('member.status.deceased')}
                                        </span>
                                    </div>
                                )}

                                {syncedMember.ordinances && syncedMember.ordinances.length > 0 && (
                                    <div className="pt-1">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">{t('profile.ordinancesLabel')}</p>
                                        <div className="flex flex-wrap gap-1">
                                            {syncedMember.ordinances.map((ord) => (
                                                <span key={ord} className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                                    {OrdinanceLabels[ord] ?? ord}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!loadingSyncedMember && !syncedMember && profileData?.syncedMemberId && (
                        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center text-sm text-muted-foreground">
                            <Link2 className="h-4 w-4 mx-auto mb-1" />
                            {t('profile.syncedNotFound')}
                        </div>
                    )}

                    {isEditing && canEditProfile ? (
                        <div className="space-y-4">
                            <Input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                ref={setFileInputRef}
                                onChange={handleImageChange}
                            />
                            <div className="space-y-2 text-left">
                                <Label htmlFor="profile-name">{t('profile.name')}</Label>
                                <Input
                                    id="profile-name"
                                    value={editValues.name}
                                    autoComplete="given-name"
                                    onChange={(event) =>
                                        setEditValues((prev) => ({
                                            ...prev,
                                            name: event.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label htmlFor="profile-last-name">{t('profile.lastName')}</Label>
                                <Input
                                    id="profile-last-name"
                                    value={editValues.lastName}
                                    autoComplete="family-name"
                                    onChange={(event) =>
                                        setEditValues((prev) => ({
                                            ...prev,
                                            lastName: event.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label htmlFor="profile-birthdate">{t('profile.birthDate')}</Label>
                                <Input
                                    id="profile-birthdate"
                                    type="date"
                                    value={editValues.birthDate}
                                    onChange={(event) =>
                                        setEditValues((prev) => ({
                                            ...prev,
                                            birthDate: event.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2 text-left">
                                <Label htmlFor="profile-member-id">{t('profile.memberId')}</Label>
                                <Input
                                    id="profile-member-id"
                                    value={editValues.memberId}
                                    onChange={(event) =>
                                        setEditValues((prev) => ({
                                            ...prev,
                                            memberId: event.target.value,
                                        }))
                                    }
                                    placeholder={t('profile.memberIdPlaceholder')}
                                />
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCancelEdit}
                                    disabled={isSaving}
                                >
                                    <X className="mr-2 h-4 w-4" />
                                    {t('common.cancel')}
                                </Button>
                                <Button type="button" onClick={handleSaveEdit} disabled={isSaving}>
                                    <Save className="mr-2 h-4 w-4" />
                                    {isSaving ? t('profile.saving') : t('common.save')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <></>
                    )}
                </CardContent>
            </Card>
        </section>
    );
}
