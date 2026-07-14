'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { CalendarIcon, Upload } from 'lucide-react';
import { addDoc, Timestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { baptismsCollection } from '@/lib/collections';
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
import { useI18n } from '@/contexts/i18n-context';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function AddBaptismPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, barrioOrg } = useAuth();
  const { t } = useI18n();

  const baptismSchema = z.object({
    name: z.string().min(2, { message: t('reports.baptismForm.nameRequired') }),
    date: z.date({
      required_error: t('reports.baptismForm.dateRequired'),
    }),
    photos: z.array(z.instanceof(File)).optional(),
  });

  type FormValues = z.infer<typeof baptismSchema>;

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
      toast({ title: t('common.error'), description: t('reports.baptismForm.loginRequiredUpload'), variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const photoURLs = [];
      if (values.photos) {
        const storage = getStorage();
        for (const photo of values.photos) {
          if (photo.size > MAX_FILE_SIZE) {
            throw new Error(t('reports.baptismForm.fileTooLarge', { name: photo.name }));
          }
          if (!photo.type || !photo.type.startsWith('image/')) {
            throw new Error(t('reports.baptismForm.fileInvalid', { name: photo.name }));
          }

          const optimized = await compressGalleryImage(photo);
          const safeName = optimized.name.replace(/[^\w.\-]+/g, '_');
          const { userScopedStoragePath } = await import('@/lib/storage-paths');
          const path = userScopedStoragePath(user.uid, 'baptisms/manual', safeName);
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, optimized, { contentType: optimized.type });
          const downloadURL = await getDownloadURL(storageRef);
          photoURLs.push(downloadURL);
        }
      }

      await addDoc(baptismsCollection, {
        name: values.name,
        date: Timestamp.fromDate(values.date),
        photoURL: photoURLs[0] || '',
        baptismPhotos: photoURLs,
        barrioOrg,
      });

      toast({
        title: t('reports.baptismForm.addedTitle'),
        description: t('reports.baptismForm.addedDescription'),
      });
      router.push('/reports');
    } catch (e) {
      logger.error({ error: e, message: 'Error adding manual baptism', data: values });
      toast({
        title: t('common.error'),
        description: e instanceof Error ? e.message : t('reports.baptismForm.addError'),
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
            title: t('settings.toast.fileTooLargeTitle'),
            description: t('reports.baptismForm.fileTooLarge', { name: file.name }),
            variant: 'destructive',
          });
          return false;
        }
        if (!file.type || !file.type.startsWith('image/')) {
          toast({
            title: t('reports.fileInvalidTitle'),
            description: t('reports.baptismForm.fileInvalid', { name: file.name }),
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
            <CardTitle>{t('reports.baptismForm.pageTitle')}</CardTitle>
            <CardDescription>
              {t('reports.baptismForm.pageDescription')}
              <br />
              <span className="text-sm text-muted-foreground">{t('reports.form.requiredFields')}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('reports.baptismForm.memberLabel')} <span className="text-red-600">*</span></FormLabel>
                  <FormControl>
                    <MemberSelector
                      value={field.value}
                      onValueChange={(memberId) => field.onChange(memberId)}
                      placeholder={t('reports.baptismForm.memberPlaceholder')}

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
                  <FormLabel>{t('reports.baptismForm.dateLabel')} <span className="text-red-600">*</span></FormLabel>
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
                            format(field.value, 'd LLLL yyyy', { locale: getDateFnsLocale() })
                          ) : (
                            <span>{t('reports.baptismForm.selectDate')}</span>
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
                        locale={getDateFnsLocale()}
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
                  <FormLabel>{t('reports.baptismForm.photosLabel')}</FormLabel>
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
                            {t('reports.baptismForm.selectFiles')}
                          </div>
                        </Button>
                      </label>
                      {selectedFiles.length > 0 && (
                         <div className="text-sm text-muted-foreground">
                          {t('reports.baptismForm.filesSelected', { count: selectedFiles.length })}
                        </div>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription>
                    {t('reports.baptismForm.photosDescription')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/reports">{t('reports.cancel')}</Link>
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('reports.saving') : t('reports.baptismForm.save')}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </Form>
  );
}
