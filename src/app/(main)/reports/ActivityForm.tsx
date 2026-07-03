
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, X, Upload, Loader2, AlertCircle } from 'lucide-react';
import { addDoc, doc, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

import { activitiesCollection, storage } from '@/lib/collections';
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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import type { Activity } from '@/lib/types';
import Image from 'next/image';
import { useAuth } from '@/contexts/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const activitySchema = z.object({
  title: z
    .string()
    .min(3, {
      message: 'El título es requerido y debe tener al menos 3 caracteres.',
    }),
  date: z.date({
    required_error: 'La fecha es requerida.',
  }),
  time: z.string().optional(),
  description: z.string().min(10, {
    message: 'La descripción es requerida y debe tener al menos 10 caracteres.',
  }),
  location: z.string().optional(),
  context: z.string().optional(),
  learning: z.string().optional(),
});

type FormValues = z.infer<typeof activitySchema>;

interface ActivityFormProps {
  activity?: Activity;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function ActivityForm({ activity }: ActivityFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditMode = !!activity;
  
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<any>(null);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);


  const form = useForm<FormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: { title: '', time: '', description: '', location: '', context: '', learning: '' },
  });

  useEffect(() => {
    if (isEditMode && activity) {
      form.reset({
        title: activity.title,
        date: activity.date.toDate(),
        time: activity.time || '',
        description: activity.description,
        location: activity.location || '',
        context: activity.context || '',
        learning: activity.learning || '',
      });
      setPreviewUrls(activity.imageUrls || []);
    } else {
       form.reset({ title: '', date: undefined, time: '', description: '', location: '', context: '', learning: '' });
       setPreviewUrls([]);
    }
    setSelectedFiles([]);
     if (fileInputRef.current) {
        fileInputRef.current.value = '';
     }
  }, [activity, isEditMode, form]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploadError(null); // Clear previous errors on new selection

    let validFiles: File[] = [];
    for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
            toast({
                title: "Archivo demasiado grande",
                description: `La imagen "${file.name}" supera el límite de 20MB.`,
                variant: "destructive",
            });
        } else {
            validFiles.push(file);
        }
    }

    const currentLocalUrls = previewUrls.filter(url => url.startsWith('blob:'));
    currentLocalUrls.forEach(URL.revokeObjectURL);

    setSelectedFiles(validFiles);
    const newUrls = validFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => [...prev.filter(url => !url.startsWith('blob:')), ...newUrls]);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const removeImage = (urlToRemove: string) => {
    const isLocal = urlToRemove.startsWith('blob:');
    
    setPreviewUrls(prev => prev.filter(url => url !== urlToRemove));

    if (isLocal) {
        const fileIndex = previewUrls.indexOf(urlToRemove) - (previewUrls.length - selectedFiles.length);
        if (fileIndex >= 0) {
            setSelectedFiles(prev => prev.filter((_, i) => i !== fileIndex));
        }
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast({ title: "Error", description: "Debes iniciar sesión para guardar.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    setUploadError(null);
    let finalImageUrls: string[] = previewUrls.filter(url => !url.startsWith('blob:'));
    
    try {
      let uploadPromise: Promise<string[]> = Promise.resolve([]);
      let deletePromise: Promise<void[]> = Promise.resolve([]);

      if (selectedFiles.length > 0) {
        const uploadPromises = selectedFiles.map(async (file) => {
          const storageRef = ref(storage, `activity_images/${user.uid}/${Date.now()}_${file.name}`);
          await uploadBytes(storageRef, file);
          return getDownloadURL(storageRef);
        });
        uploadPromise = Promise.all(uploadPromises);
      }

      if (isEditMode && activity?.imageUrls) {
          const removedUrls = activity.imageUrls.filter(url => !previewUrls.includes(url));
          const deletePromises = removedUrls.map(async url => {
              if (url.startsWith('https://firebasestorage.googleapis.com')) {
                  const imageRef = ref(storage, url);
                  await deleteObject(imageRef).catch(err => logger.warn({err, message: 'Old image could not be deleted'}));
              }
          });
          deletePromise = Promise.all(deletePromises);
      }

      const [newUrls] = await Promise.all([uploadPromise, deletePromise]);
      finalImageUrls = [...finalImageUrls, ...newUrls];

      const dataToSave = {
        ...values,
        date: Timestamp.fromDate(values.date),
        imageUrls: finalImageUrls,
      };

      if (isEditMode && activity) {
        const activityRef = doc(activitiesCollection, activity.id);
        await updateDoc(activityRef, dataToSave);

        toast({
          title: 'Actividad Actualizada',
          description: 'La actividad ha sido actualizada exitosamente.',
        });
      } else {
        await addDoc(activitiesCollection, dataToSave);
        toast({
          title: 'Actividad Agregada',
          description: 'La actividad ha sido registrada exitosamente.',
        });
      }
      router.push('/reports/activities');
      router.refresh();
    } catch (e: any) {
      logger.error({ error: e, message: 'Error saving activity', data: values });
      setUploadError(e); // Set the error state to display it in the UI
      toast({
        title: "Error al Subir Imagen",
        description: 'Hubo un error al guardar la actividad. Revisa el error mostrado.',
        variant: 'destructive',
      });
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-8"
      >
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>{isEditMode ? 'Editar Actividad' : 'Agregar Nueva Actividad'}</CardTitle>
            <CardDescription>
              {isEditMode ? 'Modifica los detalles de la actividad.' : 'Ingresa los detalles de la actividad realizada por el quórum.'}
              <br />
              <span className="text-sm text-muted-foreground">Los campos marcados con <span className="text-red-600">*</span> son obligatorios.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {uploadError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error de Subida</AlertTitle>
                <AlertDescription>
                  <p>No se pudo subir la imagen. Por favor, comparte este error:</p>
                  <pre className="mt-2 text-xs bg-red-50 p-2 rounded whitespace-pre-wrap">
                    <strong>Código:</strong> {uploadError?.code || 'N/A'}
                    <br />
                    <strong>Mensaje:</strong> {uploadError?.message || 'Error desconocido'}
                  </pre>
                </AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título de la Actividad <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Servicio en el asilo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de la Actividad <span className="text-red-600">*</span></FormLabel>
                    <Popover open={datePopoverOpen} onOpenChange={(open) => {
                      setDatePopoverOpen(open);
                      if (open) {
                        // Sincronizar selectedDate con el valor actual del campo al abrir
                        setSelectedDate(field.value);
                      }
                    }}>
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
                          selected={selectedDate || field.value}
                          onSelect={setSelectedDate}
                          defaultMonth={selectedDate || field.value}
                          autoFocus
                          locale={es}
                        />
                        <div className="p-3 border-t flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => {
                              setSelectedDate(undefined);
                              setDatePopoverOpen(false);
                            }}
                          >
                            Cancelar
                          </Button>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => {
                              if (selectedDate) {
                                field.onChange(selectedDate);
                              }
                              setDatePopoverOpen(false);
                            }}
                          >
                            Establecer fecha
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hora</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción de la Actividad <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder="Describe brevemente qué se hizo, quiénes participaron, y los resultados."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>¿Dónde sucedió?</FormLabel>
                  <FormControl>
                    <Input placeholder="Indicar el lugar donde ocurrió esta experiencia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="context"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>¿Qué estaba haciendo usted en ese momento?</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Indicar los detalles históricos y personales."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="learning"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>¿Qué es lo que aprendió de esta experiencia (en una frase)?</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Aprendí la importancia de servir a los demás." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormItem>
              <FormLabel>Imágenes</FormLabel>
              <FormControl>
                <div className="flex items-center justify-center w-full">
                    <label htmlFor="dropzone-file" className={cn(
                        "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted hover:bg-muted/50",
                        isSubmitting && "cursor-not-allowed opacity-50"
                    )}>
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {isSubmitting ? <Loader2 className="w-8 h-8 mb-4 text-muted-foreground animate-spin" /> : <Upload className="w-8 h-8 mb-4 text-muted-foreground" />}
                            <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Haz click para subir</span> o arrastra y suelta</p>
                            <p className="text-xs text-muted-foreground">PNG, JPG (MAX. 20MB por imagen)</p>
                        </div>
                        <input id="dropzone-file" type="file" className="hidden" multiple accept="image/png, image/jpeg" onChange={handleImageChange} ref={fileInputRef} disabled={isSubmitting}/>
                    </label>
                </div> 
              </FormControl>
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                {previewUrls.map((url, index) => (
                   <div key={index} className="relative group">
                     <Image src={url} alt={`Imagen de actividad ${index + 1}`} width={100} height={100} className="w-full h-24 object-cover rounded-md" data-ai-hint="activity image" />
                     <button 
                       type="button" 
                       onClick={() => removeImage(url)} 
                       className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity" 
                       disabled={isSubmitting}
                       title="Eliminar imagen"
                       aria-label={`Eliminar imagen ${index + 1}`}
                     >
                       <X className="h-3 w-3" />
                     </button>
                   </div>
                ))}
              </div>
            </FormItem>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/reports/activities">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : isEditMode ? 'Guardar Cambios' : 'Guardar Actividad'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
