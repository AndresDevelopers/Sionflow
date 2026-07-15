'use client';

/**
 * Missionary images panel — module path v4 (production-hardened).
 *
 * Upload: JSON → POST /api/storage/upload (Admin/GCS)
 * AI:     JSON → POST /api/analyze-image (Gemini)
 * Never use Next.js Server Actions for either path.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { OfflineImage } from '@/components/offline-image';
import { cacheImages } from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Trash2 } from 'lucide-react';
import {
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { compressGalleryImage, compressImageForUpload } from '@/lib/image-compression';
import { uploadImageViaServer } from '@/lib/upload-image-client';
import { missionaryImagesCollection } from '@/lib/collections';
import logger from '@/lib/logger';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import type { MissionaryImage } from '@/lib/types';

export const MISSIONARY_IMAGES_TAB_BUILD = 'http-upload-json-v4-2026-07-10';

type PendingStatus = 'uploading' | 'processing' | 'ready' | 'error';

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
  url: string | null;
  description: string;
  status: PendingStatus;
  progress: number;
  errorMessage?: string;
};

async function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen para la IA'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageDescriptionHttp(
  imageDataUrl: string,
  idToken: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch('/api/analyze-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
      body: JSON.stringify({ imageData: imageDataUrl }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      description?: string;
      error?: string;
    };

    if (!response.ok || !payload.description) {
      throw new Error(payload.error || `analyze-image HTTP failed (${response.status})`);
    }
    return payload.description;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('La descripción automática agotó el tiempo (60s).');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeStorageSegment(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/_+/g, '_');
  return base.slice(0, 80) || 'image.jpg';
}

/** Mobile cameras sometimes send empty MIME; accept by extension too. */
function isProbablyImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  if (!file.type) {
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i.test(file.name || '');
  }
  return false;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error ?? 'Error desconocido');
}

