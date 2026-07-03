
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, User, X, Upload, Loader2, UserCheck, Edit3 } from 'lucide-react';
import { addDoc, doc, Timestamp, updateDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { convertsCollection, storage, membersCollection } from '@/lib/collections';
import logger from '@/lib/logger';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import type { Convert, Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import { useAuth } from '@/contexts/auth-context';

const convertSchema = z.object({
  name: z.string().min(2, { message: 'El nombre es requerido.' }),
  baptismDate: z.date({
    required_error: 'La fecha de bautismo es requerida.',
  }),
});

type FormValues = z.infer<typeof convertSchema>;

interface ConvertFormProps {
  convert?: Convert;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function ConvertForm({ convert }: ConvertFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditMode = !!convert;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // New state for entry mode and member selection
  const [entryMode, setEntryMode] = useState<'manual' | 'automatic'>('manual');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(convertSchema),
    defaultValues: {
      name: '',
    },
  });

  // Load members for automatic mode
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const snapshot = await getDocs(query(membersCollection, orderBy('firstName', 'asc')));
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
        title: "Error",
        description: "No se pudieron cargar los miembros.",
        variant: "destructive",
      });
    }
    setLoadingMembers(false);
  }, [toast]);

  useEffect(() => {
    if (isEditMode && convert) {
      form.reset({
        name: convert.name,
        baptismDate: convert.baptismDate.toDate(),
      });
      setPreviewUrl(convert.photoURL || null);
      setEntryMode('manual'); // Always manual for edit mode
    } else {
      form.reset({ name: '', baptismDate: undefined });
      setPreviewUrl(null);
      setSelectedMember(null);
      // Load members when not in edit mode
      if (!isEditMode) {
        loadMembers();
      }
    }
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [convert, isEditMode, form, loadMembers]);

  // Handle member selection in automatic mode
  const handleMemberSelect = (memberId: string) => {
    const member = members.find(m => m.id === memberId);
    if (member) {
      setSelectedMember(member);
      // Auto-fill form with member data
      form.setValue('name', `${member.firstName} ${member.lastName}`);
      if (member.photoURL) {
        setPreviewUrl(member.photoURL);
      }
      // Clear any selected file since we're using member's photo
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle entry mode change
  const handleEntryModeChange = (mode: 'manual' | 'automatic') => {
    setEntryMode(mode);
    if (mode === 'manual') {
      setSelectedMember(null);
      form.reset({ name: '', baptismDate: undefined });
      setPreviewUrl(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };


  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "Archivo demasiado grande",
        description: "El tamaño máximo de la imagen es de 20MB.",
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
    setPreviewUrl(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };


  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast({ title: "Error", description: "Debes iniciar sesión para guardar.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    let finalPhotoURL = convert?.photoURL || null;

    try {
      // Handle photo upload/update logic
      if (selectedFile) {
        const storageRef = ref(storage, `profile_pictures/converts/${user.uid}/${Date.now()}_${selectedFile.name}`);
        await uploadBytes(storageRef, selectedFile);
        finalPhotoURL = await getDownloadURL(storageRef);

        if (isEditMode && convert?.photoURL && convert.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, convert.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: 'Old image could not be deleted.' }));
        }
      } else if (entryMode === 'automatic' && selectedMember?.photoURL) {
        // Use member's photo for automatic mode
        finalPhotoURL = selectedMember.photoURL;
      } else if (isEditMode && !previewUrl && convert?.photoURL) {
        if (convert.photoURL.startsWith('https://firebasestorage.googleapis.com')) {
          const oldImageRef = ref(storage, convert.photoURL);
          await deleteObject(oldImageRef).catch(err => logger.warn({ err, message: 'Image to be removed could not be deleted' }));
        }
        finalPhotoURL = null;
      }

      const dataToSave = {
        name: values.name,
        baptismDate: Timestamp.fromDate(values.baptismDate),
        photoURL: finalPhotoURL,
        councilCompleted: convert?.councilCompleted || false,
        councilCompletedAt: convert?.councilCompletedAt || null,
        observation: convert?.observation || '',
        // Add source information for tracking
        source: entryMode === 'automatic' ? 'Automático' : 'Manual',
        ...(entryMode === 'automatic' && selectedMember && { 
          linkedMemberId: selectedMember.id,
          memberReference: `${selectedMember.firstName} ${selectedMember.lastName}`
        })
      };

      if (isEditMode && convert) {
        const docRef = doc(convertsCollection, convert.id);
        await updateDoc(docRef, dataToSave);
        toast({
          title: "Converso Actualizado",
          description: "Los datos del miembro han sido actualizados exitosamente.",
        });
      } else {
        await addDoc(convertsCollection, dataToSave);
        toast({
          title: "Converso Agregado",
          description: `El nuevo miembro ha sido registrado exitosamente${entryMode === 'automatic' ? ' desde el registro de miembros' : ''}.`,
        });
      }
      router.push('/converts');
      router.refresh();
    } catch (e) {
      logger.error({ error: e, message: `Error ${isEditMode ? 'updating' : 'adding'} convert`, data: values });
      toast({
        title: "Error",
        description: 'Hubo un error al guardar los datos.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>{isEditMode ? 'Editar Converso' : 'Agregar Nuevo Converso'}</CardTitle>
            <CardDescription>
              {isEditMode ? 'Actualiza los detalles del miembro.' : 'Ingresa los detalles del nuevo miembro bautizado.'}
              <br />
              <span className="text-sm text-muted-foreground">Los campos marcados con <span className="text-red-600">*</span> son obligatorios.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Entry Mode Selection - Only show in add mode */}
            {!isEditMode && (
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-medium">Método de Registro</Label>
                  <p className="text-sm text-muted-foreground">Selecciona cómo deseas registrar al converso</p>
                </div>
                <RadioGroup
                  value={entryMode}
                  onValueChange={(value) => handleEntryModeChange(value as 'manual' | 'automatic')}
                  className="flex flex-col space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="manual" id="manual" />
                    <Label htmlFor="manual" className="flex items-center gap-2 cursor-pointer">
                      <Edit3 className="h-4 w-4" />
                      Manual - Ingresar datos manualmente
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="automatic" id="automatic" />
                    <Label htmlFor="automatic" className="flex items-center gap-2 cursor-pointer">
                      <UserCheck className="h-4 w-4" />
                      Automático - Seleccionar miembro existente
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Member Selection - Only show in automatic mode */}
            {entryMode === 'automatic' && !isEditMode && (
              <FormItem>
                <FormLabel>Seleccionar Miembro <span className="text-red-600">*</span></FormLabel>
                <Select onValueChange={handleMemberSelect} disabled={loadingMembers}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingMembers ? "Cargando miembros..." : "Selecciona un miembro"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {members.map((member) => (
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
                <FormMessage />
              </FormItem>
            )}

            {/* Photo Section */}
            <FormItem className="flex flex-col items-center">
              <FormLabel>Foto de Perfil</FormLabel>
              <FormControl>
                <div className="relative">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={previewUrl ?? undefined} alt="Vista previa" data-ai-hint="profile picture" />
                    <AvatarFallback>
                      {isSubmitting ? <Loader2 className="animate-spin" /> : <User className="h-10 w-10 text-muted-foreground" />}
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
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="mt-2" 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={isSubmitting}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {previewUrl ? 'Cambiar Imagen' : 'Subir Imagen'}
                </Button>
              )}
              {entryMode === 'automatic' && selectedMember && (
                <p className="text-xs text-muted-foreground mt-2">
                  Foto del miembro seleccionado
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
                  <FormLabel>Nombre Completo <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Ej: Juan Pérez" 
                      {...field} 
                      disabled={entryMode === 'automatic' && !selectedMember}
                      readOnly={entryMode === 'automatic' && !!selectedMember}
                    />
                  </FormControl>
                  {entryMode === 'automatic' && selectedMember && (
                    <p className="text-xs text-muted-foreground">
                      Nombre obtenido del miembro seleccionado
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baptismDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Fecha de Bautismo <span className="text-red-600">*</span></FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={'outline'}
                          className={cn(
                            'w-full pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground'
                          )}
                        >
                          {field.value ? (
                            format(field.value, 'd LLLL yyyy', { locale: es })
                          ) : (
                            <span>Selecciona una fecha</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        defaultMonth={field.value}
                        disabled={(date) =>
                          date > new Date() || date < new Date('1900-01-01')
                        }
                        autoFocus
                        locale={es}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/converts">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}

    
