
'use client';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import type {
  MissionaryAssignment,
  Investigator,
  NewConvertFriendship,
  Convert,
  Member,
  Annotation,
} from '@/lib/types';
import { membersCollection } from '@/lib/collections';
import { getMembersForSelector, normalizeMemberStatus } from '@/lib/members-data';
import { membersToRecentConverts, parseMemberIdFromConvertId } from '@/lib/converts-from-members';
import {
  useEffect,
  useState,
  useTransition,
  useRef,
  useCallback,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { query, orderBy, where, Timestamp } from 'firebase/firestore';
import { getDocs } from '@/lib/firestore-query';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  HandHeart,
  PlusCircle,
  Link as LinkIcon,
  UserPlus,
  Trash2,
  Pencil,
  Mic,
  Loader2,
  Type,
  Minus,
  Plus,
} from 'lucide-react';
import {
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  missionaryAssignmentsCollection,
  investigatorsCollection,
  newConvertFriendsCollection,
  annotationsCollection,
} from '@/lib/collections';
import { z } from 'zod';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import { usePermission } from '@/hooks/use-permission';
import { subHours } from 'date-fns';
import { FriendshipForm } from './FriendshipForm';
import { FutureMembersTab } from './FutureMembersTab';
import { VoiceAnnotations } from '@/components/shared/voice-annotations';
import { AnnotationManager } from '@/components/shared/annotation-manager';
import { useI18n } from '@/contexts/i18n-context';


const getFaqData = (t: (key: string) => string) => {
  return [
    {
      question: t('missionaryWork.faq.q1'),
      answer: t('missionaryWork.faq.a1'),
    },
    {
      question: t('missionaryWork.faq.q2'),
      answer: t('missionaryWork.faq.a2'),
    },
    {
      question: t('missionaryWork.faq.q3'),
      answer: t('missionaryWork.faq.a3'),
    },
    {
      question: t('missionaryWork.faq.q4'),
      answer: t('missionaryWork.faq.a4'),
    },
  ];
};

// --- Client-side Data Fetching Functions ---

async function getMissionaryAssignments(barrioOrg?: string): Promise<MissionaryAssignment[]> {
  const constraints: any[] = [orderBy('createdAt', 'desc')];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
  const q = query(
    missionaryAssignmentsCollection,
    ...constraints
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as MissionaryAssignment)
  );
}

async function getInvestigators(barrioOrg?: string): Promise<Investigator[]> {
  const constraints: any[] = [orderBy('createdAt', 'desc')];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
  const q = query(investigatorsCollection, ...constraints);
  const snapshot = await getDocs(q);
  const allInvestigators = snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as Investigator)
  );

  const twentyFourHoursAgo = subHours(new Date(), 24);

  // Filter out baptized investigators linked more than 24 hours ago
  return allInvestigators.filter(inv => {
    if (inv.status === 'baptized') {
        // If linkedAt exists and is older than 24 hours, filter it out. Otherwise, keep it.
        return inv.linkedAt ? inv.linkedAt.toDate() > twentyFourHoursAgo : true;
    }
    // Always keep active investigators
    return true;
  });
}


async function getNewConvertFriendships(barrioOrg?: string): Promise<NewConvertFriendship[]> {
    const constraints: any[] = [orderBy('assignedAt', 'desc')];
    if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
    const q = query(newConvertFriendsCollection, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NewConvertFriendship));
}


async function getNewConvertsWithoutFriends(barrioOrg?: string): Promise<Convert[]> {
  // Conversos recientes = solo miembros con baptismDate en los últimos 24 meses
  const constraints: any[] = [];
  if (barrioOrg) constraints.push(where('barrioOrg', '==', barrioOrg));
  const membersSnapshot = await getDocs(query(membersCollection, ...constraints));
  const members = membersSnapshot.docs.map((d) => {
    const data = d.data() as Member;
    return {
      ...data,
      id: d.id,
      status: normalizeMemberStatus(data.status),
    } as Member;
  });
  return membersToRecentConverts(members);
}

