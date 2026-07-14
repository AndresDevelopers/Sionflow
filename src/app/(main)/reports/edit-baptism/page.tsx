'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { compressGalleryImage } from '@/lib/image-compression';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import logger from "@/lib/logger";
import { baptismsCollection, storage } from '@/lib/collections';
import { Baptism } from '@/lib/types';
import { format } from 'date-fns';
import { getDateFnsLocale } from "@/lib/i18n-date";
import { formatDateForInput } from '@/lib/utils/date';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Camera, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function EditBaptismPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();

  const sourceLabels: Record<string, string> = {
    'Automático': t('reports.source.auto'),
    'Manual': t('reports.source.manual'),
    'Nuevo Converso': t('reports.source.newConvert'),
    'Futuro Miembro': t('reports.source.futureMember'),
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [baptism, setBaptism] = useState<Baptism | null>(null);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [baptismPhotoFiles, setBaptismPhotoFiles] = useState<File[]>([]);
  const [uploadingBaptismPhotos, setUploadingBaptismPhotos] = useState(false);

  useEffect(() => {
    const idParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null;
    if (!idParam) {
      setLoading(false);
      toast({ title: t('common.error'), description: t('reports.editBaptism.idMissing'), variant: 'destructive' });
      router.push('/reports');
      return;
    }
    const fetchBaptism = async () => {
      try {
        const docRef = doc(baptismsCollection, idParam);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as Baptism;
          setBaptism(data);
          setDate(data.date?.toDate());
        } else {
          toast({
            title: t('common.error'),
            description: t('reports.editBaptism.notFound'),
            variant: 'destructive',
          });
          router.push('/reports');
        }
      } catch (error) {
        console.error('Error fetching baptism:', error);
        toast({
          title: t('common.error'),
          description: t('reports.editBaptism.loadError'),
          variant: 'destructive',
        });
        router.push('/reports');
      } finally {
        setLoading(false);
      }
    };

    fetchBaptism();
  }, [router, toast]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBaptism(prev => (prev ? { ...prev, [name]: value } : null));
  };

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      setDate(selectedDate);
      setBaptism(prev => (prev ? { ...prev, date: Timestamp.fromDate(selectedDate) } : null));
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPhotoFile(e.target.files[0]);
    }
  };

  const handleBaptismPhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setBaptismPhotoFiles(Array.from(e.target.files));
    }
  };

  const uploadPhoto = async (file: File, category: string): Promise<string> => {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(t('reports.editBaptism.fileTooLarge', { name: file.name }));
    }
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error(t('reports.editBaptism.fileInvalid', { name: file.name }));
    }
    if (!user?.uid) {
      throw new Error(t('reports.editBaptism.loginRequiredUpload'));
    }

    const optimized = await compressGalleryImage(file);
    const { userScopedStoragePath } = await import('@/lib/storage-paths');
    const path = userScopedStoragePath(user.uid, category, `${uuidv4()}_${optimized.name}`);
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, optimized, { contentType: optimized.type });
    return getDownloadURL(storageRef);
  };

  const handleUploadPhoto = async () => {
    if (!photoFile || !baptism) return;
    if (!user) {
      toast({ title: t('common.error'), description: t('reports.editBaptism.loginRequiredUpload'), variant: 'destructive' });
      return;
    }

    try {
      setUploading(true);
      const photoURL = await uploadPhoto(photoFile, 'baptisms/profile');

      // Delete old photo if exists
      if (baptism.photoURL) {
        try {
          const oldPhotoRef = ref(storage, baptism.photoURL);
          await deleteObject(oldPhotoRef);
        } catch (error) {
          console.warn('Could not delete old photo:', error);
        }
      }

      setBaptism(prev => (prev ? { ...prev, photoURL } : null));
      setPhotoFile(null);

      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('reports.editBaptism.profilePhotoUpdated'),
      });
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('reports.editBaptism.profilePhotoError'),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUploadBaptismPhotos = async () => {
    if (baptismPhotoFiles.length === 0 || !baptism) return;
    if (!user) {
      toast({ title: t('common.error'), description: t('reports.editBaptism.loginRequiredUpload'), variant: 'destructive' });
      return;
    }

    try {
      setUploadingBaptismPhotos(true);
      const uploadPromises = baptismPhotoFiles.map(file =>
        uploadPhoto(file, 'baptisms/photos')
      );

      const newPhotoURLs = await Promise.all(uploadPromises);
      const updatedBaptismPhotos = [...(baptism.baptismPhotos || []), ...newPhotoURLs];

      setBaptism(prev => (prev ? { ...prev, baptismPhotos: updatedBaptismPhotos } : null));
      setBaptismPhotoFiles([]);

      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('reports.editBaptism.baptismPhotosUploaded'),
      });
    } catch (error) {
      console.error('Error uploading baptism photos:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('reports.editBaptism.baptismPhotosError'),
        variant: 'destructive',
      });
    } finally {
      setUploadingBaptismPhotos(false);
    }
  };

  const handleDeleteBaptismPhoto = async (photoUrl: string) => {
    if (!baptism) return;
    
    try {
      // Remove from storage
      const photoRef = ref(storage, photoUrl);
      await deleteObject(photoRef);
      
      // Update state
      const updatedPhotos = baptism.baptismPhotos?.filter(photo => photo !== photoUrl) || [];
      setBaptism(prev => (prev ? { ...prev, baptismPhotos: updatedPhotos } : null));
      
      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('reports.editBaptism.photoDeleted'),
      });
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        title: t('common.error'),
        description: t('reports.editBaptism.photoDeleteError'),
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baptism) return;
    if (!user) {
      toast({ title: t('common.error'), description: t('reports.editBaptism.loginRequiredSave'), variant: 'destructive' });
      return;
    }
    
    try {
      setSaving(true);
      const docRef = doc(baptismsCollection, baptism.id);
      // Prepare updated photo fields
      let nextPhotoURL = baptism.photoURL || '';
      let nextBaptismPhotos: string[] = baptism.baptismPhotos || [];

      // If there is a new profile photo selected, upload it first
      let oldProfileToDelete: string | null = null;
      if (photoFile) {
        const uploaded = await uploadPhoto(photoFile, 'baptisms/profile');
        oldProfileToDelete = baptism.photoURL || null;
        nextPhotoURL = uploaded;
      }

      // If there are new baptism photos selected, upload and append
      if (baptismPhotoFiles.length > 0) {
        const uploadedList = await Promise.all(
          baptismPhotoFiles.map(file => uploadPhoto(file, 'baptisms/photos'))
        );
        nextBaptismPhotos = [...nextBaptismPhotos, ...uploadedList];
      }

      await updateDoc(docRef, {
        name: baptism.name,
        date: baptism.date,
        observation: baptism.observation || '',
        photoURL: nextPhotoURL,
        baptismPhotos: nextBaptismPhotos,
      });

      // After saving, delete old profile photo if replaced
      if (oldProfileToDelete) {
        try {
          await deleteObject(ref(storage, oldProfileToDelete));
        } catch (error) {
          logger.warn({ error, message: 'Could not delete old profile photo' });
        }
      }

      // Clear transient selections
      setPhotoFile(null);
      setBaptismPhotoFiles([]);
      
      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('reports.editBaptism.recordUpdated'),
      });

      router.push('/reports');
    } catch (error) {
      console.error('Error updating baptism:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('reports.editBaptism.recordUpdateError'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!baptism) return;
    
    try {
      setDeleting(true);
      // Delete photos from storage first
      const deletePromises: Promise<void>[] = [];
      
      if (baptism.photoURL) {
        deletePromises.push(deleteObject(ref(storage, baptism.photoURL)));
      }
      
      if (baptism.baptismPhotos) {
        baptism.baptismPhotos.forEach(photoUrl => {
          deletePromises.push(deleteObject(ref(storage, photoUrl)));
        });
      }
      
      await Promise.all(deletePromises);
      
      // Delete the document
      await deleteDoc(doc(baptismsCollection, baptism.id));
      
      toast({
        title: t('settings.toast.profileUpdatedTitle'),
        description: t('reports.editBaptism.recordDeleted'),
      });

      router.push('/reports');
    } catch (error) {
      console.error('Error deleting baptism:', error);
      toast({
        title: t('common.error'),
        description: t('reports.editBaptism.recordDeleteError'),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">{t('reports.editBaptism.loading')}</h1>
      </div>
    );
  }

  if (!baptism) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">{t('reports.editBaptism.recordNotFound')}</h1>
        <p>{t('reports.editBaptism.recordNotFoundDesc')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{t('reports.editBaptism.title')}</h1>
        <Button
          variant="outline"
          onClick={() => router.push('/reports')}
        >
          {t('reports.editBaptism.backToReports')}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            <div>
              <Label htmlFor="name">{t('reports.editBaptism.fullNameLabel')}</Label>
              <Input
                id="name"
                name="name"
                value={baptism.name || ''}
                onChange={handleInputChange}
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label>{t('reports.editBaptism.dateLabel')}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal mt-1",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: getDateFnsLocale() }) : <span>{t('reports.editBaptism.selectDate')}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={handleDateSelect}
                    autoFocus
                    locale={getDateFnsLocale()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>{t('reports.editBaptism.sourceLabel')}</Label>
              <div className="mt-1 p-2 border rounded-md bg-muted/50">
                {sourceLabels[baptism.source] || baptism.source}
              </div>
            </div>

            <div>
              <Label htmlFor="observation">{t('reports.editBaptism.observationsLabel')}</Label>
              <Textarea
                id="observation"
                name="observation"
                value={baptism.observation || ''}
                onChange={handleInputChange}
                rows={4}
                className="mt-1"
              />
            </div>
          </div>

          {/* Right Column - Photo Upload */}
          <div className="space-y-6">
            <div>
              <Label>{t('reports.editBaptism.profilePhotoLabel')}</Label>
              <div className="mt-1 flex items-center space-x-4">
                <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-muted-foreground/25 flex items-center justify-center">
                  {baptism.photoURL ? (
                    <>
                      <Image
                        src={baptism.photoURL}
                        alt={t('reports.editBaptism.photoAlt', { name: baptism.name })}
                        fill
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setBaptism(prev => (prev ? { ...prev, photoURL: '' } : null))}
                        className="absolute top-0 right-0 bg-destructive text-white rounded-full p-1 -m-2 hover:bg-destructive/90"
                        title={t('reports.editBaptism.removeProfilePhoto')}
                        aria-label={t('reports.editBaptism.removeProfilePhoto')}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  ) : photoFile ? (
                    <Image
                      src={URL.createObjectURL(photoFile)}
                        alt={t('reports.editBaptism.previewAlt')}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <Camera className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <Input
                    id="photo"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('photo')?.click()}
                      className="w-full"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {photoFile ? t('reports.editBaptism.changePhoto') : t('reports.editBaptism.selectPhoto')}
                    </Button>
                    {photoFile && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleUploadPhoto}
                        disabled={uploading}
                        className="w-full"
                      >
                        {uploading ? t('reports.uploading') : t('reports.editBaptism.savePhoto')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label>{t('reports.editBaptism.baptismPhotosLabel')}</Label>
              <div className="mt-2">
                <Input
                  id="baptism-photos"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleBaptismPhotosChange}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('baptism-photos')?.click()}
                  className="w-full mb-4"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {t('reports.editBaptism.selectBaptismPhotos')}
                </Button>

                {baptismPhotoFiles.length > 0 && (
                  <Button
                    type="button"
                    onClick={handleUploadBaptismPhotos}
                    disabled={uploadingBaptismPhotos}
                    className="w-full mb-4"
                  >
                    {uploadingBaptismPhotos ? t('reports.uploading') : t('reports.editBaptism.uploadPhotos', { count: baptismPhotoFiles.length })}
                  </Button>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {baptism.baptismPhotos?.map((photoUrl, index) => (
                    <div key={index} className="relative group">
                      <div className="relative w-full h-32 rounded-md overflow-hidden">
                        <Image
                          src={photoUrl}
                          alt={t('reports.editBaptism.baptismPhotoAlt', { index: index + 1 })}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteBaptismPhoto(photoUrl)}
                        className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t('reports.editBaptism.removeBaptismPhoto')}
                        aria-label={t('reports.editBaptism.removeBaptismPhotoAlt', { index: index + 1 })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-6 border-t">
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? t('reports.deleting') : t('reports.editBaptism.deleteRecord')}
          </Button>
          
          <div className="space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/reports')}
              disabled={saving}
            >
              {t('reports.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('reports.saving') : t('reports.editBaptism.saveChanges')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
