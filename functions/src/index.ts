
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { getYear, startOfYear, endOfYear, format, addDays, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ModernImageModule from "./modules/modern-image-module";
import axios from "axios";
import { NotificationDispatcher } from "./modules/notification-dispatcher";
import * as webp from "webp-wasm";
import { PNG } from "pngjs";

admin.initializeApp();

const firestore = admin.firestore();
const storage = admin.storage();
const messaging = admin.messaging();
const notificationDispatcher = new NotificationDispatcher(
    firestore,
    messaging,
    functions.logger
);

// Ecuador timezone (no DST)
const ECUADOR_TZ = "America/Guayaquil";

interface Activity {
    id: string;
    title: string;
    date: admin.firestore.Timestamp;
    description: string;
    time?: string;
    imageUrls?: string[];
    additionalText?: string;
    location?: string;
    context?: string;
    learning?: string;
}

interface Baptism {
    id: string;
    name: string;
    date: admin.firestore.Timestamp;
    source: "Manual" | "Automático" | "Futuro Miembro" | "Nuevo Converso";
    photoURL?: string;
    baptismPhotos?: string[];
}

interface AnnualReportAnswers {
    p1?: string;
    p2?: string;
    p3?: string;
    p4?: string;
    p5?: string;
    p6?: string;
}

// Tipo unificado para actividades y servicios
interface ActivityOrService {
    id: string;
    title: string;
    date: admin.firestore.Timestamp;
    time?: string;
    description?: string;
    imageUrls?: string[];
    location?: string;
    context?: string;
    learning?: string;
    additionalText?: string;
}

// Tipo para servicios desde la base de datos
interface Service {
    id: string;
    title: string;
    date: admin.firestore.Timestamp;
    time?: string;
    description?: string;
    imageUrls?: string[];
    location?: string;
    context?: string;
    learning?: string;
    additionalText?: string;
    councilNotified?: boolean;
}

interface Birthday {
    id: string;
    name: string;
    birthDate: admin.firestore.Timestamp | Date | string | number | { seconds: number };
    memberId?: string;
}

interface MemberBasic {
    status?: string;
    firstName?: string;
    lastName?: string;
    birthDate?: admin.firestore.Timestamp | Date | string | number | { seconds: number };
}

function resolveDateValue(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
        const date = (value as { toDate: () => Date }).toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "object" && value && "seconds" in value) {
        const seconds = (value as { seconds?: unknown }).seconds;
        if (typeof seconds === "number") {
            const date = new Date(seconds * 1000);
            return Number.isNaN(date.getTime()) ? null : date;
        }
    }
    return null;
}

const getBirthdayStatusLabel = (status?: string): string | null => {
    if (!status) return null;
    const s = status.toLowerCase().trim();
    if (s === "inactive" || s === "inactivo") return "Inactivo";
    if (s === "less_active" || s === "menos_activo" || s.startsWith("menos")) return "Menos Activo";
    if (s === "active" || s === "activo") return "Activo";
    return null;
};

const normalizePersonName = (value: string): string =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

const buildBirthdayDedupKey = (name: string, memberId?: string): string => {
    const normalizedName = normalizePersonName(name);
    return memberId ? `member:${memberId}` : `name:${normalizedName}`;
};

interface Family {
    name: string;
    isUrgent: boolean;
    observation?: string;
}

interface Companionship {
    id: string;
    families: Family[];
}

interface ActivityDocImage {
    image: string;
    caption: string;
    title: string;
    date: string;
    order: number;
    description: string;
    location: string;
}

interface ActivityDocEntry {
    id: string;
    title: string;
    date: string;
    fullDate: string;
    time: string;
    description: string;
    additionalText: string;
    location: string;
    context: string;
    learning: string;
    hasImages: boolean;
    imageCount: number;
    primaryImage: ActivityDocImage | null;
    images: ActivityDocImage[];
    separator: string;
}

interface ActivityGalleryEntry {
    titulo: string;
    fecha: string;
    descripcion: string;
    cantidad: number;
    imagen_principal: ActivityDocImage | null;
    imagenes: ActivityDocImage[];
}

interface BaptismDocImage {
    image: string;
    caption: string;
    name: string;
    date: string;
    order: number;
}

interface BaptismDocEntry {
    id: string;
    nombre: string;
    fecha: string;
    fecha_corta: string;
    dia_semana: string;
    origen: string;
    mes: string;
    hasImages: boolean;
    imageCount: number;
    photoURL: string;
    images: BaptismDocImage[];
    separator: string;
}

interface BaptismGalleryEntry {
    nombre: string;
    fecha: string;
    origen: string;
    cantidad: number;
    foto_perfil: string;
    imagenes: BaptismDocImage[];
}

const MAX_DOC_IMAGE_WIDTH = 450;
const MAX_DOC_IMAGE_HEIGHT = 300;

type ImageModuleInstance = ModernImageModule;

const slugify = (value: string): string =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

const normalizeUrlKey = (value: string): string =>
    value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

const countNonEmptyUrls = (urls?: string[]): number =>
    Array.isArray(urls) ? urls.filter((url) => typeof url === "string" && url.trim().length > 0).length : 0;

const isWebpBuffer = (buffer: Buffer): boolean => {
    if (buffer.length < 12) return false;
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
};

const convertWebpToPngBuffer = async (buffer: Buffer): Promise<Buffer> => {
    const decoded = await webp.decode(buffer);
    const png = new PNG({ width: decoded.width, height: decoded.height });
    png.data = Buffer.from(decoded.data);
    return PNG.sync.write(png);
};

const normalizeImageForDocx = async (buffer: Buffer): Promise<Buffer> => {
    if (buffer.length === 0) return buffer;
    if (isWebpBuffer(buffer)) {
        try {
            return await convertWebpToPngBuffer(buffer);
        } catch (error) {
            functions.logger.error("Error converting WEBP to PNG for report", { error });
            return buffer;
        }
    }
    return buffer;
};

const pickPreferredBaptism = (
    existing: Baptism | undefined,
    candidate: Baptism,
    sourcePriority: Record<string, number>
): Baptism => {
    if (!existing) return candidate;

    const existingPhotos = countNonEmptyUrls(existing.baptismPhotos);
    const candidatePhotos = countNonEmptyUrls(candidate.baptismPhotos);

    if (candidatePhotos !== existingPhotos) {
        return candidatePhotos > existingPhotos ? candidate : existing;
    }

    const existingPriority = sourcePriority[existing.source] ?? Number.MAX_SAFE_INTEGER;
    const candidatePriority = sourcePriority[candidate.source] ?? Number.MAX_SAFE_INTEGER;

    if (candidatePriority !== existingPriority) {
        return candidatePriority < existingPriority ? candidate : existing;
    }

    return existing;
};

const createImageModuleFromUrls = async (urls: string[]): Promise<ImageModuleInstance> => {
    const buffers = await fetchImageBuffers(urls);

    return new ModernImageModule({
        centered: true,
        getImage: (tagValue: unknown) => {
            if (typeof tagValue !== "string" || !tagValue) {
                return Buffer.alloc(0);
            }
            return buffers.get(normalizeUrlKey(tagValue)) ?? Buffer.alloc(0);
        },
        getSize: () => {
            return [MAX_DOC_IMAGE_WIDTH, MAX_DOC_IMAGE_HEIGHT];
        },
    });
};

/**
 * Extrae la ruta del archivo de Storage desde una URL de Firebase Storage.
 * Soporta URLs con formato:
 * - https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?token=...
 * - gs://BUCKET/PATH
 */
const extractStorageLocationFromUrl = (url: string): { bucket: string | null; path: string } | null => {
    try {
        const normalizedUrl = normalizeUrlKey(url);

        if (normalizedUrl.startsWith("gs://")) {
            const parts = normalizedUrl.replace("gs://", "").split("/");
            const bucket = parts.shift() ?? null;
            const path = parts.join("/");
            if (!bucket || !path) return null;
            return { bucket, path };
        }

        // Formato: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/ENCODED_PATH?...
        if (url.includes("firebasestorage.googleapis.com")) {
            const match = normalizedUrl.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
            if (match) {
                const bucket = match[1] ?? null;
                const encodedPath = match[2];
                const decodedPath = decodeURIComponent(encodedPath!);
                if (!decodedPath) return null;
                functions.logger.debug("Extracted storage location", { bucket, encodedPath, decodedPath });
                return { bucket, path: decodedPath };
            }
        }

        try {
            const parsed = new URL(normalizedUrl);
            if (parsed.hostname === "storage.googleapis.com" || parsed.hostname === "storage.cloud.google.com") {
                const pathname = parsed.pathname.replace(/^\/+/, "");
                const [bucket, ...rest] = pathname.split("/");
                const path = rest.join("/");
                if (!bucket || !path) return null;
                return { bucket, path };
            }
        } catch {
            // ignore
        }

        return null;
    } catch (error) {
        functions.logger.error("Error extracting storage location", { url, error });
        return null;
    }
};

