
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { CalendarIcon, X, Upload, Loader2, AlertCircle } from 'lucide-react';
import { addDoc, doc, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

import { activitiesCollection, storage } from '@/lib/collections';
import { compressGalleryImage } from '@/lib/image-compression';
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
import { OfflineImage } from '@/components/offline-image';
import { useAuth } from '@/contexts/auth-context';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useI18n } from '@/contexts/i18n-context';

interface ActivityFormProps {
  activity?: Activity;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export function ActivityForm({ activity }: ActivityFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user, barrioOrg } = useAuth();
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activitySchema = z.object({
    title: z
      .string()
      .min(3, {
        message: t('reports.activityForm.titleRequired'),
      }),
    date: z.date({
      required_error: t('reports.activityForm.dateRequired'),
    }),
    time: z.string().optional(),
    description: z.string().min(10, {
      message: t('reports.activityForm.descriptionRequired'),
    }),
    location: z.string().optional(),
    context: z.string().optional(),
    learning: z.string().optional(),
  });

  type FormValues = z.infer<typeof activitySchema>;

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
                title: t('settings.toast.fileTooLargeTitle'),
                description: t('reports.activityForm.imageTooLarge', { name: file.name }),
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
      toast({ title: t('common.error'), description: t('reports.activityForm.loginRequired'), variant: "destructive" });
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
          const optimized = await compressGalleryImage(file);
          const { userScopedStoragePath } = await import('@/lib/storage-paths');
          const path = userScopedStoragePath(user.uid, 'activity_images', optimized.name);
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, optimized, { contentType: optimized.type });
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
        barrioOrg,
      };

      if (isEditMode && activity) {
        const activityRef = doc(activitiesCollection, activity.id);
        await updateDoc(activityRef, dataToSave);

        toast({
          title: t('reports.activityForm.updatedTitle'),
          description: t('reports.activityForm.updatedDescription'),
        });
      } else {
        await addDoc(activitiesCollection, dataToSave);
        toast({
          title: t('reports.activityForm.addedTitle'),
          description: t('reports.activityForm.addedDescription'),
        });
      }
      router.push('/reports/activities');
      router.refresh();
    } catch (e: any) {
      logger.error({ error: e, message: 'Error saving activity', data: values });
      setUploadError(e); // Set the error state to display it in the UI
      toast({
        title: t('reports.activityForm.uploadErrorTitle'),
        description: t('reports.activityForm.saveErrorDescription'),
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
            <CardTitle>{isEditMode ? t('reports.activityForm.editTitle') : t('reports.activityForm.addTitle')}</CardTitle>
            <CardDescription>
              {isEditMode ? t('reports.activityForm.editDescription') : t('reports.activityForm.addDescription')}
              <br />
              <span className="text-sm text-muted-foreground">{t('reports.form.requiredFields')}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {uploadError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('reports.activityForm.uploadErrorTitle')}</AlertTitle>
                <AlertDescription>
                  <p>{t('reports.activityForm.uploadErrorDescription')}</p>
                  <pre className="mt-2 text-xs bg-red-50 p-2 rounded whitespace-pre-wrap">
                    <strong>{t('service.uploadCodeLabel')}</strong> {uploadError?.code || 'N/A'}
                    <br />
                    <strong>{t('service.uploadMessageLabel')}</strong> {uploadError?.message || t('reports.unknownError')}
                  </pre>
                </AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('reports.activityForm.titleLabel')} <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder={t('reports.activityForm.titlePlaceholder')} {...field} />
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
                    <FormLabel>{t('reports.activityForm.dateLabel')} <span className="text-red-600">*</span></FormLabel>
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
                              format(field.value, 'd LLLL yyyy', { locale: getDateFnsLocale() })
                            ) : (
                              <span>{t('reports.activityForm.selectDate')}</span>
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
                          locale={getDateFnsLocale()}
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
                            {t('reports.cancel')}
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
                            {t('reports.activityForm.setDate')}
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
                  <FormLabel>{t('reports.activityForm.descriptionLabel')} <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      placeholder={t('reports.activityForm.descriptionPlaceholder')}
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
                  <FormLabel>{t('reports.activityForm.whereLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('reports.activityForm.wherePlaceholder')} {...field} />
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
                  <FormLabel>{t('reports.activityForm.contextLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={t('reports.activityForm.contextPlaceholder')}
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
                  <FormLabel>{t('reports.activityForm.learningLabel')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('reports.activityForm.learningPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormItem>
              <FormLabel>{t('reports.activityForm.imagesLabel')}</FormLabel>
              <FormControl>
                <div className="flex items-center justify-center w-full">
                    <label htmlFor="dropzone-file" className={cn(
                        "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-muted hover:bg-muted/50",
                        isSubmitting && "cursor-not-allowed opacity-50"
                    )}>
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            {isSubmitting ? <Loader2 className="w-8 h-8 mb-4 text-muted-foreground animate-spin" /> : <Upload className="w-8 h-8 mb-4 text-muted-foreground" />}
                            <p className="mb-2 text-sm text-muted-foreground">{t('reports.activityForm.dropzoneText')}</p>
                            <p className="text-xs text-muted-foreground">{t('reports.activityForm.dropzoneHint')}</p>
                        </div>
                        <input id="dropzone-file" type="file" className="hidden" multiple accept="image/png, image/jpeg" onChange={handleImageChange} ref={fileInputRef} disabled={isSubmitting}/>
                    </label>
                </div> 
              </FormControl>
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                {previewUrls.map((url, index) => (
                   <div key={index} className="relative group">
                      <OfflineImage src={url} alt={t('reports.activityForm.imageAlt', { index: index + 1 })} width={100} height={100} className="w-full h-24 object-cover rounded-md" data-ai-hint="activity image" />
                      <button
                        type="button"
                        onClick={() => removeImage(url)}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        disabled={isSubmitting}
                        title={t('reports.activityForm.deleteImageAlt', { index: index + 1 })}
                        aria-label={t('reports.activityForm.deleteImageAlt', { index: index + 1 })}
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
              <Link href="/reports/activities">{t('reports.cancel')}</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('reports.saving') : isEditMode ? t('reports.activityForm.saveChanges') : t('reports.activityForm.save')}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
