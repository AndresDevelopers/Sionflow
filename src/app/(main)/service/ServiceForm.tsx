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

import { servicesCollection, storage } from '@/lib/collections';
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
import type { Service } from '@/lib/types';
import Image from 'next/image';
import { useAuth } from '@/contexts/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const serviceSchema = z.object({
  title: z.string().min(3, 'El título es requerido.'),
  description: z.string().min(10, 'La descripción es requerida.'),
  date: z.date({
    required_error: 'La fecha es requerida.',
  }),
  time: z.string().optional(),
});

type FormValues = z.infer<typeof serviceSchema>;

interface ServiceFormProps {
  service?: Service;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function ServiceForm({ service }: ServiceFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditMode = !!service;
  
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<any>(null);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const form = useForm<FormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: isEditMode
      ? {
          title: service.title,
          date: service.date.toDate(),
          description: service.description,
          time: service.time || '',
        }
      : {
          title: '',
          description: '',
          time: '',
        },
  });

  useEffect(() => {
    if (isEditMode && service) {
      form.reset({
        title: service.title,
        date: service.date.toDate(),
        description: service.description,
        time: service.time || '',
      });
      setPreviewUrls(service.imageUrls || []);
    } else {
       form.reset({ title: '', date: undefined, description: '', time: '' });
       setPreviewUrls([]);
    }
    setSelectedFiles([]);
     if (fileInputRef.current) {
        fileInputRef.current.value = '';
     }
  }, [service, isEditMode, form]);

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
      const uploadPromises = selectedFiles.map(async (file) => {
        const storageRef = ref(storage, `service_images/${user.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        return getDownloadURL(storageRef);
      });

      const deletePromises = (isEditMode && service?.imageUrls)
        ? service.imageUrls
          .filter(url => !previewUrls.includes(url))
          .map(async url => {
            if (url.startsWith('https://firebasestorage.googleapis.com')) {
              const imageRef = ref(storage, url);
              await deleteObject(imageRef).catch(err => logger.warn({ err, message: 'Old image could not be deleted' }));
            }
          })
        : [];

      const [newUrls] = await Promise.all([
        Promise.all(uploadPromises),
        Promise.all(deletePromises)
      ]);

      finalImageUrls = [...finalImageUrls, ...newUrls];

      const dataToSave = {
        ...values,
        date: Timestamp.fromDate(values.date),
        imageUrls: finalImageUrls,
      };

      if (isEditMode && service) {
        const serviceRef = doc(servicesCollection, service.id);
        await updateDoc(serviceRef, dataToSave);
        
        toast({
          title: 'Servicio Actualizado',
          description: 'El servicio ha sido actualizado exitosamente.',
        });
      } else {
        await addDoc(servicesCollection, dataToSave);
        toast({
          title: 'Servicio Agregado',
          description: 'El servicio ha sido registrado exitosamente.',
        });
      }
      router.push('/service');
      router.refresh(); 
    } catch (e: any) {
      logger.error({ error: e, message: 'Error saving service', data: values });
      setUploadError(e); // Set the error state to display it in the UI
      toast({
        title: "Error al Subir Imagen",
        description: 'Hubo un error al guardar el servicio. Revisa el error mostrado.',
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
            <CardTitle>{isEditMode ? 'Editar Servicio' : 'Agregar Nuevo Servicio'}</CardTitle>
            <CardDescription>
              {isEditMode ? 'Modifica los detalles del servicio.' : 'Ingresa los detalles del proyecto de servicio.'}
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
                  <FormLabel>Título del Servicio <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Limpieza del parque" {...field} />
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
                    <FormLabel>Fecha <span className="text-red-600">*</span></FormLabel>
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
                  <FormLabel>Descripción <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder="Describe brevemente en qué consiste el servicio."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>Imágenes (Opcional)</FormLabel>
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
                     <Image src={url} alt={`Imagen de servicio ${index + 1}`} width={100} height={100} className="w-full h-24 object-cover rounded-md" data-ai-hint="service image" />
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
              <Link href="/service">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : isEditMode ? 'Guardar Cambios' : 'Guardar Servicio'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