const fetchImageBuffers = async (urls: string[]): Promise<Map<string, Buffer>> => {
    if (urls.length === 0) {
        return new Map();
    }

    const entries = await Promise.all(urls.map(async (url) => {
        const normalizedUrl = normalizeUrlKey(url);
        try {
            // Intentar extraer la ruta del Storage desde la URL
            const location = extractStorageLocationFromUrl(normalizedUrl);
            
            if (location?.path) {
                // Descargar directamente usando Firebase Admin SDK (acceso privilegiado)
                const targetBucket = location.bucket ? storage.bucket(location.bucket) : storage.bucket();
                const file = targetBucket.file(location.path);
                const [exists] = await file.exists();
                
                if (exists) {
                    const [buffer] = await file.download();
                    const normalizedBuffer = await normalizeImageForDocx(buffer);
                    functions.logger.info("Image downloaded via Admin SDK", { storagePath: location.path });
                    return [normalizedUrl, normalizedBuffer] as const;
                } else {
                    functions.logger.warn("File not found in Storage", { storagePath: location.path, url: normalizedUrl });
                }
            }
            
            // Fallback: usar axios para URLs externas o si no se pudo extraer la ruta
            const response = await axios.get<ArrayBuffer>(normalizedUrl, {
                responseType: "arraybuffer",
                headers: {
                    Accept: "image/*",
                },
                timeout: 30000, // 30 segundos de timeout
            });
            functions.logger.info("Image downloaded via HTTP", { url: normalizedUrl });
            const buffer = Buffer.from(response.data);
            const normalizedBuffer = await normalizeImageForDocx(buffer);
            return [normalizedUrl, normalizedBuffer] as const;
        } catch (error) {
            functions.logger.error("Error downloading image for report", { url: normalizedUrl, error });
            return [normalizedUrl, Buffer.alloc(0)] as const;
        }
    }));

    return new Map(entries);
};

const prepareActivitiesDocData = async (items: ActivityOrService[]): Promise<{
    activitiesData: ActivityDocEntry[];
    imageModule: ImageModuleInstance;
    totalImages: number;
    galleries: ActivityGalleryEntry[];
    activitiesWithImages: number;
}> => {
    const uniqueImageUrls = new Set<string>();

    const activitiesData: ActivityDocEntry[] = items.map((activity) => {
        const activityDate = activity.date.toDate();
        const dateStr = format(activityDate, "dd/MM/yyyy", { locale: es });
        const fullDate = format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
        const timeStr = activity.time ? ` ${activity.time}` : "";

        let fullDescription = activity.description || "";
        if (activity.additionalText) {
            fullDescription += `\n\nTexto Adicional: ${activity.additionalText}`;
        }

        const images: ActivityDocImage[] = (activity.imageUrls ?? [])
            .filter((url): url is string => !!url)
            .map((url, index) => {
                uniqueImageUrls.add(url);
                return {
                    image: url,
                    caption: `${activity.title} - ${fullDate}`,
                    title: activity.title,
                    date: fullDate,
                    order: index + 1,
                    description: fullDescription,
                    location: activity.location || "",
                };
            });

        const primaryImage = images[0] ?? null;

        return {
            id: activity.id,
            title: activity.title,
            date: `${dateStr}${timeStr}`,
            fullDate,
            time: activity.time || "",
            description: fullDescription,
            additionalText: activity.additionalText || "",
            location: activity.location || "",
            context: activity.context || "",
            learning: activity.learning || "",
            hasImages: images.length > 0,
            imageCount: images.length,
            primaryImage,
            images,
            separator: "─────────────────────────────────────────────────────", // Separador visual
        };
    });

    const totalImages = activitiesData.reduce((sum, activity) => sum + activity.imageCount, 0);
    const galleries: ActivityGalleryEntry[] = activitiesData
        .filter((activity) => activity.hasImages)
        .map((activity) => ({
            titulo: activity.title,
            fecha: activity.fullDate,
            descripcion: activity.description,
            cantidad: activity.imageCount,
            imagen_principal: activity.primaryImage,
            imagenes: activity.images,
        }));

    const imageModule = await createImageModuleFromUrls(Array.from(uniqueImageUrls));

    return {
        activitiesData,
        imageModule,
        totalImages,
        galleries,
        activitiesWithImages: galleries.length,
    };
};

