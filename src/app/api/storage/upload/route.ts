import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminBucket } from '@/lib/firebase-admin';
import logger from '@/lib/logger';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getErrorStatus, requireUid } from '@/lib/api-auth';
import { userScopedStoragePath } from '@/lib/storage-paths';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Room for compressed gallery images (base64 JSON or multipart). */
const MAX_BYTES = 8 * 1024 * 1024;

const folderSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9/_-]+$/, 'Invalid folder')
  .default('missionary-images');

const jsonBodySchema = z.object({
  imageData: z
    .string()
    .min(32)
    .max(12_000_000)
    .regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, 'Invalid image data URL'),
  folder: folderSchema.optional(),
  fileName: z.string().min(1).max(120).optional(),
});

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/_+/g, '_');
  return base.slice(0, 80) || 'image.jpg';
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('imageData debe ser un data URL base64');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

/**
 * Server-side image upload via Firebase Admin → Google Cloud Storage.
 *
 * Accepts:
 *  - JSON: { imageData: "data:image/...;base64,...", folder?, fileName? }  (preferred)
 *  - multipart FormData: file + folder
 *
 * JSON avoids `instanceof File` failures on some Node/Vercel runtimes where
 * multipart File objects are Blobs from another realm (silent 400 in production).
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, 'upload');
  if (limited) return limited;

  try {
    const uid = await requireUid(request);
    const contentType = request.headers.get('content-type') || '';

    let buffer: Buffer;
    let mimeType: string;
    let folder = 'missionary-images';
    let fileName = 'image.jpg';

    if (contentType.includes('application/json')) {
      const raw = await request.json().catch(() => null);
      const parsed = jsonBodySchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error:
              'Solicitud JSON inválida. Se espera imageData como data URL (data:image/...;base64,...).',
            details: parsed.error.flatten(),
          },
          { status: 400 }
        );
      }
      const decoded = parseDataUrl(parsed.data.imageData);
      buffer = decoded.buffer;
      mimeType = decoded.mimeType;
      folder = parsed.data.folder || folder;
      fileName = sanitizeFileName(parsed.data.fileName || 'image.jpg');
    } else {
      // multipart/form-data (and similar)
      const form = await request.formData();
      const entry = form.get('file');
      const folderRaw = form.get('folder');
      const nameRaw = form.get('fileName');

      if (typeof folderRaw === 'string' && folderRaw.length > 0) {
        const f = folderSchema.safeParse(folderRaw);
        if (!f.success) {
          return NextResponse.json({ error: 'Carpeta de destino inválida.' }, { status: 400 });
        }
        folder = f.data;
      }

      // Do NOT use `instanceof File` — fails on some serverless runtimes.
      if (!entry || typeof entry === 'string') {
        return NextResponse.json(
          { error: 'Falta el archivo (campo file) o el body JSON imageData.' },
          { status: 400 }
        );
      }

      const blob = entry as Blob;
      const maybeName =
        typeof nameRaw === 'string' && nameRaw
          ? nameRaw
          : 'name' in entry && typeof (entry as { name?: string }).name === 'string'
            ? (entry as { name: string }).name
            : 'image.jpg';

      mimeType =
        (blob.type && blob.type.startsWith('image/') ? blob.type : '') || 'image/jpeg';
      if (!mimeType.startsWith('image/')) {
        return NextResponse.json({ error: 'Solo se permiten imágenes.' }, { status: 400 });
      }

      buffer = Buffer.from(await blob.arrayBuffer());
      fileName = sanitizeFileName(maybeName);
    }

    if (buffer.length <= 0 || buffer.length > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `La imagen debe pesar entre 1 byte y ${Math.round(MAX_BYTES / (1024 * 1024))} MB (recibido: ${buffer.length} bytes).`,
        },
        { status: 400 }
      );
    }

    if (!mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Solo se permiten imágenes.' }, { status: 400 });
    }

    const extFromMime = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
    if (!/\.[a-z0-9]+$/i.test(fileName)) {
      fileName = `${fileName}.${extFromMime === 'jpeg' ? 'jpg' : extFromMime}`;
    }

    // Scope under users/{uid}/… so Storage rules isolate writes by owner (Admin still sets token)
    const objectPath = userScopedStoragePath(uid, folder, `${randomUUID().slice(0, 8)}-${fileName}`);
    const downloadToken = randomUUID();

    let bucket;
    try {
      bucket = getAdminBucket();
    } catch (error) {
      logger.error({ error, message: 'Storage bucket not configured' });
      return NextResponse.json(
        {
          error:
            'Almacenamiento no configurado en el servidor (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET / service account).',
        },
        { status: 503 }
      );
    }

    const gcsFile = bucket.file(objectPath);

    await gcsFile.save(buffer, {
      resumable: false,
      contentType: mimeType,
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000',
        metadata: {
          // Permanent Firebase download token (does not expire like V4 signed URLs).
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: uid,
        },
      },
    });

    // Permanent media URL via download token.
    // Do NOT use V4 signed URLs with multi-year expiry — GCS caps V4 signatures
    // at 7 days (604800s) and throws: "Max allowed expiration is seven days".
    const firebaseUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;

    logger.info({
      message: 'Image uploaded via /api/storage/upload',
      uid,
      path: objectPath,
      size: buffer.length,
      mimeType,
    });

    return NextResponse.json({
      url: firebaseUrl,
      firebaseUrl,
      path: objectPath,
      contentType: mimeType,
      size: buffer.length,
    });
  } catch (error) {
    const status = getErrorStatus(error, 502);
    const message = error instanceof Error ? error.message : 'Error al subir la imagen';
    logger.error({ error, message: 'Error en /api/storage/upload', status });
    return NextResponse.json({ error: message }, { status });
  }
}
