
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
  MissionaryImage,
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
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { getDocs, query, orderBy, where, Timestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { compressGalleryImage } from '@/lib/image-compression';
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
  missionaryImagesCollection,
  annotationsCollection,
  storage,
} from '@/lib/collections';
import { z } from 'zod';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { usePermission } from '@/hooks/use-permission';
import { subHours } from 'date-fns';
import { FriendshipForm } from './FriendshipForm';
import { analyzeImage } from '@/ai/flows/analyze-image-flow';
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

async function getMissionaryImages(barrioOrg?: string): Promise<MissionaryImage[]> {
  if (!missionaryImagesCollection) {
    console.warn('missionaryImagesCollection is not available');
    return [];
  }
  const constraints: any[] = [orderBy('createdAt', 'desc')];
  if (barrioOrg) constraints.unshift(where('barrioOrg', '==', barrioOrg));
  const q = query(missionaryImagesCollection, ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MissionaryImage));
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

    await addDoc(missionaryAssignmentsCollection, {
      description,
      isCompleted: false,
      createdAt: serverTimestamp(),
      userId: user.uid,
      barrioOrg,
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

  const startRecordingName = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceUnsupported'), variant: 'destructive' });
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-ES';
    recognition.onstart = () => setIsRecordingName(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setName(prev => prev + ' ' + transcript);
    };
    recognition.onend = () => setIsRecordingName(false);
    recognition.onerror = (event: any) => {
      console.error('Error en reconocimiento de voz', event.error);
      setIsRecordingName(false);
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceError'), variant: 'destructive' });
    };
    recognitionNameRef.current = recognition;
    recognition.start();
  };

  const stopRecordingName = () => {
    if (recognitionNameRef.current) {
      recognitionNameRef.current.stop();
    }
  };

  const toggleRecordingName = () => {
    if (isRecordingName) {
      stopRecordingName();
    } else {
      startRecordingName();
    }
  };

  const startRecordingMissionaries = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceUnsupported'), variant: 'destructive' });
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-ES';
    recognition.onstart = () => setIsRecordingMissionaries(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setMissionaries(prev => prev + ' ' + transcript);
    };
    recognition.onend = () => setIsRecordingMissionaries(false);
    recognition.onerror = (event: any) => {
      console.error('Error en reconocimiento de voz', event.error);
      setIsRecordingMissionaries(false);
      toast({ title: t('common.error'), description: t('missionaryWork.investigators.voiceError'), variant: 'destructive' });
    };
    recognitionMissionariesRef.current = recognition;
    recognition.start();
  };

  const stopRecordingMissionaries = () => {
    if (recognitionMissionariesRef.current) {
      recognitionMissionariesRef.current.stop();
    }
  };

  const toggleRecordingMissionaries = () => {
    if (isRecordingMissionaries) {
      stopRecordingMissionaries();
    } else {
      startRecordingMissionaries();
    }
  };

  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (open) {
      startRecordingName();
    } else if (isRecordingName) {
      stopRecordingName();
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
        await addDoc(investigatorsCollection, {
          name: validated.data.name,
          assignedMissionaries: validated.data.missionaries,
          status: 'active',
          createdAt: serverTimestamp(),
          barrioOrg,
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
                              <p dangerouslySetInnerHTML={{ __html: t('missionaryWork.investigators.linkDialogDescription', { name: item.name }) }} />
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
                            <AlertDialogDescription dangerouslySetInnerHTML={{ __html: t('missionaryWork.investigators.deleteDialogDescription', { name: item.name }) }} />
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

function ImagesTab({
  images,
  loading,
  onRefresh,
  barrioOrg,
}: {
  images: MissionaryImage[];
  loading: boolean;
  onRefresh: () => void;
  barrioOrg: string;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [uploadedFiles, setUploadedFiles] = useState<
    {
      id: string;
      file: File;
      previewUrl: string;
      url: string | null;
      description: string;
      status: 'uploading' | 'processing' | 'ready';
      progress: number;
    }[]
  >([]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`;
      const previewUrl = URL.createObjectURL(file);
      setUploadedFiles((prev) => [
        ...prev,
        {
          id,
          file,
          previewUrl,
          url: null,
          description: '',
          status: 'uploading',
          progress: 0,
        },
      ]);

      // Upload compressed image to Firebase Storage
      const optimized = await compressGalleryImage(file);
      const storageRef = ref(storage, `missionary-images/${id}`);
      const uploadTask = uploadBytesResumable(storageRef, optimized, { contentType: optimized.type });

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;

          setUploadedFiles((prev) =>
            prev.map((item) => (item.id === id ? { ...item, progress } : item))
          );
        },
        (error) => {
          console.error('Upload error:', error);
          toast({ title: t('common.error'), description: t('missionaryWork.images.uploadError'), variant: 'destructive' });
          setUploadedFiles((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'ready',
                    progress: 0,
                    description: t('missionaryWork.images.uploadError'),
                  }
                : item
            )
          );
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          setUploadedFiles((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, url: downloadURL, status: 'processing', progress: 100 }
                : item
            )
          );

          // Convert to base64 for AI
          const reader = new FileReader();
          reader.onload = async (e) => {
            const base64 = e.target?.result as string;

            try {
              const result = await analyzeImage({ imageData: base64 });
              setUploadedFiles((prev) =>
                prev.map((item) =>
                  item.id === id
                    ? { ...item, description: result.description, status: 'ready' }
                    : item
                )
              );
            } catch (error: any) {
              console.error('AI analysis error:', error);
              const errorMessage = error.message?.includes('API key') || error.message?.includes('DEEPSEEK_API_KEY')
                ? t('missionaryWork.images.apiKeyMissing')
                : t('missionaryWork.images.autoDescError');
              setUploadedFiles((prev) =>
                prev.map((item) =>
                  item.id === id
                    ? { ...item, description: errorMessage, status: 'ready' }
                    : item
                )
              );
            }
          };
          reader.readAsDataURL(file);
        }
      );
    }
  };

  const handleSave = async (item: {
    id: string;
    file: File;
    previewUrl: string;
    url: string | null;
    description: string;
    status: 'uploading' | 'processing' | 'ready';
    progress: number;
  }) => {
    if (item.status !== 'ready') return;
    if (!item.url) return;
    if (!missionaryImagesCollection) {
      toast({ title: t('common.error'), description: t('missionaryWork.images.collectionUnavailable'), variant: 'destructive' });
      return;
    }

    startTransition(async () => {
      try {
        await addDoc(missionaryImagesCollection, {
          imageUrl: item.url,
          description: item.description,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'unknown',
          barrioOrg,
        });
        toast({ title: t('missionaryWork.success'), description: t('missionaryWork.images.saved') });
        setUploadedFiles((prev) => {
          const toRemove = prev.find((i) => i.id === item.id);
          if (toRemove?.previewUrl) {
            URL.revokeObjectURL(toRemove.previewUrl);
          }
          return prev.filter((i) => i.id !== item.id);
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error saving missionary image' });
        toast({ title: t('common.error'), description: t('missionaryWork.images.saveError'), variant: 'destructive' });
      }
    });
  };

  const handleDeletePending = (id: string) => {
    setUploadedFiles((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove?.previewUrl) {
        URL.revokeObjectURL(toRemove.previewUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleEdit = async (id: string, newDescription: string) => {
    if (!missionaryImagesCollection) {
      toast({ title: t('common.error'), description: t('missionaryWork.images.collectionUnavailable'), variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      try {
        const itemRef = doc(missionaryImagesCollection, id);
        await updateDoc(itemRef, { description: newDescription });
        toast({ title: t('missionaryWork.success'), description: t('missionaryWork.images.descriptionUpdated') });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error updating image description' });
        toast({ title: t('common.error'), description: t('missionaryWork.images.descriptionUpdateError'), variant: 'destructive' });
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!missionaryImagesCollection) {
      toast({ title: t('common.error'), description: t('missionaryWork.images.collectionUnavailable'), variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      try {
        await deleteDoc(doc(missionaryImagesCollection, id));
        toast({ title: t('missionaryWork.success'), description: t('missionaryWork.images.deleted') });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error deleting missionary image' });
        toast({ title: t('common.error'), description: t('missionaryWork.images.deleteError'), variant: 'destructive' });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('missionaryWork.images.title')}</CardTitle>
            <CardDescription>
              {t('missionaryWork.images.description')}
            </CardDescription>
          </div>
          <div>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              id="image-upload"
            />
            <Label htmlFor="image-upload">
              <Button size="sm" asChild>
                <span>
                  {uploadedFiles.some((file) => file.status === 'uploading') ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('missionaryWork.images.uploading')}
                    </>
                  ) : uploadedFiles.some((file) => file.status === 'processing') ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('missionaryWork.images.processing')}
                    </>
                  ) : (
                    <>
                      <PlusCircle className="mr-2" />
                      {t('missionaryWork.images.uploadButton')}
                    </>
                  )}
                </span>
              </Button>
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-6">
            {/* Pending uploads */}
            {uploadedFiles.length > 0 && (
                <div>
                 <h3 className="text-lg font-semibold mb-4">{t('missionaryWork.images.pendingTitle')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {uploadedFiles.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <Image
                          src={item.url ?? item.previewUrl}
                          alt="Uploaded"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                          unoptimized
                        />
                         {item.status === 'uploading' && (
                           <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                             <Loader2 className="h-3.5 w-3.5 animate-spin" />
                             {t('missionaryWork.images.uploadingImageProgress', { progress: item.progress })}
                           </div>
                         )}
                         {item.status === 'processing' && (
                           <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                             <Loader2 className="h-3.5 w-3.5 animate-spin" />
                             {t('missionaryWork.images.processingText')}
                           </div>
                         )}
                         <Textarea
                           value={item.description}
                           onChange={(e) => setUploadedFiles(prev =>
                             prev.map(i => i.id === item.id ? { ...i, description: e.target.value } : i)
                           )}
                           placeholder={
                             item.status === 'uploading'
                               ? t('missionaryWork.images.uploadingImage')
                               : item.status === 'processing'
                                 ? t('missionaryWork.images.processingText')
                                 : t('missionaryWork.images.descriptionPlaceholder')
                           }
                           disabled={item.status !== 'ready'}
                           className="mb-2"
                         />
                         <div className="flex gap-2">
                           <Button
                             size="sm"
                             onClick={() => handleSave(item)}
                             disabled={item.status !== 'ready' || !item.url || isPending}
                           >
                             {t('missionaryWork.images.saveButton')}
                           </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeletePending(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Saved images */}
            {images.length > 0 && (
                 <div>
                 <h3 className="text-lg font-semibold mb-4">{t('missionaryWork.images.savedTitle')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {images.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <Image
                          src={item.imageUrl}
                          alt="Missionary"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                        />
                        <Textarea
                          value={item.description}
                          onChange={(e) => handleEdit(item.id, e.target.value)}
                          className="mb-2"
                        />
                           <Button
                           size="sm"
                           variant="destructive"
                           onClick={() => handleDelete(item.id)}
                           disabled={isPending}
                         >
                           <Trash2 className="h-4 w-4 mr-2" />
                           {t('missionaryWork.images.deleteButton')}
                         </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {uploadedFiles.length === 0 && images.length === 0 && (
              <p className="text-sm text-center py-4 text-muted-foreground">
                {t('missionaryWork.images.noImages')}
              </p>
            )}
          </div>
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

export default function MissionaryWorkPage() {
  const [assignments, setAssignments] = useState<MissionaryAssignment[]>([]);
  const [investigators, setInvestigators] = useState<Investigator[]>([]);
  const [friendships, setFriendships] = useState<NewConvertFriendship[]>([]);
  const [newConvertsWithoutFriends, setNewConvertsWithoutFriends] = useState<
    Convert[]
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [missionaryImages, setMissionaryImages] = useState<MissionaryImage[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAnnotations, setLoadingAnnotations] = useState(true);
   const { user, loading: authLoading, barrioOrg } = useAuth();
   const { canWrite } = usePermission();
   const { toast } = useToast();
   const { t } = useI18n();

   const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        assignmentsData,
        investigatorsData,
        friendshipsData,
        newConvertsData,
        membersData,
        imagesData,
      ] = await Promise.all([
        getMissionaryAssignments(barrioOrg),
        getInvestigators(barrioOrg),
        getNewConvertFriendships(barrioOrg),
        getNewConvertsWithoutFriends(barrioOrg),
        getMembersForSelector(true, barrioOrg),
        getMissionaryImages(barrioOrg),
      ]);
      setAssignments(assignmentsData);
      setInvestigators(investigatorsData);
      setFriendships(friendshipsData);
      setNewConvertsWithoutFriends(newConvertsData);
      setMembers(membersData);
      setMissionaryImages(imagesData);
    } catch (error) {
      console.error('Failed to fetch missionary work data:', error);
    } finally {
      setLoading(false);
    }
  }, [barrioOrg]);

  const fetchAnnotations = useCallback(async () => {
    setLoadingAnnotations(true);
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
      fetchAnnotations();
    } catch (error) {
      console.error('Error deleting annotation:', error);
      toast({ title: t('common.error'), description: t('missionaryWork.annotations.deleteError'), variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (authLoading || !user) return; // Wait for authentication
    fetchData();
    fetchAnnotations();
  }, [authLoading, user, fetchData, fetchAnnotations]);

  const availableNewConverts = newConvertsWithoutFriends.filter(
    (c) => !investigators.some((i) => i.convertId === c.id)
  );

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

      <Tabs defaultValue="assignments">
        <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4 h-auto sm:h-10">
          <TabsTrigger value="assignments">{t('missionaryWork.tabs.assignments')}</TabsTrigger>
          <TabsTrigger value="investigators">{t('missionaryWork.tabs.investigators')}</TabsTrigger>
          <TabsTrigger value="images">{t('missionaryWork.tabs.images')}</TabsTrigger>
          <TabsTrigger value="new_converts">{t('missionaryWork.tabs.new_converts')}</TabsTrigger>
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
        <TabsContent value="images">
          <ImagesTab
            images={missionaryImages}
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
          <CardTitle>{t('missionaryWork.faq.title')}</CardTitle>
          <CardDescription>
            {t('missionaryWork.faq.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {getFaqData(t).map((faq, index) => (
              <AccordionItem value={`item-${index}`} key={index}>
                <AccordionTrigger className="text-xl">{faq.question}</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground leading-relaxed text-lg">
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