// --- Components ---

function AssignmentsTab({
  assignments,
  loading,
  onRefresh,
  user,
  barrioOrg,
}: {
  assignments: MissionaryAssignment[];
  loading: boolean;
  onRefresh: () => void;
  user: any;
  barrioOrg: string;
}) {
  const { t } = useI18n();
  const handleAddAssignment = async (description: string) => {
    if (!user) return;

    const { requireBarrioOrg } = await import('@/lib/tenant-scope');
    await addDoc(missionaryAssignmentsCollection, {
      description,
      isCompleted: false,
      createdAt: serverTimestamp(),
      userId: user.uid,
      barrioOrg: requireBarrioOrg(barrioOrg),
    });
    onRefresh();
  };

  const handleToggleAssignment = async (id: string, status: boolean) => {
    const itemRef = doc(missionaryAssignmentsCollection, id);
    await updateDoc(itemRef, { isCompleted: !status });
    onRefresh();
  };

  const handleDeleteAssignment = async (id: string) => {
    await deleteDoc(doc(missionaryAssignmentsCollection, id));
    onRefresh();
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <AnnotationManager
          title={t('missionaryWork.assignments.title')}
          description={t('missionaryWork.assignments.description')}
          buttonText={t('missionaryWork.assignments.addAssignment')}
          dialogTitle={t('missionaryWork.assignments.newAssignmentTitle')}
          placeholder={t('missionaryWork.assignments.descriptionPlaceholder')}
          items={assignments.map(assignment => ({
            id: assignment.id,
            description: assignment.description,
            isCompleted: assignment.isCompleted,
            createdAt: assignment.createdAt,
            userId: assignment.userId
          }))}
          loading={loading}
          showCheckbox={true}
          onAdd={handleAddAssignment}
          onToggle={handleToggleAssignment}
          onDelete={handleDeleteAssignment}
          emptyMessage={t('missionaryWork.assignments.noAssignments')}
          currentUserId={user?.uid}
        />
      </CardContent>
    </Card>
  );
}

