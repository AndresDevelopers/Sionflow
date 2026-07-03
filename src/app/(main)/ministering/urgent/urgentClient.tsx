'use client';

import { getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ministeringCollection } from '@/lib/collections';
import type { Companionship, Family } from '@/lib/types';
import { useEffect, useState, useRef } from 'react';
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
import { createNotificationsForAll } from '@/lib/notification-helpers';

type FamilyWithCompanions = Family & { companionshipId: string; companions: string[] };
type UrgentFamily = Family & { companions: string[] };

export function UrgentNeedsClient() {
  const { user, loading: authLoading } = useAuth();
  const [allFamilies, setAllFamilies] = useState<FamilyWithCompanions[]>([]);
  const [urgentFamilies, setUrgentFamilies] = useState<UrgentFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFamilyIdentifier, setSelectedFamilyIdentifier] = useState('');
  const [observation, setObservation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    const snapshot = await getDocs(ministeringCollection);
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
  };

  useEffect(() => {
    if (authLoading || !user) return;
    fetchData();
  }, [authLoading, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFamilyIdentifier || !observation) {
      toast({
        title: 'Error de validación',
        description: 'Por favor, selecciona una familia y añade una observación.',
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

      // Send in-app notification to all users about the urgent family need
      await createNotificationsForAll({
        title: 'Necesidad Urgente de Familia',
        body: `La familia ${familyName} tiene una necesidad urgente: ${observation}`,
        contextType: 'urgent_family',
        actionUrl: '/ministering/urgent'
      });

      // Send push notification to all subscribed users using FCM
      try {
        const pushResponse = await fetch('/api/send-fcm-notification', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Necesidad Urgente de Familia',
            body: `La familia ${familyName} requiere atención inmediata: ${observation}`,
            url: '/ministering/urgent'
          }),
        });

        if (!pushResponse.ok) {
          const pushErrorResponse = await pushResponse.text();
          logger.warn({
            message: 'Push notification request failed',
            status: pushResponse.status,
            response: pushErrorResponse,
          });
        }
      } catch (pushError) {
        logger.warn({ error: pushError, message: 'Failed to send push notifications, but in-app notifications were sent' });
      }

      toast({
        title: 'Éxito',
        description: 'La familia ha sido marcada como urgente y se han enviado las notificaciones.',
      });

      setSelectedFamilyIdentifier('');
      setObservation('');
      formRef.current?.reset();
      fetchData();
    } catch (error) {
      logger.error({ error, message: 'Error marking family as urgent', companionshipId, familyName, observation });
      toast({
        title: 'Error',
        description: 'No se pudo marcar la familia como urgente. Por favor, inténtalo de nuevo.',
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
          <CardTitle>Familias con Necesidad Urgente</CardTitle>
          <CardDescription>
            Estas familias han sido marcadas para atención inmediata.
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
                        Asignados a: {family.companions.join(' y ')}
                      </p>
                      <p className="text-sm text-amber-600">Obs: {family.observation}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TooltipProvider>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-4">
              No hay familias marcadas como urgentes actualmente.
            </p>
          )}
        </CardContent>
      </Card>

      <form ref={formRef} onSubmit={handleSubmit}>
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Marcar Nueva Necesidad Urgente</CardTitle>
            <CardDescription>
              Selecciona una familia y describe la necesidad para notificar al consejo.
              Las familias ya marcadas como urgentes no aparecerán en esta lista.
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
                  <Label>Familia</Label>
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
                              (Asignada a: {family.companions.join(' y ')})
                            </span>
                          </Label>
                        </div>
                      );
                    })}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="observation">Observación</Label>
                  <Textarea
                    id="observation"
                    name="observation"
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    placeholder="Describe la situación o necesidad específica..."
                    rows={3}
                    disabled={!selectedFamilyIdentifier}
                  />
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/ministering">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={!selectedFamilyIdentifier || isSubmitting}>
              {isSubmitting ? 'Marcando...' : 'Marcar como Urgente'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
