'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateDoc, doc, query, orderBy, where, serverTimestamp, setDoc, arrayUnion, writeBatch } from 'firebase/firestore';
import { getDocs, getDoc } from '@/lib/firestore-query';
import { ministeringCollection, membersCollection, ministeringDistrictsCollection } from '@/lib/collections';
import { firestore } from '@/lib/firebase';
import logger from '@/lib/logger';
import { updateMinisteringTeachersOnCompanionshipChange } from '@/lib/ministering-reverse-sync';
import { useAuth } from '@/contexts/auth-context';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormField, FormControl, FormItem, FormMessage } from '@/components/ui/form';
import { PlusCircle, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Companionship, Member, MinisteringDistrict } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import { getAvailableCompanionMembers, getAvailableFamilyMembers, resolveSelectedDistrictId, validateCompanionshipData } from '@/lib/ministering-validations';
import { useI18n } from '@/contexts/i18n-context';

const createCompanionshipSchema = (t: (key: string, params?: Record<string, string | number>) => string) =>
  z.object({
    companions: z.array(z.object({
      value: z.string().min(1, t('ministering.validation.nameRequired')),
      memberId: z.string().optional(),
    })).min(2, { message: t('ministering.validation.minCompanions') }),
    families: z.array(z.object({
      value: z.string().min(1, t('ministering.validation.nameRequired')),
      memberId: z.string().optional(),
      /** Per-row: automatic select vs free-text name (not persisted) */
      entryMode: z.enum(['manual', 'automatic']),
    })).min(1, { message: t('ministering.validation.minFamilies') }),
  });

type FormValues = z.infer<ReturnType<typeof createCompanionshipSchema>>;

interface CompanionshipFormProps {
    companionship?: Companionship;
    onCancel?: () => void; // Add onCancel prop
}


