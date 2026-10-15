'use client';

import { doc, updateDoc, query, where } from 'firebase/firestore';
import { getDocs, getDoc } from '@/lib/firestore-query';
import { ministeringCollection } from '@/lib/collections';
import type { Companionship, Family } from '@/lib/types';
import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';

type FamilyWithCompanions = Family & { companionshipId: string; companions: string[] };
type UrgentFamily = Family & { companions: string[] };

export function UrgentNeedsClient() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { t } = useI18n();
  const [allFamilies, setAllFamilies] = useState<FamilyWithCompanions[]>([]);
  const [urgentFamilies, setUrgentFamilies] = useState<UrgentFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFamilyIdentifier, setSelectedFamilyIdentifier] = useState('');
  const [observation, setObservation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const snapshot = await getDocs(query(ministeringCollection, where('barrioOrg', '==', barrioOrg)));
    const families: FamilyWithCompanions[] = [];
    const urgent: UrgentFamily[] = [];

    snapshot.docs.forEach(docSnap => {
      const comp = { id: docSnap.id, ...docSnap.data() } as Companionship;
      comp.families.forEach((family) => {
        const familyData = {
          ...family,
          companionshipId: comp.id,
          companions: comp.companions,
        };
        families.push(familyData);
        if (family.isUrgent) {
          urgent.push({
            ...family,
            companions: comp.companions,
          });
        }
      });
    });

    setAllFamilies(families);
    setUrgentFamilies(urgent);
    setLoading(false);
  }, [barrioOrg]);

  useEffect(() => {
    if (authLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga async inicial (Firestore)
    fetchData();
  }, [authLoading, user, fetchData]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFamilyIdentifier || !observation) {
      toast({
        title: t('ministering.urgent.validationTitle'),
        description: t('ministering.urgent.validationDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    const [companionshipId, familyName] = selectedFamilyIdentifier.split(':::');

    try {
      const companionshipRef = doc(ministeringCollection, companionshipId);
      const companionshipSnap = await getDoc(companionshipRef);

      if (!companionshipSnap.exists()) {
        throw new Error('Companionship not found');
      }

      const companionship = companionshipSnap.data() as Companionship;
      const familyIndex = companionship.families.findIndex(f => f.name === familyName);

      if (familyIndex === -1) {
        throw new Error('Family not found in companionship.');
      }

      const updatedFamilies = [...companionship.families];
      updatedFamilies[familyIndex] = {
        ...updatedFamilies[familyIndex],
        isUrgent: true,
        observation: observation,
      };

      await updateDoc(companionshipRef, { families: updatedFamilies });

      // In-app + push are handled by Cloud Function `onUrgentFamilyFlagged`
      // (scoped by barrioOrg, visiblePages, and category prefs — no client fan-out).

      toast({
        title: t('ministering.urgent.successTitle'),
        description: t('ministering.urgent.successDescription'),
      });

      setSelectedFamilyIdentifier('');
      setObservation('');
      formRef.current?.reset();
      fetchData();
    } catch (error) {
      logger.error({ error, message: 'Error marking family as urgent', companionshipId, familyName, observation });
      toast({
        title: t('ministering.error'),
        description: t('ministering.urgent.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('ministering.urgent.listTitle')}</CardTitle>
          <CardDescription>
            {t('ministering.urgent.listDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex space-x-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <Skeleton className="h-16 w-16 rounded-full" />
            </div>
          ) : urgentFamilies.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              <TooltipProvider>
                {urgentFamilies.map((family, index) => (
                  <Tooltip key={index}>
                    <TooltipTrigger>
                      <Avatar className="h-16 w-16 border-2 border-destructive">
                        <AvatarImage src={`https://picsum.photos/seed/${family.name}/100`} data-ai-hint="family avatar" />
                        <AvatarFallback>{family.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-semibold">{family.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('ministering.urgent.assignedTo', { names: family.companions.join(t('ministering.and')) })}
                      </p>
                      <p className="text-sm text-amber-600">{t('ministering.urgent.observationPrefix', { observation: family.observation })}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TooltipProvider>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-4">
              {t('ministering.urgent.empty')}
            </p>
          )}
        </CardContent>
      </Card>

      <form ref={formRef} onSubmit={handleSubmit}>
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>{t('ministering.urgent.formTitle')}</CardTitle>
            <CardDescription>
              {t('ministering.urgent.formDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label>{t('ministering.urgent.familyLabel')}</Label>
                  <RadioGroup
                    name="family"
                    className="mt-2 space-y-1"
                    onValueChange={setSelectedFamilyIdentifier}
                    value={selectedFamilyIdentifier}
                  >
                    {allFamilies.filter(f => !f.isUrgent).map((family) => {
                      const identifier = `${family.companionshipId}:::${family.name}`;
                      return (
                        <div key={identifier} className="flex items-center">
                          <RadioGroupItem value={identifier} id={identifier} />
                          <Label htmlFor={identifier} className="ml-2 font-normal">
                            {family.name}{' '}
                            <span className="text-xs text-muted-foreground">
                              {t('ministering.urgent.assignedToParen', { names: family.companions.join(t('ministering.and')) })}
                            </span>
                          </Label>
                        </div>
                      );
                    })}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="observation">{t('ministering.urgent.observationLabel')}</Label>
                  <Textarea
                    id="observation"
                    name="observation"
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    placeholder={t('ministering.urgent.observationPlaceholder')}
                    rows={3}
                    disabled={!selectedFamilyIdentifier}
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/ministering">{t('common.cancel')}</Link>
            </Button>
            <Button type="submit" disabled={!selectedFamilyIdentifier || isSubmitting}>
              {isSubmitting ? t('ministering.urgent.submitting') : t('ministering.urgent.submit')}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
