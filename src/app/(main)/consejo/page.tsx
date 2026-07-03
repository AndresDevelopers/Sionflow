"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getDocs, query, orderBy, where, Timestamp, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, getDoc, Firestore, onSnapshot, setDoc } from 'firebase/firestore';
import { convertsCollection, membersCollection, annotationsCollection } from '@/lib/collections';
import { Convert, Annotation } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import { subMonths } from 'date-fns';
import { AnnotationManager } from '@/components/shared/annotation-manager';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Save, Edit2, X, Check, Eye } from 'lucide-react';
import { createNewConvertCouncilNotificationsForAll } from '@/lib/notification-helpers';

// Extended convert type with notes
interface ConvertWithNotes extends Convert {
  notes?: string;
}

// Helper function to get convert info from subcollection
async function getConvertInfo(firestore: Firestore, convertId: string): Promise<{ notes?: string; calling?: string } | null> {
  try {
    const infoDoc = await getDoc(doc(firestore, 'c_conversos_info', convertId));
    if (infoDoc.exists()) {
      const data = infoDoc.data();
      return {
        notes: data.notes as string || '',
        calling: data.calling as string || ''
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Helper function to save convert info to subcollection
async function saveConvertNotes(firestore: Firestore, convertId: string, notes: string): Promise<void> {
  try {
    const infoRef = doc(firestore, 'c_conversos_info', convertId);
    await setDoc(infoRef, {
      notes,
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    console.error('Error saving convert notes:', error);
    throw error;
  }
}

const ConsejoPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [newConverts, setNewConverts] = useState<ConvertWithNotes[]>([]);
  const [loading, setLoading] = useState(true);
  const [annotationsLoading, setAnnotationsLoading] = useState(true);

  // State for editing notes
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Fetch annotations in real-time
  useEffect(() => {
    const annotationsQuery = query(
      annotationsCollection,
      where('source', '==', 'council'),
      orderBy('createdAt', 'desc')
    );
    const annotationsUnsubscribe = onSnapshot(annotationsQuery, (snapshot) => {
      const annotationsData = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Annotation)
      );
      setAnnotations(annotationsData);
      setAnnotationsLoading(false);
    }, (error) => {
      console.error('Error fetching annotations:', error);
      setAnnotationsLoading(false);
    });

    return () => {
      annotationsUnsubscribe();
    };
  }, []);

  // Fetch converts in real-time
  useEffect(() => {
    const convertsQuery = query(convertsCollection, orderBy('baptismDate', 'desc'));
    const membersQuery = query(membersCollection, orderBy('baptismDate', 'desc'));

    const unsubscribeConverts = onSnapshot(convertsQuery, async (snapshot) => {
      try {
        const twentyFourMonthsAgo = subMonths(new Date(), 24);

        let convertsFromCollection = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Convert))
          .filter(convert =>
            convert.baptismDate &&
            convert.baptismDate.toDate &&
            convert.baptismDate.toDate() > twentyFourMonthsAgo
          );

        // Get member data for converts with memberId
        const membersSnap = await getDocs(membersQuery);
        const memberIds = convertsFromCollection
          .map(convert => convert.memberId)
          .filter(id => id) as string[];
        const membersMap = new Map<string, any>();
        if (memberIds.length > 0) {
          const chunks = [];
          for (let i = 0; i < memberIds.length; i += 10) {
            chunks.push(memberIds.slice(i, i + 10));
          }
          for (const chunk of chunks) {
            const membersSnapshot = await getDocs(query(membersCollection, where('__name__', 'in', chunk)));
            membersSnapshot.docs.forEach(doc => {
              const memberData = doc.data();
              if (normalizeMemberStatus(memberData.status) === 'deceased') {
                return;
              }
              membersMap.set(doc.id, memberData);
            });
          }
          convertsFromCollection = convertsFromCollection.map(convert => {
            if (convert.memberId && membersMap.has(convert.memberId)) {
              const memberData = membersMap.get(convert.memberId);
              return {
                ...convert,
                name: convert.name || `${memberData.firstName || ''} ${memberData.lastName || ''}`.trim(),
                photoURL: convert.photoURL || memberData.photoURL
              };
            }
            return convert;
          });
        }

        // Get members baptized in the last 24 months
        const membersAsConverts = membersSnap.docs
          .map(doc => {
            const memberData = doc.data();
            if (normalizeMemberStatus(memberData.status) === 'deceased') {
              return null;
            }
            if (memberData.baptismDate && memberData.baptismDate.toDate) {
              const baptismDate = memberData.baptismDate.toDate();
              if (baptismDate > twentyFourMonthsAgo) {
                return {
                  id: `member_${doc.id}`,
                  name: `${memberData.firstName || ''} ${memberData.lastName || ''}`.trim(),
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

        // Combine and sort
        const allConverts = [...convertsFromCollection, ...membersAsConverts]
          .sort((a, b) => b.baptismDate.toDate().getTime() - a.baptismDate.toDate().getTime());

        const uniqueConverts = allConverts
          .filter(convert => convert.name && convert.name.trim() !== '')
          .filter((convert, index, self) =>
            index === self.findIndex(c =>
              c.name === convert.name &&
              c.baptismDate.toDate().getTime() === convert.baptismDate.toDate().getTime()
            )
          );

        // Fetch notes for each convert
        const convertsWithNotes = await Promise.all(
          uniqueConverts.map(async (convert) => {
            try {
              const firestore = convertsCollection.firestore;
              const info = await getConvertInfo(firestore, convert.id);
              return {
                ...convert,
                notes: info?.notes || ''
              } as ConvertWithNotes;
            } catch {
              return { ...convert, notes: '' } as ConvertWithNotes;
            }
          })
        );

        setNewConverts(convertsWithNotes);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching new converts:', error);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeConverts();
    };
  }, []);

  const handleAddAnnotation = async (description: string) => {
    if (!user) return;

    await addDoc(annotationsCollection, {
      text: description,
      source: 'council',
      isCouncilAction: false,
      isResolved: false,
      createdAt: serverTimestamp(),
      userId: user.uid,
    });
  };

  const handleDeleteAnnotation = async (id: string) => {
    await deleteDoc(doc(annotationsCollection, id));
  };

  const handleResolveAnnotation = async (id: string) => {
    try {
      const annotationRef = doc(annotationsCollection, id);
      const annotationSnap = await getDoc(annotationRef);

      if (!annotationSnap.exists()) {
        toast({ title: 'Error', description: 'Anotación no encontrada.', variant: 'destructive' });
        return;
      }

      const annotationData = annotationSnap.data() as Annotation;

      if (annotationData.isCouncilAction) {
        await updateDoc(annotationRef, {
          isCouncilAction: false,
          isResolved: true,
        });
      }

      await deleteDoc(annotationRef);

      toast({ title: 'Anotación Resuelta', description: 'La anotación ha sido marcada como resuelta y eliminada.' });
    } catch (error) {
      console.error('Error resolving annotation:', error);
      toast({ title: 'Error', description: 'No se pudo resolver la anotación.', variant: 'destructive' });
    }
  };

  // Handle editing notes
  const startEditingNotes = (convert: ConvertWithNotes) => {
    setEditingNotesId(convert.id);
    setEditingNotesValue(convert.notes || '');
  };

  const cancelEditingNotes = () => {
    setEditingNotesId(null);
    setEditingNotesValue('');
  };

  const saveNotes = async (convertId: string) => {
    if (!user) return;

    // Get current notes before saving to detect changes
    const currentConvert = newConverts.find(c => c.id === convertId);
    const previousNotes = currentConvert?.notes || '';
    const notesChanged = previousNotes !== editingNotesValue;

    setSavingNotes(true);
    try {
      const firestore = convertsCollection.firestore;
      await saveConvertNotes(firestore, convertId, editingNotesValue);

      // Update local state
      setNewConverts(prev => prev.map(c =>
        c.id === convertId ? { ...c, notes: editingNotesValue } : c
      ));

      setEditingNotesId(null);
      setEditingNotesValue('');

      toast({ title: 'Observaciones guardadas', description: 'Las observaciones se han sincronizado correctamente.' });

      // Send in-app notification only if notes changed (not first time)
      if (notesChanged && currentConvert) {
        try {
          await createNewConvertCouncilNotificationsForAll(
            currentConvert.name || 'Converso',
            convertId,
            'actualizado'
          );
        } catch (notifError) {
          console.error('Error sending new convert notification:', notifError);
        }
      }
    } catch (error) {
      console.error('Error saving notes:', error);
      toast({ title: 'Error', description: 'No se pudieron guardar las observaciones.', variant: 'destructive' });
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="p-5">
      <h1 className="text-2xl font-bold mb-6">Consejo</h1>

      <AnnotationManager
        title="Anotaciones"
        description="Notas y recordatorios para el consejo del quórum."
        buttonText="Anotación"
        dialogTitle="Nueva Anotación"
        placeholder="Ej: Revisar situación de la familia Pérez..."
        items={annotations.map(ann => ({
          id: ann.id,
          description: ann.text,
          createdAt: ann.createdAt,
          userId: ann.userId,
          isCouncilAction: ann.isCouncilAction
        }))}
        loading={annotationsLoading}
        onAdd={handleAddAnnotation}
        onDelete={handleDeleteAnnotation}
        onResolve={handleResolveAnnotation}
        showResolveButton={true}
        emptyMessage="No hay anotaciones."
        currentUserId={user?.uid}
      />

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Seguimiento de Conversos</h2>
        {loading ? (
          <p className="text-muted-foreground">Cargando...</p>
        ) : newConverts.length > 0 ? (
          <ul className="mt-5 bg-gray-50 border border-gray-300 rounded-md p-2.5 space-y-4">
            {newConverts.map((convert) => (
              <li key={convert.id} className="flex items-start gap-2.5">
                {convert.photoURL && (
                  <Image
                    src={convert.photoURL}
                    alt={`Foto de ${convert.name}`}
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                )}
                <div className="flex flex-col flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-bold text-base mb-0.5 block">
                        {convert.name}
                      </span>
                      <span className="text-sm text-gray-600 block">
                        Bautismo: {convert.baptismDate?.toDate().toLocaleDateString('es-ES')}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-100" asChild>
                      <Link href={convert.id.startsWith('member_')
                        ? `/members/${convert.id.substring(7)}`
                        : convert.memberId
                          ? `/members/${convert.memberId}`
                          : `/members?search=${encodeURIComponent(convert.name || '')}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>

                  {/* Notes section - editable */}
                  <div className="mt-2">
                    {editingNotesId === convert.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingNotesValue}
                          onChange={(e) => setEditingNotesValue(e.target.value)}
                          placeholder="Escriba observaciones sobre este converso..."
                          rows={3}
                          className="text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveNotes(convert.id)}
                            disabled={savingNotes}
                            className="flex items-center gap-1"
                          >
                            <Check className="h-4 w-4" />
                            {savingNotes ? 'Guardando...' : 'Guardar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEditingNotes}
                            disabled={savingNotes}
                            className="flex items-center gap-1"
                          >
                            <X className="h-4 w-4" />
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        {convert.notes && convert.notes.trim() !== '' ? (
                          <span className="text-sm text-gray-500 italic flex-1">
                            Observaciones: {convert.notes}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400 italic">
                            Sin observaciones
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEditingNotes(convert)}
                          className="h-6 px-2 text-gray-500 hover:text-gray-700"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No hay conversos nuevos en los últimos 2 años.</p>
        )}
      </section>
    </div>
  );
};

export default ConsejoPage;