export function CompanionshipForm({ companionship, onCancel }: CompanionshipFormProps) {
   const router = useRouter();
   const { toast } = useToast();
   const { barrioOrg } = useAuth();
   const { t } = useI18n();
   const [isSubmitting, setIsSubmitting] = useState(false);

   const isEditMode = !!companionship;

   // Companions remain automatic; each family row can be automatic or manual independently
   const companionEntryMode: 'automatic' = 'automatic';
   const [members, setMembers] = useState<Member[]>([]);
  const [companionships, setCompanionships] = useState<Companionship[]>([]);
   const [districts, setDistricts] = useState<MinisteringDistrict[]>([]);
   const [loadingMembers, setLoadingMembers] = useState(false);
   
   const [selectedDistrictId, setSelectedDistrictId] = useState<string>('');

  const defaultValues = isEditMode
  ? {
      companions: companionship.companions.map(c => ({ value: c, memberId: '' })),
      // Keep automatic when linked to a member; otherwise open that row as manual so the name is editable
      families: companionship.families.map(f => ({
        value: f.name,
        memberId: f.memberId ?? '',
        entryMode: (f.memberId ? 'automatic' : 'manual') as 'manual' | 'automatic',
      })),
    }
  : {
      companions: [{ value: '', memberId: '' }, { value: '', memberId: '' }],
      families: [{ value: '', memberId: '', entryMode: 'automatic' as const }],
    };

  // Load members for automatic mode
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const snapshot = await getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg), orderBy('firstName', 'asc')));
      const membersList = snapshot.docs
        .map(doc => {
          const memberData = doc.data();
          return {
            id: doc.id,
            ...memberData,
            status: normalizeMemberStatus(memberData.status),
          } as Member;
        })
        .filter(member => member.status !== 'deceased');
      setMembers(membersList);
    } catch (error) {
      console.error("Error loading members:", error);
      toast({
        title: t('ministering.error'),
        description: t('ministering.loadMembersError'),
        variant: "destructive",
      });
    }
    setLoadingMembers(false);
  }, [toast, barrioOrg, t]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const loadCompanionships = async () => {
      try {
        const snapshot = await getDocs(query(ministeringCollection, where('barrioOrg', '==', barrioOrg)));
        const companionshipList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as Companionship[];
        setCompanionships(companionshipList);
      } catch (error) {
        logger.error({ error, message: 'Error loading companionships' });
        toast({
          title: t('ministering.error'),
          description: t('ministering.loadCompanionshipsError'),
          variant: 'destructive',
        });
      }
    };
    loadCompanionships();
  }, [toast, barrioOrg, t]);

  // Load districts
  useEffect(() => {
    const loadDistricts = async () => {
      try {
        const snapshot = await getDocs(query(ministeringDistrictsCollection, where('barrioOrg', '==', barrioOrg), orderBy('name')));
        const districtsList = snapshot.docs.map(d => {
          const data = d.data() as Omit<MinisteringDistrict, 'id'>;
          return { ...data, id: d.id, companionshipIds: data.companionshipIds ?? [] };
        });
        setDistricts(districtsList);
        
        // Set initial selected district (districtId del compañerismo o membership en distrito)
        if (companionship) {
          const fromCompanionship = companionship.districtId &&
            districtsList.some(d => d.id === companionship.districtId)
            ? companionship.districtId
            : null;
          setSelectedDistrictId(
            fromCompanionship ??
            resolveSelectedDistrictId({
              districts: districtsList,
              companionshipId: companionship.id,
              fallbackId: 'none',
            })
          );
        }
      } catch (error) {
        console.error("Error loading districts:", error);
      }
    };
    loadDistricts();
  }, [companionship, barrioOrg]);

  // Handle district assignment (exclusivo: un compañerismo solo en un distrito)
  const handleDistrictChange = async (districtId: string) => {
    if (!companionship) return;

    try {
      const batch = writeBatch(firestore);
      const resolvedDistrictId = districtId && districtId !== 'none' ? districtId : null;

      const nextDistricts = districts.map((district) => {
        const currentIds = district.companionshipIds ?? [];
        const isInDistrict = currentIds.includes(companionship.id);
        const shouldBeInDistrict = Boolean(resolvedDistrictId && district.id === resolvedDistrictId);

        if (isInDistrict === shouldBeInDistrict) {
          return district;
        }

        const nextIds = shouldBeInDistrict
          ? [...currentIds.filter(id => id !== companionship.id), companionship.id]
          : currentIds.filter(id => id !== companionship.id);

        batch.update(doc(ministeringDistrictsCollection, district.id), {
          companionshipIds: nextIds,
          updatedAt: serverTimestamp(),
        });
        return { ...district, companionshipIds: nextIds };
      });

      // districtId en el compañerismo: fuente de verdad para filtrar en la lista
      batch.update(doc(ministeringCollection, companionship.id), {
        districtId: resolvedDistrictId,
      });

      await batch.commit();
      setDistricts(nextDistricts);
      setSelectedDistrictId(districtId || 'none');
      toast({ title: t('ministering.success'), description: t('ministering.districtUpdatedDescription') });
    } catch (error) {
      logger.error({ error, message: "Failed to update district" });
      toast({ title: t('ministering.error'), description: t('ministering.districtUpdateErrorDescription'), variant: "destructive" });
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(createCompanionshipSchema(t)),
    defaultValues,
  });

  useEffect(() => {
    if (members.length === 0) return;
    const companionsValues = form.getValues('companions');
    companionsValues.forEach((companion, index) => {
      if (!companion.memberId && companion.value) {
        const member = members.find(m => `${m.firstName} ${m.lastName}` === companion.value);
        if (member) {
          form.setValue(`companions.${index}.memberId`, member.id);
        }
      }
    });
    const familiesValues = form.getValues('families');
    familiesValues.forEach((family, index) => {
      if (!family.memberId && family.value) {
        const lastName = family.value.replace('Familia ', '').trim();
        const member = members.find(m => m.lastName === lastName);
        if (member) {
          form.setValue(`families.${index}.memberId`, member.id);
        }
      }
    });
  }, [form, members]);

  const availableCompanionMembers = useMemo(
    () =>
      getAvailableCompanionMembers({
        members,
        companionships,
        currentCompanionshipId: companionship?.id ?? null,
      }),
    [members, companionships, companionship?.id]
  );

  const availableFamilyMembers = useMemo(
    () =>
      getAvailableFamilyMembers({
        members,
        companionships,
        currentCompanionshipId: companionship?.id ?? null,
      }),
    [members, companionships, companionship?.id]
  );

  const getCompanionMemberId = (name: string) => {
    if (!name) return '';
    const member = members.find(m => `${m.firstName} ${m.lastName}` === name);
    return member?.id ?? '';
  };

  const getFamilyMemberId = (familyName: string) => {
    if (!familyName) return '';
    const lastName = familyName.replace('Familia ', '').trim();
    const member = members.find(m => m.lastName === lastName);
    return member?.id ?? '';
  };

  // After members load in edit mode: mark linked families as automatic, unlinked as manual
  useEffect(() => {
    if (!isEditMode || members.length === 0) return;
    const currentFamilies = form.getValues('families');
    currentFamilies.forEach((family, index) => {
      const linkedById = Boolean(family.memberId && members.some((m) => m.id === family.memberId));
      const linkedByName = Boolean(family.value && getFamilyMemberId(family.value));
      const nextMode: 'manual' | 'automatic' = linkedById || linkedByName ? 'automatic' : 'manual';
      if (family.entryMode !== nextMode) {
        form.setValue(`families.${index}.entryMode`, nextMode);
      }
      if (!family.memberId && linkedByName) {
        form.setValue(`families.${index}.memberId`, getFamilyMemberId(family.value));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when members finish loading for edit
  }, [isEditMode, members.length]);

  /** Change mode for a single family row without touching the others */
  const handleFamilyRowModeChange = (index: number, mode: 'manual' | 'automatic') => {
    form.setValue(`families.${index}.entryMode`, mode, { shouldDirty: true });
    if (mode === 'manual') {
      // Keep the displayed name; drop the member link so free-text is authoritative
      form.setValue(`families.${index}.memberId`, '', { shouldDirty: true });
      return;
    }
    // Switching to automatic: re-link if the name matches a member; otherwise leave empty for Select
    const familyName = form.getValues(`families.${index}.value`);
    if (familyName) {
      const memberId = getFamilyMemberId(familyName);
      form.setValue(`families.${index}.memberId`, memberId || '', { shouldDirty: true });
    }
  };

  const {
    fields: companionFields,
    append: appendCompanion,
    remove: removeCompanion,
  } = useFieldArray({ control: form.control, name: 'companions' });
  const {
    fields: familyFields,
    append: appendFamily,
    remove: removeFamily,
  } = useFieldArray({ control: form.control, name: 'families' });

  // Función para sincronizar compañeros cuando se eliminan familias
  const syncCompanionsWithFamilies = (familyCount: number) => {
    const currentCompanionCount = companionFields.length;

    // Si quedan muy pocas familias, reducir compañeros proporcionalmente
    // Mantener siempre al menos 2 compañeros (requerimiento del schema)
    let targetCompanionCount = Math.max(2, Math.min(currentCompanionCount, familyCount + 1));

    // Si hay más compañeros que el objetivo, eliminar los excedentes
    if (currentCompanionCount > targetCompanionCount) {
      const companionsToRemove = currentCompanionCount - targetCompanionCount;
      for (let i = 0; i < companionsToRemove; i++) {
        removeCompanion(currentCompanionCount - 1 - i);
      }
    }
  };

  // Modificar removeFamily para incluir sincronización
  const handleRemoveFamily = (index: number) => {
    if (familyFields.length <= 1) {
      // No permitir eliminar la última familia
      toast({
        title: t('ministering.cannotRemoveTitle'),
        description: t('ministering.cannotRemoveLastFamily'),
        variant: "destructive",
      });
      return;
    }

    removeFamily(index);

    // Sincronizar compañeros después de un breve delay para que el estado se actualice
    setTimeout(() => {
      const remainingFamilies = familyFields.length; // Ya se actualizó después de removeFamily
      syncCompanionsWithFamilies(remainingFamilies);
    }, 100);
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
        // Validar que no haya duplicados ni conflictos
        const companionNames = values.companions.map(c => c.value);
        const newFamilyNames = values.families.map(f => f.value);
        const familyInputs = values.families.map(f => ({
          name: f.value,
          memberId: f.memberId || undefined,
        }));

        const validationResult = await validateCompanionshipData(
          companionNames,
          familyInputs,
          barrioOrg,
          isEditMode ? companionship.id : undefined
        );

        if (!validationResult.valid) {
          toast({
            title: t('ministering.validationErrorTitle'),
            description: validationResult.error || t('ministering.validationConflictFallback'),
            variant: 'destructive',
          });
          setIsSubmitting(false);
          return;
        }

        // Synchronize ministering assignments using reverse sync
        if (isEditMode) {
            const oldCompanions = companionship.companions;
            const oldFamilies = companionship.families.map(f => f.name);
            
            await updateMinisteringTeachersOnCompanionshipChange(
                oldCompanions,
                companionNames,
                oldFamilies,
                newFamilyNames,
                barrioOrg
            );
        } else {
            // For new companionships, add ministering assignments
            for (const family of values.families) {
                if (family.memberId) {
                    const memberRef = doc(membersCollection, family.memberId);
                    const memberSnap = await getDoc(memberRef);
                    if (memberSnap.exists()) {
                      const member = { id: memberSnap.id, ...memberSnap.data() } as Member;
                      // Never write ministers onto members of another barrio
                      if (member.barrioOrg && member.barrioOrg !== barrioOrg) continue;
                      const currentTeachers = member.ministeringTeachers || [];
                      const newTeachers = [...new Set([...currentTeachers, ...companionNames])];
                      await updateDoc(memberRef, { ministeringTeachers: newTeachers });
                    }
                    continue;
                }
                const lastName = family.value.replace('Familia ', '');
                const memberQuery = query(membersCollection, where('barrioOrg', '==', barrioOrg), where('lastName', '==', lastName));
                const memberSnap = await getDocs(memberQuery);
                if (!memberSnap.empty) {
                    const memberDoc = memberSnap.docs[0];
                    const member = { id: memberDoc.id, ...memberDoc.data() } as Member;
                    const currentTeachers = member.ministeringTeachers || [];
                    const newTeachers = [...new Set([...currentTeachers, ...companionNames])];
                    await updateDoc(doc(membersCollection, member.id), { ministeringTeachers: newTeachers });
                }
            }
        }

        if (isEditMode) {
             const companionshipRef = doc(ministeringCollection, companionship.id);
             
             // Smartly update families: keep existing data, remove old, add new
             const existingFamilies = companionship.families;
             const updatedFamilies = values.families.map(family => {
                 const existing = existingFamilies.find(f => f.name === family.value);
                 if (existing) {
                   return { ...existing, memberId: family.memberId || existing.memberId };
                 }
                 return {
                   name: family.value,
                   isUrgent: false,
                   observation: '',
                   memberId: family.memberId || undefined,
                 };
             });

             const resolvedDistrictId =
               selectedDistrictId && selectedDistrictId !== 'none' ? selectedDistrictId : null;

             await updateDoc(companionshipRef, {
                companions: values.companions.map(c => c.value),
                families: updatedFamilies,
                districtId: resolvedDistrictId,
             });

             toast({
                title: t('ministering.companionshipUpdatedTitle'),
                description: t('ministering.companionshipUpdatedDescription'),
             });
             // Instead of router.push, we call a refresh or passed-in handler if available
             // For simplicity, we can let the parent page handle refresh logic.
             if (onCancel) onCancel(); // Exit edit mode
             router.refresh(); // Force a server-side refresh of the page
        } else {
            const familiesWithObjects = values.families.map(f => ({
                name: f.value,
                isUrgent: false,
                observation: '',
                memberId: f.memberId || undefined,
            }));

            const resolvedDistrictId =
              selectedDistrictId && selectedDistrictId !== 'none' ? selectedDistrictId : null;

            // Add the new companionship with districtId for reliable filtering
            const newCompanionshipRef = doc(ministeringCollection);
            await setDoc(newCompanionshipRef, {
                companions: values.companions.map(c => c.value),
                families: familiesWithObjects,
                barrioOrg,
                districtId: resolvedDistrictId,
            });

            // También mantener companionshipIds en el documento del distrito
            if (resolvedDistrictId) {
                await updateDoc(doc(ministeringDistrictsCollection, resolvedDistrictId), {
                    companionshipIds: arrayUnion(newCompanionshipRef.id),
                    updatedAt: serverTimestamp(),
                });
            }

            toast({
                title: t('ministering.companionshipAddedTitle'),
                description: t('ministering.companionshipAddedDescription'),
            });
            router.push('/ministering');
        }
    } catch (error) {
      logger.error({ error, message: 'Error saving companionship' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.saveCompanionshipError'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>{isEditMode ? t('ministering.editCompanionshipTitle') : t('ministering.addCompanionshipTitle')}</CardTitle>
            <CardDescription>
              {isEditMode ? t('ministering.editCompanionshipDescription') : t('ministering.addCompanionshipDescription')}
              <br />
              <span className="text-sm text-muted-foreground">{t('ministering.requiredFieldsHint')}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Companion Entry Mode Selection */}
            <div className="space-y-4">
              <div>
                <Label className="text-base font-medium">{t('ministering.companionEntryMethod')}</Label>
                <p className="text-sm text-muted-foreground">{t('ministering.companionEntryMethodHelp')}</p>
              </div>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <UserCheck className="h-4 w-4" />
                <span>{t('ministering.automaticSelectExisting')}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('ministering.companionsRequired')}</Label>
              {companionFields.map((field, index) => (
                <FormField
                  key={field.id}
                  control={form.control}
                  name={`companions.${index}.value`}
                  render={({ field }) => {
                    const companionMemberId = form.watch(`companions.${index}.memberId`);
                    return (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        {companionEntryMode === 'automatic' ? (
                          <>
                            <Select
                              value={companionMemberId || getCompanionMemberId(field.value)}
                              onValueChange={(value) => {
                                const member = members.find(m => m.id === value);
                                if (member) {
                                  field.onChange(`${member.firstName} ${member.lastName}`);
                                  form.setValue(`companions.${index}.memberId`, member.id, { shouldDirty: true });
                                }
                              }}
                              disabled={loadingMembers}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={loadingMembers ? t('common.loading') : t('ministering.selectCompanionN', { n: index + 1 })} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {availableCompanionMembers.map((member) => (
                                  <SelectItem key={member.id} value={member.id}>
                                    <div className="flex items-center gap-2">
                                      <Avatar className="h-6 w-6">
                                        <AvatarImage src={member.photoURL} />
                                        <AvatarFallback className="text-xs">
                                          {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                                        </AvatarFallback>
                                      </Avatar>
                                      {member.firstName} {member.lastName}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <input type="hidden" {...field} />
                          </>
                        ) : (
                          <FormControl>
                            <Input {...field} placeholder={t('ministering.selectCompanionN', { n: index + 1 })} />
                          </FormControl>
                        )}
                        <Button type="button" variant="outline" size="icon" onClick={() => removeCompanion(index)} disabled={companionFields.length <= 2}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                    );
                  }}
                />
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => appendCompanion({ value: '', memberId: '' })}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {t('ministering.addCompanion')}
              </Button>
            </div>

            {/* Families: each row can be automatic (select member) or manual (type name) independently */}
            <div className="space-y-2">
              <div>
                <Label className="text-base font-medium">{t('ministering.assignedFamiliesRequired')}</Label>
                <p className="text-sm text-muted-foreground">{t('ministering.familyEntryMethodHelp')}</p>
              </div>
              {familyFields.map((field, index) => (
                 <FormField
                  key={field.id}
                  control={form.control}
                  name={`families.${index}.value`}
                  render={({ field: valueField }) => {
                    const familyMemberId = form.watch(`families.${index}.memberId`);
                    const rowMode = form.watch(`families.${index}.entryMode`) ?? 'automatic';
                    return (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Select
                          value={rowMode}
                          onValueChange={(value: 'manual' | 'automatic') => handleFamilyRowModeChange(index, value)}
                        >
                          <SelectTrigger className="w-full sm:w-[10.5rem] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="automatic">
                              <span className="flex items-center gap-2">
                                <UserCheck className="h-3.5 w-3.5" />
                                {t('ministering.familyModeAutomatic')}
                              </span>
                            </SelectItem>
                            <SelectItem value="manual">
                              <span className="flex items-center gap-2">
                                <UserPlus className="h-3.5 w-3.5" />
                                {t('ministering.familyModeManual')}
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          {rowMode === 'automatic' ? (
                            <>
                              <Select
                                value={familyMemberId || getFamilyMemberId(valueField.value)}
                                onValueChange={(value) => {
                                  const member = members.find(m => m.id === value);
                                  if (member) {
                                    valueField.onChange(`Familia ${member.lastName}`);
                                    form.setValue(`families.${index}.memberId`, member.id, { shouldDirty: true });
                                    form.setValue(`families.${index}.entryMode`, 'automatic', { shouldDirty: true });
                                  }
                                }}
                                disabled={loadingMembers}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={loadingMembers ? t('common.loading') : t('ministering.selectFamilyN', { n: index + 1 })} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {availableFamilyMembers.map((member) => (
                                    <SelectItem key={member.id} value={member.id}>
                                      <div className="flex items-center gap-2">
                                        <Avatar className="h-6 w-6">
                                          <AvatarImage src={member.photoURL} />
                                          <AvatarFallback className="text-xs">
                                            {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                                          </AvatarFallback>
                                        </Avatar>
                                        {t('ministering.familyOptionLabel', { lastName: member.lastName })}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <input type="hidden" {...valueField} />
                            </>
                          ) : (
                            <FormControl>
                              <Input
                                {...valueField}
                                placeholder={t('ministering.manualFamilyPlaceholder')}
                                onChange={(e) => {
                                  valueField.onChange(e);
                                  form.setValue(`families.${index}.memberId`, '', { shouldDirty: true });
                                }}
                              />
                            </FormControl>
                          )}
                          <Button type="button" variant="outline" size="icon" onClick={() => handleRemoveFamily(index)} disabled={familyFields.length <= 1}>
                              <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                    );
                  }}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendFamily({ value: '', memberId: '', entryMode: 'automatic' })}
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('ministering.addFamily')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => appendFamily({ value: '', memberId: '', entryMode: 'manual' })}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('ministering.addFamilyManual')}
                </Button>
              </div>
            </div>

            {/* District Selection */}
            <div className="space-y-4 pt-4 border-t">
              <div>
                <Label className="text-base font-medium">{t('ministering.districtSectionTitle')}</Label>
                <p className="text-sm text-muted-foreground">{t('ministering.districtSectionHelp')}</p>
              </div>
              {isEditMode ? (
                <Select
                  value={selectedDistrictId}
                  onValueChange={handleDistrictChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('ministering.selectDistrict')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">{t('ministering.noDistrict')}</SelectItem>
                    {districts.map((district) => (
                      <SelectItem key={district.id} value={district.id}>
                        {district.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={selectedDistrictId}
                  onValueChange={(value) => setSelectedDistrictId(value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t('ministering.selectDistrict')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">{t('ministering.noDistrict')}</SelectItem>
                    {districts.map((district) => (
                      <SelectItem key={district.id} value={district.id}>
                        {district.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
              {isEditMode ? (
                 <Button type="button" variant="outline" onClick={onCancel}>
                    {t('common.cancel')}
                 </Button>
              ) : (
                <Button variant="outline" asChild>
                    <Link href="/ministering">{t('common.cancel')}</Link>
                </Button>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('common.saving') : t('common.saveChanges')}
              </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