export function MissionaryImagesTab({
  images,
  loading,
  onRefresh,
  barrioOrg,
}: {
  images: MissionaryImage[];
  loading: boolean;
  onRefresh: () => void;
  barrioOrg: string;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<PendingImage[]>([]);

  // Cache saved missionary images for offline viewing
  useEffect(() => {
    if (!isBrowserOnline() || images.length === 0) return;
    const urls = images.map((img) => img.imageUrl).filter(Boolean);
    void cacheImages(urls, { concurrency: 3, limit: 100 });
  }, [images]);

  const updatePending = (id: string, patch: Partial<PendingImage>) => {
    setUploadedFiles((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removePending = (id: string) => {
    setUploadedFiles((prev) => {
      const toRemove = prev.find((i) => i.id === id);
      if (toRemove?.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList?.length) return;

    // FileList is live — snapshot before clearing.
    const selectedFiles = Array.from(fileList);
    event.target.value = '';

    if (authLoading) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.authLoading'),
        variant: 'destructive',
      });
      return;
    }

    if (!user && !firebaseUser) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.loginRequired'),
        variant: 'destructive',
      });
      return;
    }

    const imageFiles = selectedFiles.filter(isProbablyImage);
    if (imageFiles.length === 0) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.invalidFileType'),
        variant: 'destructive',
      });
      return;
    }

    if (imageFiles.length < selectedFiles.length) {
      toast({
        title: t('missionaryWork.images.title'),
        description: t('missionaryWork.images.someFilesSkipped'),
      });
    }

    setBusy(true);

    for (const file of imageFiles) {
      const safeName = sanitizeStorageSegment(file.name || `photo-${Date.now()}.jpg`);
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`;
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
          progress: 5,
        },
      ]);

      try {
        updatePending(id, { progress: 15, status: 'uploading' });

        // Normalize empty MIME from mobile pickers before compression.
        const normalizedFile =
          file.type && file.type.startsWith('image/')
            ? file
            : new File([file], safeName, {
                type: 'image/jpeg',
                lastModified: file.lastModified || Date.now(),
              });

        const optimized = await compressGalleryImage(normalizedFile);
        updatePending(id, { progress: 40 });

        // Always re-encode to a proper data URL for the server JSON API.
        const uploadBlob = await compressImageForUpload(optimized, {
          maxDimension: 1600,
          quality: 0.8,
          maxBytes: 700 * 1024,
          preferWebp: false,
          force: true,
        });
        const dataUrl = await fileToDataUrl(uploadBlob);
        if (!dataUrl.startsWith('data:image/')) {
          throw new Error('No se pudo preparar la imagen (data URL inválido).');
        }

        updatePending(id, { progress: 55 });

        const uploaded = await uploadImageViaServer(uploadBlob, {
          folder: 'missionary-images',
          fileName: safeName.replace(/\.[^.]+$/, '') + '.jpg',
          dataUrl,
        });

        updatePending(id, {
          url: uploaded.url,
          status: 'processing',
          progress: 100,
        });

        // AI is best-effort; upload already succeeded.
        try {
          const idToken = await firebaseUser?.getIdToken().catch(() => null);
          if (!idToken) {
            throw new Error('No autenticado para analizar la imagen');
          }
          const forAi = await compressImageForUpload(uploadBlob, {
            maxDimension: 1024,
            quality: 0.72,
            maxBytes: 350 * 1024,
            preferWebp: false,
            force: true,
          });
          const base64 = await fileToDataUrl(forAi);
          const description = await fetchImageDescriptionHttp(base64, idToken);
          updatePending(id, { description, status: 'ready' });
        } catch (error: unknown) {
          console.error(
            `[MissionaryImagesTab ${MISSIONARY_IMAGES_TAB_BUILD}] analyze-image failed:`,
            error
          );
          const msg = errorMessageOf(error);
          const missingKey =
            msg.includes('API key') ||
            msg.includes('GEMINI_API_KEY') ||
            msg.includes('GOOGLE_GENERATIVE_AI_API_KEY');
          toast({
            title: t('common.error'),
            description: missingKey
              ? t('missionaryWork.images.apiKeyMissing')
              : `${t('missionaryWork.images.autoDescError')} (${msg})`,
            variant: 'destructive',
          });
          updatePending(id, { description: '', status: 'ready' });
        }
      } catch (error) {
        const msg = errorMessageOf(error);
        console.error(
          `[MissionaryImagesTab ${MISSIONARY_IMAGES_TAB_BUILD}] upload error:`,
          error
        );
        logger.error({ error, message: 'Error uploading missionary image', detail: msg });
        toast({
          title: t('common.error'),
          description: msg || t('missionaryWork.images.uploadError'),
          variant: 'destructive',
        });
        updatePending(id, {
          status: 'error',
          progress: 0,
          errorMessage: msg || t('missionaryWork.images.uploadError'),
        });
      }
    }

    setBusy(false);
  };

  const handleSave = async (item: PendingImage) => {
    if (item.status !== 'ready' || !item.url) return;
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    if (!barrioOrg) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.missingBarrio'),
        variant: 'destructive',
      });
      return;
    }

    startTransition(async () => {
      try {
        const { requireBarrioOrg } = await import('@/lib/tenant-scope');
        await addDoc(missionaryImagesCollection, {
          imageUrl: item.url,
          description: item.description,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || firebaseUser?.uid || 'unknown',
          barrioOrg: requireBarrioOrg(barrioOrg),
        });
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.saved'),
        });
        removePending(item.id);
        onRefresh();
      } catch (error) {
        const msg = errorMessageOf(error);
        logger.error({ error, message: 'Error saving missionary image' });
        toast({
          title: t('common.error'),
          description: msg || t('missionaryWork.images.saveError'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleDeletePending = (id: string) => {
    removePending(id);
  };

  const handleEdit = async (id: string, newDescription: string) => {
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    startTransition(async () => {
      try {
        await updateDoc(doc(missionaryImagesCollection, id), {
          description: newDescription,
        });
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.descriptionUpdated'),
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error updating image description' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.descriptionUpdateError'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!missionaryImagesCollection) {
      toast({
        title: t('common.error'),
        description: t('missionaryWork.images.collectionUnavailable'),
        variant: 'destructive',
      });
      return;
    }
    startTransition(async () => {
      try {
        await deleteDoc(doc(missionaryImagesCollection, id));
        toast({
          title: t('missionaryWork.success'),
          description: t('missionaryWork.images.deleted'),
        });
        onRefresh();
      } catch (error) {
        logger.error({ error, message: 'Error deleting missionary image' });
        toast({
          title: t('common.error'),
          description: t('missionaryWork.images.deleteError'),
          variant: 'destructive',
        });
      }
    });
  };

  const isWorking =
    busy ||
    uploadedFiles.some((f) => f.status === 'uploading' || f.status === 'processing');

  return (
    <Card data-missionary-images-build={MISSIONARY_IMAGES_TAB_BUILD}>
      <CardHeader>
        <div className="flex justify-between items-start gap-3">
          <div>
            <CardTitle>{t('missionaryWork.images.title')}</CardTitle>
            <CardDescription>{t('missionaryWork.images.description')}</CardDescription>
          </div>
          <div>
            <Input
              ref={fileInputRef}
              type="file"
              accept="image/*,image/heic,image/heif,.heic,.heif"
              multiple
              onChange={(event) => void handleFileSelect(event)}
              className="hidden"
              id="missionary-image-upload-v4"
            />
            <Button
              size="sm"
              type="button"
              disabled={isWorking || authLoading}
              onClick={() => {
                if (authLoading) {
                  toast({
                    title: t('common.error'),
                    description: t('missionaryWork.images.authLoading'),
                    variant: 'destructive',
                  });
                  return;
                }
                if (!user && !firebaseUser) {
                  toast({
                    title: t('common.error'),
                    description: t('missionaryWork.images.loginRequired'),
                    variant: 'destructive',
                  });
                  return;
                }
                fileInputRef.current?.click();
              }}
            >
              {isWorking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadedFiles.some((f) => f.status === 'processing')
                    ? t('missionaryWork.images.processing')
                    : t('missionaryWork.images.uploading')}
                </>
              ) : (
                <>
                  <PlusCircle className="mr-2" />
                  {t('missionaryWork.images.uploadButton')}
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-6">
            {uploadedFiles.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  {t('missionaryWork.images.pendingTitle')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {uploadedFiles.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <OfflineImage
                          src={item.url ?? item.previewUrl}
                          alt="Uploaded"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                          style={{ width: '100%', height: '8rem' }}
                        />
                        {item.status === 'uploading' && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('missionaryWork.images.uploadingImageProgress', {
                              progress: item.progress,
                            })}{' '}
                            ({item.progress}%)
                          </div>
                        )}
                        {item.status === 'processing' && (
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t('missionaryWork.images.processingText')}
                          </div>
                        )}
                        {item.status === 'error' && (
                          <p className="mb-2 text-xs text-destructive">
                            {item.errorMessage || t('missionaryWork.images.uploadError')}
                          </p>
                        )}
                        <Textarea
                          value={item.description}
                          onChange={(e) =>
                            updatePending(item.id, { description: e.target.value })
                          }
                          placeholder={
                            item.status === 'uploading'
                              ? t('missionaryWork.images.uploadingImage')
                              : item.status === 'processing'
                                ? t('missionaryWork.images.processingText')
                                : t('missionaryWork.images.descriptionPlaceholder')
                          }
                          disabled={item.status !== 'ready'}
                          className="mb-2"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleSave(item)}
                            disabled={item.status !== 'ready' || !item.url || isPending}
                          >
                            {t('missionaryWork.images.saveButton')}
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

            {images.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  {t('missionaryWork.images.savedTitle')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {images.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        <OfflineImage
                          src={item.imageUrl}
                          alt="Missionary"
                          width={480}
                          height={128}
                          className="w-full h-32 object-cover rounded mb-2"
                          style={{ width: '100%', height: '8rem' }}
                        />
                        <Textarea
                          value={item.description}
                          onChange={(e) => void handleEdit(item.id, e.target.value)}
                          className="mb-2"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(item.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('missionaryWork.images.deleteButton')}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {uploadedFiles.length === 0 && images.length === 0 && (
              <p className="text-sm text-center py-4 text-muted-foreground">
                {t('missionaryWork.images.noImages')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
