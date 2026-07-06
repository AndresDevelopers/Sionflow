"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.councilNotifications = exports.weeklyNotifications = exports.dailyNotifications = exports.onMissionaryAssignmentCreated = exports.onUrgentFamilyFlagged = exports.onServiceDeleted = exports.onServiceUpdated = exports.onServiceCreated = exports.onActivityDeleted = exports.onActivityUpdated = exports.onActivityCreated = exports.generateReport = exports.generateCompleteReport = exports.cleanupProfilePictures = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const date_fns_1 = require("date-fns");
const locale_1 = require("date-fns/locale");
const pizzip_1 = __importDefault(require("pizzip"));
const docxtemplater_1 = __importDefault(require("docxtemplater"));
const modern_image_module_1 = __importDefault(require("./modules/modern-image-module"));
const axios_1 = __importDefault(require("axios"));
const notification_dispatcher_1 = require("./modules/notification-dispatcher");
const webp = __importStar(require("webp-wasm"));
const pngjs_1 = require("pngjs");
admin.initializeApp();
const firestore = admin.firestore();
const storage = admin.storage();
const messaging = admin.messaging();
const notificationDispatcher = new notification_dispatcher_1.NotificationDispatcher(firestore, messaging, functions.logger);
// Ecuador timezone (no DST)
const ECUADOR_TZ = "America/Guayaquil";
/**
 * Sanitiza el nombre de organización recibido desde el frontend.
 * Evita que valores como undefined, null, "undefined", "null", o vacíos
 * lleguen a la plantilla DOCX.
 */
