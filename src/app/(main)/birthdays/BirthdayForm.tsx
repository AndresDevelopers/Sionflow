
'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Users, X, Upload, Loader2 } from 'lucide-react';
import { addDoc, doc, Timestamp, updateDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { birthdaysCollection, storage, membersCollection } from '@/lib/collections';
import type { Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import logger from '@/lib/logger';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Birthday } from '@/lib/types';
import { normalizeDateForEcuadorStorage } from '@/lib/date-utils';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';

const birthdaySchema = z.object({
  name: z.string().min(2, { message: 'birthdayForm.nameRequired' }),
  birthDate: z.date({
    required_error: 'birthdayForm.birthDateRequired',
  }),
  entryMode: z.enum(['manual', 'automatic']),
  selectedMemberId: z.string().optional(),
});

type FormValues = z.infer<typeof birthdaySchema>;

interface BirthdayFormProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onFormSubmit: () => void;
  birthday?: Birthday;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function BirthdayForm({ isOpen, onOpenChange, onFormSubmit, birthday }: BirthdayFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditMode = !!birthday;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [entryMode, setEntryMode] = useState<'manual' | 'automatic'>('manual');

  const renderMemberOptions = () => {
    if (loadingMembers) {
      return (
        <SelectItem value="loading" disabled>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('birthdayForm.loadingMembers')}</span>
          </div>
        </SelectItem>
      );
    }

    if (members.length === 0) {
      return (
        <SelectItem value="no-members" disabled>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{t('birthdayForm.noMembers')}</span>
          </div>
        </SelectItem>
      );
    }

    return members.map((member) => (
      <SelectItem key={member.id} value={member.id}>
        <div className="flex items-center gap-3">
          <Avatar className="h-6 w-6">
            <AvatarImage src={member.photoURL} data-ai-hint="member avatar" />
            <AvatarFallback className="text-xs">{member.firstName.charAt(0)}</AvatarFallback>
          </Avatar>
          <span>{member.firstName} {member.lastName}</span>
        </div>
      </SelectItem>
    ));
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(birthdaySchema),
    defaultValues: { 
      name: '',
      entryMode: 'manual',
      selectedMemberId: undefined
    },
  });

  // Fetch members when dialog opens
  useEffect(() => {
    if (isOpen && !isEditMode) {
      setLoadingMembers(true);
      getDocs(query(membersCollection, orderBy('firstName')))
        .then(snapshot => {
          const membersData = snapshot.docs
            .map(doc => {
              const memberData = doc.data();
              return {
                id: doc.id,
                ...memberData,
                status: normalizeMemberStatus(memberData.status),
              } as Member;
            })
            .filter(member => member.status !== 'deceased');
          setMembers(membersData);
        })
        .catch(error => {
          logger.error({ error, message: 'Failed to fetch members for birthday form' });
          let errorMessage = t('birthdayForm.loadMembersError');

          if (error.message?.includes('permission-denied')) {
            errorMessage = t('birthdayForm.permissionDenied');
          } else if (error.message?.includes('network')) {
            errorMessage = t('birthdayForm.networkError');
          }

          toast({
            title: t('birthdays.error'),
            description: errorMessage,
            variant: 'destructive'
          });
        })
        .finally(() => setLoadingMembers(false));
    }
  }, [isOpen, isEditMode, toast, t]);

  useEffect(() => {
    if (isOpen) {
      if (isEditMode && birthday) {
        form.reset({
          name: birthday.name,
          birthDate: birthday.birthDate.toDate(),
          entryMode: 'manual', // Always manual in edit mode
          selectedMemberId: undefined
        });
        setPreviewUrl(birthday.photoURL || null);
        setEntryMode('manual');
      } else {
        form.reset({
          name: '',
          entryMode: 'manual',
          selectedMemberId: undefined,
        });
        setPreviewUrl(null);
        setEntryMode('manual');
      }
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [isOpen, birthday, isEditMode, form]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: t('birthdayForm.fileTooLarge'),
        description: t('birthdayForm.maxFileSize'),
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
    setPreviewUrl(null); // Keep existing image in edit mode until save
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const removeStoredImage = async (photoUrl?: string | null) => {
    if (!photoUrl?.startsWith('https://firebasestorage.googleapis.com')) {
      return;
    }

    const oldImageRef = ref(storage, photoUrl);
    await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: 'Image could not be deleted' }));
  };

  const uploadNewImage = async (file: File) => {
    const storageRef = ref(storage, `profile_pictures/birthdays/${user?.uid}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  const resolvePhotoUrl = async () => {
    if (selectedFile) {
      const uploadedUrl = await uploadNewImage(selectedFile);

      if (isEditMode) {
        await removeStoredImage(birthday?.photoURL ?? null);
      }

      return uploadedUrl;
    }

    if (isEditMode && !previewUrl) {
      await removeStoredImage(birthday?.photoURL ?? null);
      return null;
    }

    return birthday?.photoURL ?? null;
  };

  // Handle entry mode change
  const handleEntryModeChange = (mode: 'manual' | 'automatic') => {
    setEntryMode(mode);
    form.setValue('entryMode', mode);
    
    if (mode === 'manual') {
      // Clear automatic mode fields
      form.setValue('selectedMemberId', undefined);
      form.setValue('name', '');
      setPreviewUrl(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } else {
      // Clear manual mode fields
      form.setValue('name', '');
      setPreviewUrl(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle member selection in automatic mode
  const handleMemberSelect = (memberId: string) => {
    const selectedMember = members.find(m => m.id === memberId);
    if (selectedMember) {
      form.setValue('selectedMemberId', memberId);
      form.setValue('name', `${selectedMember.firstName} ${selectedMember.lastName}`);
      setPreviewUrl(selectedMember.photoURL || null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast({ title: t('birthdays.error'), description: t('birthdayForm.loginRequired'), variant: "destructive" });
      return;
    }
    
    setIsSubmitting(true);

    try {
      const finalPhotoURL = await resolvePhotoUrl();

      const dataToSave = {
        name: values.name,
        birthDate: Timestamp.fromDate(normalizeDateForEcuadorStorage(values.birthDate)),
        photoURL: finalPhotoURL,
        // Store metadata about entry mode and source
        entryMode: values.entryMode,
        ...(values.entryMode === 'automatic' && values.selectedMemberId && {
          linkedMemberId: values.selectedMemberId,
          sourceType: 'member_selection'
        })
      };

      if (isEditMode && birthday) {
        const docRef = doc(birthdaysCollection, birthday.id);
        await updateDoc(docRef, dataToSave);
        toast({
          title: t('birthdayForm.updatedTitle'),
          description: t('birthdayForm.updatedDescription'),
        });
      } else {
        await addDoc(birthdaysCollection, dataToSave);
        toast({
          title: t('birthdayForm.addedTitle'),
          description: t('birthdayForm.addedDescription'),
        });
      }
      
      onFormSubmit();
      onOpenChange(false);
    } catch (e) {
      logger.error({ error: e, message: `Error ${isEditMode ? 'updating' : 'adding'} birthday`, data: values });
      toast({
        title: t('birthdays.error'),
        description: t('birthdayForm.saveError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{isEditMode ? t('birthdayForm.editTitle') : t('birthdayForm.addTitle')}</DialogTitle>
              <DialogDescription>
                {isEditMode ? t('birthdayForm.editDescription') : t('birthdayForm.addDescription')}
                <br />
                <span className="text-sm text-muted-foreground">{t('birthdayForm.requiredFields')}</span>
              </DialogDescription>
            </DialogHeader>
            
            {/* Entry Mode Selection - Only show in add mode */}
            {!isEditMode && (
              <div className="space-y-3 pb-4 border-b">
                <Label className="text-sm font-medium">{t('birthdayForm.entryMode')}</Label>
                <RadioGroup
                  value={entryMode}
                  onValueChange={(value: 'manual' | 'automatic') => handleEntryModeChange(value)}
                  className="flex space-x-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="manual" />
                    <Label htmlFor="manual" className="text-sm">{t('birthdayForm.manual')}</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="automatic" id="automatic" />
                    <Label htmlFor="automatic" className="text-sm">{t('birthdayForm.selectMember')}</Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  {entryMode === 'manual'
                    ? t('birthdayForm.manualDescription')
                    : t('birthdayForm.automaticDescription')
                  }
                </p>
              </div>
            )}
            <div className="space-y-4 py-4">
                {/* Member Selection - Only show in automatic mode */}
                {!isEditMode && entryMode === 'automatic' && (
                  <FormField
                    control={form.control}
                    name="selectedMemberId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('birthdayForm.selectMemberLabel')}</FormLabel>
                        <Select onValueChange={handleMemberSelect} value={field.value}>
                          <FormControl>
                            <SelectTrigger className={cn(
                              "w-full",
                              !field.value && "text-muted-foreground"
                            )}>
                              <SelectValue placeholder={t('birthdayForm.searchMember')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {renderMemberOptions()}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                <FormItem className="flex flex-col items-center">
                <FormLabel>{t('birthdayForm.profilePicture')}</FormLabel>
                <FormControl>
                    <div className="relative">
                    <Avatar className="h-24 w-24">
                        <AvatarImage src={previewUrl ?? undefined} alt={t('birthdayForm.preview')} data-ai-hint="profile picture" />
                        <AvatarFallback>
                           {isSubmitting ? <Loader2 className="animate-spin" /> : <Users className="h-10 w-10 text-muted-foreground" />}
                        </AvatarFallback>
                    </Avatar>
                    {previewUrl && !isSubmitting && entryMode === 'manual' && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-0 right-0 h-6 w-6 rounded-full"
                          onClick={removeImage}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                    )}
                    </div>
                </FormControl>
                {entryMode === 'manual' && (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
                      <Upload className="mr-2 h-4 w-4" />
                      {previewUrl ? t('birthdayForm.changeImage') : t('birthdayForm.uploadImage')}
                  </Button>
                )}
                {entryMode === 'automatic' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('birthdayForm.memberPhoto')}
                  </p>
                )}
                <Input 
                    type="file" 
                    className="hidden" 
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleImageChange}
                    disabled={isSubmitting || entryMode === 'automatic'}
                />
                <FormMessage />
                </FormItem>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('birthdayForm.fullName')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('birthdayForm.namePlaceholder')}
                        {...field}
                        disabled={entryMode === 'automatic' || isSubmitting}
                        className={cn(
                          entryMode === 'automatic' && "bg-muted cursor-not-allowed"
                        )}
                      />
                    </FormControl>
                    {entryMode === 'automatic' && (
                      <p className="text-xs text-muted-foreground">
                        {t('birthdayForm.memberName')}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('birthdayForm.birthDate')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('birthdayForm.datePlaceholder')}
                        value={field.value ? format(field.value, 'dd/MM/yyyy') : ''}
                        onChange={(e) => {
                          const value = e.target.value.trim();

                          if (!value) {
                            field.onChange(undefined);
                            return;
                          }

                          // Parse date from DD/MM/YYYY format
                          const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
                          const match = value.match(dateRegex);

                          if (match) {
                            const [, dayStr, monthStr, yearStr] = match;
                            const day = Number.parseInt(dayStr, 10);
                            const month = Number.parseInt(monthStr, 10) - 1; // JavaScript months are 0-indexed
                            const year = Number.parseInt(yearStr, 10);
                            const currentYear = new Date().getFullYear();

                            // Validate ranges
                            if (day >= 1 && day <= 31 &&
                                month >= 0 && month <= 11 &&
                                year >= 1900 && year <= currentYear) {

                              const date = new Date(year, month, day);

                              // Check if date is valid (e.g., not Feb 30)
                              if (date.getDate() === day &&
                                  date.getMonth() === month &&
                                  date.getFullYear() === year) {
                                field.onChange(date);
                                return;
                              }
                            }
                          }

                          // If invalid format or date, set to undefined
                          field.onChange(undefined);
                        }}
                        disabled={entryMode === 'automatic' || isSubmitting}
                        className={cn(
                          entryMode === 'automatic' && "bg-muted cursor-not-allowed"
                        )}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('birthdayForm.dateFormat')}
                    </FormDescription>
                    {entryMode === 'automatic' && (
                      <p className="text-xs text-muted-foreground">
                        {t('birthdayForm.memberBirthDate')}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('birthdayForm.saving') : t('birthdayForm.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    
