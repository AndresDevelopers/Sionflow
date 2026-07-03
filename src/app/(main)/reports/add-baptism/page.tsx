'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Upload } from 'lucide-react';
import { addDoc, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { baptismsCollection } from '@/lib/collections';
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
  FormDescription,
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
import React from 'react';
import { MemberSelector } from '@/components/members/member-selector';
import { useAuth } from '@/contexts/auth-context';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const baptismSchema = z.object({
  name: z.string().min(2, { message: 'El nombre es requerido.' }),
  date: z.date({
    required_error: 'La fecha del bautismo es requerida.',
  }),
  photos: z.array(z.instanceof(File)).optional(),
});

type FormValues = z.infer<typeof baptismSchema>;

export default function AddBaptismPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(baptismSchema),
    defaultValues: {
      name: '',
      photos: [],
    },
  });

  const onSubmit = async (values: FormValues) => {
    if (!user) {
      toast({ title: 'Error', description: 'Debes iniciar sesión para subir imágenes.', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const photoURLs = [];
      if (values.photos) {
        const storage = getStorage();
        for (const photo of values.photos) {
          if (photo.size > MAX_FILE_SIZE) {
            throw new Error(`El archivo ${photo.name} supera los 20MB.`);
          }
          if (!photo.type || !photo.type.startsWith('image/')) {
            throw new Error(`El archivo ${photo.name} no es una imagen válida.`);
          }

          const safeName = photo.name.replace(/[^\w.\-]+/g, '_');
          const storageRef = ref(storage, `baptisms/manual/${user.uid}/${Date.now()}_${safeName}`);
          await uploadBytes(storageRef, photo, { contentType: photo.type });
          const downloadURL = await getDownloadURL(storageRef);
          photoURLs.push(downloadURL);
        }
      }

      await addDoc(baptismsCollection, {
        name: values.name,
        date: Timestamp.fromDate(values.date),
        photoURL: photoURLs[0] || '',
        baptismPhotos: photoURLs,
      });

      toast({
        title: 'Bautismo Agregado',
        description: 'El bautismo ha sido registrado exitosamente para el reporte anual.',
      });
      router.push('/reports');
    } catch (e) {
      logger.error({ error: e, message: 'Error adding manual baptism', data: values });
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Hubo un error al agregar el bautismo.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files = Array.from(event.target.files);
      const acceptedFiles = files.filter(file => {
        if (file.size > MAX_FILE_SIZE) {
          toast({
            title: 'Archivo demasiado grande',
            description: `El archivo ${file.name} supera los 20MB.`,
            variant: 'destructive',
          });
          return false;
        }
        if (!file.type || !file.type.startsWith('image/')) {
          toast({
            title: 'Archivo inválido',
            description: `El archivo ${file.name} no es una imagen válida.`,
            variant: 'destructive',
          });
          return false;
        }
        return true;
      });

      setSelectedFiles(acceptedFiles);
      form.setValue('photos', acceptedFiles);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Agregar Bautismo Manualmente</CardTitle>
            <CardDescription>
              Ingresa los detalles de un bautismo realizado en el año actual para incluirlo en el reporte.
              <br />
              <span className="text-sm text-muted-foreground">Los campos marcados con <span className="text-red-600">*</span> son obligatorios.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Miembro Bautizado <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <MemberSelector
                      value={field.value}
                      onValueChange={(memberId) => field.onChange(memberId)}
                      placeholder="Seleccionar miembro bautizado"

                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Fecha del Bautismo <span className="text-red-600">*</span></FormLabel>
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
                        autoFocus
                        locale={es}
                        defaultMonth={new Date()}
                        startMonth={new Date(new Date().getFullYear(), 0)}
                        endMonth={new Date(new Date().getFullYear(), 11)}
                        hidden={{ before: new Date(new Date().getFullYear(), 0, 1), after: new Date(new Date().getFullYear(), 11, 31) }}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="photos"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fotos del Bautismo</FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-2">
                      <Input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileChange}
                        className="hidden"
                        id="file-upload"
                      />
                      <label htmlFor="file-upload" className="cursor-pointer">
                        <Button variant="outline" asChild>
                          <div>
                            <Upload className="mr-2 h-4 w-4" />
                            Seleccionar Archivos
                          </div>
                        </Button>
                      </label>
                      {selectedFiles.length > 0 && (
                        <div className="text-sm text-muted-foreground">
                          {selectedFiles.length} archivo(s) seleccionado(s)
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>
                    Puedes subir una o varias fotos del bautismo.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/reports">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Guardar Bautismo'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