const prepareBaptismsDocData = async (baptisms: Baptism[]): Promise<{
    baptismsData: BaptismDocEntry[];
    totalBaptismImages: number;
    baptismGalleries: BaptismGalleryEntry[];
    baptismsWithImages: number;
}> => {
    functions.logger.info("prepareBaptismsDocData called", { 
        totalBaptisms: baptisms.length,
        sampleBaptism: baptisms[0] ? {
            name: baptisms[0].name,
            hasPhotoURL: !!baptisms[0].photoURL,
            photoURL: baptisms[0].photoURL,
            hasBaptismPhotos: !!baptisms[0].baptismPhotos,
            baptismPhotosLength: baptisms[0].baptismPhotos?.length || 0
        } : null
    });

    const baptismsData: BaptismDocEntry[] = baptisms.map((baptism) => {
        const baptismDate = baptism.date.toDate();
        const fullDate = format(baptismDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
        const shortDate = format(baptismDate, "dd/MM/yyyy", { locale: es });
        const dayOfWeek = format(baptismDate, "EEEE", { locale: es });
        const month = format(baptismDate, "MMMM", { locale: es });

        // Solo usar las fotos específicas del bautismo (baptismPhotos)
        // NO incluir la foto de perfil (photoURL) en el reporte
        const allImageUrls: string[] = [];
        
        // Agregar solo las fotos del bautismo
        if (baptism.baptismPhotos && baptism.baptismPhotos.length > 0) {
            functions.logger.info("Adding baptismPhotos for baptism", { 
                name: baptism.name, 
                count: baptism.baptismPhotos.length,
                photos: baptism.baptismPhotos
            });
            allImageUrls.push(...baptism.baptismPhotos.filter((url): url is string => !!url));
        }

        if (allImageUrls.length === 0 && baptism.photoURL && baptism.photoURL.trim()) {
            allImageUrls.push(baptism.photoURL.trim());
        }

        const images: BaptismDocImage[] = allImageUrls.map((url, index) => ({
            image: url,
            caption: `Bautismo de ${baptism.name} - ${fullDate}`,
            name: baptism.name,
            date: fullDate,
            order: index + 1,
        }));

        functions.logger.info("Processed baptism", {
            name: baptism.name,
            totalImages: images.length,
            hasImages: images.length > 0
        });

        return {
            id: baptism.id,
            nombre: baptism.name,
            fecha: fullDate,
            fecha_corta: shortDate,
            dia_semana: dayOfWeek,
            origen: baptism.source,
            mes: month,
            hasImages: images.length > 0,
            imageCount: images.length,
            photoURL: baptism.photoURL || "",
            images,
            separator: "─────────────────────────────────────────────────────", // Separador visual
        };
    });

    const totalBaptismImages = baptismsData.reduce((sum, baptism) => sum + baptism.imageCount, 0);
    
    const baptismGalleries: BaptismGalleryEntry[] = baptismsData
        .filter((baptism) => baptism.hasImages)
        .map((baptism) => ({
            nombre: baptism.nombre,
            fecha: baptism.fecha,
            origen: baptism.origen,
            cantidad: baptism.imageCount,
            foto_perfil: baptism.photoURL,
            imagenes: baptism.images,
        }));

    return {
        baptismsData,
        totalBaptismImages,
        baptismGalleries,
        baptismsWithImages: baptismGalleries.length,
    };
};

export const cleanupProfilePictures = functions.storage.object().onFinalize(async (object: any) => {
    const filePath = object.name;
    const contentType = object.contentType;

    if (!contentType?.startsWith("image/") || !filePath?.startsWith("profile_pictures/users/")) {
        functions.logger.log("Not a profile picture, skipping cleanup.");
        return null;
    }

    const parts = filePath.split("/");
    const userId = parts[2];
    const bucket = admin.storage().bucket(object.bucket);
    const directory = `profile_pictures/users/${userId}`;

    const [files] = await bucket.getFiles({ prefix: directory });

    const deletePromises = files.map(file => {
        if (file.name !== filePath) {
            functions.logger.log(`Deleting old profile picture: ${file.name}`);
            return file.delete();
        }
        return null;
    });

    await Promise.all(deletePromises);
    return null;
});

export const generateCompleteReport = functions.https.onCall(async (data: any, context: any) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "The function must be called while authenticated."
        );
    }

    const year = data.year || getYear(new Date());
    const includeAllActivities = data.includeAllActivities || false;

    try {
        const start = startOfYear(new Date(year, 0, 1));
        const end = endOfYear(new Date(year, 11, 31));
        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);

        // Obtener todas las colecciones necesarias
        const [
            activitiesSnapshot,
            servicesSnapshot,
            baptismsSnapshot,
            futureMembersSnapshot,
            convertsSnapshot,
            membersSnapshot,
            reportAnswersDoc
        ] = await Promise.all([
            firestore.collection("c_actividades").orderBy("date", "desc").get(),
            firestore.collection("c_servicios").orderBy("date", "desc").get(),
            firestore.collection("c_bautismos")
                .where("date", ">=", startTimestamp)
                .where("date", "<=", endTimestamp)
                .get(),
            firestore.collection("c_futuros_miembros")
                .where("baptismDate", ">=", startTimestamp)
                .where("baptismDate", "<=", endTimestamp)
                .get(),
            firestore.collection("c_nuevos_conversos")
                .where("baptismDate", ">=", startTimestamp)
                .where("baptismDate", "<=", endTimestamp)
                .get(),
            firestore.collection("c_miembros")
                .where("baptismDate", ">=", startTimestamp)
                .where("baptismDate", "<=", endTimestamp)
                .get(),
            firestore.collection("c_reporte_anual").doc(String(year)).get()
        ]);

        // Procesar datos
        const allActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity));
        
        // Procesar servicios - solo incluir los que tienen imágenes
        const allServices = servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Service));
        const servicesWithImages = allServices.filter(s => 
            s.imageUrls && s.imageUrls.length > 0 && s.imageUrls.some(url => url && url.trim() !== '')
        );
        
        // Combinar actividades y servicios con imágenes
        const combinedActivitiesAndServices: (Activity | Service)[] = [...allActivities, ...servicesWithImages];
        const activitiesToProcess = includeAllActivities 
            ? combinedActivitiesAndServices 
            : combinedActivitiesAndServices.filter(a => a.date.toDate() >= start && a.date.toDate() <= end);

        // Procesar bautismos con imágenes
        const allBaptisms: Baptism[] = [
            ...futureMembersSnapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    name: data.name || "Sin nombre", 
                    date: data.baptismDate, 
                    source: "Futuro Miembro" as const,
                    photoURL: data.photoURL,
                    baptismPhotos: data.baptismPhotos || []
                };
            }),
            ...convertsSnapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    name: data.name || "Sin nombre", 
                    date: data.baptismDate, 
                    source: "Nuevo Converso" as const,
                    photoURL: data.photoURL,
                    baptismPhotos: data.baptismPhotos || []
                };
            }),
            ...baptismsSnapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    name: data.name || "Sin nombre", 
                    date: data.date, 
                    source: "Manual" as const,
                    photoURL: data.photoURL,
                    baptismPhotos: data.baptismPhotos || []
                };
            }),
            ...membersSnapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    name: `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Sin nombre", 
                    date: data.baptismDate, 
                    source: "Automático" as const,
                    photoURL: data.photoURL,
                    baptismPhotos: data.baptismPhotos || []
                };
            })
        ].filter(b => b.date);

        // Deduplicar bautismos por nombre y fecha
        // Prioridad: Manual > Nuevo Converso > Futuro Miembro > Automático
        const sourcePriority: Record<string, number> = {
            "Manual": 1,
            "Nuevo Converso": 2,
            "Futuro Miembro": 3,
            "Automático": 4
        };

        const baptismMap = new Map<string, Baptism>();
        allBaptisms.forEach(baptism => {
            // Normalizar nombre para comparación (sin espacios extra, minúsculas)
            const normalizedName = baptism.name.trim().toLowerCase().replace(/\s+/g, ' ');
            const dateKey = baptism.date.toDate().toISOString().split('T')[0]; // Solo fecha YYYY-MM-DD
            const key = `${normalizedName}|${dateKey}`;

            const existing = baptismMap.get(key);
            const preferred = pickPreferredBaptism(existing, baptism, sourcePriority);
            if (preferred !== existing) {
                baptismMap.set(key, preferred);
            }
        });

        const baptisms: Baptism[] = Array.from(baptismMap.values())
            .sort((a, b) => b.date.toMillis() - a.date.toMillis());

        const answers = (reportAnswersDoc.data() || {}) as AnnualReportAnswers;

        // Calcular estadísticas generales
        const totalActivities = activitiesToProcess.length;
        const totalBaptisms = baptisms.length;
        const currentYearActivities = allActivities.filter(a => a.date.toDate() >= start && a.date.toDate() <= end);

        const activitiesByMonth = activitiesToProcess.reduce((acc: Record<string, ActivityOrService[]>, activity) => {
            const month = format(activity.date.toDate(), "MMMM yyyy", { locale: es });
            if (!acc[month]) acc[month] = [];
            acc[month].push(activity);
            return acc;
        }, {} as Record<string, ActivityOrService[]>);

        const {
            activitiesData,
            totalImages,
            galleries,
            activitiesWithImages,
        } = await prepareActivitiesDocData(activitiesToProcess);

        const {
            baptismsData,
            totalBaptismImages,
            baptismGalleries,
            baptismsWithImages,
        } = await prepareBaptismsDocData(baptisms);

        // Combinar todas las URLs de imágenes para el módulo
        const allImageUrls = new Set<string>();
        
        // Agregar imágenes de actividades
        activitiesData.forEach(activity => {
            activity.images.forEach(img => allImageUrls.add(img.image));
        });
        
        // Agregar imágenes de bautismos
        baptismsData.forEach(baptism => {
            if (baptism.photoURL) allImageUrls.add(baptism.photoURL);
            baptism.images.forEach(img => allImageUrls.add(img.image));
        });

        // Crear módulo de imágenes combinado
        const imageModule = await createImageModuleFromUrls(Array.from(allImageUrls));

        const activitiesDataMap = new Map(activitiesData.map(activity => [activity.id, activity]));

        const monthlyActivities = Object.entries(activitiesByMonth)
            .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
            .map(([month, activities]) => ({
                month,
                count: activities.length,
                activities: activities.map((activity: ActivityOrService) => {
                    const docActivity = activitiesDataMap.get(activity.id);
                    const activityDate = activity.date.toDate();
                    return {
                        title: docActivity?.title ?? activity.title,
                        date: format(activityDate, "dd 'de' MMMM", { locale: es }),
                        fullDate: docActivity?.fullDate ?? format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es }),
                        time: docActivity?.time ?? activity.time ?? "",
                        description: docActivity?.description ?? activity.description,
                        additionalText: docActivity?.additionalText ?? activity.additionalText ?? "",
                        location: docActivity?.location ?? activity.location ?? "",
                        context: docActivity?.context ?? activity.context ?? "",
                        learning: docActivity?.learning ?? activity.learning ?? "",
                        hasImages: docActivity?.hasImages ?? (activity.imageUrls ? activity.imageUrls.length > 0 : false),
                        imageCount: docActivity?.imageCount ?? (activity.imageUrls ? activity.imageUrls.length : 0),
                        images: docActivity?.images ?? (activity.imageUrls ?? []).map((url, index) => ({
                            image: url,
                            caption: `${activity.title} - ${format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es })}`,
                            title: activity.title,
                            date: format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es }),
                            order: index + 1,
                            description: activity.description,
                            location: activity.location || "",
                        })),
                    };
                }),
            }));

        // Los bautismos ya están preparados con imágenes en baptismsData
        const baptismsText = baptismsData.map((b: any) => `${b.nombre} (${b.fecha})`).join("\n");

        // Obtener template
        const bucket = storage.bucket();
        const file = bucket.file("template/reporte.docx");
        const [templateBuffer] = await file.download();

        const zip = new PizZip(templateBuffer);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            modules: [imageModule],
        });

        // Preparar resumen ejecutivo
        const summary = {
            total_actividades_ano: currentYearActivities.length,
            total_bautismos_ano: baptisms.length,
            total_actividades_registradas: allActivities.length,
            actividades_incluidas: activitiesToProcess.length,
            periodo_cubierto: `${format(start, "d 'de' MMMM", { locale: es })} al ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`,
            meses_con_actividades: Object.keys(activitiesByMonth).length,
            distribucion_bautismos: baptisms.reduce((acc: any, b: any) => {
                if (!acc[b.source]) acc[b.source] = 0;
                acc[b.source]++;
                return acc;
            }, {})
        };

        // Renderizar documento completo
        doc.render({
            anho_reporte: year,
            fecha_reporte: format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }),
            fecha_generacion: format(new Date(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es }),
            periodo_informe: summary.periodo_cubierto,
            
            // Resumen ejecutivo
            resumen_ejecutivo: summary,
            
            // Respuestas del informe anual
            respuesta_p1: answers.p1 || "",
            respuesta_p2: answers.p2 || "",
            respuesta_p3: answers.p3 || "",
            respuesta_p4: answers.p4 || "",
            respuesta_p5: answers.p5 || "",
            respuesta_p6: answers.p6 || "",
            
            // Listados completos
            lista_actividades: activitiesData,
            lista_bautismos: baptismsText,
            
            // Estadísticas
            total_actividades: totalActivities,
            total_bautismos: totalBaptisms,
            total_actividades_ano_actual: currentYearActivities.length,
            total_actividades_totales: allActivities.length,
            incluye_todas_actividades: includeAllActivities ? "Sí" : "No (solo del año actual)",

            // Datos agrupados
            actividades_por_mes: monthlyActivities,
            resumen_bautismos: baptismsData,
            galeria_actividades: galleries,
            galeria_bautismos: baptismGalleries,
            total_imagenes: totalImages,
            total_imagenes_bautismos: totalBaptismImages,
            total_imagenes_todas: totalImages + totalBaptismImages,
            actividades_con_imagenes: activitiesWithImages,
            bautismos_con_imagenes: baptismsWithImages,

            // Información adicional
            distribucion_bautismos_por_fuente: Object.entries(summary.distribucion_bautismos).map(([fuente, cantidad]) => ({
                fuente,
                cantidad
            })),
            
            // Datos para tablas
            tabla_actividades: activitiesToProcess.map(a => ({
                titulo: a.title,
                fecha: format(a.date.toDate(), "dd/MM/yyyy", { locale: es }),
                descripcion: (a.description || "").substring(0, 100) + ((a.description || "").length > 100 ? "..." : ""),
                tiene_imagenes: a.imageUrls && a.imageUrls.length > 0 ? "Sí" : "No",
                cantidad_imagenes: a.imageUrls ? a.imageUrls.length : 0,
            })),
            
            tabla_bautismos: baptismsData
        });

        const buffer = doc.getZip().generate({ type: "nodebuffer" });

        return {
            fileContents: buffer.toString("base64"),
        };
    } catch (error) {
        functions.logger.error("Error generating complete report:", error);
        throw new functions.https.HttpsError(
            "internal",
            "Error generating complete report: " + error
        );
    }
});

export const generateReport = functions.https.onCall(async (data: any, context: any) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "The function must be called while authenticated."
        );
    }

    const year = data.year || getYear(new Date());
    const includeAllActivities = data.includeAllActivities || false;

    try {
        const start = startOfYear(new Date(year, 0, 1));
        const end = endOfYear(new Date(year, 11, 31));
        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);

        const activitiesSnapshot = await firestore.collection("c_actividades").orderBy("date", "desc").get();
        const allActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity));
        
        const currentYearActivities = allActivities.filter(a => a.date.toDate() >= start && a.date.toDate() <= end);

        const fmSnapshot = await firestore.collection("c_futuros_miembros")
            .where("baptismDate", ">=", startTimestamp)
            .where("baptismDate", "<=", endTimestamp)
            .get();
        const fromFutureMembers = fmSnapshot.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                name: data.name || "Sin nombre", 
                date: data.baptismDate, 
                source: "Futuro Miembro" as const,
                photoURL: data.photoURL,
                baptismPhotos: data.baptismPhotos || []
            };
        });

        const bSnapshot = await firestore.collection("c_bautismos")
            .where("date", ">=", startTimestamp)
            .where("date", "<=", endTimestamp)
            .get();
        const fromManual = bSnapshot.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                name: data.name || "Sin nombre", 
                date: data.date, 
                source: "Manual" as const,
                photoURL: data.photoURL,
                baptismPhotos: data.baptismPhotos || []
            };
        });
        
        const convertsSnapshot = await firestore.collection("c_nuevos_conversos")
            .where("baptismDate", ">=", startTimestamp)
            .where("baptismDate", "<=", endTimestamp)
            .get();
        const fromConverts = convertsSnapshot.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                name: data.name || "Sin nombre", 
                date: data.baptismDate, 
                source: "Nuevo Converso" as const,
                photoURL: data.photoURL,
                baptismPhotos: data.baptismPhotos || []
            };
        });
        
        const allBaptisms: Baptism[] = [...fromFutureMembers, ...fromManual, ...fromConverts]
            .filter(b => b.date);

        // Deduplicar bautismos por nombre y fecha
        // Prioridad: Manual > Nuevo Converso > Futuro Miembro
        const sourcePriority: Record<string, number> = {
            "Manual": 1,
            "Nuevo Converso": 2,
            "Futuro Miembro": 3
        };

        const baptismMap = new Map<string, Baptism>();
        allBaptisms.forEach(baptism => {
            // Normalizar nombre para comparación (sin espacios extra, minúsculas)
            const normalizedName = baptism.name.trim().toLowerCase().replace(/\s+/g, ' ');
            const dateKey = baptism.date.toDate().toISOString().split('T')[0]; // Solo fecha YYYY-MM-DD
            const key = `${normalizedName}|${dateKey}`;

            const existing = baptismMap.get(key);
            const preferred = pickPreferredBaptism(existing, baptism, sourcePriority);
            if (preferred !== existing) {
                baptismMap.set(key, preferred);
            }
        });

        const baptisms: Baptism[] = Array.from(baptismMap.values())
            .sort((a, b) => b.date.toMillis() - a.date.toMillis());

        const reportAnswersDoc = await firestore.collection("c_reporte_anual").doc(String(year)).get();
        const answers = (reportAnswersDoc.data() || {}) as AnnualReportAnswers;

        const activitiesToProcess = includeAllActivities ? allActivities : currentYearActivities;
        const {
            activitiesData,
            totalImages,
            galleries,
            activitiesWithImages,
        } = await prepareActivitiesDocData(activitiesToProcess);

        const {
            baptismsData,
            totalBaptismImages,
            baptismGalleries,
            baptismsWithImages,
        } = await prepareBaptismsDocData(baptisms);

        // Combinar todas las URLs de imágenes para el módulo
        const allImageUrls = new Set<string>();
        
        // Agregar imágenes de actividades
        activitiesData.forEach(activity => {
            activity.images.forEach(img => allImageUrls.add(img.image));
        });
        
        // Agregar imágenes de bautismos
        baptismsData.forEach(baptism => {
            if (baptism.photoURL) allImageUrls.add(baptism.photoURL);
            baptism.images.forEach(img => allImageUrls.add(img.image));
        });

        // Crear módulo de imágenes combinado
        const imageModule = await createImageModuleFromUrls(Array.from(allImageUrls));

        const activitiesDataMap = new Map(activitiesData.map(activity => [activity.id, activity]));

        const baptismsText = baptismsData.map(b => `${b.nombre} (${b.fecha})`).join("\n");

        // Obtener estadísticas generales
        const totalActivities = activitiesToProcess.length;
        const totalBaptisms = baptisms.length;

        // Obtener actividades por mes
        const activitiesByMonth = activitiesToProcess.reduce((acc: Record<string, Activity[]>, activity) => {
            const month = format(activity.date.toDate(), "MMMM yyyy", { locale: es });
            if (!acc[month]) acc[month] = [];
            acc[month].push(activity);
            return acc;
        }, {} as Record<string, Activity[]>);

        // Preparar datos para el template
        const monthlyActivities = Object.entries(activitiesByMonth)
            .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
            .map(([month, activities]) => ({
                month,
                count: activities.length,
                activities: activities.map((activity: Activity) => {
                    const docActivity = activitiesDataMap.get(activity.id);
                    const activityDate = activity.date.toDate();
                    return {
                        title: docActivity?.title ?? activity.title,
                        date: format(activityDate, "dd/MM/yyyy", { locale: es }),
                    time: docActivity?.time ?? activity.time ?? "",
                    description: docActivity?.description ?? activity.description,
                    additionalText: docActivity?.additionalText ?? activity.additionalText ?? "",
                    location: docActivity?.location ?? activity.location ?? "",
                    context: docActivity?.context ?? activity.context ?? "",
                    learning: docActivity?.learning ?? activity.learning ?? "",
                    hasImages: docActivity?.hasImages ?? (activity.imageUrls ? activity.imageUrls.length > 0 : false),
                    imageCount: docActivity?.imageCount ?? (activity.imageUrls ? activity.imageUrls.length : 0),
                    images: docActivity?.images ?? (activity.imageUrls ?? []).map((url, index) => ({
                        image: url,
                        caption: `${activity.title} - ${format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es })}`,
                        title: activity.title,
                        date: format(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: es }),
                        order: index + 1,
                        description: activity.description,
                        location: activity.location || "",
                    })),
                };
            }),
        }));

        const bucket = storage.bucket();
        const file = bucket.file("template/reporte.docx");
        const [templateBuffer] = await file.download();

        const zip = new PizZip(templateBuffer);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            modules: [imageModule],
        });

        doc.render({
            anho_reporte: year,
            fecha_reporte: format(new Date(), "d MMMM yyyy", { locale: es }),
            respuesta_p1: answers.p1 || "",
            respuesta_p2: answers.p2 || "",
            respuesta_p3: answers.p3 || "",
            respuesta_p4: answers.p4 || "",
            respuesta_p5: answers.p5 || "",
            respuesta_p6: answers.p6 || "",
            lista_actividades: activitiesData,
            lista_bautismos: baptismsText,
            total_actividades: totalActivities,
            total_bautismos: totalBaptisms,
            actividades_por_mes: monthlyActivities,
            resumen_bautismos: baptismsData,
            galeria_actividades: galleries,
            galeria_bautismos: baptismGalleries,
            total_imagenes: totalImages,
            total_imagenes_bautismos: totalBaptismImages,
            total_imagenes_todas: totalImages + totalBaptismImages,
            actividades_con_imagenes: activitiesWithImages,
            bautismos_con_imagenes: baptismsWithImages,
            fecha_generacion: format(new Date(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: es })
        });

        const buffer = doc.getZip().generate({
            type: "nodebuffer",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        return { fileContents: buffer.toString("base64") };
    } catch (error) {
        functions.logger.error("Error generating report:", error);
        if (error instanceof Error) {
            throw new functions.https.HttpsError("internal", error.message, error);
        }
        throw new functions.https.HttpsError("internal", "An unknown error occurred.");
    }
});

export const onActivityCreated = functions.firestore
    .document("c_actividades/{activityId}")
    .onCreate(async (snapshot, context) => {
        try {
            const activity = snapshot.data() as Activity;
            const activityId = context.params.activityId as string;

            const activityTitle = activity?.title?.trim() || "Nueva actividad";
            const activityDate = activity?.date && typeof activity.date.toDate === "function"
                ? activity.date.toDate()
                : null;
            const formattedDate = activityDate
                ? format(activityDate, "EEEE d 'de' MMMM yyyy", { locale: es })
                : null;
            const timeSegment = activity?.time ? ` a las ${activity.time}` : "";
            const details: string[] = [];

            if (formattedDate) {
                details.push(`para el ${formattedDate}${timeSegment}`);
            }

            if (activity?.location) {
                details.push(`en ${activity.location}`);
            }

            const detailText = details.length > 0 ? ` ${details.join(" ")}` : "";
            const body = `Se programó la actividad "${activityTitle}"${detailText}.`;

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "activities");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Nueva Actividad Programada",
                    body,
                    url: "/reports/activities",
                    tag: `activity-${activityId}`,
                    context: {
                        contextType: "activity",
                        contextId: activityId,
                        actionUrl: "/reports/activities",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast activity notification", {
                error,
                activityId: context.params.activityId,
            });
        }
    });

export const onActivityUpdated = functions.firestore
    .document("c_actividades/{activityId}")
    .onUpdate(async (change, context) => {
        try {
            const before = change.before.data() as Activity | undefined;
            const after = change.after.data() as Activity | undefined;
            if (!after) return;

            const activityId = context.params.activityId as string;
            const activityTitle = after.title?.trim() || "Actividad";
            const prevTitle = before?.title?.trim() || activityTitle;

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "activities");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Actividad Actualizada",
                    body: `La actividad "${prevTitle}" ha sido actualizada.`,
                    url: "/reports/activities",
                    tag: `activity-updated-${activityId}`,
                    context: {
                        contextType: "activity",
                        contextId: activityId,
                        actionUrl: "/reports/activities",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast activity update notification", {
                error,
                activityId: context.params.activityId,
            });
        }
    });

export const onActivityDeleted = functions.firestore
    .document("c_actividades/{activityId}")
    .onDelete(async (snapshot, context) => {
        try {
            const activity = snapshot.data() as Activity | undefined;
            const activityTitle = activity?.title?.trim() || "Actividad";

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "activities");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Actividad Eliminada",
                    body: `La actividad "${activityTitle}" ha sido eliminada.`,
                    url: "/reports/activities",
                    tag: `activity-deleted-${context.params.activityId}`,
                    context: {
                        contextType: "activity",
                        actionUrl: "/reports/activities",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast activity delete notification", {
                error,
                activityId: context.params.activityId,
            });
        }
    });

export const onServiceCreated = functions.firestore
    .document("c_servicios/{serviceId}")
    .onCreate(async (snapshot, context) => {
        try {
            const svc = snapshot.data() as Service;
            const serviceId = context.params.serviceId as string;
            const title = svc.title?.trim() || "Nuevo servicio";
            const svcDate = svc.date?.toDate
                ? format(svc.date.toDate(), "d MMM yyyy", { locale: es })
                : "";

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "service");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Nuevo Servicio Programado",
                    body: `Se programó el servicio "${title}"${svcDate ? ` para el ${svcDate}` : ""}.`,
                    url: "/service",
                    tag: `service-created-${serviceId}`,
                    context: {
                        contextType: "service",
                        contextId: serviceId,
                        actionUrl: "/service",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service creation notification", { error });
        }
    });

export const onServiceUpdated = functions.firestore
    .document("c_servicios/{serviceId}")
    .onUpdate(async (change, context) => {
        try {
            const before = change.before.data() as Service | undefined;
            const after = change.after.data() as Service | undefined;
            if (!after) return;

            const serviceId = context.params.serviceId as string;
            const title = after.title?.trim() || before?.title?.trim() || "Servicio";

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "service");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Servicio Actualizado",
                    body: `El servicio "${title}" ha sido actualizado.`,
                    url: "/service",
                    tag: `service-updated-${serviceId}`,
                    context: {
                        contextType: "service",
                        contextId: serviceId,
                        actionUrl: "/service",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service update notification", { error });
        }
    });

export const onServiceDeleted = functions.firestore
    .document("c_servicios/{serviceId}")
    .onDelete(async (snapshot, context) => {
        try {
            const svc = snapshot.data() as Service | undefined;
            const title = svc?.title?.trim() || "Servicio";
            const serviceId = context.params.serviceId as string;

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "service");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Servicio Eliminado",
                    body: `El servicio "${title}" ha sido eliminado.`,
                    url: "/service",
                    tag: `service-deleted-${serviceId}`,
                    context: {
                        contextType: "service",
                        actionUrl: "/service",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service delete notification", { error });
        }
    });

export const onUrgentFamilyFlagged = functions.firestore
    .document("c_ministracion/{companionshipId}")
    .onUpdate(async (change, context) => {
        const before = change.before.data() as Companionship | undefined;
        const after = change.after.data() as Companionship | undefined;

        if (!after?.families || after.families.length === 0) {
            return;
        }

        const previousStatus = new Map(
            (before?.families ?? []).map((family) => [family.name, family.isUrgent])
        );

        const newlyUrgent = after.families.filter((family) => {
            if (!family.isUrgent) {
                return false;
            }
            const wasUrgent = previousStatus.get(family.name);
            return wasUrgent !== true;
        });

        if (newlyUrgent.length === 0) {
            return;
        }

        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "council");

        await Promise.all(
            newlyUrgent.map(async (family) => {
                const familyName = family.name || "Familia";
                const familySlug = slugify(familyName) || "familia";
                try {
                    const normalizedObservation = family.observation?.trim();
                    const body = normalizedObservation
                        ? `La familia ${familyName} requiere ayuda: ${normalizedObservation}`
                        : `La familia ${familyName} ha sido marcada como urgente.`;

                    const contextId = `${context.params.companionshipId}:${familySlug}`;

                    await notificationDispatcher.broadcastToUsers(
                        eligible.inAppUserIds,
                        {
                            title: "Nueva familia con necesidad urgente",
                            body,
                            url: "/ministering/urgent",
                            tag: `urgent-family-${context.params.companionshipId}-${familySlug}`,
                            context: {
                                contextType: "urgent_family",
                                contextId,
                                actionUrl: "/ministering/urgent",
                                actionType: "navigate",
                            },
                        },
                        eligible.pushUserIds
                    );
                } catch (error) {
                    functions.logger.error("Failed to broadcast urgent family notification", {
                        error,
                        companionshipId: context.params.companionshipId,
                        family: familyName,
                    });
                }
            })
        );
    });

export const onMissionaryAssignmentCreated = functions.firestore
    .document("c_obra_misional_asignaciones/{assignmentId}")
    .onCreate(async (snapshot, context) => {
        try {
            const assignment = snapshot.data() as { description?: string } | undefined;
            const assignmentId = context.params.assignmentId as string;
            const description = assignment?.description?.trim();
            const body = description && description.length > 0
                ? description
                : "Se registró una nueva asignación misional.";

            const allUsers = await getAllUsersNotificationData();
            const eligible = getEligibleUsers(allUsers, "missionaryWork");

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Nueva Asignación Misional",
                    body,
                    url: "/missionary-work",
                    tag: `missionary-assignment-${assignmentId}`,
                    context: {
                        contextType: "missionary_assignment",
                        contextId: assignmentId,
                        actionUrl: "/missionary-work",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast missionary assignment notification", {
                error,
                assignmentId: context.params.assignmentId,
            });
        }
    });


// ─────────────────────────────────────────────────────────────────────────────
// Notification helpers – Ecuador timezone (UTC-5, no DST)
// ─────────────────────────────────────────────────────────────────────────────

/** Return "today" date object in Ecuador local time (midnight UTC-5). */
function getEcuadorToday(): Date {
    const today = getDatePartsInTimeZone(new Date(), ECUADOR_TZ);
    return new Date(today.year, today.month - 1, today.day);
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(date);

    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    const day = Number(parts.find((part) => part.type === "day")?.value);

    return { year, month, day };
}

function getBirthdayDateInEcuador(
    birthDate: admin.firestore.Timestamp | Date | string | number | { seconds: number },
    year: number
): Date | null {
    const date = resolveDateValue(birthDate);
    if (!date) return null;
    const parts = getDatePartsInTimeZone(date, ECUADOR_TZ);
    return new Date(year, parts.month - 1, parts.day);
}

interface UserNotificationData {
    userId: string;
    /** null means the field was never configured → treat all pages as visible (same as frontend default). */
    visiblePages: string[] | null;
    inAppEnabled: boolean;
    pushEnabled: boolean;
    notificationPrefs: {
        inApp: Record<string, boolean>;
        push: Record<string, boolean>;
    };
}

/**
 * Fetch all users with their notification preferences and visible pages.
 * Defaults: inApp = true, push = false, all categories = true.
 * visiblePages = null means "never configured" → all pages are visible
 * (matches the frontend default in settings/page.tsx).
 */
async function getAllUsersNotificationData(): Promise<UserNotificationData[]> {
    const snapshot = await firestore.collection("c_users").get();
    return snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
            userId: doc.id,
            visiblePages: Array.isArray(d.visiblePages) ? (d.visiblePages as string[]) : null,
            inAppEnabled: d.inAppNotificationsEnabled !== false,
            pushEnabled: d.pushNotificationsEnabled === true,
            notificationPrefs: {
                inApp: (d.notificationPrefs?.inApp as Record<string, boolean>) ?? {},
                push: (d.notificationPrefs?.push as Record<string, boolean>) ?? {},
            },
        };
    });
}

type NotifCategory =
    | "observations"
    | "converts"
    | "futureMembers"
    | "birthdays"
    | "familySearch"
    | "missionaryWork"
    | "service"
    | "council"
    | "activities";

const CATEGORY_PAGE: Record<NotifCategory, string> = {
    observations: "/observations",
    converts: "/converts",
    futureMembers: "/future-members",
    birthdays: "/birthdays",
    familySearch: "/family-search",
    missionaryWork: "/missionary-work",
    service: "/service",
    council: "/council",
    activities: "/reports/activities",
};

interface EligibleUsers {
    inAppUserIds: string[];
    pushUserIds: string[];
}

function getEcuadorNowLabel(): string {
    return new Intl.DateTimeFormat("es-EC", {
        timeZone: ECUADOR_TZ,
        dateStyle: "medium",
        timeStyle: "medium",
    }).format(new Date());
}

function buildNotificationTrace(source: string, category: string) {
    return {
        source,
        category,
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    };
}

function logEligibleUsersSummary(source: string, category: string, eligible: EligibleUsers): void {
    functions.logger.log(`${source}: eligible users`, {
        category,
        inAppRecipients: eligible.inAppUserIds.length,
        pushRecipients: eligible.pushUserIds.length,
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    });
}

/**
 * Given all users and a category, return those eligible to receive in-app
 * and/or push notifications for that category.
 */
function getEligibleUsers(
    users: UserNotificationData[],
    category: NotifCategory
): EligibleUsers {
    const page = CATEGORY_PAGE[category];
    const inAppUserIds: string[] = [];
    const pushUserIds: string[] = [];

    for (const u of users) {
        // null = visiblePages was never configured → all pages are visible (matches frontend default)
        const hasPage = u.visiblePages === null || u.visiblePages.includes(page);
        if (!hasPage) continue;

        const inAppCat = u.notificationPrefs.inApp[category] !== false;
        const pushCat = u.notificationPrefs.push[category] !== false;

        if (u.inAppEnabled && inAppCat) inAppUserIds.push(u.userId);
        if (u.pushEnabled && pushCat) pushUserIds.push(u.userId);
    }

    return { inAppUserIds, pushUserIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY NOTIFICATIONS – 09:00 Ecuador (America/Guayaquil)
// Covers: Birthdays, Future Members, Services, Activities
// ─────────────────────────────────────────────────────────────────────────────
export const dailyNotifications = functions.pubsub
    .schedule("0 9 * * *")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
        functions.logger.log("dailyNotifications: running...", {
            scheduledTimeZone: ECUADOR_TZ,
            scheduledLocalTime: getEcuadorNowLabel(),
        });
        const today = getEcuadorToday();
        const in14Days = addDays(today, 14);
        const in3Days = addDays(today, 3);

        const allUsers = await getAllUsersNotificationData();

        // ── Cumpleaños ──────────────────────────────────────────────────────
        const birthdayEligible = getEligibleUsers(allUsers, "birthdays");
        const birthdayTrace = buildNotificationTrace("dailyNotifications", "birthdays");
        logEligibleUsersSummary("dailyNotifications", "birthdays", birthdayEligible);
        if (birthdayEligible.inAppUserIds.length > 0 || birthdayEligible.pushUserIds.length > 0) {
            const [birthdaysSnap, membersForBirthdaySnap] = await Promise.all([
                firestore.collection("c_cumpleanos").get(),
                firestore.collection("c_miembros").get(),
            ]);

            const sentBirthdays14 = new Set<string>();
            const sentBirthdaysToday = new Set<string>();
            const coveredBirthdayKeys = new Set<string>();

            // Build member status map for quick lookup by memberId
            const memberStatusMap = new Map<string, string>();
            for (const memberDoc of membersForBirthdaySnap.docs) {
                const m = memberDoc.data() as MemberBasic;
                if (m.status) memberStatusMap.set(memberDoc.id, m.status);
            }

            // Process birthdays from c_cumpleanos collection
            for (const doc of birthdaysSnap.docs) {
                const b = doc.data() as Birthday;
                const birthdayKey = buildBirthdayDedupKey(b.name, b.memberId);
                const normalizedNameKey = buildBirthdayDedupKey(b.name);
                coveredBirthdayKeys.add(birthdayKey);
                coveredBirthdayKeys.add(normalizedNameKey);

                const nextBirthday = getBirthdayDateInEcuador(b.birthDate, today.getFullYear());
                if (!nextBirthday) continue;

                // Resolve member status if birthday is linked to a member
                const memberStatus = b.memberId ? memberStatusMap.get(b.memberId) : undefined;
                const statusLabel = getBirthdayStatusLabel(memberStatus);
                const nameWithStatus = statusLabel ? `${b.name} (${statusLabel})` : b.name;

                if (isSameDay(nextBirthday, in14Days) && !sentBirthdays14.has(birthdayKey)) {
                    sentBirthdays14.add(birthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        birthdayEligible.inAppUserIds,
                        {
                            title: "Próximo Cumpleaños",
                            body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                            url: "/birthdays",
                            tag: `birthday-14d-${doc.id}`,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        birthdayEligible.pushUserIds,
                        birthdayTrace
                    );
                }

                if (isSameDay(nextBirthday, today) && !sentBirthdaysToday.has(birthdayKey)) {
                    sentBirthdaysToday.add(birthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        birthdayEligible.inAppUserIds,
                        {
                            title: "¡Feliz Cumpleaños!",
                            body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                            url: "/birthdays",
                            tag: `birthday-today-${doc.id}`,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        birthdayEligible.pushUserIds,
                        birthdayTrace
                    );
                }
            }

            // Also process member birthdays from c_miembros (not in c_cumpleanos)
            for (const memberDoc of membersForBirthdaySnap.docs) {
                const m = memberDoc.data() as MemberBasic;
                if (!m.birthDate || !m.firstName || !m.lastName) continue;
                if (m.status === "deceased" || m.status === "fallecido" || m.status === "fallecida") continue;

                const memberName = `${m.firstName} ${m.lastName}`;
                const memberBirthdayKey = buildBirthdayDedupKey(memberName, memberDoc.id);
                const memberNameKey = buildBirthdayDedupKey(memberName);
                // Skip if already covered by c_cumpleanos record (deduplication by memberId or normalized name)
                if (coveredBirthdayKeys.has(memberBirthdayKey) || coveredBirthdayKeys.has(memberNameKey)) continue;

                const nextBirthday = getBirthdayDateInEcuador(m.birthDate, today.getFullYear());
                if (!nextBirthday) continue;
                const statusLabel = getBirthdayStatusLabel(m.status);
                const nameWithStatus = statusLabel ? `${memberName} (${statusLabel})` : memberName;

                if (isSameDay(nextBirthday, in14Days) && !sentBirthdays14.has(memberBirthdayKey)) {
                    sentBirthdays14.add(memberBirthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        birthdayEligible.inAppUserIds,
                        {
                            title: "Próximo Cumpleaños",
                            body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                            url: "/birthdays",
                            tag: `birthday-14d-member-${memberDoc.id}`,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        birthdayEligible.pushUserIds,
                        birthdayTrace
                    );
                }

                if (isSameDay(nextBirthday, today) && !sentBirthdaysToday.has(memberBirthdayKey)) {
                    sentBirthdaysToday.add(memberBirthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        birthdayEligible.inAppUserIds,
                        {
                            title: "¡Feliz Cumpleaños!",
                            body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                            url: "/birthdays",
                            tag: `birthday-today-member-${memberDoc.id}`,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        birthdayEligible.pushUserIds,
                        birthdayTrace
                    );
                }
            }
        }

        // ── Futuros Miembros – 3 días antes del bautismo ────────────────────
        const fmEligible = getEligibleUsers(allUsers, "futureMembers");
        const futureMembersTrace = buildNotificationTrace("dailyNotifications", "futureMembers");
        logEligibleUsersSummary("dailyNotifications", "futureMembers", fmEligible);
        if (fmEligible.inAppUserIds.length > 0 || fmEligible.pushUserIds.length > 0) {
            const fmSnap = await firestore.collection("c_futuros_miembros").get();
            for (const doc of fmSnap.docs) {
                const fm = doc.data() as { name: string; baptismDate: admin.firestore.Timestamp; isBaptized?: boolean };
                if (fm.isBaptized) continue;
                const baptismDate = fm.baptismDate?.toDate();
                if (!baptismDate) continue;
                const baptismDay = new Date(baptismDate.getFullYear(), baptismDate.getMonth(), baptismDate.getDate());

                if (isSameDay(baptismDay, in3Days)) {
                    await notificationDispatcher.broadcastToUsers(
                        fmEligible.inAppUserIds,
                        {
                            title: "Próximo Bautismo",
                            body: `Faltan 3 días para el bautismo de ${fm.name} (${format(baptismDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/future-members",
                            tag: `future-member-${doc.id}`,
                            context: { contextType: "future_member", contextId: doc.id, actionUrl: "/future-members", actionType: "navigate" },
                        },
                        fmEligible.pushUserIds,
                        futureMembersTrace
                    );
                }
            }
        }

        // ── Servicios – 14 días antes y el mismo día ─────────────────────────
        const serviceEligible = getEligibleUsers(allUsers, "service");
        const serviceTrace = buildNotificationTrace("dailyNotifications", "service");
        logEligibleUsersSummary("dailyNotifications", "service", serviceEligible);
        if (serviceEligible.inAppUserIds.length > 0 || serviceEligible.pushUserIds.length > 0) {
            const servicesSnap = await firestore.collection("c_servicios").get();
            for (const doc of servicesSnap.docs) {
                const svc = doc.data() as Service;
                const svcDate = svc.date.toDate();
                const svcDay = new Date(svcDate.getFullYear(), svcDate.getMonth(), svcDate.getDate());
                const timeStr = svc.time ? ` a las ${svc.time}` : "";

                if (isSameDay(svcDay, in14Days)) {
                    await notificationDispatcher.broadcastToUsers(
                        serviceEligible.inAppUserIds,
                        {
                            title: "Recordatorio de Servicio",
                            body: `El servicio "${svc.title}" es en 14 días (${format(svcDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/service",
                            tag: `service-14d-${doc.id}`,
                            context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                        },
                        serviceEligible.pushUserIds,
                        serviceTrace
                    );
                }

                if (isSameDay(svcDay, today)) {
                    await notificationDispatcher.broadcastToUsers(
                        serviceEligible.inAppUserIds,
                        {
                            title: "¡Servicio Hoy!",
                            body: `El servicio "${svc.title}" es hoy${timeStr}.`,
                            url: "/service",
                            tag: `service-today-${doc.id}`,
                            context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                        },
                        serviceEligible.pushUserIds,
                        serviceTrace
                    );
                }
            }
        }

        // ── Actividades – 14 días antes y el mismo día ───────────────────────
        const actEligible = getEligibleUsers(allUsers, "activities");
        const activitiesTrace = buildNotificationTrace("dailyNotifications", "activities");
        logEligibleUsersSummary("dailyNotifications", "activities", actEligible);
        if (actEligible.inAppUserIds.length > 0 || actEligible.pushUserIds.length > 0) {
            const actSnap = await firestore.collection("c_actividades").get();
            for (const doc of actSnap.docs) {
                const act = doc.data() as Activity;
                const actDate = act.date.toDate();
                const actDay = new Date(actDate.getFullYear(), actDate.getMonth(), actDate.getDate());
                const timeStr = act.time ? ` a las ${act.time}` : "";

                if (isSameDay(actDay, in14Days)) {
                    await notificationDispatcher.broadcastToUsers(
                        actEligible.inAppUserIds,
                        {
                            title: "Recordatorio de Actividad",
                            body: `La actividad "${act.title}" es en 14 días (${format(actDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/reports/activities",
                            tag: `activity-14d-${doc.id}`,
                            context: { contextType: "activity", contextId: doc.id, actionUrl: "/reports/activities", actionType: "navigate" },
                        },
                        actEligible.pushUserIds,
                        activitiesTrace
                    );
                }

                if (isSameDay(actDay, today)) {
                    await notificationDispatcher.broadcastToUsers(
                        actEligible.inAppUserIds,
                        {
                            title: "¡Actividad Hoy!",
                            body: `La actividad "${act.title}" es hoy${timeStr}.`,
                            url: "/reports/activities",
                            tag: `activity-today-${doc.id}`,
                            context: { contextType: "activity", contextId: doc.id, actionUrl: "/reports/activities", actionType: "navigate" },
                        },
                        actEligible.pushUserIds,
                        activitiesTrace
                    );
                }
            }
        }

        functions.logger.log("dailyNotifications: done.");
        return null;
    });

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY NOTIFICATIONS – Mondays 09:00 Ecuador
// Covers: Observaciones, Conversos, FamilySearch, Obra Misional
// ─────────────────────────────────────────────────────────────────────────────
export const weeklyNotifications = functions.pubsub
    .schedule("0 9 * * 1")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
        functions.logger.log("weeklyNotifications: running...", {
            scheduledTimeZone: ECUADOR_TZ,
            scheduledLocalTime: getEcuadorNowLabel(),
        });
        const allUsers = await getAllUsersNotificationData();

        // ── Observaciones ────────────────────────────────────────────────────
        const obsEligible = getEligibleUsers(allUsers, "observations");
        const observationsTrace = buildNotificationTrace("weeklyNotifications", "observations");
        logEligibleUsersSummary("weeklyNotifications", "observations", obsEligible);
        if (obsEligible.inAppUserIds.length > 0 || obsEligible.pushUserIds.length > 0) {
            const [membersSnap, healthSnap, ministeringSnap] = await Promise.all([
                firestore.collection("c_miembros").get(),
                firestore.collection("c_observaciones_salud").get(),
                firestore.collection("c_ministracion").get(),
            ]);

            let sinInvestidura = 0;
            let sinOrdenanzaElder = 0;
            let sinSacerdocioMayor = 0;
            let inactivos = 0;
            let menosActivos = 0;
            let urgentes = 0;
            let enConsejo = 0;

            membersSnap.forEach((doc) => {
                const m = doc.data() as {
                    status?: string;
                    ordinances?: string[];
                    isUrgent?: boolean;
                    isInCouncil?: boolean;
                };
                const ords = m.ordinances ?? [];
                if (!ords.includes("endowment")) sinInvestidura++;
                if (!ords.includes("elder_ordination") && !ords.includes("high_priest_ordination")) sinOrdenanzaElder++;
                if (!ords.includes("high_priest_ordination") && !ords.includes("elder_ordination")) sinSacerdocioMayor++;
                if (m.status === "inactive") inactivos++;
                if (m.status === "less_active") menosActivos++;
                if (m.isUrgent) urgentes++;
                if (m.isInCouncil) enConsejo++;
            });

            let urgentFamilies = 0;
            ministeringSnap.forEach((doc) => {
                const c = doc.data() as Companionship;
                (c.families ?? []).forEach((f) => { if (f.isUrgent) urgentFamilies++; });
            });

            const bodyParts: string[] = [];
            if (sinInvestidura > 0) bodyParts.push(`${sinInvestidura} sin investidura`);
            if (sinOrdenanzaElder > 0) bodyParts.push(`${sinOrdenanzaElder} sin ordenanza de élderes`);
            if (sinSacerdocioMayor > 0) bodyParts.push(`${sinSacerdocioMayor} sin ordenanza de élderes`);
            if (inactivos > 0) bodyParts.push(`${inactivos} inactivos`);
            if (menosActivos > 0) bodyParts.push(`${menosActivos} menos activos`);
            if (urgentFamilies > 0) bodyParts.push(`${urgentFamilies} familias con necesidad urgente`);
            if (healthSnap.size > 0) bodyParts.push(`${healthSnap.size} con apoyo de salud`);
            if (urgentes > 0) bodyParts.push(`${urgentes} miembros urgentes`);
            if (enConsejo > 0) bodyParts.push(`${enConsejo} en seguimiento de consejo`);

            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(
                    obsEligible.inAppUserIds,
                    {
                        title: "Resumen Semanal – Observaciones",
                        body: bodyParts.join(", ") + ".",
                        url: "/observations",
                        tag: "weekly-observations",
                        context: { actionUrl: "/observations", actionType: "navigate" },
                    },
                    obsEligible.pushUserIds,
                    observationsTrace
                );
            }
        }

        // ── Miembros Fallecidos sin Ordenanzas Completas (Solo Push, solo Lunes) ─
        const deceasedMembersQuery = await firestore.collection("c_miembros")
            .where("status", "==", "deceased")
            .get();
        
        const ALL_TEMPLE_ORDINANCES = [
            'baptism', 'confirmation', 'initiatory', 'endowment',
            'sealed_to_father', 'sealed_to_mother', 'sealed_to_spouse'
        ];
        
        const membersNeedingOrdinances: { id: string; firstName: string; lastName: string; templeOrdinances: string[] }[] = [];
        
        deceasedMembersQuery.forEach((doc) => {
            const m = doc.data();
            const templeOrdinances = m.templeOrdinances || [];
            const hasAll = ALL_TEMPLE_ORDINANCES.every(ord => templeOrdinances.includes(ord));
            if (!hasAll) {
                membersNeedingOrdinances.push({
                    id: doc.id,
                    firstName: m.firstName || '',
                    lastName: m.lastName || '',
                    templeOrdinances
                });
            }
        });
        
        if (membersNeedingOrdinances.length > 0) {
            const pushUsers = allUsers.filter(u => u.pushEnabled);
            
            if (pushUsers.length > 0) {
                const memberNames = membersNeedingOrdinances
                    .map(m => `${m.firstName} ${m.lastName}`)
                    .join(', ');
                const count = membersNeedingOrdinances.length;
                
                const title = "⚰️ Miembros Fallecidos Sin Ordenanzas Completas";
                const body = count === 1
                    ? `Hay ${count} miembro fallecido que necesita ordenanzas del templo: ${memberNames}`
                    : `Hay ${count} miembros fallecidos que necesitan ordenanzas del templo: ${memberNames}`;
                
                const pushUserIds = pushUsers.map(u => u.userId);
                
                await notificationDispatcher.broadcastToUsers(
                    [], // No in-app
                    {
                        title,
                        body,
                        url: "/council",
                        tag: "weekly-deceased-ordinances",
                        context: { contextType: "member", actionUrl: "/council", actionType: "navigate" },
                    },
                    pushUserIds,
                    buildNotificationTrace("weeklyNotifications", "deceased-members")
                );
                
                functions.logger.log("weeklyNotifications: Sent deceased members ordinance notification to " + pushUserIds.length + " users");
            }
        }

        // ── Conversos ────────────────────────────────────────────────────────
        const convEligible = getEligibleUsers(allUsers, "converts");
        const convertsTrace = buildNotificationTrace("weeklyNotifications", "converts");
        logEligibleUsersSummary("weeklyNotifications", "converts", convEligible);
        if (convEligible.inAppUserIds.length > 0 || convEligible.pushUserIds.length > 0) {
            const [convertsSnap, friendsSnap] = await Promise.all([
                firestore.collection("c_conversos").get(),
                firestore.collection("c_obra_misional_amigos_conversos").get(),
            ]);

            const assignedFriendConvertIds = new Set<string>();
            friendsSnap.forEach((doc) => {
                const f = doc.data() as { convertId?: string; friends?: string[] };
                if (f.convertId && Array.isArray(f.friends) && f.friends.length > 0) {
                    assignedFriendConvertIds.add(f.convertId);
                }
            });

            let totalConverts = 0;
            let conObservacion = 0;
            let sinAmigo = 0;
            let sinMinistrantesMaestros = 0;
            let sinLlamamiento = 0;
            let sinRecomendacion = 0;
            let sinAutosuficiencia = 0;

            convertsSnap.forEach((doc) => {
                const c = doc.data() as {
                    observation?: string;
                    ministeringTeachers?: string[];
                    hasCalling?: boolean;
                    hasRecommendation?: boolean;
                    hasSelfReliance?: boolean;
                };
                totalConverts++;
                if (c.observation?.trim()) conObservacion++;
                if (!assignedFriendConvertIds.has(doc.id)) sinAmigo++;
                if (!Array.isArray(c.ministeringTeachers) || c.ministeringTeachers.length === 0) sinMinistrantesMaestros++;
                if (c.hasCalling === false) sinLlamamiento++;
                if (c.hasRecommendation === false) sinRecomendacion++;
                if (c.hasSelfReliance === false) sinAutosuficiencia++;
            });

            const bodyParts: string[] = [];
            if (totalConverts > 0) bodyParts.push(`${totalConverts} conversos registrados`);
            if (sinAmigo > 0) bodyParts.push(`${sinAmigo} sin amigo asignado`);
            if (sinLlamamiento > 0) bodyParts.push(`${sinLlamamiento} sin llamamiento`);
            if (sinRecomendacion > 0) bodyParts.push(`${sinRecomendacion} sin recomendación`);
            if (sinAutosuficiencia > 0) bodyParts.push(`${sinAutosuficiencia} sin curso de autosuficiencia`);
            if (sinMinistrantesMaestros > 0) bodyParts.push(`${sinMinistrantesMaestros} sin maestros ministrantes`);
            if (conObservacion > 0) bodyParts.push(`${conObservacion} con observación`);

            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(
                    convEligible.inAppUserIds,
                    {
                        title: "Resumen Semanal – Conversos",
                        body: bodyParts.join(", ") + ".",
                        url: "/converts",
                        tag: "weekly-converts",
                        context: { contextType: "convert", actionUrl: "/converts", actionType: "navigate" },
                    },
                    convEligible.pushUserIds,
                    convertsTrace
                );
            }
        }

        // ── FamilySearch ─────────────────────────────────────────────────────
        const fsEligible = getEligibleUsers(allUsers, "familySearch");
        const familySearchTrace = buildNotificationTrace("weeklyNotifications", "familySearch");
        logEligibleUsersSummary("weeklyNotifications", "familySearch", fsEligible);
        if (fsEligible.inAppUserIds.length > 0 || fsEligible.pushUserIds.length > 0) {
            const fsSnap = await firestore.collection("c_fs_capacitaciones").get();
            const fsCount = fsSnap.size;
            if (fsCount > 0) {
                await notificationDispatcher.broadcastToUsers(
                    fsEligible.inAppUserIds,
                    {
                        title: "FamilySearch – Familias por Capacitar",
                        body: `Hay ${fsCount} familia${fsCount !== 1 ? "s" : ""} pendiente${fsCount !== 1 ? "s" : ""} de capacitación en FamilySearch.`,
                        url: "/family-search",
                        tag: "weekly-family-search",
                        context: { actionUrl: "/family-search", actionType: "navigate" },
                    },
                    fsEligible.pushUserIds,
                    familySearchTrace
                );
            }
        }

        // ── Obra Misional ─────────────────────────────────────────────────────
        const mwEligible = getEligibleUsers(allUsers, "missionaryWork");
        const missionaryWorkTrace = buildNotificationTrace("weeklyNotifications", "missionaryWork");
        logEligibleUsersSummary("weeklyNotifications", "missionaryWork", mwEligible);
        if (mwEligible.inAppUserIds.length > 0 || mwEligible.pushUserIds.length > 0) {
            const [assignmentsSnap, investigatorsSnap, convertsThisWeek] = await Promise.all([
                firestore.collection("c_obra_misional_asignaciones").where("isCompleted", "==", false).get(),
                firestore.collection("c_obra_misional_investigadores").where("status", "==", "active").get(),
                firestore.collection("c_conversos").get(),
            ]);

            const pendingAssignments = assignmentsSnap.size;
            const activeInvestigators = investigatorsSnap.size;
            const totalConverts = convertsThisWeek.size;

            const bodyParts: string[] = [];
            if (pendingAssignments > 0) bodyParts.push(`${pendingAssignments} asignación${pendingAssignments !== 1 ? "es" : ""} misional${pendingAssignments !== 1 ? "es" : ""} pendiente${pendingAssignments !== 1 ? "s" : ""}`);
            if (activeInvestigators > 0) bodyParts.push(`${activeInvestigators} investigador${activeInvestigators !== 1 ? "es" : ""} activo${activeInvestigators !== 1 ? "s" : ""}`);
            if (totalConverts > 0) bodyParts.push(`${totalConverts} nuevo${totalConverts !== 1 ? "s" : ""} converso${totalConverts !== 1 ? "s" : ""} registrado${totalConverts !== 1 ? "s" : ""}`);

            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(
                    mwEligible.inAppUserIds,
                    {
                        title: "Resumen Semanal – Obra Misional",
                        body: bodyParts.join(", ") + ".",
                        url: "/missionary-work",
                        tag: "weekly-missionary-work",
                        context: { contextType: "missionary_assignment", actionUrl: "/missionary-work", actionType: "navigate" },
                    },
                    mwEligible.pushUserIds,
                    missionaryWorkTrace
                );
            }
        }

        functions.logger.log("weeklyNotifications: done.");
        return null;
    });

