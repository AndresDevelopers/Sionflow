
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
  convertsCollection,
  missionaryImagesCollection,
  annotationsCollection,
  storage,
} from '@/lib/collections';
import { z } from 'zod';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { subHours, subMonths } from 'date-fns';
import { FriendshipForm } from './FriendshipForm';
import { analyzeImage } from '@/ai/flows/analyze-image-flow';
import { VoiceAnnotations } from '@/components/shared/voice-annotations';
import { AnnotationManager } from '@/components/shared/annotation-manager';


const faqData = [
  {
    question: '¿Cuál es el rol del Quórum de Élderes en la obra misional?',
    answer:
      'El Quórum de Élderes, bajo la dirección del obispo, lidera la obra misional en el barrio. Su responsabilidad principal es coordinar los esfuerzos de los miembros para encontrar, enseñar y bautizar a personas interesadas. Esto incluye trabajar de cerca con los misioneros de tiempo completo, organizar actividades misionales y asegurarse de que los nuevos conversos sean integrados y apoyados.',
  },
  {
    question: '¿Cómo trabajamos con los misioneros de tiempo completo?',
    answer:
      'La colaboración es clave. La presidencia del quórum debe reunirse regularmente con los misioneros en las reuniones de correlación misional para coordinar planes. Los miembros del quórum pueden ayudar a los misioneros proveyendo referencias, participando en las lecciones, ofreciendo transporte y abriendo sus hogares para actividades.',
  },
  {
    question:
      '¿Qué significa "asignar amigos" a un nuevo converso y por qué es importante?',
    answer:
      'Asignar amigos (a menudo llamados "compañeros ministrantes" o simplemente amigos del quórum) es crucial para la retención de nuevos miembros. Un nuevo converso necesita apoyo, amistad y guía. Asignar a uno o dos hermanos del quórum para que se hagan amigos del nuevo miembro, lo visiten, lo inviten a actividades y respondan sus preguntas, le ayuda a sentirse parte de la comunidad y a fortalecer su testimonio.',
  },
  {
    question: '¿Qué tipo de asignaciones misionales puede tener el quórum?',
    answer:
      'Las asignaciones pueden ser variadas: acompañar a los misioneros a dar una lección, invitar a un amigo a una actividad de la Iglesia, compartir un mensaje del Evangelio en redes sociales, ayudar a un investigador con una mudanza como acto de servicio, u organizar una noche de hogar abierta a amigos de la Iglesia.',
  },
];

// --- Client-side Data Fetching Functions ---

async function getMissionaryAssignments(): Promise<MissionaryAssignment[]> {
  const q = query(
    missionaryAssignmentsCollection,
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() } as MissionaryAssignment)
  );
}

async function getInvestigators(): Promise<Investigator[]> {
  const q = query(investigatorsCollection, orderBy('createdAt', 'desc'));
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


async function getNewConvertFriendships(): Promise<NewConvertFriendship[]> {
    const q = query(newConvertFriendsCollection, orderBy('assignedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as NewConvertFriendship));
}


async function getNewConvertsWithoutFriends(): Promise<Convert[]> {
  const twentyFourMonthsAgo = subMonths(new Date(), 24);
  const twentyFourMonthsAgoTimestamp = Timestamp.fromDate(twentyFourMonthsAgo);

  // Obtener conversos de la colección c_conversos
  const convertsSnapshot = await getDocs(query(convertsCollection, orderBy('baptismDate', 'desc')));
  const convertsFromCollection = convertsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Convert))
    .filter(convert =>
        convert.baptismDate &&
        convert.baptismDate.toDate &&
        convert.baptismDate.toDate() > twentyFourMonthsAgo
    );

  // Obtener miembros bautizados hace 2 años
  const membersSnapshot = await getDocs(query(membersCollection, orderBy('baptismDate', 'desc')));
  const membersAsConverts = membersSnapshot.docs
    .map(doc => {
      const memberData = doc.data() as Member;
      if (normalizeMemberStatus(memberData.status) === 'deceased') {
        return null;
      }
      if (memberData.baptismDate && memberData.baptismDate.toDate) {
        const baptismDate = memberData.baptismDate.toDate();
        if (baptismDate > twentyFourMonthsAgo) {
          return {
            id: `member_${doc.id}`,
            name: `${memberData.firstName} ${memberData.lastName}`,
            baptismDate: memberData.baptismDate,
            photoURL: memberData.photoURL,
            councilCompleted: memberData.councilCompleted || false,
            councilCompletedAt: memberData.councilCompletedAt || null,
            observation: 'Bautizado como miembro',
            missionaryReference: 'Registro de miembros'
          } as Convert;
        }
      }
      return null;
    })
    .filter(Boolean) as Convert[];

  // Combinar y ordenar por fecha de bautismo (más reciente primero)
  const allConverts = [...convertsFromCollection, ...membersAsConverts]
    .sort((a, b) => b.baptismDate.toDate().getTime() - a.baptismDate.toDate().getTime());

  // Eliminar duplicados basados en nombre y fecha de bautismo
  const uniqueConverts = allConverts.filter((convert, index, self) =>
    index === self.findIndex(c =>
      c.name === convert.name &&
      c.baptismDate.toDate().getTime() === convert.baptismDate.toDate().getTime()
    )
  );

  return uniqueConverts;
}

async function getMissionaryImages(): Promise<MissionaryImage[]> {
  if (!missionaryImagesCollection) {
    console.warn('missionaryImagesCollection is not available');
    return [];
  }
  const q = query(missionaryImagesCollection, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MissionaryImage));
}

