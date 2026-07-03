'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { doc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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
import { es } from 'date-fns/locale';
import { formatDateForInput } from '@/lib/utils/date';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Camera, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function EditBaptismPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
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
      toast({ title: 'Error', description: 'ID de bautismo no proporcionado.', variant: 'destructive' });
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
            title: 'Error',
            description: 'No se encontró el registro de bautismo.',
            variant: 'destructive',
          });
          router.push('/reports');
        }
      } catch (error) {
        console.error('Error fetching baptism:', error);
        toast({
          title: 'Error',
          description: 'No se pudo cargar el registro de bautismo.',
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

  const uploadPhoto = async (file: File, path: string): Promise<string> => {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`El archivo ${file.name} supera los 20MB.`);
    }
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error(`El archivo ${file.name} no es una imagen válida.`);
    }

    const storageRef = ref(storage, `${path}/${uuidv4()}_${file.name}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  };

  const handleUploadPhoto = async () => {
    if (!photoFile || !baptism) return;
    if (!user) {
      toast({ title: 'Error', description: 'Debes iniciar sesión para subir imágenes.', variant: 'destructive' });
      return;
    }
    
    try {
      setUploading(true);
      const photoURL = await uploadPhoto(photoFile, `baptisms/${baptism.id}/profile`);
      
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
        title: 'Éxito',
        description: 'Foto de perfil actualizada correctamente.',
      });
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo subir la foto de perfil.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUploadBaptismPhotos = async () => {
    if (baptismPhotoFiles.length === 0 || !baptism) return;
    if (!user) {
      toast({ title: 'Error', description: 'Debes iniciar sesión para subir imágenes.', variant: 'destructive' });
      return;
    }
    
    try {
      setUploadingBaptismPhotos(true);
      const uploadPromises = baptismPhotoFiles.map(file => 
        uploadPhoto(file, `baptisms/${baptism.id}/baptism`)
      );
      
      const newPhotoURLs = await Promise.all(uploadPromises);
      const updatedBaptismPhotos = [...(baptism.baptismPhotos || []), ...newPhotoURLs];
      
      setBaptism(prev => (prev ? { ...prev, baptismPhotos: updatedBaptismPhotos } : null));
      setBaptismPhotoFiles([]);
      
      toast({
        title: 'Éxito',
        description: 'Fotos del bautismo subidas correctamente.',
      });
    } catch (error) {
      console.error('Error uploading baptism photos:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudieron subir las fotos del bautismo.',
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
        title: 'Éxito',
        description: 'Foto eliminada correctamente.',
      });
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la foto.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baptism) return;
    if (!user) {
      toast({ title: 'Error', description: 'Debes iniciar sesión para guardar cambios.', variant: 'destructive' });
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
        const uploaded = await uploadPhoto(photoFile, `baptisms/${baptism.id}/profile`);
        oldProfileToDelete = baptism.photoURL || null;
        nextPhotoURL = uploaded;
      }

      // If there are new baptism photos selected, upload and append
      if (baptismPhotoFiles.length > 0) {
        const uploadedList = await Promise.all(
          baptismPhotoFiles.map(file => uploadPhoto(file, `baptisms/${baptism.id}/baptism`))
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
        title: 'Éxito',
        description: 'Registro de bautismo actualizado correctamente.',
      });
      
      router.push('/reports');
    } catch (error) {
      console.error('Error updating baptism:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'No se pudo actualizar el registro de bautismo.',
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
        title: 'Éxito',
        description: 'Registro de bautismo eliminado correctamente.',
      });
      
      router.push('/reports');
    } catch (error) {
      console.error('Error deleting baptism:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el registro de bautismo.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">Cargando registro de bautismo...</h1>
      </div>
    );
  }

  if (!baptism) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">Registro no encontrado</h1>
        <p>El registro de bautismo solicitado no pudo ser cargado.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Editar Bautismo</h1>
        <Button 
          variant="outline" 
          onClick={() => router.push('/reports')}
        >
          Volver a Reportes
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            <div>
              <Label htmlFor="name">Nombre Completo</Label>
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
              <Label>Fecha de Bautismo</Label>
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
                    {date ? format(date, "PPP", { locale: es }) : <span>Seleccione una fecha</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={handleDateSelect}
                    autoFocus
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Origen</Label>
              <div className="mt-1 p-2 border rounded-md bg-muted/50">
                {baptism.source}
              </div>
            </div>

            <div>
              <Label htmlFor="observation">Observaciones</Label>
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
              <Label>Foto de Perfil</Label>
              <div className="mt-1 flex items-center space-x-4">
                <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-muted-foreground/25 flex items-center justify-center">
                  {baptism.photoURL ? (
                    <>
                      <Image
                        src={baptism.photoURL}
                        alt={`${baptism.name} foto`}
                        fill
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setBaptism(prev => (prev ? { ...prev, photoURL: '' } : null))}
                        className="absolute top-0 right-0 bg-destructive text-white rounded-full p-1 -m-2 hover:bg-destructive/90"
                        title="Eliminar foto de perfil"
                        aria-label="Eliminar foto de perfil"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  ) : photoFile ? (
                    <Image
                      src={URL.createObjectURL(photoFile)}
                      alt="Vista previa"
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
                      {photoFile ? 'Cambiar foto' : 'Seleccionar foto'}
                    </Button>
                    {photoFile && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleUploadPhoto}
                        disabled={uploading}
                        className="w-full"
                      >
                        {uploading ? 'Subiendo...' : 'Guardar foto'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label>Fotos del Bautismo</Label>
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
                  Seleccionar fotos del bautismo
                </Button>

                {baptismPhotoFiles.length > 0 && (
                  <Button
                    type="button"
                    onClick={handleUploadBaptismPhotos}
                    disabled={uploadingBaptismPhotos}
                    className="w-full mb-4"
                  >
                    {uploadingBaptismPhotos ? 'Subiendo...' : `Subir ${baptismPhotoFiles.length} fotos`}
                  </Button>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {baptism.baptismPhotos?.map((photoUrl, index) => (
                    <div key={index} className="relative group">
                      <div className="relative w-full h-32 rounded-md overflow-hidden">
                        <Image
                          src={photoUrl}
                          alt={`Bautismo ${index + 1}`}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteBaptismPhoto(photoUrl)}
                        className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Eliminar foto de bautismo"
                        aria-label={`Eliminar foto de bautismo ${index + 1}`}
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
            {deleting ? 'Eliminando...' : 'Eliminar Registro'}
          </Button>
          
          <div className="space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/reports')}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
