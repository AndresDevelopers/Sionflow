
'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { ministeringCollection } from '@/lib/collections';
import type { Companionship, Family } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import Link from 'next/link';
import { removeMinisteringTeachersFromFamilies } from '@/lib/ministering-reverse-sync';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Textarea } from '@/components/ui/textarea';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Edit, Save, Trash2 } from 'lucide-react';
import { CompanionshipForm } from '../CompanionshipForm';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { useI18n } from '@/contexts/i18n-context';

export default function ManageCompanionshipPage() {
  const router = useRouter();
  const params = useParams();
  const { barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const { id } = params;
  const { toast } = useToast();
  const { t } = useI18n();

  const [companionship, setCompanionship] = useState<Companionship | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isPending, startTransition] = useTransition();


  const companionshipId = Array.isArray(id) ? id[0] : id;

  const fetchCompanionship = useCallback(async () => {
    if (!companionshipId) return;

    setLoading(true);
    const docRef = doc(ministeringCollection, companionshipId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = { id: docSnap.id, ...docSnap.data() } as Companionship;
      setCompanionship(data);
      setFamilies(data.families);
    } else {
      toast({ title: t('ministering.error'), description: t('ministering.companionshipNotFound'), variant: "destructive" });
      router.push('/ministering');
    }
    setLoading(false);
  }, [companionshipId, router, toast, t]);

  useEffect(() => {
    fetchCompanionship();
  }, [fetchCompanionship]);

  const handleFamilyChange = (index: number, field: keyof Family, value: any) => {
    const updatedFamilies = [...families];
    (updatedFamilies[index] as any)[field] = value;
    setFamilies(updatedFamilies);
  };
  const handleSaveChanges = async () => {
    if (!companionshipId) return;
    setIsSaving(true);
    try {
      const docRef = doc(ministeringCollection, companionshipId);
      await updateDoc(docRef, { families });
      toast({ title: t('ministering.success'), description: t('ministering.changesSaved') });
    } catch (error) {
      logger.error({ error, message: 'Error saving companionship changes' });
      toast({ title: t('ministering.error'), description: t('ministering.saveChangesError'), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!companionshipId || !companionship) return;
    try {
      const companionNames = companionship.companions || [];
      const familyNames = companionship.families.map(f => f.name);

      await removeMinisteringTeachersFromFamilies(companionNames, familyNames, barrioOrg);

      await deleteDoc(doc(ministeringCollection, companionshipId));

      toast({
        title: t('ministering.companionshipDeletedTitle'),
        description: t('ministering.companionshipDeletedDescription'),
      });
      router.push('/ministering');
    } catch (error) {
      logger.error({ error, message: 'Error deleting companionship' });
      toast({
        title: t('ministering.error'),
        description: t('ministering.deleteCompanionshipError'),
        variant: 'destructive',
      });
    }
  };
  
  const handleCancelEdit = () => {
    setIsEditMode(false);
    startTransition(async () => {
        await fetchCompanionship(); // Refetch data to discard any changes
    });
  };

  if (loading || isPending) {
    return (
        <div className="space-y-4">
            <Skeleton className="h-10 w-1/4" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-10 w-1/3 self-end" />
        </div>
    );
  }

  if (!companionship) {
    return null; // Or a not found message
  }

  if (isEditMode) {
    return <CompanionshipForm companionship={companionship} onCancel={handleCancelEdit} />;
  }

  return (
    <div className="space-y-6">
      <Button variant="outline" asChild>
        <Link href="/ministering">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('ministering.backToList')}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>{t('ministering.manageCompanionshipTitle')}</CardTitle>
              <CardDescription>{companionship.companions.join(t('ministering.and'))}</CardDescription>
            </div>
             {canWrite && (
             <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsEditMode(true)}>
                    <Edit className="mr-2 h-4 w-4" />
                    {t('common.edit')}
                </Button>
                <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete')}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('ministering.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                        {t('ministering.deleteConfirmDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                        {t('common.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
             )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>{t('ministering.family')}</TableHead>
                    <TableHead>{t('ministering.urgent')}</TableHead>
                    <TableHead className="w-[40%]">{t('ministering.observation')}</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {families.map((family, index) => (
                    <TableRow key={index}>
                    <TableCell className="font-medium">{family.name}</TableCell>
                    <TableCell>
                         <Switch
                            checked={family.isUrgent}
                            onCheckedChange={(checked) => handleFamilyChange(index, 'isUrgent', checked)}
                            aria-label={t('ministering.markAsUrgentAria')}
                         />
                    </TableCell>
                    <TableCell>
                        <Textarea
                        value={family.observation}
                        onChange={(e) => handleFamilyChange(index, 'observation', e.target.value)}
                        placeholder={t('ministering.addNotePlaceholder')}
                        rows={1}
                        />
                    </TableCell>
                    </TableRow>
                ))}
                </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
            {canWrite && (
            <Button onClick={handleSaveChanges} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? t('common.saving') : t('common.saveChanges')}
            </Button>
            )}
        </CardFooter>
      </Card>
    </div>
  );
}