// --- Components ---

function AssignmentsTab({
  assignments,
  loading,
  onRefresh,
  user,
}: {
  assignments: MissionaryAssignment[];
  loading: boolean;
  onRefresh: () => void;
  user: any;
}) {
  const handleAddAssignment = async (description: string) => {
    if (!user) return;

    await addDoc(missionaryAssignmentsCollection, {
      description,
      isCompleted: false,
      createdAt: serverTimestamp(),
      userId: user.uid,
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
          title="Asignaciones Misionales"
          description="Tareas y responsabilidades para apoyar la obra en el barrio."
          buttonText="Asignación"
          dialogTitle="Nueva Asignación"
          placeholder="Ej: Acompañar a los misioneros..."
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
          emptyMessage="No hay asignaciones."
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
}: {
  investigators: Investigator[];
  newConverts: Convert[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
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
      toast({ title: 'Error', description: 'Reconocimiento de voz no soportado en este navegador.', variant: 'destructive' });
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
      toast({ title: 'Error', description: 'Error en el reconocimiento de voz.', variant: 'destructive' });
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
      toast({ title: 'Error', description: 'Reconocimiento de voz no soportado en este navegador.', variant: 'destructive' });
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
      toast({ title: 'Error', description: 'Error en el reconocimiento de voz.', variant: 'destructive' });
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
    name: z.string().min(2, 'El nombre es requerido.'),
    missionaries: z
      .string()
      .min(5, 'El nombre de los misioneros es requerido.'),
  });

  const linkInvestigatorSchema = z.object({
    convertId: z.string().min(1, 'Debe seleccionar un converso.'),
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
        });
        toast({ title: 'Éxito', description: 'Investigador agregado.' });
        setAddOpen(false);
        setName('');
        setMissionaries('');
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error adding investigator' });
        toast({
          title: 'Error',
          description: 'No se pudo agregar el investigador.',
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

        const convertRef = doc(convertsCollection, validated.data.convertId);
        await updateDoc(convertRef, {
            missionaryReference: selectedInvestigator.assignedMissionaries,
        });

        toast({
          title: 'Éxito',
          description: 'Investigador vinculado a converso.',
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
          title: 'Error',
          description: 'No se pudo vincular al investigador.',
          variant: 'destructive',
        });
      }
    });
  };

  const handleDelete = (investigator: Investigator) => {
    startTransition(async () => {
        try {
            await deleteDoc(doc(investigatorsCollection, investigator.id));
            toast({ title: 'Éxito', description: 'Investigador eliminado.' });
            onRefresh();
        } catch (error) {
            logger.error({ error, message: 'Error deleting investigator' });
            toast({
                title: 'Error',
                description: 'No se pudo eliminar al investigador.',
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
            <CardTitle>Investigadores</CardTitle>
            <CardDescription>
              Personas que están aprendiendo sobre el evangelio.
            </CardDescription>
          </div>
          <Dialog open={isAddOpen} onOpenChange={handleAddOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm">
                <PlusCircle className="mr-2" />
                Investigador
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleAddSubmit}>
                <DialogHeader>
                  <DialogTitle>Agregar Investigador</DialogTitle>
                </DialogHeader>
                <div className="py-4 space-y-4">
                  <div>
                    <Label htmlFor="name">Nombre</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="name"
                        name="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ej: Familia Pérez"
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
                    <Label htmlFor="missionaries">Misioneros Asignados</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="missionaries"
                        name="missionaries"
                        value={missionaries}
                        onChange={(e) => setMissionaries(e.target.value)}
                        placeholder="Ej: Elder Smith y Elder Jones"
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
                    {isPending ? 'Guardando...' : 'Guardar'}
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
            No hay investigadores activos.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Misioneros</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investigators.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.assignedMissionaries}</TableCell>
                  <TableCell>
                    {item.status === 'baptized' ? (
                      <Badge variant="default">Bautizado</Badge>
                    ) : (
                      <Badge variant="secondary">Activo</Badge>
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
                            Vincular
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <form onSubmit={handleLinkSubmit}>
                            <DialogHeader>
                              <DialogTitle>
                                Vincular a Nuevo Converso
                              </DialogTitle>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                              <p>
                                Selecciona el registro del nuevo converso que
                                corresponde a <strong>{item.name}</strong>.
                              </p>
                              <Label htmlFor="convertId">Nuevo Converso</Label>
                              <Select
                                name="convertId"
                                onValueChange={setSelectedConvertId}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecciona un converso..." />
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
                                {isPending ? 'Vinculando...' : 'Vincular'}
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
                            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta acción eliminará permanentemente el registro del investigador <strong>{item.name}</strong>.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => handleDelete(item)}
                                className="bg-destructive hover:bg-destructive/90"
                            >
                                Eliminar
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
}: {
  images: MissionaryImage[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
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

      // Upload to Firebase Storage
      const storageRef = ref(storage, `missionary-images/${id}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

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
          toast({ title: 'Error', description: 'Error al subir la imagen.', variant: 'destructive' });
          setUploadedFiles((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'ready',
                    progress: 0,
                    description: 'Error al subir la imagen.',
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
                ? 'API key de IA no configurada. Configure DEEPSEEK_API_KEY en su archivo .env.local'
                : 'Error al generar descripción automática';
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
      toast({ title: 'Error', description: 'Colección no disponible.', variant: 'destructive' });
      return;
    }

    startTransition(async () => {
      try {
        await addDoc(missionaryImagesCollection, {
          imageUrl: item.url,
          description: item.description,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || 'unknown',
        });
        toast({ title: 'Éxito', description: 'Imagen guardada.' });
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
        toast({ title: 'Error', description: 'No se pudo guardar la imagen.', variant: 'destructive' });
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
      toast({ title: 'Error', description: 'Colección no disponible.', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      try {
        const itemRef = doc(missionaryImagesCollection, id);
        await updateDoc(itemRef, { description: newDescription });
        toast({ title: 'Éxito', description: 'Descripción actualizada.' });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error updating image description' });
        toast({ title: 'Error', description: 'No se pudo actualizar la descripción.', variant: 'destructive' });
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!missionaryImagesCollection) {
      toast({ title: 'Error', description: 'Colección no disponible.', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      try {
        await deleteDoc(doc(missionaryImagesCollection, id));
        toast({ title: 'Éxito', description: 'Imagen eliminada.' });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error deleting missionary image' });
        toast({ title: 'Error', description: 'No se pudo eliminar la imagen.', variant: 'destructive' });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Imágenes Misionales</CardTitle>
            <CardDescription>
              Sube imágenes y la IA generará descripciones automáticamente.
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
                      Subiendo...
                    </>
                  ) : uploadedFiles.some((file) => file.status === 'processing') ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="mr-2" />
                      Subir Imágenes
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
                <h3 className="text-lg font-semibold mb-4">Imágenes Pendientes</h3>
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
                            Subiendo imagen... {item.progress}%
                          </div>
                        )}
                        {item.status === 'processing' && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Procesando el texto de la imagen...
                          </div>
                        )}
                        <Textarea
                          value={item.description}
                          onChange={(e) => setUploadedFiles(prev =>
                            prev.map(i => i.id === item.id ? { ...i, description: e.target.value } : i)
                          )}
                          placeholder={
                            item.status === 'uploading'
                              ? 'Subiendo imagen...'
                              : item.status === 'processing'
                                ? 'Procesando el texto de la imagen...'
                                : 'Descripción'
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
                            Guardar
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
                <h3 className="text-lg font-semibold mb-4">Imágenes Guardadas</h3>
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
                          Eliminar
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {uploadedFiles.length === 0 && images.length === 0 && (
              <p className="text-sm text-center py-4 text-muted-foreground">
                No hay imágenes. Sube algunas para comenzar.
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
        <CardTitle>Nuevos Conversos</CardTitle>
        <CardDescription>
          Lista de nuevos conversos y sus amigos asignados del quórum.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : newConverts.length === 0 ? (
          <p className="text-sm text-center py-4 text-muted-foreground">
            No hay nuevos conversos.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nuevo Converso</TableHead>
                <TableHead>Amigo(s) del Quórum</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newConverts.map((item) => {
                const friendship = friendships.find(f => f.convertId === item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      {friendship ? friendship.friends.map(getMemberName).join(', ') : <span className="text-muted-foreground italic">Pendiente</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {friendship ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenForm(friendship)}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            Editar Amigos
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenForm(item)}
                          >
                            <UserPlus className="mr-2 h-4 w-4" />
                            Asignar Amigo
                          </Button>
                        )}
                      </div>
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
  const { toast } = useToast();

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
        getMissionaryAssignments(),
        getInvestigators(),
        getNewConvertFriendships(),
        getNewConvertsWithoutFriends(),
        getMembersForSelector(true, barrioOrg),
        getMissionaryImages(),
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
  }, []);

  const fetchAnnotations = useCallback(async () => {
    setLoadingAnnotations(true);
    try {
      const q = query(
        annotationsCollection,
        where('source', '==', 'missionary-work'),
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
  }, []);

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await deleteDoc(doc(annotationsCollection, id));
      toast({ title: 'Éxito', description: 'Anotación eliminada.' });
      fetchAnnotations();
    } catch (error) {
      console.error('Error deleting annotation:', error);
      toast({ title: 'Error', description: 'No se pudo eliminar la anotación.', variant: 'destructive' });
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
          <h1 className="text-balance text-fluid-title font-semibold">Obra Misional</h1>
          <p className="text-balance text-fluid-subtitle text-muted-foreground">
            Coordina y da seguimiento a los esfuerzos misionales del quórum.
          </p>
        </div>
      </div>

      <Tabs defaultValue="assignments">
        <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4 h-auto sm:h-10">
          <TabsTrigger value="assignments">Asignaciones</TabsTrigger>
          <TabsTrigger value="investigators">Investigadores</TabsTrigger>
          <TabsTrigger value="images">Imágenes</TabsTrigger>
          <TabsTrigger value="new_converts">Nuevos Conversos</TabsTrigger>
        </TabsList>
        <TabsContent value="assignments">
          <AssignmentsTab
            assignments={assignments}
            loading={loading}
            onRefresh={fetchData}
            user={user}
          />
        </TabsContent>
        <TabsContent value="investigators">
          <InvestigatorsTab
            investigators={investigators}
            newConverts={availableNewConverts}
            loading={loading}
            onRefresh={fetchData}
          />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTab
            images={missionaryImages}
            loading={loading}
            onRefresh={fetchData}
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
        title="Anotaciones de Obra Misional"
        description="Notas y recordatorios sobre los esfuerzos misionales del quórum."
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
          <CardTitle>Preguntas Frecuentes</CardTitle>
          <CardDescription>
            Respuestas a dudas comunes sobre el rol del quórum en la obra
            misional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqData.map((faq, index) => (
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