const sanitizeOrgName = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        return "Quórum de Élderes";
    }
    const lower = value.trim().toLowerCase();
    if (lower === "undefined" || lower === "null") {
        return "Quórum de Élderes";
    }
    return value.trim();
};
function resolveDateValue(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function") {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "object" && value && "seconds" in value) {
        const seconds = value.seconds;
        if (typeof seconds === "number") {
            const date = new Date(seconds * 1000);
            return Number.isNaN(date.getTime()) ? null : date;
        }
    }
    return null;
}
const getBirthdayStatusLabel = (status) => {
    if (!status)
        return null;
    const s = status.toLowerCase().trim();
    if (s === "inactive" || s === "inactivo")
        return "Inactivo";
    if (s === "less_active" || s === "menos_activo" || s.startsWith("menos"))
        return "Menos Activo";
    if (s === "active" || s === "activo")
        return "Activo";
    return null;
};
const normalizePersonName = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
const buildBirthdayDedupKey = (name, memberId) => {
    const normalizedName = normalizePersonName(name);
    return memberId ? `member:${memberId}` : `name:${normalizedName}`;
};
const MAX_DOC_IMAGE_WIDTH = 450;
const MAX_DOC_IMAGE_HEIGHT = 300;
const slugify = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const normalizeUrlKey = (value) => value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
const countNonEmptyUrls = (urls) => Array.isArray(urls) ? urls.filter((url) => typeof url === "string" && url.trim().length > 0).length : 0;
const isWebpBuffer = (buffer) => {
    if (buffer.length < 12)
        return false;
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
};
const convertWebpToPngBuffer = async (buffer) => {
    const decoded = await webp.decode(buffer);
    const png = new pngjs_1.PNG({ width: decoded.width, height: decoded.height });
    png.data = Buffer.from(decoded.data);
    return pngjs_1.PNG.sync.write(png);
};
const normalizeImageForDocx = async (buffer) => {
    if (buffer.length === 0)
        return buffer;
    if (isWebpBuffer(buffer)) {
        try {
            return await convertWebpToPngBuffer(buffer);
        }
        catch (error) {
            functions.logger.error("Error converting WEBP to PNG for report", { error });
            return buffer;
        }
    }
    return buffer;
};
const pickPreferredBaptism = (existing, candidate, sourcePriority) => {
    if (!existing)
        return candidate;
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
const createImageModuleFromUrls = async (urls) => {
    const buffers = await fetchImageBuffers(urls);
    return new modern_image_module_1.default({
        centered: true,
        getImage: (tagValue) => {
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
const extractStorageLocationFromUrl = (url) => {
    try {
        const normalizedUrl = normalizeUrlKey(url);
        if (normalizedUrl.startsWith("gs://")) {
            const parts = normalizedUrl.replace("gs://", "").split("/");
            const bucket = parts.shift() ?? null;
            const path = parts.join("/");
            if (!bucket || !path)
                return null;
            return { bucket, path };
        }
        // Formato: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/ENCODED_PATH?...
        if (url.includes("firebasestorage.googleapis.com")) {
            const match = normalizedUrl.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
            if (match) {
                const bucket = match[1] ?? null;
                const encodedPath = match[2];
                const decodedPath = decodeURIComponent(encodedPath);
                if (!decodedPath)
                    return null;
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
                if (!bucket || !path)
                    return null;
                return { bucket, path };
            }
        }
        catch {
            // ignore
        }
        return null;
    }
    catch (error) {
        functions.logger.error("Error extracting storage location", { url, error });
        return null;
    }
};
const fetchImageBuffers = async (urls) => {
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
                    return [normalizedUrl, normalizedBuffer];
                }
                else {
                    functions.logger.warn("File not found in Storage", { storagePath: location.path, url: normalizedUrl });
                }
            }
            // Fallback: usar axios para URLs externas o si no se pudo extraer la ruta
            const response = await axios_1.default.get(normalizedUrl, {
                responseType: "arraybuffer",
                headers: {
                    Accept: "image/*",
                },
                timeout: 30000, // 30 segundos de timeout
            });
            functions.logger.info("Image downloaded via HTTP", { url: normalizedUrl });
            const buffer = Buffer.from(response.data);
            const normalizedBuffer = await normalizeImageForDocx(buffer);
            return [normalizedUrl, normalizedBuffer];
        }
        catch (error) {
            functions.logger.error("Error downloading image for report", { url: normalizedUrl, error });
            return [normalizedUrl, Buffer.alloc(0)];
        }
    }));
    return new Map(entries);
};
const prepareActivitiesDocData = async (items) => {
    const uniqueImageUrls = new Set();
    const activitiesData = items.map((activity) => {
        const activityDate = activity.date.toDate();
        const dateStr = (0, date_fns_1.format)(activityDate, "dd/MM/yyyy", { locale: locale_1.es });
        const fullDate = (0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es });
        const timeStr = activity.time ? ` ${activity.time}` : "";
        let fullDescription = activity.description || "";
        if (activity.additionalText) {
            fullDescription += `\n\nTexto Adicional: ${activity.additionalText}`;
        }
        const images = (activity.imageUrls ?? [])
            .filter((url) => !!url)
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
    const galleries = activitiesData
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
const prepareBaptismsDocData = async (baptisms) => {
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
    const baptismsData = baptisms.map((baptism) => {
        const baptismDate = baptism.date.toDate();
        const fullDate = (0, date_fns_1.format)(baptismDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es });
        const shortDate = (0, date_fns_1.format)(baptismDate, "dd/MM/yyyy", { locale: locale_1.es });
        const dayOfWeek = (0, date_fns_1.format)(baptismDate, "EEEE", { locale: locale_1.es });
        const month = (0, date_fns_1.format)(baptismDate, "MMMM", { locale: locale_1.es });
        // Solo usar las fotos específicas del bautismo (baptismPhotos)
        // NO incluir la foto de perfil (photoURL) en el reporte
        const allImageUrls = [];
        // Agregar solo las fotos del bautismo
        if (baptism.baptismPhotos && baptism.baptismPhotos.length > 0) {
            functions.logger.info("Adding baptismPhotos for baptism", {
                name: baptism.name,
                count: baptism.baptismPhotos.length,
                photos: baptism.baptismPhotos
            });
            allImageUrls.push(...baptism.baptismPhotos.filter((url) => !!url));
        }
        if (allImageUrls.length === 0 && baptism.photoURL && baptism.photoURL.trim()) {
            allImageUrls.push(baptism.photoURL.trim());
        }
        const images = allImageUrls.map((url, index) => ({
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
    const baptismGalleries = baptismsData
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
exports.cleanupProfilePictures = functions.storage.object().onFinalize(async (object) => {
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
exports.generateCompleteReport = functions
    .runWith({ timeoutSeconds: 540, memory: "1GB" })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const year = data.year || (0, date_fns_1.getYear)(new Date());
    const includeAllActivities = data.includeAllActivities || false;
    const organizacion = sanitizeOrgName(data.organizacion);
    try {
        const start = (0, date_fns_1.startOfYear)(new Date(year, 0, 1));
        const end = (0, date_fns_1.endOfYear)(new Date(year, 11, 31));
        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);
        // Determinar queries según si incluye todas las actividades o solo las del año
        const activitiesQuery = includeAllActivities
            ? firestore.collection("c_actividades").orderBy("date", "desc")
            : firestore.collection("c_actividades")
                .where("date", ">=", startTimestamp)
                .where("date", "<=", endTimestamp)
                .orderBy("date", "desc");
        const servicesQuery = includeAllActivities
            ? firestore.collection("c_servicios").orderBy("date", "desc")
            : firestore.collection("c_servicios")
                .where("date", ">=", startTimestamp)
                .where("date", "<=", endTimestamp)
                .orderBy("date", "desc");
        // Obtener todas las colecciones necesarias
        const [activitiesSnapshot, servicesSnapshot, baptismsSnapshot, futureMembersSnapshot, convertsSnapshot, membersSnapshot, reportAnswersDoc] = await Promise.all([
            activitiesQuery.get(),
            servicesQuery.get(),
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
        const allActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Procesar servicios - solo incluir los que tienen imágenes
        const allServices = servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const servicesWithImages = allServices.filter(s => s.imageUrls && s.imageUrls.length > 0 && s.imageUrls.some(url => url && url.trim() !== ''));
        // Combinar actividades y servicios con imágenes
        const combinedActivitiesAndServices = [...allActivities, ...servicesWithImages];
        const activitiesToProcess = includeAllActivities
            ? combinedActivitiesAndServices
            : combinedActivitiesAndServices.filter(a => a.date.toDate() >= start && a.date.toDate() <= end);
        // Procesar bautismos con imágenes
        const allBaptisms = [
            ...futureMembersSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.name || "Sin nombre",
                    date: data.baptismDate,
                    source: "Futuro Miembro",
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
                    source: "Nuevo Converso",
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
                    source: "Manual",
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
                    source: "Automático",
                    photoURL: data.photoURL,
                    baptismPhotos: data.baptismPhotos || []
                };
            })
        ].filter(b => b.date);
        // Deduplicar bautismos por nombre y fecha
        // Prioridad: Manual > Nuevo Converso > Futuro Miembro > Automático
        const sourcePriority = {
            "Manual": 1,
            "Nuevo Converso": 2,
            "Futuro Miembro": 3,
            "Automático": 4
        };
        const baptismMap = new Map();
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
        const baptisms = Array.from(baptismMap.values())
            .sort((a, b) => b.date.toMillis() - a.date.toMillis());
        const answers = (reportAnswersDoc.data() || {});
        // Calcular estadísticas generales
        const totalActivities = activitiesToProcess.length;
        const totalBaptisms = baptisms.length;
        const currentYearActivities = allActivities.filter(a => a.date.toDate() >= start && a.date.toDate() <= end);
        const activitiesByMonth = activitiesToProcess.reduce((acc, activity) => {
            const month = (0, date_fns_1.format)(activity.date.toDate(), "MMMM yyyy", { locale: locale_1.es });
            if (!acc[month])
                acc[month] = [];
            acc[month].push(activity);
            return acc;
        }, {});
        const { activitiesData, totalImages, galleries, activitiesWithImages, } = await prepareActivitiesDocData(activitiesToProcess);
        const { baptismsData, totalBaptismImages, baptismGalleries, baptismsWithImages, } = await prepareBaptismsDocData(baptisms);
        // Combinar todas las URLs de imágenes para el módulo
        const allImageUrls = new Set();
        // Agregar imágenes de actividades
        activitiesData.forEach(activity => {
            activity.images.forEach(img => allImageUrls.add(img.image));
        });
        // Agregar imágenes de bautismos
        baptismsData.forEach(baptism => {
            if (baptism.photoURL)
                allImageUrls.add(baptism.photoURL);
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
            activities: activities.map((activity) => {
                const docActivity = activitiesDataMap.get(activity.id);
                const activityDate = activity.date.toDate();
                return {
                    title: docActivity?.title ?? activity.title,
                    date: (0, date_fns_1.format)(activityDate, "dd 'de' MMMM", { locale: locale_1.es }),
                    fullDate: docActivity?.fullDate ?? (0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es }),
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
                        caption: `${activity.title} - ${(0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es })}`,
                        title: activity.title,
                        date: (0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es }),
                        order: index + 1,
                        description: activity.description,
                        location: activity.location || "",
                    })),
                };
            }),
        }));
        // Los bautismos ya están preparados con imágenes en baptismsData
        const baptismsText = baptismsData.map((b) => `${b.nombre} (${b.fecha})`).join("\n");
        // Obtener template
        const bucket = storage.bucket();
        const file = bucket.file("template/reporte.docx");
        const [templateBuffer] = await file.download();
        const zip = new pizzip_1.default(templateBuffer);
        const doc = new docxtemplater_1.default(zip, {
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
            periodo_cubierto: `${(0, date_fns_1.format)(start, "d 'de' MMMM", { locale: locale_1.es })} al ${(0, date_fns_1.format)(end, "d 'de' MMMM 'de' yyyy", { locale: locale_1.es })}`,
            meses_con_actividades: Object.keys(activitiesByMonth).length,
            distribucion_bautismos: baptisms.reduce((acc, b) => {
                if (!acc[b.source])
                    acc[b.source] = 0;
                acc[b.source]++;
                return acc;
            }, {})
        };
        // Renderizar documento completo
        doc.render({
            org: organizacion,
            anho_reporte: year,
            fecha_reporte: (0, date_fns_1.format)(new Date(), "d 'de' MMMM 'de' yyyy", { locale: locale_1.es }),
            fecha_generacion: (0, date_fns_1.format)(new Date(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: locale_1.es }),
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
                fecha: (0, date_fns_1.format)(a.date.toDate(), "dd/MM/yyyy", { locale: locale_1.es }),
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
    }
    catch (error) {
        functions.logger.error("Error generating complete report:", error);
        throw new functions.https.HttpsError("internal", "Error generating complete report: " + error);
    }
});
exports.generateReport = functions
    .runWith({ timeoutSeconds: 300, memory: "512MB" })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const year = data.year || (0, date_fns_1.getYear)(new Date());
    const includeAllActivities = data.includeAllActivities || false;
    const organizacion = sanitizeOrgName(data.organizacion);
    try {
        const start = (0, date_fns_1.startOfYear)(new Date(year, 0, 1));
        const end = (0, date_fns_1.endOfYear)(new Date(year, 11, 31));
        const startTimestamp = admin.firestore.Timestamp.fromDate(start);
        const endTimestamp = admin.firestore.Timestamp.fromDate(end);
        const activitiesSnapshot = await firestore.collection("c_actividades").orderBy("date", "desc").get();
        const allActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
                source: "Futuro Miembro",
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
                source: "Manual",
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
                source: "Nuevo Converso",
                photoURL: data.photoURL,
                baptismPhotos: data.baptismPhotos || []
            };
        });
        const allBaptisms = [...fromFutureMembers, ...fromManual, ...fromConverts]
            .filter(b => b.date);
        // Deduplicar bautismos por nombre y fecha
        // Prioridad: Manual > Nuevo Converso > Futuro Miembro
        const sourcePriority = {
            "Manual": 1,
            "Nuevo Converso": 2,
            "Futuro Miembro": 3
        };
        const baptismMap = new Map();
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
        const baptisms = Array.from(baptismMap.values())
            .sort((a, b) => b.date.toMillis() - a.date.toMillis());
        const reportAnswersDoc = await firestore.collection("c_reporte_anual").doc(String(year)).get();
        const answers = (reportAnswersDoc.data() || {});
        const activitiesToProcess = includeAllActivities ? allActivities : currentYearActivities;
        const { activitiesData, totalImages, galleries, activitiesWithImages, } = await prepareActivitiesDocData(activitiesToProcess);
        const { baptismsData, totalBaptismImages, baptismGalleries, baptismsWithImages, } = await prepareBaptismsDocData(baptisms);
        // Combinar todas las URLs de imágenes para el módulo
        const allImageUrls = new Set();
        // Agregar imágenes de actividades
        activitiesData.forEach(activity => {
            activity.images.forEach(img => allImageUrls.add(img.image));
        });
        // Agregar imágenes de bautismos
        baptismsData.forEach(baptism => {
            if (baptism.photoURL)
                allImageUrls.add(baptism.photoURL);
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
        const activitiesByMonth = activitiesToProcess.reduce((acc, activity) => {
            const month = (0, date_fns_1.format)(activity.date.toDate(), "MMMM yyyy", { locale: locale_1.es });
            if (!acc[month])
                acc[month] = [];
            acc[month].push(activity);
            return acc;
        }, {});
        // Preparar datos para el template
        const monthlyActivities = Object.entries(activitiesByMonth)
            .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
            .map(([month, activities]) => ({
            month,
            count: activities.length,
            activities: activities.map((activity) => {
                const docActivity = activitiesDataMap.get(activity.id);
                const activityDate = activity.date.toDate();
                return {
                    title: docActivity?.title ?? activity.title,
                    date: (0, date_fns_1.format)(activityDate, "dd/MM/yyyy", { locale: locale_1.es }),
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
                        caption: `${activity.title} - ${(0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es })}`,
                        title: activity.title,
                        date: (0, date_fns_1.format)(activityDate, "dd 'de' MMMM 'de' yyyy", { locale: locale_1.es }),
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
        const zip = new pizzip_1.default(templateBuffer);
        const doc = new docxtemplater_1.default(zip, {
            paragraphLoop: true,
            linebreaks: true,
            modules: [imageModule],
        });
        doc.render({
            org: organizacion,
            anho_reporte: year,
            fecha_reporte: (0, date_fns_1.format)(new Date(), "d MMMM yyyy", { locale: locale_1.es }),
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
            fecha_generacion: (0, date_fns_1.format)(new Date(), "d 'de' MMMM 'de' yyyy 'a las' HH:mm", { locale: locale_1.es })
        });
        const buffer = doc.getZip().generate({
            type: "nodebuffer",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        return { fileContents: buffer.toString("base64") };
    }
    catch (error) {
        functions.logger.error("Error generating report:", error);
        if (error instanceof Error) {
            throw new functions.https.HttpsError("internal", error.message, error);
        }
        throw new functions.https.HttpsError("internal", "An unknown error occurred.");
    }
});
exports.onActivityCreated = functions.firestore
    .document("c_actividades/{activityId}")
    .onCreate(async (snapshot, context) => {
    try {
        const activity = snapshot.data();
        const activityId = context.params.activityId;
        const docBarrioOrg = activity.barrioOrg || null;
        const activityTitle = activity?.title?.trim() || "Nueva actividad";
        const activityDate = activity?.date && typeof activity.date.toDate === "function"
            ? activity.date.toDate()
            : null;
        const formattedDate = activityDate
            ? (0, date_fns_1.format)(activityDate, "EEEE d 'de' MMMM yyyy", { locale: locale_1.es })
            : null;
        const timeSegment = activity?.time ? ` a las ${activity.time}` : "";
        const details = [];
        if (formattedDate) {
            details.push(`para el ${formattedDate}${timeSegment}`);
        }
        if (activity?.location) {
            details.push(`en ${activity.location}`);
        }
        const detailText = details.length > 0 ? ` ${details.join(" ")}` : "";
        const body = `Se programó la actividad "${activityTitle}"${detailText}.`;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Nueva Actividad Programada",
            body,
            url: "/reports/activities",
            tag: `activity-${activityId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "activity",
                contextId: activityId,
                actionUrl: "/reports/activities",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast activity notification", {
            error,
            activityId: context.params.activityId,
        });
    }
});
exports.onActivityUpdated = functions.firestore
    .document("c_actividades/{activityId}")
    .onUpdate(async (change, context) => {
    try {
        const before = change.before.data();
        const after = change.after.data();
        if (!after)
            return;
        const activityId = context.params.activityId;
        const activityTitle = after.title?.trim() || "Actividad";
        const prevTitle = before?.title?.trim() || activityTitle;
        const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Actividad Actualizada",
            body: `La actividad "${prevTitle}" ha sido actualizada.`,
            url: "/reports/activities",
            tag: `activity-updated-${activityId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "activity",
                contextId: activityId,
                actionUrl: "/reports/activities",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast activity update notification", {
            error,
            activityId: context.params.activityId,
        });
    }
});
exports.onActivityDeleted = functions.firestore
    .document("c_actividades/{activityId}")
    .onDelete(async (snapshot, context) => {
    try {
        const activity = snapshot.data();
        const activityTitle = activity?.title?.trim() || "Actividad";
        const docBarrioOrg = activity?.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Actividad Eliminada",
            body: `La actividad "${activityTitle}" ha sido eliminada.`,
            url: "/reports/activities",
            tag: `activity-deleted-${context.params.activityId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "activity",
                actionUrl: "/reports/activities",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast activity delete notification", {
            error,
            activityId: context.params.activityId,
        });
    }
});
exports.onServiceCreated = functions.firestore
    .document("c_servicios/{serviceId}")
    .onCreate(async (snapshot, context) => {
    try {
        const svc = snapshot.data();
        const serviceId = context.params.serviceId;
        const title = svc.title?.trim() || "Nuevo servicio";
        const svcDate = svc.date?.toDate
            ? (0, date_fns_1.format)(svc.date.toDate(), "d MMM yyyy", { locale: locale_1.es })
            : "";
        const docBarrioOrg = svc.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Nuevo Servicio Programado",
            body: `Se programó el servicio "${title}"${svcDate ? ` para el ${svcDate}` : ""}.`,
            url: "/service",
            tag: `service-created-${serviceId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "service",
                contextId: serviceId,
                actionUrl: "/service",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast service creation notification", { error });
    }
});
exports.onServiceUpdated = functions.firestore
    .document("c_servicios/{serviceId}")
    .onUpdate(async (change, context) => {
    try {
        const before = change.before.data();
        const after = change.after.data();
        if (!after)
            return;
        const serviceId = context.params.serviceId;
        const title = after.title?.trim() || before?.title?.trim() || "Servicio";
        const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Servicio Actualizado",
            body: `El servicio "${title}" ha sido actualizado.`,
            url: "/service",
            tag: `service-updated-${serviceId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "service",
                contextId: serviceId,
                actionUrl: "/service",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast service update notification", { error });
    }
});
exports.onServiceDeleted = functions.firestore
    .document("c_servicios/{serviceId}")
    .onDelete(async (snapshot, context) => {
    try {
        const svc = snapshot.data();
        const title = svc?.title?.trim() || "Servicio";
        const serviceId = context.params.serviceId;
        const docBarrioOrg = svc?.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Servicio Eliminado",
            body: `El servicio "${title}" ha sido eliminado.`,
            url: "/service",
            tag: `service-deleted-${serviceId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "service",
                actionUrl: "/service",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
        functions.logger.error("Failed to broadcast service delete notification", { error });
    }
});
exports.onUrgentFamilyFlagged = functions.firestore
    .document("c_ministracion/{companionshipId}")
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after?.families || after.families.length === 0) {
        return;
    }
    const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;
    const previousStatus = new Map((before?.families ?? []).map((family) => [family.name, family.isUrgent]));
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
    const eligible = getEligibleUsers(allUsers, "council", docBarrioOrg);
    await Promise.all(newlyUrgent.map(async (family) => {
        const familyName = family.name || "Familia";
        const familySlug = slugify(familyName) || "familia";
        try {
            const normalizedObservation = family.observation?.trim();
            const body = normalizedObservation
                ? `La familia ${familyName} requiere ayuda: ${normalizedObservation}`
                : `La familia ${familyName} ha sido marcada como urgente.`;
            const contextId = `${context.params.companionshipId}:${familySlug}`;
            await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
                title: "Nueva familia con necesidad urgente",
                body,
                url: "/ministering/urgent",
                tag: `urgent-family-${context.params.companionshipId}-${familySlug}`,
                barrioOrg: docBarrioOrg || null,
                context: {
                    contextType: "urgent_family",
                    contextId,
                    actionUrl: "/ministering/urgent",
                    actionType: "navigate",
                },
            }, eligible.pushUserIds);
        }
        catch (error) {
            functions.logger.error("Failed to broadcast urgent family notification", {
                error,
                companionshipId: context.params.companionshipId,
                family: familyName,
            });
        }
    }));
});
exports.onMissionaryAssignmentCreated = functions.firestore
    .document("c_obra_misional_asignaciones/{assignmentId}")
    .onCreate(async (snapshot, context) => {
    try {
        const assignment = snapshot.data();
        const assignmentId = context.params.assignmentId;
        const description = assignment?.description?.trim();
        const body = description && description.length > 0
            ? description
            : "Se registró una nueva asignación misional.";
        const docBarrioOrg = assignment?.barrioOrg || null;
        const allUsers = await getAllUsersNotificationData();
        const eligible = getEligibleUsers(allUsers, "missionaryWork", docBarrioOrg);
        await notificationDispatcher.broadcastToUsers(eligible.inAppUserIds, {
            title: "Nueva Asignación Misional",
            body,
            url: "/missionary-work",
            tag: `missionary-assignment-${assignmentId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "missionary_assignment",
                contextId: assignmentId,
                actionUrl: "/missionary-work",
                actionType: "navigate",
            },
        }, eligible.pushUserIds);
    }
    catch (error) {
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
function getEcuadorToday() {
    const today = getDatePartsInTimeZone(new Date(), ECUADOR_TZ);
    return new Date(today.year, today.month - 1, today.day);
}
function getDatePartsInTimeZone(date, timeZone) {
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
function getBirthdayDateInEcuador(birthDate, year) {
    const date = resolveDateValue(birthDate);
    if (!date)
        return null;
    const parts = getDatePartsInTimeZone(date, ECUADOR_TZ);
    return new Date(year, parts.month - 1, parts.day);
}
/**
 * Fetch all users with their notification preferences and visible pages.
 * Defaults: inApp = true, push = false, all categories = true.
 * visiblePages = null means "never configured" → all pages are visible
 * (matches the frontend default in settings/page.tsx).
 */
async function getAllUsersNotificationData() {
    const snapshot = await firestore.collection("c_users").get();
    return snapshot.docs.map((doc) => {
        const d = doc.data();
        const barrio = d.barrio || "Libertad";
        const organizacion = d.organizacion || "Quórum de Élderes";
        return {
            userId: doc.id,
            visiblePages: Array.isArray(d.visiblePages) ? d.visiblePages : null,
            inAppEnabled: d.inAppNotificationsEnabled !== false,
            pushEnabled: d.pushNotificationsEnabled === true,
            notificationPrefs: {
                inApp: d.notificationPrefs?.inApp ?? {},
                push: d.notificationPrefs?.push ?? {},
            },
            barrioOrg: `${barrio}|${organizacion}`,
        };
    });
}
const CATEGORY_PAGE = {
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
function getEcuadorNowLabel() {
    return new Intl.DateTimeFormat("es-EC", {
        timeZone: ECUADOR_TZ,
        dateStyle: "medium",
        timeStyle: "medium",
    }).format(new Date());
}
function buildNotificationTrace(source, category) {
    return {
        source,
        category,
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    };
}
/**
 * Given all users and a category, return those eligible to receive in-app
 * and/or push notifications for that category.
 *
 * @param users - All users with notification preferences
 * @param category - Notification category
 * @param docBarrioOrg - Optional barrioOrg from the triggering document. If provided,
 *   only users with matching barrioOrg will be eligible. This ensures notifications
 *   are scoped to the correct barrio + organization.
 */
function getEligibleUsers(users, category, docBarrioOrg) {
    const page = CATEGORY_PAGE[category];
    const inAppUserIds = [];
    const pushUserIds = [];
    for (const u of users) {
        // null = visiblePages was never configured → all pages are visible (matches frontend default)
        const hasPage = u.visiblePages === null || u.visiblePages.includes(page);
        if (!hasPage)
            continue;
        // Filter by barrioOrg: never send cross-organization notifications.
        // If the document has no barrioOrg, only legacy users without barrioOrg are eligible.
        if (docBarrioOrg) {
            if (u.barrioOrg && u.barrioOrg !== docBarrioOrg)
                continue;
        }
        else {
            if (u.barrioOrg)
                continue;
        }
        const inAppCat = u.notificationPrefs.inApp[category] !== false;
        const pushCat = u.notificationPrefs.push[category] !== false;
        if (u.inAppEnabled && inAppCat)
            inAppUserIds.push(u.userId);
        if (u.pushEnabled && pushCat)
            pushUserIds.push(u.userId);
    }
    return { inAppUserIds, pushUserIds };
}
// ─────────────────────────────────────────────────────────────────────────────
// DAILY NOTIFICATIONS – 09:00 Ecuador (America/Guayaquil)
// Covers: Birthdays, Future Members, Services, Activities
// ─────────────────────────────────────────────────────────────────────────────
exports.dailyNotifications = functions.pubsub
    .schedule("0 9 * * *")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
    functions.logger.log("dailyNotifications: running...", {
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    });
    const today = getEcuadorToday();
    const in14Days = (0, date_fns_1.addDays)(today, 14);
    const in3Days = (0, date_fns_1.addDays)(today, 3);
    const allUsers = await getAllUsersNotificationData();
    // ── Cumpleaños ──────────────────────────────────────────────────────
    const birthdayTrace = buildNotificationTrace("dailyNotifications", "birthdays");
    {
        const [birthdaysSnap, membersForBirthdaySnap] = await Promise.all([
            firestore.collection("c_cumpleanos").get(),
            firestore.collection("c_miembros").get(),
        ]);
        const sentBirthdays14 = new Set();
        const sentBirthdaysToday = new Set();
        const coveredBirthdayKeys = new Set();
        // Build member status map for quick lookup by memberId
        const memberStatusMap = new Map();
        for (const memberDoc of membersForBirthdaySnap.docs) {
            const m = memberDoc.data();
            if (m.status)
                memberStatusMap.set(memberDoc.id, m.status);
        }
        // Process birthdays from c_cumpleanos collection
        for (const doc of birthdaysSnap.docs) {
            const b = doc.data();
            const docBarrioOrg = b.barrioOrg || null;
            const birthdayKey = buildBirthdayDedupKey(b.name, b.memberId);
            const normalizedNameKey = buildBirthdayDedupKey(b.name);
            coveredBirthdayKeys.add(birthdayKey);
            coveredBirthdayKeys.add(normalizedNameKey);
            const nextBirthday = getBirthdayDateInEcuador(b.birthDate, today.getFullYear());
            if (!nextBirthday)
                continue;
            // Get eligible users scoped to this birthday's barrioOrg
            const bdEligible = getEligibleUsers(allUsers, "birthdays", docBarrioOrg);
            if (bdEligible.inAppUserIds.length === 0 && bdEligible.pushUserIds.length === 0)
                continue;
            // Resolve member status if birthday is linked to a member
            const memberStatus = b.memberId ? memberStatusMap.get(b.memberId) : undefined;
            const statusLabel = getBirthdayStatusLabel(memberStatus);
            const nameWithStatus = statusLabel ? `${b.name} (${statusLabel})` : b.name;
            if ((0, date_fns_1.isSameDay)(nextBirthday, in14Days) && !sentBirthdays14.has(birthdayKey)) {
                sentBirthdays14.add(birthdayKey);
                await notificationDispatcher.broadcastToUsers(bdEligible.inAppUserIds, {
                    title: "Próximo Cumpleaños",
                    body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                    url: "/birthdays",
                    tag: `birthday-14d-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                }, bdEligible.pushUserIds, birthdayTrace);
            }
            if ((0, date_fns_1.isSameDay)(nextBirthday, today) && !sentBirthdaysToday.has(birthdayKey)) {
                sentBirthdaysToday.add(birthdayKey);
                await notificationDispatcher.broadcastToUsers(bdEligible.inAppUserIds, {
                    title: "¡Feliz Cumpleaños!",
                    body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                    url: "/birthdays",
                    tag: `birthday-today-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                }, bdEligible.pushUserIds, birthdayTrace);
            }
        }
        // Also process member birthdays from c_miembros (not in c_cumpleanos)
        for (const memberDoc of membersForBirthdaySnap.docs) {
            const m = memberDoc.data();
            if (!m.birthDate || !m.firstName || !m.lastName)
                continue;
            if (m.status === "deceased" || m.status === "fallecido" || m.status === "fallecida")
                continue;
            const memberDocBarrioOrg = m.barrioOrg || null;
            const memberName = `${m.firstName} ${m.lastName}`;
            const memberBirthdayKey = buildBirthdayDedupKey(memberName, memberDoc.id);
            const memberNameKey = buildBirthdayDedupKey(memberName);
            // Skip if already covered by c_cumpleanos record (deduplication by memberId or normalized name)
            if (coveredBirthdayKeys.has(memberBirthdayKey) || coveredBirthdayKeys.has(memberNameKey))
                continue;
            const nextBirthday = getBirthdayDateInEcuador(m.birthDate, today.getFullYear());
            if (!nextBirthday)
                continue;
            const bdEligible = getEligibleUsers(allUsers, "birthdays", memberDocBarrioOrg);
            if (bdEligible.inAppUserIds.length === 0 && bdEligible.pushUserIds.length === 0)
                continue;
            const statusLabel = getBirthdayStatusLabel(m.status);
            const nameWithStatus = statusLabel ? `${memberName} (${statusLabel})` : memberName;
            if ((0, date_fns_1.isSameDay)(nextBirthday, in14Days) && !sentBirthdays14.has(memberBirthdayKey)) {
                sentBirthdays14.add(memberBirthdayKey);
                await notificationDispatcher.broadcastToUsers(bdEligible.inAppUserIds, {
                    title: "Próximo Cumpleaños",
                    body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                    url: "/birthdays",
                    tag: `birthday-14d-member-${memberDoc.id}`,
                    barrioOrg: memberDocBarrioOrg || null,
                    context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                }, bdEligible.pushUserIds, birthdayTrace);
            }
            if ((0, date_fns_1.isSameDay)(nextBirthday, today) && !sentBirthdaysToday.has(memberBirthdayKey)) {
                sentBirthdaysToday.add(memberBirthdayKey);
                await notificationDispatcher.broadcastToUsers(bdEligible.inAppUserIds, {
                    title: "¡Feliz Cumpleaños!",
                    body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                    url: "/birthdays",
                    tag: `birthday-today-member-${memberDoc.id}`,
                    barrioOrg: memberDocBarrioOrg || null,
                    context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                }, bdEligible.pushUserIds, birthdayTrace);
            }
        }
    }
    // ── Futuros Miembros – 3 días antes del bautismo ────────────────────
    const futureMembersTrace = buildNotificationTrace("dailyNotifications", "futureMembers");
    {
        const fmSnap = await firestore.collection("c_futuros_miembros").get();
        for (const doc of fmSnap.docs) {
            const fm = doc.data();
            if (fm.isBaptized)
                continue;
            const baptismDate = fm.baptismDate?.toDate();
            if (!baptismDate)
                continue;
            const baptismDay = new Date(baptismDate.getFullYear(), baptismDate.getMonth(), baptismDate.getDate());
            if ((0, date_fns_1.isSameDay)(baptismDay, in3Days)) {
                const docBarrioOrg = fm.barrioOrg || null;
                const fmEligible = getEligibleUsers(allUsers, "futureMembers", docBarrioOrg);
                if (fmEligible.inAppUserIds.length === 0 && fmEligible.pushUserIds.length === 0)
                    continue;
                await notificationDispatcher.broadcastToUsers(fmEligible.inAppUserIds, {
                    title: "Próximo Bautismo",
                    body: `Faltan 3 días para el bautismo de ${fm.name} (${(0, date_fns_1.format)(baptismDate, "d MMM yyyy", { locale: locale_1.es })}).`,
                    url: "/future-members",
                    tag: `future-member-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "future_member", contextId: doc.id, actionUrl: "/future-members", actionType: "navigate" },
                }, fmEligible.pushUserIds, futureMembersTrace);
            }
        }
    }
    // ── Servicios – 14 días antes y el mismo día ─────────────────────────
    const serviceTrace = buildNotificationTrace("dailyNotifications", "service");
    {
        const servicesSnap = await firestore.collection("c_servicios").get();
        for (const doc of servicesSnap.docs) {
            const svc = doc.data();
            const svcDate = svc.date.toDate();
            const svcDay = new Date(svcDate.getFullYear(), svcDate.getMonth(), svcDate.getDate());
            const timeStr = svc.time ? ` a las ${svc.time}` : "";
            const docBarrioOrg = svc.barrioOrg || null;
            if ((0, date_fns_1.isSameDay)(svcDay, in14Days)) {
                const svcEligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
                if (svcEligible.inAppUserIds.length === 0 && svcEligible.pushUserIds.length === 0)
                    continue;
                await notificationDispatcher.broadcastToUsers(svcEligible.inAppUserIds, {
                    title: "Recordatorio de Servicio",
                    body: `El servicio "${svc.title}" es en 14 días (${(0, date_fns_1.format)(svcDate, "d MMM yyyy", { locale: locale_1.es })}).`,
                    url: "/service",
                    tag: `service-14d-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                }, svcEligible.pushUserIds, serviceTrace);
            }
            if ((0, date_fns_1.isSameDay)(svcDay, today)) {
                const svcEligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
                if (svcEligible.inAppUserIds.length === 0 && svcEligible.pushUserIds.length === 0)
                    continue;
                await notificationDispatcher.broadcastToUsers(svcEligible.inAppUserIds, {
                    title: "¡Servicio Hoy!",
                    body: `El servicio "${svc.title}" es hoy${timeStr}.`,
                    url: "/service",
                    tag: `service-today-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                }, svcEligible.pushUserIds, serviceTrace);
            }
        }
    }
    // ── Actividades – 14 días antes y el mismo día ───────────────────────
    const activitiesTrace = buildNotificationTrace("dailyNotifications", "activities");
    {
        const actSnap = await firestore.collection("c_actividades").get();
        for (const doc of actSnap.docs) {
            const act = doc.data();
            const actDate = act.date.toDate();
            const actDay = new Date(actDate.getFullYear(), actDate.getMonth(), actDate.getDate());
            const timeStr = act.time ? ` a las ${act.time}` : "";
            const docBarrioOrg = act.barrioOrg || null;
            if ((0, date_fns_1.isSameDay)(actDay, in14Days)) {
                const actEligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
                if (actEligible.inAppUserIds.length === 0 && actEligible.pushUserIds.length === 0)
                    continue;
                await notificationDispatcher.broadcastToUsers(actEligible.inAppUserIds, {
                    title: "Recordatorio de Actividad",
                    body: `La actividad "${act.title}" es en 14 días (${(0, date_fns_1.format)(actDate, "d MMM yyyy", { locale: locale_1.es })}).`,
                    url: "/reports/activities",
                    tag: `activity-14d-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "activity", contextId: doc.id, actionUrl: "/reports/activities", actionType: "navigate" },
                }, actEligible.pushUserIds, activitiesTrace);
            }
            if ((0, date_fns_1.isSameDay)(actDay, today)) {
                const actEligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
                if (actEligible.inAppUserIds.length === 0 && actEligible.pushUserIds.length === 0)
                    continue;
                await notificationDispatcher.broadcastToUsers(actEligible.inAppUserIds, {
                    title: "¡Actividad Hoy!",
                    body: `La actividad "${act.title}" es hoy${timeStr}.`,
                    url: "/reports/activities",
                    tag: `activity-today-${doc.id}`,
                    barrioOrg: docBarrioOrg || null,
                    context: { contextType: "activity", contextId: doc.id, actionUrl: "/reports/activities", actionType: "navigate" },
                }, actEligible.pushUserIds, activitiesTrace);
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
exports.weeklyNotifications = functions.pubsub
    .schedule("0 9 * * 1")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
    functions.logger.log("weeklyNotifications: running...", {
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    });
    const allUsers = await getAllUsersNotificationData();
    // ── Observaciones ────────────────────────────────────────────────────
    const observationsTrace = buildNotificationTrace("weeklyNotifications", "observations");
    {
        const [membersSnap, healthSnap, ministeringSnap] = await Promise.all([
            firestore.collection("c_miembros").get(),
            firestore.collection("c_observaciones_salud").get(),
            firestore.collection("c_ministracion").get(),
        ]);
        const barrioOrgStats = new Map();
        const getStats = (key) => {
            if (!barrioOrgStats.has(key)) {
                barrioOrgStats.set(key, {
                    sinInvestidura: 0, sinOrdenanzaElder: 0, sinSacerdocioMayor: 0,
                    inactivos: 0, menosActivos: 0, urgentes: 0, enConsejo: 0,
                    urgentFamilies: 0, healthCount: 0,
                });
            }
            return barrioOrgStats.get(key);
        };
        membersSnap.forEach((doc) => {
            const m = doc.data();
            const key = m.barrioOrg || "unknown";
            const s = getStats(key);
            const ords = m.ordinances ?? [];
            if (!ords.includes("endowment"))
                s.sinInvestidura++;
            if (!ords.includes("elder_ordination") && !ords.includes("high_priest_ordination"))
                s.sinOrdenanzaElder++;
            if (!ords.includes("high_priest_ordination") && !ords.includes("elder_ordination"))
                s.sinSacerdocioMayor++;
            if (m.status === "inactive")
                s.inactivos++;
            if (m.status === "less_active")
                s.menosActivos++;
            if (m.isUrgent)
                s.urgentes++;
            if (m.isInCouncil)
                s.enConsejo++;
        });
        ministeringSnap.forEach((doc) => {
            const c = doc.data();
            const key = c.barrioOrg || "unknown";
            const s = getStats(key);
            (c.families ?? []).forEach((f) => { if (f.isUrgent)
                s.urgentFamilies++; });
        });
        healthSnap.forEach((doc) => {
            const data = doc.data();
            const key = data.barrioOrg || "unknown";
            const s = getStats(key);
            s.healthCount++;
        });
        // Send per-barrioOrg notifications
        for (const [barrioOrg, s] of barrioOrgStats.entries()) {
            const obsEligible = getEligibleUsers(allUsers, "observations", barrioOrg);
            if (obsEligible.inAppUserIds.length === 0 && obsEligible.pushUserIds.length === 0)
                continue;
            const bodyParts = [];
            if (s.sinInvestidura > 0)
                bodyParts.push(`${s.sinInvestidura} sin investidura`);
            if (s.sinOrdenanzaElder > 0)
                bodyParts.push(`${s.sinOrdenanzaElder} sin ordenanza de élderes`);
            if (s.sinSacerdocioMayor > 0)
                bodyParts.push(`${s.sinSacerdocioMayor} sin ordenanza de élderes`);
            if (s.inactivos > 0)
                bodyParts.push(`${s.inactivos} inactivos`);
            if (s.menosActivos > 0)
                bodyParts.push(`${s.menosActivos} menos activos`);
            if (s.urgentFamilies > 0)
                bodyParts.push(`${s.urgentFamilies} familias con necesidad urgente`);
            if (s.healthCount > 0)
                bodyParts.push(`${s.healthCount} con apoyo de salud`);
            if (s.urgentes > 0)
                bodyParts.push(`${s.urgentes} miembros urgentes`);
            if (s.enConsejo > 0)
                bodyParts.push(`${s.enConsejo} en seguimiento de consejo`);
            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(obsEligible.inAppUserIds, {
                    title: "Resumen Semanal – Observaciones",
                    body: bodyParts.join(", ") + ".",
                    url: "/observations",
                    tag: `weekly-observations-${barrioOrg}`,
                    barrioOrg: barrioOrg || null,
                    context: { actionUrl: "/observations", actionType: "navigate" },
                }, obsEligible.pushUserIds, observationsTrace);
            }
        }
    }
    // ── Miembros Fallecidos sin Ordenanzas Completas (Solo Push, solo Lunes) ─
    {
        const deceasedMembersQuery = await firestore.collection("c_miembros")
            .where("status", "==", "deceased")
            .get();
        const ALL_TEMPLE_ORDINANCES = [
            'baptism', 'confirmation', 'initiatory', 'endowment',
            'sealed_to_father', 'sealed_to_mother', 'sealed_to_spouse'
        ];
        // Group deceased members needing ordinances by barrioOrg
        const deceasedByBarrioOrg = new Map();
        deceasedMembersQuery.forEach((doc) => {
            const m = doc.data();
            const templeOrdinances = m.templeOrdinances || [];
            const hasAll = ALL_TEMPLE_ORDINANCES.every(ord => templeOrdinances.includes(ord));
            if (!hasAll) {
                const key = m.barrioOrg || "unknown";
                if (!deceasedByBarrioOrg.has(key))
                    deceasedByBarrioOrg.set(key, []);
                deceasedByBarrioOrg.get(key).push({
                    id: doc.id,
                    firstName: m.firstName || '',
                    lastName: m.lastName || '',
                    templeOrdinances
                });
            }
        });
        for (const [barrioOrg, membersNeedingOrdinances] of deceasedByBarrioOrg.entries()) {
            if (membersNeedingOrdinances.length === 0)
                continue;
            const pushUsers = allUsers.filter(u => u.pushEnabled && (!barrioOrg || barrioOrg === "unknown" || u.barrioOrg === barrioOrg));
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
                await notificationDispatcher.broadcastToUsers([], // No in-app
                {
                    title,
                    body,
                    url: "/council",
                    tag: `weekly-deceased-ordinances-${barrioOrg}`,
                    barrioOrg: barrioOrg || null,
                    context: { contextType: "member", actionUrl: "/council", actionType: "navigate" },
                }, pushUserIds, buildNotificationTrace("weeklyNotifications", "deceased-members"));
                functions.logger.log(`weeklyNotifications: Sent deceased members ordinance notification for barrioOrg=${barrioOrg} to ${pushUserIds.length} users`);
            }
        }
    }
    // ── Conversos ────────────────────────────────────────────────────────
    const convertsTrace = buildNotificationTrace("weeklyNotifications", "converts");
    {
        const [convertsSnap, friendsSnap] = await Promise.all([
            firestore.collection("c_conversos").get(),
            firestore.collection("c_obra_misional_amigos_conversos").get(),
        ]);
        const assignedFriendConvertIds = new Set();
        friendsSnap.forEach((doc) => {
            const f = doc.data();
            if (f.convertId && Array.isArray(f.friends) && f.friends.length > 0) {
                assignedFriendConvertIds.add(f.convertId);
            }
        });
        const convertStatsByBarrioOrg = new Map();
        const getConvStats = (key) => {
            if (!convertStatsByBarrioOrg.has(key)) {
                convertStatsByBarrioOrg.set(key, {
                    total: 0, conObservacion: 0, sinAmigo: 0,
                    sinMinistrantesMaestros: 0, sinLlamamiento: 0,
                    sinRecomendacion: 0, sinAutosuficiencia: 0,
                });
            }
            return convertStatsByBarrioOrg.get(key);
        };
        convertsSnap.forEach((doc) => {
            const c = doc.data();
            const key = c.barrioOrg || "unknown";
            const s = getConvStats(key);
            s.total++;
            if (c.observation?.trim())
                s.conObservacion++;
            if (!assignedFriendConvertIds.has(doc.id))
                s.sinAmigo++;
            if (!Array.isArray(c.ministeringTeachers) || c.ministeringTeachers.length === 0)
                s.sinMinistrantesMaestros++;
            if (c.hasCalling === false)
                s.sinLlamamiento++;
            if (c.hasRecommendation === false)
                s.sinRecomendacion++;
            if (c.hasSelfReliance === false)
                s.sinAutosuficiencia++;
        });
        for (const [barrioOrg, s] of convertStatsByBarrioOrg.entries()) {
            const convEligible = getEligibleUsers(allUsers, "converts", barrioOrg);
            if (convEligible.inAppUserIds.length === 0 && convEligible.pushUserIds.length === 0)
                continue;
            const bodyParts = [];
            if (s.total > 0)
                bodyParts.push(`${s.total} conversos registrados`);
            if (s.sinAmigo > 0)
                bodyParts.push(`${s.sinAmigo} sin amigo asignado`);
            if (s.sinLlamamiento > 0)
                bodyParts.push(`${s.sinLlamamiento} sin llamamiento`);
            if (s.sinRecomendacion > 0)
                bodyParts.push(`${s.sinRecomendacion} sin recomendación`);
            if (s.sinAutosuficiencia > 0)
                bodyParts.push(`${s.sinAutosuficiencia} sin curso de autosuficiencia`);
            if (s.sinMinistrantesMaestros > 0)
                bodyParts.push(`${s.sinMinistrantesMaestros} sin maestros ministrantes`);
            if (s.conObservacion > 0)
                bodyParts.push(`${s.conObservacion} con observación`);
            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(convEligible.inAppUserIds, {
                    title: "Resumen Semanal – Conversos",
                    body: bodyParts.join(", ") + ".",
                    url: "/converts",
                    tag: `weekly-converts-${barrioOrg}`,
                    barrioOrg: barrioOrg || null,
                    context: { contextType: "convert", actionUrl: "/converts", actionType: "navigate" },
                }, convEligible.pushUserIds, convertsTrace);
            }
        }
    }
    // ── FamilySearch ─────────────────────────────────────────────────────
    const familySearchTrace = buildNotificationTrace("weeklyNotifications", "familySearch");
    {
        const fsSnap = await firestore.collection("c_fs_capacitaciones").get();
        // Group counts by barrioOrg
        const fsCountByBarrioOrg = new Map();
        fsSnap.forEach((doc) => {
            const data = doc.data();
            const key = data.barrioOrg || "unknown";
            fsCountByBarrioOrg.set(key, (fsCountByBarrioOrg.get(key) || 0) + 1);
        });
        for (const [barrioOrg, fsCount] of fsCountByBarrioOrg.entries()) {
            if (fsCount <= 0)
                continue;
            const fsEligible = getEligibleUsers(allUsers, "familySearch", barrioOrg);
            if (fsEligible.inAppUserIds.length === 0 && fsEligible.pushUserIds.length === 0)
                continue;
            await notificationDispatcher.broadcastToUsers(fsEligible.inAppUserIds, {
                title: "FamilySearch – Familias por Capacitar",
                body: `Hay ${fsCount} familia${fsCount !== 1 ? "s" : ""} pendiente${fsCount !== 1 ? "s" : ""} de capacitación en FamilySearch.`,
                url: "/family-search",
                tag: `weekly-family-search-${barrioOrg}`,
                barrioOrg: barrioOrg || null,
                context: { actionUrl: "/family-search", actionType: "navigate" },
            }, fsEligible.pushUserIds, familySearchTrace);
        }
    }
    // ── Obra Misional ─────────────────────────────────────────────────────
    const missionaryWorkTrace = buildNotificationTrace("weeklyNotifications", "missionaryWork");
    {
        const [assignmentsSnap, investigatorsSnap, convertsThisWeek] = await Promise.all([
            firestore.collection("c_obra_misional_asignaciones").where("isCompleted", "==", false).get(),
            firestore.collection("c_obra_misional_investigadores").where("status", "==", "active").get(),
            firestore.collection("c_conversos").get(),
        ]);
        const mwStatsByBarrioOrg = new Map();
        const getMwStats = (key) => {
            if (!mwStatsByBarrioOrg.has(key)) {
                mwStatsByBarrioOrg.set(key, { pendingAssignments: 0, activeInvestigators: 0, totalConverts: 0 });
            }
            return mwStatsByBarrioOrg.get(key);
        };
        assignmentsSnap.forEach((doc) => {
            const data = doc.data();
            const key = data.barrioOrg || "unknown";
            getMwStats(key).pendingAssignments++;
        });
        investigatorsSnap.forEach((doc) => {
            const data = doc.data();
            const key = data.barrioOrg || "unknown";
            getMwStats(key).activeInvestigators++;
        });
        convertsThisWeek.forEach((doc) => {
            const data = doc.data();
            const key = data.barrioOrg || "unknown";
            getMwStats(key).totalConverts++;
        });
        for (const [barrioOrg, s] of mwStatsByBarrioOrg.entries()) {
            const mwEligible = getEligibleUsers(allUsers, "missionaryWork", barrioOrg);
            if (mwEligible.inAppUserIds.length === 0 && mwEligible.pushUserIds.length === 0)
                continue;
            const bodyParts = [];
            if (s.pendingAssignments > 0)
                bodyParts.push(`${s.pendingAssignments} asignación${s.pendingAssignments !== 1 ? "es" : ""} misional${s.pendingAssignments !== 1 ? "es" : ""} pendiente${s.pendingAssignments !== 1 ? "s" : ""}`);
            if (s.activeInvestigators > 0)
                bodyParts.push(`${s.activeInvestigators} investigador${s.activeInvestigators !== 1 ? "es" : ""} activo${s.activeInvestigators !== 1 ? "s" : ""}`);
            if (s.totalConverts > 0)
                bodyParts.push(`${s.totalConverts} nuevo${s.totalConverts !== 1 ? "s" : ""} converso${s.totalConverts !== 1 ? "s" : ""} registrado${s.totalConverts !== 1 ? "s" : ""}`);
            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(mwEligible.inAppUserIds, {
                    title: "Resumen Semanal – Obra Misional",
                    body: bodyParts.join(", ") + ".",
                    url: "/missionary-work",
                    tag: `weekly-missionary-work-${barrioOrg}`,
                    barrioOrg: barrioOrg || null,
                    context: { contextType: "missionary_assignment", actionUrl: "/missionary-work", actionType: "navigate" },
                }, mwEligible.pushUserIds, missionaryWorkTrace);
            }
        }
    }
    functions.logger.log("weeklyNotifications: done.");
    return null;
});
// ─────────────────────────────────────────────────────────────────────────────
// COUNCIL NOTIFICATIONS – Tuesdays & Wednesdays 18:00 Ecuador
// Covers: Consejo (Necesidades Urgentes, Menos Activos, Ministración)
// ─────────────────────────────────────────────────────────────────────────────
exports.councilNotifications = functions.pubsub
    .schedule("0 18 * * 2,3")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
    functions.logger.log("councilNotifications: running...", {
        scheduledTimeZone: ECUADOR_TZ,
        scheduledLocalTime: getEcuadorNowLabel(),
    });
    const allUsers = await getAllUsersNotificationData();
    const councilTrace = buildNotificationTrace("councilNotifications", "council");
    const [membersSnap, ministeringSnap] = await Promise.all([
        firestore.collection("c_miembros").get(),
        firestore.collection("c_ministracion").get(),
    ]);
    const councilStatsByBarrioOrg = new Map();
    const getCouncilStats = (key) => {
        if (!councilStatsByBarrioOrg.has(key)) {
            councilStatsByBarrioOrg.set(key, {
                urgentMembers: 0, lessActiveMembers: 0,
                inCouncil: 0, urgentFamiliesMinistering: 0,
            });
        }
        return councilStatsByBarrioOrg.get(key);
    };
    membersSnap.forEach((doc) => {
        const m = doc.data();
        const key = m.barrioOrg || "unknown";
        const s = getCouncilStats(key);
        if (m.isUrgent)
            s.urgentMembers++;
        if (m.status === "less_active" || m.status === "inactive")
            s.lessActiveMembers++;
        if (m.isInCouncil)
            s.inCouncil++;
    });
    ministeringSnap.forEach((doc) => {
        const c = doc.data();
        const key = c.barrioOrg || "unknown";
        const s = getCouncilStats(key);
        (c.families ?? []).forEach((f) => { if (f.isUrgent)
            s.urgentFamiliesMinistering++; });
    });
    const today = getEcuadorToday();
    const dateParts = getDatePartsInTimeZone(today, ECUADOR_TZ);
    const dateTag = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
    for (const [barrioOrg, s] of councilStatsByBarrioOrg.entries()) {
        const councilEligible = getEligibleUsers(allUsers, "council", barrioOrg);
        if (councilEligible.inAppUserIds.length === 0 && councilEligible.pushUserIds.length === 0)
            continue;
        const bodyParts = [];
        if (s.urgentMembers > 0)
            bodyParts.push(`${s.urgentMembers} necesidad${s.urgentMembers !== 1 ? "es" : ""} urgente${s.urgentMembers !== 1 ? "s" : ""} de miembros`);
        if (s.urgentFamiliesMinistering > 0)
            bodyParts.push(`${s.urgentFamiliesMinistering} necesidad${s.urgentFamiliesMinistering !== 1 ? "es" : ""} urgente${s.urgentFamiliesMinistering !== 1 ? "s" : ""} de ministración`);
        if (s.lessActiveMembers > 0)
            bodyParts.push(`${s.lessActiveMembers} miembro${s.lessActiveMembers !== 1 ? "s" : ""} menos activo${s.lessActiveMembers !== 1 ? "s" : ""}`);
        if (s.inCouncil > 0)
            bodyParts.push(`${s.inCouncil} en seguimiento de consejo`);
        if (bodyParts.length > 0) {
            await notificationDispatcher.broadcastToUsers(councilEligible.inAppUserIds, {
                title: "Recordatorio – Consejo de Cuórum",
                body: bodyParts.join(", ") + ".",
                url: "/council",
                tag: `council-reminder-${dateTag}-${barrioOrg}`,
                barrioOrg: barrioOrg || null,
                context: { contextType: "council", actionUrl: "/council", actionType: "navigate" },
            }, councilEligible.pushUserIds, councilTrace);
        }
    }
    functions.logger.log("councilNotifications: done.");
    return null;
});
//# sourceMappingURL=index.js.map