// ─────────────────────────────────────────────────────────────────────────────
// COUNCIL NOTIFICATIONS – Tuesdays & Wednesdays 18:00 Ecuador
// Covers: Consejo (Necesidades Urgentes, Menos Activos, Ministración)
// ─────────────────────────────────────────────────────────────────────────────
export const councilNotifications = functions.pubsub
    .schedule("0 18 * * 2,3")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
        functions.logger.log("councilNotifications: running...", {
            scheduledTimeZone: ECUADOR_TZ,
            scheduledLocalTime: getEcuadorNowLabel(),
        });
        const allUsers = await getAllUsersNotificationData();
        const councilEligible = getEligibleUsers(allUsers, "council");
        const councilTrace = buildNotificationTrace("councilNotifications", "council");
        logEligibleUsersSummary("councilNotifications", "council", councilEligible);

        if (councilEligible.inAppUserIds.length === 0 && councilEligible.pushUserIds.length === 0) {
            functions.logger.log("councilNotifications: no eligible users.");
            return null;
        }

        const [membersSnap, ministeringSnap] = await Promise.all([
            firestore.collection("c_miembros").get(),
            firestore.collection("c_ministracion").get(),
        ]);

        let urgentMembers = 0;
        let lessActiveMembers = 0;
        let inCouncil = 0;

        membersSnap.forEach((doc) => {
            const m = doc.data() as { isUrgent?: boolean; status?: string; isInCouncil?: boolean };
            if (m.isUrgent) urgentMembers++;
            if (m.status === "less_active" || m.status === "inactive") lessActiveMembers++;
            if (m.isInCouncil) inCouncil++;
        });

        let urgentFamiliesMinistering = 0;
        ministeringSnap.forEach((doc) => {
            const c = doc.data() as Companionship;
            (c.families ?? []).forEach((f) => { if (f.isUrgent) urgentFamiliesMinistering++; });
        });

        const bodyParts: string[] = [];
        if (urgentMembers > 0) bodyParts.push(`${urgentMembers} necesidad${urgentMembers !== 1 ? "es" : ""} urgente${urgentMembers !== 1 ? "s" : ""} de miembros`);
        if (urgentFamiliesMinistering > 0) bodyParts.push(`${urgentFamiliesMinistering} necesidad${urgentFamiliesMinistering !== 1 ? "es" : ""} urgente${urgentFamiliesMinistering !== 1 ? "s" : ""} de ministración`);
        if (lessActiveMembers > 0) bodyParts.push(`${lessActiveMembers} miembro${lessActiveMembers !== 1 ? "s" : ""} menos activo${lessActiveMembers !== 1 ? "s" : ""}`);
        if (inCouncil > 0) bodyParts.push(`${inCouncil} en seguimiento de consejo`);

        if (bodyParts.length > 0) {
            const today = getEcuadorToday();
            const dateParts = getDatePartsInTimeZone(today, ECUADOR_TZ);
            const dateTag = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
            await notificationDispatcher.broadcastToUsers(
                councilEligible.inAppUserIds,
                {
                    title: "Recordatorio – Consejo de Cuórum",
                    body: bodyParts.join(", ") + ".",
                    url: "/council",
                    tag: `council-reminder-${dateTag}`,
                    context: { contextType: "council", actionUrl: "/council", actionType: "navigate" },
                },
                councilEligible.pushUserIds,
                councilTrace
            );
        }

        functions.logger.log("councilNotifications: done.");
        return null;
    });