function InvestigatorsTab({
  investigators,
  newConverts,
  loading,
  onRefresh,
  barrioOrg,
}: {
  investigators: Investigator[];
  newConverts: Convert[];
  loading: boolean;
  onRefresh: () => void;
  barrioOrg: string;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [isAddOpen, setAddOpen] = useState(false);
  const [isLinkOpen, setLinkOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [selectedInvestigator, setSelectedInvestigator] =
    useState<Investigator | null>(null);

  // States for Add form
  const [name, setName] = useState('');
  const [missionaries, setMissionaries] = useState('');
  const [addErrors, setAddErrors] = useState<{
    name?: string[];
    missionaries?: string[];
  }>({});

  const recognitionNameRef = useRef<any>(null);
  const [isRecordingName, setIsRecordingName] = useState(false);
  const recognitionMissionariesRef = useRef<any>(null);
  const [isRecordingMissionaries, setIsRecordingMissionaries] = useState(false);

  const getSpeechRecognitionConstructor = () => {
    if (typeof window === 'undefined') return undefined;
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  };

  const handleVoiceError = (errorCode: string) => {
    // User stopped recording or no speech detected — not real failures.
    if (errorCode === 'aborted' || errorCode === 'no-speech') {
      return;
    }
    const description =
      errorCode === 'not-allowed'
        ? t('missionaryWork.investigators.voicePermissionDenied')
        : t('missionaryWork.investigators.voiceError');
    toast({ title: t('common.error'), description, variant: 'destructive' });
  };

  const startRecordingName = () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceUnsupported'), variant: 'destructive' });
      return;
    }
    // SpeechRecognition needs a secure context (HTTPS or localhost).
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceInsecureContext'), variant: 'destructive' });
      return;
    }
    if (recognitionMissionariesRef.current) {
      recognitionMissionariesRef.current.stop();
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-ES';
    recognition.onstart = () => setIsRecordingName(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setName((prev) => (prev ? `${prev} ${transcript}` : transcript).trim());
    };
    recognition.onend = () => {
      recognitionNameRef.current = null;
      setIsRecordingName(false);
    };
    recognition.onerror = (event: any) => {
      recognitionNameRef.current = null;
      setIsRecordingName(false);
      handleVoiceError(event.error);
    };
    try {
      recognitionNameRef.current = recognition;
      recognition.start();
    } catch {
      recognitionNameRef.current = null;
      setIsRecordingName(false);
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceError'), variant: 'destructive' });
    }
  };

  const stopRecordingName = () => {
    if (recognitionNameRef.current) {
      recognitionNameRef.current.stop();
      recognitionNameRef.current = null;
    }
    setIsRecordingName(false);
  };

  const toggleRecordingName = () => {
    if (isRecordingName) {
      stopRecordingName();
    } else {
      startRecordingName();
    }
  };

  const startRecordingMissionaries = () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceUnsupported'), variant: 'destructive' });
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceInsecureContext'), variant: 'destructive' });
      return;
    }
    if (recognitionNameRef.current) {
      recognitionNameRef.current.stop();
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-ES';
    recognition.onstart = () => setIsRecordingMissionaries(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setMissionaries((prev) => (prev ? `${prev} ${transcript}` : transcript).trim());
    };
    recognition.onend = () => {
      recognitionMissionariesRef.current = null;
      setIsRecordingMissionaries(false);
    };
    recognition.onerror = (event: any) => {
      recognitionMissionariesRef.current = null;
      setIsRecordingMissionaries(false);
      handleVoiceError(event.error);
    };
    try {
      recognitionMissionariesRef.current = recognition;
      recognition.start();
    } catch {
      recognitionMissionariesRef.current = null;
      setIsRecordingMissionaries(false);
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceError'), variant: 'destructive' });
    }
  };

  const stopRecordingMissionaries = () => {
    if (recognitionMissionariesRef.current) {
      recognitionMissionariesRef.current.stop();
      recognitionMissionariesRef.current = null;
    }
    setIsRecordingMissionaries(false);
  };

  const toggleRecordingMissionaries = () => {
    if (isRecordingMissionaries) {
      stopRecordingMissionaries();
    } else {
      startRecordingMissionaries();
    }
  };

  // Do not auto-start speech recognition when the dialog opens: browsers require
  // a direct user gesture for mic access and will throw "not-allowed" otherwise.
  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      stopRecordingName();
      stopRecordingMissionaries();
    }
  };

  // State for Link form
  const [selectedConvertId, setSelectedConvertId] = useState('');
  const [linkErrors, setLinkErrors] = useState<{ convertId?: string[] }>({});

  const investigatorSchema = z.object({
    name: z.string().min(2, t('missionaryWork.investigators.validation.nameRequired')),
    missionaries: z
      .string()
      .min(5, t('missionaryWork.investigators.validation.missionariesRequired')),
  });

  const linkInvestigatorSchema = z.object({
    convertId: z.string().min(1, t('missionaryWork.investigators.validation.convertRequired')),
  });

  const handleAddSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAddErrors({});
    const validated = investigatorSchema.safeParse({ name, missionaries });
    if (!validated.success) {
      setAddErrors(validated.error.flatten().fieldErrors);
      return;
    }

    startTransition(async () => {
      try {
        const { requireBarrioOrg } = await import('@/lib/tenant-scope');
        await addDoc(investigatorsCollection, {
          name: validated.data.name,
          assignedMissionaries: validated.data.missionaries,
          status: 'active',
          createdAt: serverTimestamp(),
          barrioOrg: requireBarrioOrg(barrioOrg),
        });
        toast({ title: t('missionaryWork.success'), description: t('missionaryWork.investigators.successAdd') });
        setAddOpen(false);
        setName('');
        setMissionaries('');
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error adding investigator' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.investigators.errorAdd'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleLinkSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLinkErrors({});
    if (!selectedInvestigator) return;

    const validated = linkInvestigatorSchema.safeParse({
      convertId: selectedConvertId,
    });
    if (!validated.success) {
      setLinkErrors(validated.error.flatten().fieldErrors);
      return;
    }

    startTransition(async () => {
      try {
        const investigatorRef = doc(
          investigatorsCollection,
          selectedInvestigator.id
        );
        await updateDoc(investigatorRef, {
          status: 'baptized',
          convertId: validated.data.convertId,
          linkedAt: serverTimestamp(),
        });

        // convertId es member_${id}; guardar referencia misional en el miembro
        const memberId =
          parseMemberIdFromConvertId(validated.data.convertId) || validated.data.convertId;
        if (memberId) {
          await updateDoc(doc(membersCollection, memberId), {
            missionaryReference: selectedInvestigator.assignedMissionaries,
            updatedAt: serverTimestamp(),
          }).catch((err) => {
            logger.warn({ error: err, message: 'No se pudo actualizar missionaryReference en miembro' });
          });
        }

        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.investigators.successLink'),
        });
        setLinkOpen(false);
        setSelectedInvestigator(null);
        setSelectedConvertId('');
        onRefresh();
      } catch (error) {
        logger.error({
          error,
          message: 'Error linking investigator to convert',
        });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.investigators.errorLink'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleDelete = (investigator: Investigator) => {
    startTransition(async () => {
        try {
            await deleteDoc(doc(investigatorsCollection, investigator.id));
             toast({ title: t('missionaryWork.success'), description: t('missionaryWork.investigators.successDelete') });
            onRefresh();
        } catch (error) {
            logger.error({ error, message: 'Error deleting investigator' });
            toast({
                 title: t('common.error'),
                 description: t('missionaryWork.investigators.errorDelete'),
                 variant: 'destructive',
            });
        }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('missionaryWork.investigators.title')}</CardTitle>
            <CardDescription>
              {t('missionaryWork.investigators.description')}
            </CardDescription>
          </div>
          <Dialog open={isAddOpen} onOpenChange={handleAddOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm">
                <PlusCircle className="mr-2" />
                {t('missionaryWork.investigators.addInvestigator')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleAddSubmit}>
                <DialogHeader>
                  <DialogTitle>{t('missionaryWork.investigators.newInvestigatorTitle')}</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <div>
                    <Label htmlFor="name">{t('missionaryWork.investigators.nameLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="name"
                        name="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('missionaryWork.investigators.namePlaceholder')}
                      />
                      <Button type="button" variant="outline" size="icon" onClick={toggleRecordingName}>
                        <Mic className={`h-4 w-4 ${isRecordingName ? 'text-red-500' : ''}`} />
                      </Button>
                    </div>
                    {addErrors?.name && (
                      <p className="text-sm text-destructive mt-1">
                        {addErrors.name[0]}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="missionaries">{t('missionaryWork.investigators.missionariesLabel')}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="missionaries"
                        name="missionaries"
                        value={missionaries}
                        onChange={(e) => setMissionaries(e.target.value)}
                        placeholder={t('missionaryWork.investigators.missionariesPlaceholder')}
                      />
                      <Button type="button" variant="outline" size="icon" onClick={toggleRecordingMissionaries}>
                        <Mic className={`h-4 w-4 ${isRecordingMissionaries ? 'text-red-500' : ''}`} />
                      </Button>
                    </div>
                    {addErrors?.missionaries && (
                      <p className="text-sm text-destructive mt-1">
                        {addErrors.missionaries[0]}
                      </p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? t('missionaryWork.investigators.savingButton') : t('missionaryWork.investigators.saveButton')}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : investigators.length === 0 ? (
          <p className="text-sm text-center py-4 text-muted-foreground">
            {t('missionaryWork.investigators.noInvestigators')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('missionaryWork.investigators.nameLabel')}</TableHead>
                <TableHead>{t('missionaryWork.investigators.missionariesHeader')}</TableHead>
                <TableHead>{t('missionaryWork.investigators.statusHeader')}</TableHead>
                <TableHead className="text-right">{t('missionaryWork.investigators.actionHeader')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investigators.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.assignedMissionaries}</TableCell>
                  <TableCell>
                    {item.status === 'baptized' ? (
                      <Badge variant="default">{t('missionaryWork.investigators.status.baptized')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('missionaryWork.investigators.status.active')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className='flex justify-end items-center gap-2'>
                    {item.status === 'active' && (
                      <Dialog
                        open={
                          isLinkOpen && selectedInvestigator?.id === item.id
                        }
                        onOpenChange={(isOpen) => {
                          if (!isOpen) {
                            setSelectedInvestigator(null);
                            setSelectedConvertId('');
                            setLinkErrors({});
                          }
                          setLinkOpen(isOpen);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedInvestigator(item);
                              setLinkOpen(true);
                            }}
                          >
                            <LinkIcon className="mr-2 h-4 w-4" />
                            {t('missionaryWork.investigators.linkButton')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <form onSubmit={handleLinkSubmit}>
                            <DialogHeader>
                              <DialogTitle>
                                {t('missionaryWork.investigators.linkDialogTitle')}
                              </DialogTitle>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                              <p>
                                {t('missionaryWork.investigators.linkDialogDescription', {
                                  name: item.name,
                                })}
                              </p>
                              <Label htmlFor="convertId">{t('missionaryWork.investigators.linkDialog.convertLabel')}</Label>
                              <Select
                                name="convertId"
                                onValueChange={setSelectedConvertId}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t('missionaryWork.investigators.linkDialog.selectPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {newConverts.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {linkErrors?.convertId && (
                                <p className="text-sm text-destructive mt-1">
                                  {linkErrors.convertId[0]}
                                </p>
                              )}
                            </div>
                            <DialogFooter>
                              <Button type="submit" disabled={isPending}>
                                {isPending ? t('missionaryWork.investigators.linkingButton') : t('missionaryWork.investigators.linkButton')}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    )}
                     <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>{t('missionaryWork.investigators.deleteDialogTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('missionaryWork.investigators.deleteDialogDescription', {
                                name: item.name,
                              })}
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>{t('missionaryWork.investigators.cancelButton')}</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => handleDelete(item)}
                                className="bg-destructive hover:bg-destructive/90"
                            >
                                {t('missionaryWork.investigators.deleteButton')}
                            </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


function NewConvertsTab({
  friendships,
  newConverts,
  members,
  loading,
  onRefresh,
}: {
  friendships: NewConvertFriendship[];
  newConverts: Convert[];
  members: Member[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const { canWrite } = usePermission();
  const [isFormOpen, setFormOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [selectedConvert, setSelectedConvert] = useState<Convert | null>(null);
  const [selectedFriendship, setSelectedFriendship] = useState<NewConvertFriendship | null>(null);


  const handleOpenForm = (item: Convert | NewConvertFriendship) => {
    if ('convertName' in item) { // It's a Friendship object
      setSelectedFriendship(item);
      setSelectedConvert(null);
    } else { // It's a Convert object
      setSelectedConvert(item);
      setSelectedFriendship(null);
    }
    setFormOpen(true);
  };

  const handleEditMember = (item: Convert | NewConvertFriendship) => {
    let memberId = '';
    if ('convertName' in item) {
      // It's a Friendship, find the convert
      const convert = newConverts.find(c => c.id === item.convertId);
      memberId = convert?.memberId || '';
    } else {
      // It's a Convert
      memberId = item.memberId || '';
    }
    if (memberId) {
      router.push(`/members/${memberId}`);
    }
  };
  
  const handleCloseForm = () => {
    setFormOpen(false);
    setSelectedConvert(null);
    setSelectedFriendship(null);
  };

  const handleFormSubmit = () => {
    handleCloseForm();
    onRefresh();
  };


  const getMemberName = (memberId: string) => {
    const m = members.find((mm) => mm.id === memberId);
    return m ? `${m.firstName} ${m.lastName}`.trim() : memberId;
  };

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>{t('missionaryWork.tabs.new_converts')}</CardTitle>
        <CardDescription>
          {t('missionaryWork.newConverts.listDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : newConverts.length === 0 ? (
          <p className="text-sm text-center py-4 text-muted-foreground">
            {t('missionaryWork.newConverts.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('missionaryWork.newConverts.table.convertHeader')}</TableHead>
                <TableHead>{t('missionaryWork.newConverts.table.friendsHeader')}</TableHead>
                <TableHead className="text-right">{t('missionaryWork.newConverts.table.actionHeader')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newConverts.map((item) => {
                const friendship = friendships.find(f => f.convertId === item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      {friendship ? friendship.friends.map(getMemberName).join(', ') : <span className="text-muted-foreground italic">{t('missionaryWork.newConverts.status.pending')}</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                      <div className="flex justify-end gap-2">
                        {friendship ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenForm(friendship)}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            {t('missionaryWork.newConverts.editFriendsButton')}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenForm(item)}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            {t('missionaryWork.newConverts.assignFriendButton')}
                          </Button>
                        )}
                      </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    <FriendshipForm
        isOpen={isFormOpen}
        onOpenChange={handleCloseForm}
        onFormSubmit={handleFormSubmit}
        convert={selectedConvert}
        friendship={selectedFriendship}
    />
    </>
  );
}

const MISSIONARY_TABS = [
  'assignments',
  'investigators',
  'new_converts',
  'future_members',
] as const;

type MissionaryTab = (typeof MISSIONARY_TABS)[number];

function isMissionaryTab(value: string | null): value is MissionaryTab {
  return !!value && (MISSIONARY_TABS as readonly string[]).includes(value);
}

export default function MissionaryWorkPage() {
  const [assignments, setAssignments] = useState<MissionaryAssignment[]>([]);
  const [investigators, setInvestigators] = useState<Investigator[]>([]);
  const [friendships, setFriendships] = useState<NewConvertFriendship[]>([]);
  const [newConvertsWithoutFriends, setNewConvertsWithoutFriends] = useState<
    Convert[]
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAnnotations, setLoadingAnnotations] = useState(true);
  const [faqFontSize, setFaqFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(
    isMissionaryTab(tabFromUrl) ? tabFromUrl : 'assignments'
  );
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { canWrite } = usePermission();
  const { toast } = useToast();
  const { t } = useI18n();

  useEffect(() => {
    if (isMissionaryTab(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

   const fetchData = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const [
        assignmentsData,
        investigatorsData,
        friendshipsData,
        newConvertsData,
        membersData,
      ] = await Promise.all([
        getMissionaryAssignments(barrioOrg),
        getInvestigators(barrioOrg),
        getNewConvertFriendships(barrioOrg),
        getNewConvertsWithoutFriends(barrioOrg),
        getMembersForSelector(true, barrioOrg),
      ]);
      setAssignments(assignmentsData);
      setInvestigators(investigatorsData);
      setFriendships(friendshipsData);
      setNewConvertsWithoutFriends(newConvertsData);
      setMembers(membersData);
    } catch (error) {
      console.error('Failed to fetch missionary work data:', error);
    } finally {
      setLoading(false);
    }
  }, [barrioOrg]);

  const fetchAnnotations = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoadingAnnotations(true);
    try {
      const q = query(
        annotationsCollection,
        where('source', '==', 'missionary-work'),
        where('barrioOrg', '==', barrioOrg),
        where('isResolved', '==', false)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Annotation))
        .sort((a, b) => {
          const dateA = a.createdAt?.toMillis?.() ?? 0;
          const dateB = b.createdAt?.toMillis?.() ?? 0;
          return dateB - dateA;
        });
      setAnnotations(data);
    } catch (error) {
      console.error('Error fetching missionary-work annotations:', error);
      setAnnotations([]);
    } finally {
      setLoadingAnnotations(false);
    }
  }, [barrioOrg]);

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await deleteDoc(doc(annotationsCollection, id));
      toast({ title: t('missionaryWork.success'), description: t('missionaryWork.annotations.deleted') });
      void fetchAnnotations();
    } catch (error) {
      console.error('Error deleting annotation:', error);
      toast({ title: t('common.error'), description: t('missionaryWork.annotations.deleteError'), variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication
    void fetchData();
    void fetchAnnotations();
  }, [authLoading, user, fetchData, fetchAnnotations]);

  useOnManualRefresh(async () => {
    await Promise.all([
      fetchData({ quiet: true }),
      fetchAnnotations({ quiet: true }),
    ]);
    return true;
  });

  const availableNewConverts = newConvertsWithoutFriends.filter(
    (c) => !investigators.some((i) => i.convertId === c.id)
  );

  const getFaqFontClass = () => {
    return faqFontSize === 'sm' ? 'text-sm' : faqFontSize === 'lg' ? 'text-lg' : 'text-base';
  };

  return (
    <section className="page-section">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <HandHeart className="h-8 w-8 text-primary" />
        <div className="flex flex-col gap-1">
          <h1 className="text-balance text-fluid-title font-semibold">{t('missionaryWork.title')}</h1>
          <p className="text-balance text-fluid-subtitle text-muted-foreground">
            {t('missionaryWork.description')}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4 h-auto sm:h-10">
          <TabsTrigger value="assignments">{t('missionaryWork.tabs.assignments')}</TabsTrigger>
          <TabsTrigger value="investigators">{t('missionaryWork.tabs.investigators')}</TabsTrigger>
          <TabsTrigger value="new_converts">{t('missionaryWork.tabs.new_converts')}</TabsTrigger>
          <TabsTrigger value="future_members">{t('missionaryWork.tabs.future_members')}</TabsTrigger>
        </TabsList>
        <TabsContent value="assignments">
          <AssignmentsTab
            assignments={assignments}
            loading={loading}
            onRefresh={fetchData}
            user={user}
            barrioOrg={barrioOrg}
          />
        </TabsContent>
        <TabsContent value="investigators">
          <InvestigatorsTab
            investigators={investigators}
            newConverts={availableNewConverts}
            loading={loading}
            onRefresh={fetchData}
            barrioOrg={barrioOrg}
          />
        </TabsContent>
        <TabsContent value="new_converts">
          <NewConvertsTab
            friendships={friendships}
            newConverts={newConvertsWithoutFriends}
            members={members}
            loading={loading}
            onRefresh={fetchData}
          />
        </TabsContent>
        <TabsContent value="future_members">
          <FutureMembersTab />
        </TabsContent>
      </Tabs>

      <VoiceAnnotations
        title={t('missionaryWork.annotations.title')}
        description={t('missionaryWork.annotations.description')}
        source="missionary-work"
        annotations={annotations}
        isLoading={loadingAnnotations}
        onAnnotationAdded={fetchAnnotations}
        onAnnotationToggled={fetchAnnotations}
        onDeleteAnnotation={handleDeleteAnnotation}
        currentUserId={user?.uid}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('missionaryWork.faq.title')}</CardTitle>
              <CardDescription>
                {t('missionaryWork.faq.description')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 border rounded-md">
              <Button
                variant={faqFontSize === 'sm' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setFaqFontSize('sm')}
                title="Letra pequeña"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={faqFontSize === 'base' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setFaqFontSize('base')}
                title="Letra normal"
              >
                <Type className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={faqFontSize === 'lg' ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setFaqFontSize('lg')}
                title="Letra grande"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {getFaqData(t).map((faq, index) => (
              <AccordionItem value={`item-${index}`} key={index}>
                <AccordionTrigger className={getFaqFontClass()}>{faq.question}</AccordionTrigger>
                <AccordionContent>
                  <p className={`text-muted-foreground leading-relaxed ${getFaqFontClass()}`}>
                    {faq.answer}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </section>
  );
}
