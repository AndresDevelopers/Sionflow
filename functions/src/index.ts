
import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { format, addDays, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { NotificationDispatcher } from "./modules/notification-dispatcher";
import {
  createCollectionSyncHandler,
  publishSyncSignal,
} from "./modules/data-sync-publisher";

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();
const notificationDispatcher = new NotificationDispatcher(
    firestore,
    messaging,
    functions.logger
);

// Ecuador timezone (no DST)
const ECUADOR_TZ = "America/Guayaquil";

// Conservative instance caps (cost-first). firebase-functions v1 via runWith.
const MAX_INSTANCES_DEFAULT = 10; // triggers / sync / callables
const MAX_INSTANCES_SCHEDULED = 2; // cron jobs (single-shot)
const MAX_INSTANCES_STORAGE = 5; // profile picture cleanup

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

const slugify = (value: string): string =>
    value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");


export const cleanupProfilePictures = functions
    .runWith({ maxInstances: MAX_INSTANCES_STORAGE })
    .storage.object().onFinalize(async (object: any) => {
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

export const onActivityCreated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_actividades/{activityId}")
    .onCreate(async (snapshot, context) => {
        try {
            const activity = snapshot.data() as Activity & { barrioOrg?: string };
            const activityId = context.params.activityId as string;
            const docBarrioOrg = activity.barrioOrg || null;

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

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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

/** User-visible fields for activity update notifications (ignore bookkeeping). */
const ACTIVITY_NOTIF_CONTENT_FIELDS = [
    "title",
    "date",
    "time",
    "description",
    "location",
    "context",
    "learning",
    "additionalText",
    "imageUrls",
] as const;

/** User-visible fields for service update notifications (ignore bookkeeping). */
const SERVICE_NOTIF_CONTENT_FIELDS = [
    "title",
    "date",
    "time",
    "description",
    "location",
    "context",
    "learning",
    "additionalText",
    "imageUrls",
] as const;

function stableFieldValue(value: unknown): string {
    if (value == null) return String(value);
    if (typeof value === "object") {
        if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
            return `ts:${(value as { toMillis: () => number }).toMillis()}`;
        }
        if (typeof (value as { toDate?: () => Date }).toDate === "function") {
            return `ts:${(value as { toDate: () => Date }).toDate().getTime()}`;
        }
        if (value instanceof Date) return `ts:${value.getTime()}`;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return JSON.stringify(value);
}

/**
 * True when at least one user-visible content field changed.
 * Bookkeeping-only updates (councilNotified, timestamps, etc.) must NOT
 * re-fire notification CFs — the notification dispatcher already wrote
 * c_notifications for the real domain event when applicable.
 */
function hasMeaningfulContentChange(
    before: FirebaseFirestore.DocumentData | undefined,
    after: FirebaseFirestore.DocumentData | undefined,
    fields: readonly string[]
): boolean {
    if (!before || !after) return true;
    for (const field of fields) {
        if (stableFieldValue(before[field]) !== stableFieldValue(after[field])) {
            return true;
        }
    }
    return false;
}

export const onActivityUpdated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_actividades/{activityId}")
    .onUpdate(async (change, context) => {
        try {
            const before = change.before.data() as (Activity & { barrioOrg?: string }) | undefined;
            const after = change.after.data() as (Activity & { barrioOrg?: string }) | undefined;
            if (!after) return;

            // Skip bookkeeping-only updates (e.g. flags written after another notif CF)
            if (!hasMeaningfulContentChange(before, after, ACTIVITY_NOTIF_CONTENT_FIELDS)) {
                functions.logger.log("onActivityUpdated: skip bookkeeping-only change", {
                    activityId: context.params.activityId,
                });
                return;
            }

            const activityId = context.params.activityId as string;
            const activityTitle = after.title?.trim() || "Actividad";
            const prevTitle = before?.title?.trim() || activityTitle;
            const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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

export const onActivityDeleted = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_actividades/{activityId}")
    .onDelete(async (snapshot, context) => {
        try {
            const activity = snapshot.data() as (Activity & { barrioOrg?: string }) | undefined;
            const activityTitle = activity?.title?.trim() || "Actividad";
            const docBarrioOrg = activity?.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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

export const onServiceCreated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_servicios/{serviceId}")
    .onCreate(async (snapshot, context) => {
        try {
            const svc = snapshot.data() as Service & { barrioOrg?: string };
            const serviceId = context.params.serviceId as string;
            const title = svc.title?.trim() || "Nuevo servicio";
            const svcDate = svc.date?.toDate
                ? format(svc.date.toDate(), "d MMM yyyy", { locale: es })
                : "";
            const docBarrioOrg = svc.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service creation notification", { error });
        }
    });

export const onServiceUpdated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_servicios/{serviceId}")
    .onUpdate(async (change, context) => {
        try {
            const before = change.before.data() as (Service & { barrioOrg?: string }) | undefined;
            const after = change.after.data() as (Service & { barrioOrg?: string }) | undefined;
            if (!after) return;

            // e.g. councilNotified=true is written after the notification pipeline
            // already carried the user-facing message — do not re-notify "Servicio Actualizado".
            if (!hasMeaningfulContentChange(before, after, SERVICE_NOTIF_CONTENT_FIELDS)) {
                functions.logger.log("onServiceUpdated: skip bookkeeping-only change", {
                    serviceId: context.params.serviceId,
                });
                return;
            }

            const serviceId = context.params.serviceId as string;
            const title = after.title?.trim() || before?.title?.trim() || "Servicio";
            const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service update notification", { error });
        }
    });

export const onServiceDeleted = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_servicios/{serviceId}")
    .onDelete(async (snapshot, context) => {
        try {
            const svc = snapshot.data() as (Service & { barrioOrg?: string }) | undefined;
            const title = svc?.title?.trim() || "Servicio";
            const serviceId = context.params.serviceId as string;
            const docBarrioOrg = svc?.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "service", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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
                },
                eligible.pushUserIds
            );
        } catch (error) {
            functions.logger.error("Failed to broadcast service delete notification", { error });
        }
    });

export const onUrgentFamilyFlagged = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_ministracion/{companionshipId}")
    .onUpdate(async (change, context) => {
        const before = change.before.data() as (Companionship & { barrioOrg?: string }) | undefined;
        const after = change.after.data() as (Companionship & { barrioOrg?: string }) | undefined;

        if (!after?.families || after.families.length === 0) {
            return;
        }

        const docBarrioOrg = after.barrioOrg || before?.barrioOrg || null;

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

        const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
        const eligible = getEligibleUsers(allUsers, "council", docBarrioOrg);

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
                            barrioOrg: docBarrioOrg || null,
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

export const onMissionaryAssignmentCreated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_obra_misional_asignaciones/{assignmentId}")
    .onCreate(async (snapshot, context) => {
        try {
            const assignment = snapshot.data() as { description?: string; barrioOrg?: string } | undefined;
            const assignmentId = context.params.assignmentId as string;
            const description = assignment?.description?.trim();
            const body = description && description.length > 0
                ? description
                : "Se registró una nueva asignación misional.";
            const docBarrioOrg = assignment?.barrioOrg || null;

            const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
            const eligible = getEligibleUsers(allUsers, "missionaryWork", docBarrioOrg);

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
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
// Council annotations (c_anotaciones) – notify secretary role only
// Covers: new annotations on /council, deleted annotations, and dashboard notes
// marked as council action (they appear on the council page).
// In-app + push are both handled by notificationDispatcher.broadcastToUsers.
// ─────────────────────────────────────────────────────────────────────────────

interface CouncilAnnotationDoc {
    text?: string;
    isCouncilAction?: boolean;
    isResolved?: boolean;
    source?: string;
    userId?: string;
    barrioOrg?: string;
}

/** Annotations that appear on the council page. */
function isCouncilPageAnnotation(data: CouncilAnnotationDoc | undefined | null): boolean {
    if (!data) return false;
    if (data.isResolved === true) return false;
    return data.source === "council" || data.isCouncilAction === true;
}

function truncateAnnotationText(text: string | undefined, maxLen = 120): string {
    const normalized = (text ?? "").trim().replace(/\s+/g, " ");
    if (!normalized) return "(sin texto)";
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, maxLen - 1)}…`;
}

async function notifySecretariesAboutCouncilAnnotation(params: {
    annotationId: string;
    annotation: CouncilAnnotationDoc;
    action: "created" | "deleted";
}): Promise<void> {
    const { annotationId, annotation, action } = params;
    const docBarrioOrg = annotation.barrioOrg || null;
    const preview = truncateAnnotationText(annotation.text);

    const allUsers = await getUsersForDocBarrioOrg(docBarrioOrg);
    const eligible = getEligibleSecretaries(allUsers, "council", docBarrioOrg);

    if (eligible.inAppUserIds.length === 0 && eligible.pushUserIds.length === 0) {
        functions.logger.log("Council annotation notification: no eligible secretaries", {
            annotationId,
            action,
            barrioOrg: docBarrioOrg,
        });
        return;
    }

    const isCreated = action === "created";
    await notificationDispatcher.broadcastToUsers(
        eligible.inAppUserIds,
        {
            title: isCreated ? "Nueva anotación en Consejo" : "Anotación eliminada del Consejo",
            body: isCreated
                ? `Se agregó una anotación: ${preview}`
                : `Se eliminó una anotación: ${preview}`,
            url: "/council",
            tag: `council-annotation-${action}-${annotationId}`,
            barrioOrg: docBarrioOrg || null,
            context: {
                contextType: "council",
                contextId: annotationId,
                actionUrl: "/council",
                actionType: "navigate",
            },
        },
        eligible.pushUserIds
    );
}

export const onCouncilAnnotationCreated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_anotaciones/{annotationId}")
    .onCreate(async (snapshot, context) => {
        try {
            const annotation = snapshot.data() as CouncilAnnotationDoc;
            if (!isCouncilPageAnnotation(annotation)) {
                return;
            }

            await notifySecretariesAboutCouncilAnnotation({
                annotationId: context.params.annotationId as string,
                annotation,
                action: "created",
            });
        } catch (error) {
            functions.logger.error("Failed to broadcast council annotation create notification", {
                error,
                annotationId: context.params.annotationId,
            });
        }
    });

export const onCouncilAnnotationUpdated = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_anotaciones/{annotationId}")
    .onUpdate(async (change, context) => {
        try {
            const before = change.before.data() as CouncilAnnotationDoc | undefined;
            const after = change.after.data() as CouncilAnnotationDoc | undefined;
            if (!after) return;

            const wasOnCouncil = isCouncilPageAnnotation(before);
            const isOnCouncil = isCouncilPageAnnotation(after);

            // Dashboard annotation marked for council → appears as new on /council
            if (!wasOnCouncil && isOnCouncil) {
                await notifySecretariesAboutCouncilAnnotation({
                    annotationId: context.params.annotationId as string,
                    annotation: after,
                    action: "created",
                });
                return;
            }

            // Removed from council view without hard-delete (resolve / unmark council action)
            if (wasOnCouncil && !isOnCouncil) {
                await notifySecretariesAboutCouncilAnnotation({
                    annotationId: context.params.annotationId as string,
                    annotation: before ?? after,
                    action: "deleted",
                });
            }
        } catch (error) {
            functions.logger.error("Failed to broadcast council annotation update notification", {
                error,
                annotationId: context.params.annotationId,
            });
        }
    });

export const onCouncilAnnotationDeleted = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_anotaciones/{annotationId}")
    .onDelete(async (snapshot, context) => {
        try {
            const annotation = snapshot.data() as CouncilAnnotationDoc | undefined;
            // On hard-delete, isResolved may already be false; still notify if it was a council item.
            const wasCouncil =
                annotation?.source === "council" || annotation?.isCouncilAction === true;
            if (!wasCouncil) {
                return;
            }

            await notifySecretariesAboutCouncilAnnotation({
                annotationId: context.params.annotationId as string,
                annotation: annotation ?? {},
                action: "deleted",
            });
        } catch (error) {
            functions.logger.error("Failed to broadcast council annotation delete notification", {
                error,
                annotationId: context.params.annotationId,
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
    /** barrioOrg scoping key (e.g. "Libertad|Quórum de Élderes"). Used to match data with users. */
    barrioOrg: string | null;
    /** Raw role from c_users (e.g. secretary, admin, president). */
    role: string | null;
}

// ── Cache en memoria para preferencias de notificación de usuarios ──────────
// TTL corto (10 min). Claves: "__all__" o un barrioOrg concreto.
// Triggers por documento deben usar getUsersForDocBarrioOrg(scope) — O(users del barrio).
// Crons diarios/semanales usan getAllUsersNotificationData() una vez.
const _usersCacheByKey = new Map<string, { data: UserNotificationData[]; ts: number }>();
const USERS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const USERS_CACHE_ALL_KEY = "__all__";

/** Fields needed for notification eligibility (reduces bytes/read cost). */
const USER_NOTIF_SELECT_FIELDS = [
    "barrioOrg",
    "barrio",
    "organizacion",
    "visiblePages",
    "inAppNotificationsEnabled",
    "pushNotificationsEnabled",
    "notificationPrefs",
    "role",
] as const;

function resolveUserBarrioOrgFromData(d: FirebaseFirestore.DocumentData): string | null {
    if (typeof d.barrioOrg === "string") {
        const explicit = d.barrioOrg.trim();
        if (explicit.includes("|") && !explicit.startsWith("|") && !explicit.endsWith("|")) {
            return explicit;
        }
    }
    const barrio = typeof d.barrio === "string" ? d.barrio.trim() : "";
    const organizacion = typeof d.organizacion === "string" ? d.organizacion.trim() : "";
    if (barrio && organizacion) {
        return `${barrio}|${organizacion}`;
    }
    return null;
}

function mapUserDocToNotificationData(
    doc: FirebaseFirestore.QueryDocumentSnapshot
): UserNotificationData | null {
    const d = doc.data();
    const barrioOrg = resolveUserBarrioOrgFromData(d);
    if (!barrioOrg) return null;

    return {
        userId: doc.id,
        visiblePages: Array.isArray(d.visiblePages) ? (d.visiblePages as string[]) : null,
        inAppEnabled: d.inAppNotificationsEnabled !== false,
        pushEnabled: d.pushNotificationsEnabled === true,
        notificationPrefs: {
            inApp: (d.notificationPrefs?.inApp as Record<string, boolean>) ?? {},
            push: (d.notificationPrefs?.push as Record<string, boolean>) ?? {},
        },
        barrioOrg,
        role: typeof d.role === "string" ? d.role : null,
    };
}

function getCachedUsers(key: string): UserNotificationData[] | null {
    const entry = _usersCacheByKey.get(key);
    if (entry && Date.now() - entry.ts < USERS_CACHE_TTL_MS) {
        return entry.data;
    }
    return null;
}

function setCachedUsers(key: string, data: UserNotificationData[]): void {
    _usersCacheByKey.set(key, { data, ts: Date.now() });
}

/**
 * Users of a single barrioOrg (indexed query). Preferred for Firestore triggers.
 */
async function getUsersNotificationDataByBarrio(barrioOrg: string): Promise<UserNotificationData[]> {
    const key = barrioOrg.trim();
    if (!key.includes("|")) return [];

    const cached = getCachedUsers(key);
    if (cached) return cached;

    const snapshot = await firestore
        .collection("c_users")
        .where("barrioOrg", "==", key)
        .select(...USER_NOTIF_SELECT_FIELDS)
        .get();

    const data: UserNotificationData[] = [];
    for (const doc of snapshot.docs) {
        const mapped = mapUserDocToNotificationData(doc);
        if (mapped) data.push(mapped);
    }

    setCachedUsers(key, data);
    return data;
}

/**
 * Load users for an event document's tenant only.
 * Missing/invalid barrioOrg → empty (fail closed; never full project scan on triggers).
 */
async function getUsersForDocBarrioOrg(docBarrioOrg?: string | null): Promise<UserNotificationData[]> {
    if (!docBarrioOrg || docBarrioOrg === "unknown") {
        return [];
    }
    const key = docBarrioOrg.trim();
    if (!key.includes("|") || key.startsWith("|") || key.endsWith("|")) {
        return [];
    }
    return getUsersNotificationDataByBarrio(key);
}

/**
 * All users with notification prefs (scheduled jobs only — once per cron run).
 * Prefer getUsersForDocBarrioOrg for event-driven notifications.
 */
async function getAllUsersNotificationData(): Promise<UserNotificationData[]> {
    const cached = getCachedUsers(USERS_CACHE_ALL_KEY);
    if (cached) return cached;

    // Field mask: smaller docs → lower network/CPU; still 1 read per user doc
    const snapshot = await firestore
        .collection("c_users")
        .select(...USER_NOTIF_SELECT_FIELDS)
        .get();

    const data: UserNotificationData[] = [];
    for (const doc of snapshot.docs) {
        const mapped = mapUserDocToNotificationData(doc);
        if (mapped) data.push(mapped);
    }

    setCachedUsers(USERS_CACHE_ALL_KEY, data);
    // Warm per-barrio caches for subsequent getEligibleUsers filters in the same cron
    const byBarrio = new Map<string, UserNotificationData[]>();
    for (const u of data) {
        if (!u.barrioOrg) continue;
        const list = byBarrio.get(u.barrioOrg) ?? [];
        list.push(u);
        byBarrio.set(u.barrioOrg, list);
    }
    for (const [bo, list] of byBarrio) {
        setCachedUsers(bo, list);
    }

    return data;
}

/** Firestore `in` operator supports at most 30 values. */
const FIRESTORE_IN_LIMIT = 30;

/**
 * Unique barrioOrg values that have users. Used to scope scheduled notification reads.
 * Push delivery is later filtered by per-device FCM tokens.
 */
function getActiveBarrioOrgs(users: UserNotificationData[]): string[] {
    const set = new Set<string>();
    for (const u of users) {
        if (u.barrioOrg) {
            set.add(u.barrioOrg);
        }
    }
    return Array.from(set);
}

type SnapshotLike = {
    docs: admin.firestore.QueryDocumentSnapshot[];
    empty: boolean;
    forEach: (cb: (doc: admin.firestore.QueryDocumentSnapshot) => void) => void;
};

function toSnapshotLike(docs: admin.firestore.QueryDocumentSnapshot[]): SnapshotLike {
    return {
        docs,
        empty: docs.length === 0,
        forEach: (cb) => {
            docs.forEach(cb);
        },
    };
}

/**
 * Read a collection filtered by barrioOrg in chunks of 30 (Firestore `in` limit).
 * Optional `applyExtra` adds further where/orderBy after the barrioOrg filter.
 */
async function getCollectionDocsForBarrios(
    collectionName: string,
    activeBarrioOrgs: string[],
    applyExtra?: (q: admin.firestore.Query) => admin.firestore.Query
): Promise<SnapshotLike> {
    if (activeBarrioOrgs.length === 0) {
        return toSnapshotLike([]);
    }

    const chunks: string[][] = [];
    for (let i = 0; i < activeBarrioOrgs.length; i += FIRESTORE_IN_LIMIT) {
        chunks.push(activeBarrioOrgs.slice(i, i + FIRESTORE_IN_LIMIT));
    }

    const snapshots = await Promise.all(
        chunks.map((chunk) => {
            let q: admin.firestore.Query = firestore
                .collection(collectionName)
                .where("barrioOrg", "in", chunk);
            if (applyExtra) q = applyExtra(q);
            return q.get();
        })
    );
    return toSnapshotLike(snapshots.flatMap((s) => s.docs));
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

/**
 * Page paths used for visiblePages matching.
 * Must match Settings `notificationCategories[].page` and navigation hrefs
 * (no query strings — visiblePages stores bare paths like /missionary-work).
 */
const CATEGORY_PAGE: Record<NotifCategory, string> = {
    observations: "/observations",
    converts: "/converts",
    futureMembers: "/missionary-work",
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

/**
 * Whether the user can see the page for a notification category.
 * Aligns with frontend main-layout: null OR empty visiblePages ⇒ all pages.
 * Strips query strings and maps legacy /future-members → /missionary-work.
 */
function userHasCategoryPage(
    visiblePages: string[] | null,
    page: string
): boolean {
    // Frontend: empty/missing list shows all nav items
    if (visiblePages === null || visiblePages.length === 0) {
        return true;
    }

    const target = page.split("?")[0];
    const normalizedVisible = visiblePages.map((p) => {
        const path = p.split("?")[0];
        if (path === "/future-members") return "/missionary-work";
        // Legacy reports page removed; treat as activities
        if (path === "/reports") return "/reports/activities";
        return path;
    });

    if (normalizedVisible.includes(target)) {
        return true;
    }

    return false;
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

/**
 * Normalize document barrioOrg for eligibility checks.
 * - null/undefined/empty/"unknown" → unscoped (legacy data without multi-tenant key)
 * - otherwise → exact match required against user.barrioOrg
 *
 * NOTE: getAllUsersNotificationData always assigns a barrioOrg string to every user
 * (constructed from barrio|organizacion with defaults). The previous filter treated
 * "doc without barrioOrg" as "only users without barrioOrg", which excluded ALL users
 * and silently dropped Cloud Function notifications.
 */
function normalizeDocBarrioOrg(docBarrioOrg?: string | null): string | null {
    if (!docBarrioOrg || docBarrioOrg === "unknown") {
        return null;
    }
    return docBarrioOrg;
}

/**
 * Given all users and a category, return those eligible to receive in-app
 * and/or push notifications for that category.
 *
 * FAIL CLOSED multi-tenant: if the document has no real barrioOrg, nobody is
 * notified. Broadcasting to all wards would leak PII (names, etc.) across tenants.
 * Migrate legacy docs so they carry barrioOrg before expecting notifications.
 *
 * @param users - All users with notification preferences
 * @param category - Notification category
 * @param docBarrioOrg - barrioOrg from the triggering document (required for any recipients)
 */
function getEligibleUsers(
    users: UserNotificationData[],
    category: NotifCategory,
    docBarrioOrg?: string | null
): EligibleUsers {
    const page = CATEGORY_PAGE[category];
    const scope = normalizeDocBarrioOrg(docBarrioOrg);
    const inAppUserIds: string[] = [];
    const pushUserIds: string[] = [];

    // Fail closed: never cross-tenant notify for unscoped/legacy documents
    if (!scope) {
        functions.logger.warn("getEligibleUsers: skipped — document missing barrioOrg", {
            category,
            docBarrioOrg: docBarrioOrg ?? null,
        });
        return { inAppUserIds, pushUserIds };
    }

    for (const u of users) {
        if (!userHasCategoryPage(u.visiblePages, page)) continue;

        if (u.barrioOrg !== scope) continue;

        const inAppCat = u.notificationPrefs.inApp[category] !== false;
        const pushCat = u.notificationPrefs.push[category] !== false;

        if (u.inAppEnabled && inAppCat) inAppUserIds.push(u.userId);
        // Push is per-device: include users by category preference; FCM only
        // reaches devices with an active c_push_subscriptions token.
        // Account pushEnabled is derived/diagnostic and must not hide other devices.
        if (pushCat) pushUserIds.push(u.userId);
    }

    return { inAppUserIds, pushUserIds };
}

/** Matches frontend normalizeRole: admin is treated as secretary. */
function isSecretaryRole(role: string | null | undefined): boolean {
    if (!role) return false;
    const normalized = role.trim().toLowerCase();
    return normalized === "secretary" || normalized === "admin";
}

/**
 * Roles that see Administración in the sidebar (matches frontend isAdmin).
 * Includes legacy "admin" and Spanish "presidente".
 */
function isAdminMenuRole(role: string | null | undefined): boolean {
    if (!role) return false;
    const normalized = role.trim().toLowerCase();
    return (
        normalized === "secretary" ||
        normalized === "admin" ||
        normalized === "president" ||
        normalized === "presidente"
    );
}

/**
 * Eligible users for a category, restricted to the secretary role
 * (includes legacy "admin" role).
 */
function getEligibleSecretaries(
    users: UserNotificationData[],
    category: NotifCategory,
    docBarrioOrg?: string | null
): EligibleUsers {
    const secretaries = users.filter((u) => isSecretaryRole(u.role));
    return getEligibleUsers(secretaries, category, docBarrioOrg);
}

/**
 * Admins (president / secretary / legacy admin) in the same barrioOrg who
 * should be told that a new self-registered member needs a role assignment.
 * In-app respects the global in-app toggle; push is attempted for all
 * matching roles (FCM only reaches devices with an active token).
 */
function getEligibleAdminsForNewRegistration(
    users: UserNotificationData[],
    docBarrioOrg?: string | null,
    excludeUserId?: string
): EligibleUsers {
    const scope = normalizeDocBarrioOrg(docBarrioOrg);
    const inAppUserIds: string[] = [];
    const pushUserIds: string[] = [];

    if (!scope) {
        functions.logger.warn("getEligibleAdminsForNewRegistration: skipped — missing barrioOrg", {
            docBarrioOrg: docBarrioOrg ?? null,
        });
        return { inAppUserIds, pushUserIds };
    }

    for (const u of users) {
        if (excludeUserId && u.userId === excludeUserId) continue;
        if (!isAdminMenuRole(u.role)) continue;
        if (u.barrioOrg !== scope) continue;

        if (u.inAppEnabled) inAppUserIds.push(u.userId);
        pushUserIds.push(u.userId);
    }

    return { inAppUserIds, pushUserIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// New user registration (c_users onCreate) – notify admin menu roles
// Roles: secretary (incl. legacy admin) and president — same as isAdmin() UI.
// In-app + push; click opens /admin/users to assign a role.
// ─────────────────────────────────────────────────────────────────────────────

function isSelfRegisteredMemberRole(role: unknown): boolean {
    if (typeof role !== "string" || !role.trim()) {
        // Registration always writes role: 'user'; missing/empty still needs assignment.
        return true;
    }
    const normalized = role.trim().toLowerCase();
    return normalized === "user" || normalized === "miembro";
}

export const onNewUserRegistered = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .firestore
    .document("c_users/{userId}")
    .onCreate(async (snapshot, context) => {
        const userId = context.params.userId as string;
        try {
            const data = snapshot.data() || {};

            // Only self-registrations that still need a leadership role assigned.
            if (!isSelfRegisteredMemberRole(data.role)) {
                functions.logger.log("onNewUserRegistered: skip non-member role", {
                    userId,
                    role: data.role ?? null,
                });
                return;
            }

            const barrioOrg = resolveUserBarrioOrgFromData(data);
            if (!barrioOrg) {
                functions.logger.warn("onNewUserRegistered: missing barrioOrg — abort (fail closed)", {
                    userId,
                });
                return;
            }

            const name =
                typeof data.name === "string" && data.name.trim()
                    ? data.name.trim()
                    : "Un usuario";
            const email =
                typeof data.email === "string" && data.email.trim()
                    ? data.email.trim()
                    : "";

            // Bust barrio cache so we load current admins (and avoid stale misses).
            _usersCacheByKey.delete(barrioOrg);

            const allUsers = await getUsersForDocBarrioOrg(barrioOrg);
            const eligible = getEligibleAdminsForNewRegistration(allUsers, barrioOrg, userId);

            if (eligible.inAppUserIds.length === 0 && eligible.pushUserIds.length === 0) {
                functions.logger.log("onNewUserRegistered: no eligible admins", {
                    userId,
                    barrioOrg,
                });
                return;
            }

            const body = email
                ? `${name} (${email}) se registró y necesita que le asignes un rol`
                : `${name} se registró y necesita que le asignes un rol`;

            await notificationDispatcher.broadcastToUsers(
                eligible.inAppUserIds,
                {
                    title: "Nuevo usuario registrado",
                    body,
                    url: "/admin/users",
                    tag: `new-user-registered-${userId}`,
                    barrioOrg,
                    context: {
                        contextType: "admin_user",
                        contextId: userId,
                        actionUrl: "/admin/users",
                        actionType: "navigate",
                    },
                },
                eligible.pushUserIds,
                {
                    source: "onNewUserRegistered",
                    category: "admin_user",
                }
            );

            functions.logger.log("onNewUserRegistered: notified admins", {
                userId,
                barrioOrg,
                inApp: eligible.inAppUserIds.length,
                push: eligible.pushUserIds.length,
            });
        } catch (error) {
            functions.logger.error("Failed to notify admins of new registration", {
                error,
                userId,
            });
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// DAILY NOTIFICATIONS – 09:00 Ecuador (America/Guayaquil)
// Covers: Birthdays, Future Members, Services, Activities
// ─────────────────────────────────────────────────────────────────────────────
export const dailyNotifications = functions
    .runWith({ maxInstances: MAX_INSTANCES_SCHEDULED })
    .pubsub
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
        const activeBarrioOrgs = getActiveBarrioOrgs(allUsers);

        // ── Cumpleaños ──────────────────────────────────────────────────────
        const birthdayTrace = buildNotificationTrace("dailyNotifications", "birthdays");
        {
            const [birthdaysSnap, membersForBirthdaySnap] = await Promise.all([
                getCollectionDocsForBarrios("c_cumpleanos", activeBarrioOrgs),
                getCollectionDocsForBarrios("c_miembros", activeBarrioOrgs),
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
                const b = doc.data() as Birthday & { barrioOrg?: string };
                const docBarrioOrg = b.barrioOrg || null;
                const birthdayKey = buildBirthdayDedupKey(b.name, b.memberId);
                const normalizedNameKey = buildBirthdayDedupKey(b.name);
                coveredBirthdayKeys.add(birthdayKey);
                coveredBirthdayKeys.add(normalizedNameKey);

                const nextBirthday = getBirthdayDateInEcuador(b.birthDate, today.getFullYear());
                if (!nextBirthday) continue;

                // Get eligible users scoped to this birthday's barrioOrg
                const bdEligible = getEligibleUsers(allUsers, "birthdays", docBarrioOrg);
                if (bdEligible.inAppUserIds.length === 0 && bdEligible.pushUserIds.length === 0) continue;

                // Resolve member status if birthday is linked to a member
                const memberStatus = b.memberId ? memberStatusMap.get(b.memberId) : undefined;
                const statusLabel = getBirthdayStatusLabel(memberStatus);
                const nameWithStatus = statusLabel ? `${b.name} (${statusLabel})` : b.name;

                const yearTag = today.getFullYear();
                if (isSameDay(nextBirthday, in14Days) && !sentBirthdays14.has(birthdayKey)) {
                    sentBirthdays14.add(birthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        bdEligible.inAppUserIds,
                        {
                            title: "Próximo Cumpleaños",
                            body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                            url: "/birthdays",
                            tag: `birthday-14d-${yearTag}-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        bdEligible.pushUserIds,
                        birthdayTrace
                    );
                }

                if (isSameDay(nextBirthday, today) && !sentBirthdaysToday.has(birthdayKey)) {
                    sentBirthdaysToday.add(birthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        bdEligible.inAppUserIds,
                        {
                            title: "¡Feliz Cumpleaños!",
                            body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                            url: "/birthdays",
                            tag: `birthday-today-${yearTag}-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        bdEligible.pushUserIds,
                        birthdayTrace
                    );
                }
            }

            // Also process member birthdays from c_miembros (not in c_cumpleanos)
            for (const memberDoc of membersForBirthdaySnap.docs) {
                const m = memberDoc.data() as MemberBasic & { barrioOrg?: string };
                if (!m.birthDate || !m.firstName || !m.lastName) continue;
                if (m.status === "deceased" || m.status === "fallecido" || m.status === "fallecida") continue;

                const memberDocBarrioOrg = m.barrioOrg || null;
                const memberName = `${m.firstName} ${m.lastName}`;
                const memberBirthdayKey = buildBirthdayDedupKey(memberName, memberDoc.id);
                const memberNameKey = buildBirthdayDedupKey(memberName);
                // Skip if already covered by c_cumpleanos record (deduplication by memberId or normalized name)
                if (coveredBirthdayKeys.has(memberBirthdayKey) || coveredBirthdayKeys.has(memberNameKey)) continue;

                const nextBirthday = getBirthdayDateInEcuador(m.birthDate, today.getFullYear());
                if (!nextBirthday) continue;

                const bdEligible = getEligibleUsers(allUsers, "birthdays", memberDocBarrioOrg);
                if (bdEligible.inAppUserIds.length === 0 && bdEligible.pushUserIds.length === 0) continue;

                const statusLabel = getBirthdayStatusLabel(m.status);
                const nameWithStatus = statusLabel ? `${memberName} (${statusLabel})` : memberName;
                const yearTag = today.getFullYear();

                if (isSameDay(nextBirthday, in14Days) && !sentBirthdays14.has(memberBirthdayKey)) {
                    sentBirthdays14.add(memberBirthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        bdEligible.inAppUserIds,
                        {
                            title: "Próximo Cumpleaños",
                            body: `Faltan 14 días para el cumpleaños de ${nameWithStatus}.`,
                            url: "/birthdays",
                            tag: `birthday-14d-${yearTag}-member-${memberDoc.id}`,
                            barrioOrg: memberDocBarrioOrg || null,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        bdEligible.pushUserIds,
                        birthdayTrace
                    );
                }

                if (isSameDay(nextBirthday, today) && !sentBirthdaysToday.has(memberBirthdayKey)) {
                    sentBirthdaysToday.add(memberBirthdayKey);
                    await notificationDispatcher.broadcastToUsers(
                        bdEligible.inAppUserIds,
                        {
                            title: "¡Feliz Cumpleaños!",
                            body: `¡Hoy es el cumpleaños de ${nameWithStatus}! No olvides felicitarle.`,
                            url: "/birthdays",
                            tag: `birthday-today-${yearTag}-member-${memberDoc.id}`,
                            barrioOrg: memberDocBarrioOrg || null,
                            context: { contextType: "birthday", actionUrl: "/birthdays", actionType: "navigate" },
                        },
                        bdEligible.pushUserIds,
                        birthdayTrace
                    );
                }
            }
        }

        // ── Futuros Miembros – 3 días antes del bautismo ────────────────────
        const futureMembersTrace = buildNotificationTrace("dailyNotifications", "futureMembers");
        {
            const fmSnap = await getCollectionDocsForBarrios("c_futuros_miembros", activeBarrioOrgs);
            for (const doc of fmSnap.docs) {
                const fm = doc.data() as { name: string; baptismDate: admin.firestore.Timestamp; isBaptized?: boolean; barrioOrg?: string };
                if (fm.isBaptized) continue;
                const baptismDate = fm.baptismDate?.toDate();
                if (!baptismDate) continue;
                const baptismDay = new Date(baptismDate.getFullYear(), baptismDate.getMonth(), baptismDate.getDate());

                if (isSameDay(baptismDay, in3Days)) {
                    const docBarrioOrg = fm.barrioOrg || null;
                    const fmEligible = getEligibleUsers(allUsers, "futureMembers", docBarrioOrg);
                    if (fmEligible.inAppUserIds.length === 0 && fmEligible.pushUserIds.length === 0) continue;

                    await notificationDispatcher.broadcastToUsers(
                        fmEligible.inAppUserIds,
                        {
                            title: "Próximo Bautismo",
                            body: `Faltan 3 días para el bautismo de ${fm.name} (${format(baptismDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/missionary-work?tab=future_members",
                            tag: `future-member-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "future_member", contextId: doc.id, actionUrl: "/missionary-work?tab=future_members", actionType: "navigate" },
                        },
                        fmEligible.pushUserIds,
                        futureMembersTrace
                    );
                }
            }
        }

        // ── Servicios – 14 días antes y el mismo día ─────────────────────────
        const serviceTrace = buildNotificationTrace("dailyNotifications", "service");
        {
            const servicesSnap = await getCollectionDocsForBarrios(
                "c_servicios",
                activeBarrioOrgs,
                (q) =>
                    q
                        .where("date", ">=", admin.firestore.Timestamp.fromDate(today))
                        .where("date", "<=", admin.firestore.Timestamp.fromDate(in14Days))
            );
            for (const doc of servicesSnap.docs) {
                const svc = doc.data() as Service & { barrioOrg?: string };
                const svcDate = svc.date.toDate();
                const svcDay = new Date(svcDate.getFullYear(), svcDate.getMonth(), svcDate.getDate());
                const timeStr = svc.time ? ` a las ${svc.time}` : "";
                const docBarrioOrg = svc.barrioOrg || null;

                if (isSameDay(svcDay, in14Days)) {
                    const svcEligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
                    if (svcEligible.inAppUserIds.length === 0 && svcEligible.pushUserIds.length === 0) continue;
                    await notificationDispatcher.broadcastToUsers(
                        svcEligible.inAppUserIds,
                        {
                            title: "Recordatorio de Servicio",
                            body: `El servicio "${svc.title}" es en 14 días (${format(svcDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/service",
                            tag: `service-14d-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                        },
                        svcEligible.pushUserIds,
                        serviceTrace
                    );
                }

                if (isSameDay(svcDay, today)) {
                    const svcEligible = getEligibleUsers(allUsers, "service", docBarrioOrg);
                    if (svcEligible.inAppUserIds.length === 0 && svcEligible.pushUserIds.length === 0) continue;
                    await notificationDispatcher.broadcastToUsers(
                        svcEligible.inAppUserIds,
                        {
                            title: "¡Servicio Hoy!",
                            body: `El servicio "${svc.title}" es hoy${timeStr}.`,
                            url: "/service",
                            tag: `service-today-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "service", contextId: doc.id, actionUrl: "/service", actionType: "navigate" },
                        },
                        svcEligible.pushUserIds,
                        serviceTrace
                    );
                }
            }
        }

        // ── Actividades – 14 días antes y el mismo día ───────────────────────
        const activitiesTrace = buildNotificationTrace("dailyNotifications", "activities");
        {
            const actSnap = await getCollectionDocsForBarrios(
                "c_actividades",
                activeBarrioOrgs,
                (q) =>
                    q
                        .where("date", ">=", admin.firestore.Timestamp.fromDate(today))
                        .where("date", "<=", admin.firestore.Timestamp.fromDate(in14Days))
            );
            for (const doc of actSnap.docs) {
                const act = doc.data() as Activity & { barrioOrg?: string };
                const actDate = act.date.toDate();
                const actDay = new Date(actDate.getFullYear(), actDate.getMonth(), actDate.getDate());
                const timeStr = act.time ? ` a las ${act.time}` : "";
                const docBarrioOrg = act.barrioOrg || null;

                if (isSameDay(actDay, in14Days)) {
                    const actEligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
                    if (actEligible.inAppUserIds.length === 0 && actEligible.pushUserIds.length === 0) continue;
                    await notificationDispatcher.broadcastToUsers(
                        actEligible.inAppUserIds,
                        {
                            title: "Recordatorio de Actividad",
                            body: `La actividad "${act.title}" es en 14 días (${format(actDate, "d MMM yyyy", { locale: es })}).`,
                            url: "/reports/activities",
                            tag: `activity-14d-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
                            context: { contextType: "activity", contextId: doc.id, actionUrl: "/reports/activities", actionType: "navigate" },
                        },
                        actEligible.pushUserIds,
                        activitiesTrace
                    );
                }

                if (isSameDay(actDay, today)) {
                    const actEligible = getEligibleUsers(allUsers, "activities", docBarrioOrg);
                    if (actEligible.inAppUserIds.length === 0 && actEligible.pushUserIds.length === 0) continue;
                    await notificationDispatcher.broadcastToUsers(
                        actEligible.inAppUserIds,
                        {
                            title: "¡Actividad Hoy!",
                            body: `La actividad "${act.title}" es hoy${timeStr}.`,
                            url: "/reports/activities",
                            tag: `activity-today-${doc.id}`,
                            barrioOrg: docBarrioOrg || null,
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
export const weeklyNotifications = functions
    .runWith({ maxInstances: MAX_INSTANCES_SCHEDULED })
    .pubsub
    .schedule("0 9 * * 1")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
        functions.logger.log("weeklyNotifications: running...", {
            scheduledTimeZone: ECUADOR_TZ,
            scheduledLocalTime: getEcuadorNowLabel(),
        });
        const allUsers = await getAllUsersNotificationData();
        const activeBarrioOrgs = getActiveBarrioOrgs(allUsers);
        // Ecuador date key so weekly tags are unique each week (in-app + FCM replacement)
        const weekDateParts = getDatePartsInTimeZone(new Date(), ECUADOR_TZ);
        const weekDateTag = `${weekDateParts.year}-${String(weekDateParts.month).padStart(2, "0")}-${String(weekDateParts.day).padStart(2, "0")}`;

        // ── Observaciones ────────────────────────────────────────────────────
        const observationsTrace = buildNotificationTrace("weeklyNotifications", "observations");
        {
            const [membersSnap, healthSnap, ministeringSnap] = await Promise.all([
                getCollectionDocsForBarrios("c_miembros", activeBarrioOrgs),
                getCollectionDocsForBarrios("c_observaciones_salud", activeBarrioOrgs),
                getCollectionDocsForBarrios("c_ministracion", activeBarrioOrgs),
            ]);

            // Group stats by barrioOrg
            interface ObservationStats {
                sinInvestidura: number;
                sinOrdenanzaElder: number;
                sinSacerdocioMayor: number;
                inactivos: number;
                menosActivos: number;
                urgentes: number;
                enConsejo: number;
                urgentFamilies: number;
                healthCount: number;
            }
            const barrioOrgStats = new Map<string, ObservationStats>();
            const getStats = (key: string): ObservationStats => {
                if (!barrioOrgStats.has(key)) {
                    barrioOrgStats.set(key, {
                        sinInvestidura: 0, sinOrdenanzaElder: 0, sinSacerdocioMayor: 0,
                        inactivos: 0, menosActivos: 0, urgentes: 0, enConsejo: 0,
                        urgentFamilies: 0, healthCount: 0,
                    });
                }
                return barrioOrgStats.get(key)!;
            };

            membersSnap.forEach((doc) => {
                const m = doc.data() as {
                    status?: string; ordinances?: string[]; isUrgent?: boolean;
                    isInCouncil?: boolean; barrioOrg?: string;
                };
                const key = m.barrioOrg || "unknown";
                const s = getStats(key);
                const ords = m.ordinances ?? [];
                if (!ords.includes("endowment")) s.sinInvestidura++;
                if (!ords.includes("elder_ordination") && !ords.includes("high_priest_ordination")) s.sinOrdenanzaElder++;
                if (!ords.includes("high_priest_ordination") && !ords.includes("elder_ordination")) s.sinSacerdocioMayor++;
                if (m.status === "inactive") s.inactivos++;
                if (m.status === "less_active") s.menosActivos++;
                if (m.isUrgent) s.urgentes++;
                if (m.isInCouncil) s.enConsejo++;
            });

            ministeringSnap.forEach((doc) => {
                const c = doc.data() as Companionship & { barrioOrg?: string };
                const key = c.barrioOrg || "unknown";
                const s = getStats(key);
                (c.families ?? []).forEach((f) => { if (f.isUrgent) s.urgentFamilies++; });
            });

            healthSnap.forEach((doc) => {
                const data = doc.data() as { barrioOrg?: string };
                const key = data.barrioOrg || "unknown";
                const s = getStats(key);
                s.healthCount++;
            });

            // Send per-barrioOrg notifications
            for (const [barrioOrg, s] of barrioOrgStats.entries()) {
                const obsEligible = getEligibleUsers(allUsers, "observations", barrioOrg);
                if (obsEligible.inAppUserIds.length === 0 && obsEligible.pushUserIds.length === 0) continue;

                const bodyParts: string[] = [];
                if (s.sinInvestidura > 0) bodyParts.push(`${s.sinInvestidura} sin investidura`);
                if (s.sinOrdenanzaElder > 0) bodyParts.push(`${s.sinOrdenanzaElder} sin ordenanza de élderes`);
                if (s.sinSacerdocioMayor > 0) bodyParts.push(`${s.sinSacerdocioMayor} sin ordenanza de élderes`);
                if (s.inactivos > 0) bodyParts.push(`${s.inactivos} inactivos`);
                if (s.menosActivos > 0) bodyParts.push(`${s.menosActivos} menos activos`);
                if (s.urgentFamilies > 0) bodyParts.push(`${s.urgentFamilies} familias con necesidad urgente`);
                if (s.healthCount > 0) bodyParts.push(`${s.healthCount} con apoyo de salud`);
                if (s.urgentes > 0) bodyParts.push(`${s.urgentes} miembros urgentes`);
                if (s.enConsejo > 0) bodyParts.push(`${s.enConsejo} en seguimiento de consejo`);

                if (bodyParts.length > 0) {
                    await notificationDispatcher.broadcastToUsers(
                        obsEligible.inAppUserIds,
                        {
                            title: "Resumen Semanal – Observaciones",
                            body: bodyParts.join(", ") + ".",
                            url: "/observations",
                            tag: `weekly-observations-${weekDateTag}-${barrioOrg}`,
                            barrioOrg: barrioOrg || null,
                            context: { actionUrl: "/observations", actionType: "navigate" },
                        },
                        obsEligible.pushUserIds,
                        observationsTrace
                    );
                }
            }
        }

        // ── Miembros Fallecidos sin Ordenanzas Completas (Solo Push, solo Lunes) ─
        {
            const deceasedMembersQuery = await getCollectionDocsForBarrios(
                "c_miembros",
                activeBarrioOrgs,
                (q) => q.where("status", "==", "deceased")
            );

            const ALL_TEMPLE_ORDINANCES = [
                'baptism', 'confirmation', 'initiatory', 'endowment',
                'sealed_to_father', 'sealed_to_mother', 'sealed_to_spouse'
            ];

            // Group deceased members needing ordinances by barrioOrg
            const deceasedByBarrioOrg = new Map<string, { id: string; firstName: string; lastName: string; templeOrdinances: string[] }[]>();
            
            deceasedMembersQuery.forEach((doc) => {
                const m = doc.data();
                const templeOrdinances = m.templeOrdinances || [];
                const hasAll = ALL_TEMPLE_ORDINANCES.every(ord => templeOrdinances.includes(ord));
                if (!hasAll) {
                    const key = m.barrioOrg || "unknown";
                    if (!deceasedByBarrioOrg.has(key)) deceasedByBarrioOrg.set(key, []);
                    deceasedByBarrioOrg.get(key)!.push({
                        id: doc.id,
                        firstName: m.firstName || '',
                        lastName: m.lastName || '',
                        templeOrdinances
                    });
                }
            });

            for (const [barrioOrg, membersNeedingOrdinances] of deceasedByBarrioOrg.entries()) {
                if (membersNeedingOrdinances.length === 0) continue;

                // Per-device opt-in: include barrio users; only devices with tokens receive FCM
                const pushUsers = allUsers.filter(u => !barrioOrg || barrioOrg === "unknown" || u.barrioOrg === barrioOrg);
                
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
                            tag: `weekly-deceased-ordinances-${weekDateTag}-${barrioOrg}`,
                            barrioOrg: barrioOrg || null,
                            context: { contextType: "member", actionUrl: "/council", actionType: "navigate" },
                        },
                        pushUserIds,
                        buildNotificationTrace("weeklyNotifications", "deceased-members")
                    );
                    
                    functions.logger.log(`weeklyNotifications: Sent deceased members ordinance notification for barrioOrg=${barrioOrg} to ${pushUserIds.length} users`);
                }
            }
        }

        // ── Conversos (derivados de c_miembros.baptismDate, últimos 24 meses) ─
        const convertsTrace = buildNotificationTrace("weeklyNotifications", "converts");
        {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - 24);
            const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

            const [membersSnap, friendsSnap, convertInfoSnap] = await Promise.all([
                getCollectionDocsForBarrios(
                    "c_miembros",
                    activeBarrioOrgs,
                    (q) => q.where("baptismDate", ">=", cutoffTs)
                ),
                getCollectionDocsForBarrios("c_obra_misional_amigos_conversos", activeBarrioOrgs),
                getCollectionDocsForBarrios("c_conversos_info", activeBarrioOrgs),
            ]);

            const assignedFriendConvertIds = new Set<string>();
            friendsSnap.forEach((docSnap) => {
                const f = docSnap.data() as { convertId?: string; friends?: string[] };
                if (f.convertId && Array.isArray(f.friends) && f.friends.length > 0) {
                    assignedFriendConvertIds.add(f.convertId);
                }
            });

            const convertInfoById = new Map<string, {
                calling?: string;
                recommendationActive?: boolean;
                selfRelianceCourse?: boolean;
                notes?: string;
            }>();
            convertInfoSnap.forEach((docSnap) => {
                convertInfoById.set(docSnap.id, docSnap.data() as {
                    calling?: string;
                    recommendationActive?: boolean;
                    selfRelianceCourse?: boolean;
                    notes?: string;
                });
            });

            interface ConvertStats {
                total: number;
                conObservacion: number;
                sinAmigo: number;
                sinMinistrantesMaestros: number;
                sinLlamamiento: number;
                sinRecomendacion: number;
                sinAutosuficiencia: number;
            }
            const convertStatsByBarrioOrg = new Map<string, ConvertStats>();
            const getConvStats = (key: string): ConvertStats => {
                if (!convertStatsByBarrioOrg.has(key)) {
                    convertStatsByBarrioOrg.set(key, {
                        total: 0, conObservacion: 0, sinAmigo: 0,
                        sinMinistrantesMaestros: 0, sinLlamamiento: 0,
                        sinRecomendacion: 0, sinAutosuficiencia: 0,
                    });
                }
                return convertStatsByBarrioOrg.get(key)!;
            };

            membersSnap.forEach((docSnap) => {
                const m = docSnap.data() as {
                    status?: string;
                    baptismDate?: admin.firestore.Timestamp;
                    ministeringTeachers?: string[];
                    barrioOrg?: string;
                    inactiveObservation?: string;
                };
                const status = String(m.status || "").toLowerCase();
                if (["deceased", "fallecido", "fallecida"].includes(status)) return;
                if (!m.baptismDate?.toDate || m.baptismDate.toDate() <= cutoff) return;

                const convertId = `member_${docSnap.id}`;
                const info = convertInfoById.get(convertId);
                const key = m.barrioOrg || "unknown";
                const s = getConvStats(key);
                s.total++;
                if (info?.notes?.trim() || m.inactiveObservation?.trim()) s.conObservacion++;
                if (
                    !assignedFriendConvertIds.has(convertId) &&
                    !assignedFriendConvertIds.has(docSnap.id)
                ) {
                    s.sinAmigo++;
                }
                if (!Array.isArray(m.ministeringTeachers) || m.ministeringTeachers.length === 0) {
                    s.sinMinistrantesMaestros++;
                }
                if (!info?.calling?.trim()) s.sinLlamamiento++;
                if (info?.recommendationActive !== true) s.sinRecomendacion++;
                if (info?.selfRelianceCourse !== true) s.sinAutosuficiencia++;
            });

            for (const [barrioOrg, s] of convertStatsByBarrioOrg.entries()) {
                const convEligible = getEligibleUsers(allUsers, "converts", barrioOrg);
                if (convEligible.inAppUserIds.length === 0 && convEligible.pushUserIds.length === 0) continue;

                const bodyParts: string[] = [];
                if (s.total > 0) bodyParts.push(`${s.total} conversos registrados`);
                if (s.sinAmigo > 0) bodyParts.push(`${s.sinAmigo} sin amigo asignado`);
                if (s.sinLlamamiento > 0) bodyParts.push(`${s.sinLlamamiento} sin llamamiento`);
                if (s.sinRecomendacion > 0) bodyParts.push(`${s.sinRecomendacion} sin recomendación`);
                if (s.sinAutosuficiencia > 0) bodyParts.push(`${s.sinAutosuficiencia} sin curso de autosuficiencia`);
                if (s.sinMinistrantesMaestros > 0) bodyParts.push(`${s.sinMinistrantesMaestros} sin maestros ministrantes`);
                if (s.conObservacion > 0) bodyParts.push(`${s.conObservacion} con observación`);

                if (bodyParts.length > 0) {
                    await notificationDispatcher.broadcastToUsers(
                        convEligible.inAppUserIds,
                        {
                            title: "Resumen Semanal – Conversos",
                            body: bodyParts.join(", ") + ".",
                            url: "/converts",
                            tag: `weekly-converts-${weekDateTag}-${barrioOrg}`,
                            barrioOrg: barrioOrg || null,
                            context: { contextType: "convert", actionUrl: "/converts", actionType: "navigate" },
                        },
                        convEligible.pushUserIds,
                        convertsTrace
                    );
                }
            }
        }

        // ── FamilySearch ─────────────────────────────────────────────────────
        const familySearchTrace = buildNotificationTrace("weeklyNotifications", "familySearch");
        {
            const fsSnap = await getCollectionDocsForBarrios("c_fs_capacitaciones", activeBarrioOrgs);
            // Group counts by barrioOrg
            const fsCountByBarrioOrg = new Map<string, number>();
            fsSnap.forEach((doc) => {
                const data = doc.data() as { barrioOrg?: string };
                const key = data.barrioOrg || "unknown";
                fsCountByBarrioOrg.set(key, (fsCountByBarrioOrg.get(key) || 0) + 1);
            });
            for (const [barrioOrg, fsCount] of fsCountByBarrioOrg.entries()) {
                if (fsCount <= 0) continue;
                const fsEligible = getEligibleUsers(allUsers, "familySearch", barrioOrg);
                if (fsEligible.inAppUserIds.length === 0 && fsEligible.pushUserIds.length === 0) continue;
                await notificationDispatcher.broadcastToUsers(
                    fsEligible.inAppUserIds,
                    {
                        title: "FamilySearch – Familias por Capacitar",
                        body: `Hay ${fsCount} familia${fsCount !== 1 ? "s" : ""} pendiente${fsCount !== 1 ? "s" : ""} de capacitación en FamilySearch.`,
                        url: "/family-search",
                        tag: `weekly-family-search-${weekDateTag}-${barrioOrg}`,
                        barrioOrg: barrioOrg || null,
                        context: { actionUrl: "/family-search", actionType: "navigate" },
                    },
                    fsEligible.pushUserIds,
                    familySearchTrace
                );
            }
        }

        // ── Obra Misional ─────────────────────────────────────────────────────
        const missionaryWorkTrace = buildNotificationTrace("weeklyNotifications", "missionaryWork");
        {
            const mwCutoff = new Date();
            mwCutoff.setMonth(mwCutoff.getMonth() - 24);
            const mwCutoffTs = admin.firestore.Timestamp.fromDate(mwCutoff);

            const [assignmentsSnap, investigatorsSnap, recentConvertMembersSnap] = await Promise.all([
                getCollectionDocsForBarrios(
                    "c_obra_misional_asignaciones",
                    activeBarrioOrgs,
                    (q) => q.where("isCompleted", "==", false)
                ),
                getCollectionDocsForBarrios(
                    "c_obra_misional_investigadores",
                    activeBarrioOrgs,
                    (q) => q.where("status", "==", "active")
                ),
                getCollectionDocsForBarrios(
                    "c_miembros",
                    activeBarrioOrgs,
                    (q) => q.where("baptismDate", ">=", mwCutoffTs)
                ),
            ]);

            interface MwStats {
                pendingAssignments: number;
                activeInvestigators: number;
                totalConverts: number;
            }
            const mwStatsByBarrioOrg = new Map<string, MwStats>();
            const getMwStats = (key: string): MwStats => {
                if (!mwStatsByBarrioOrg.has(key)) {
                    mwStatsByBarrioOrg.set(key, { pendingAssignments: 0, activeInvestigators: 0, totalConverts: 0 });
                }
                return mwStatsByBarrioOrg.get(key)!;
            };

            assignmentsSnap.forEach((doc) => {
                const data = doc.data() as { barrioOrg?: string };
                const key = data.barrioOrg || "unknown";
                getMwStats(key).pendingAssignments++;
            });
            investigatorsSnap.forEach((doc) => {
                const data = doc.data() as { barrioOrg?: string };
                const key = data.barrioOrg || "unknown";
                getMwStats(key).activeInvestigators++;
            });
            recentConvertMembersSnap.forEach((doc) => {
                const data = doc.data() as {
                    barrioOrg?: string;
                    status?: string;
                    baptismDate?: admin.firestore.Timestamp;
                };
                const status = String(data.status || "").toLowerCase();
                if (["deceased", "fallecido", "fallecida"].includes(status)) return;
                if (!data.baptismDate?.toDate || data.baptismDate.toDate() <= mwCutoff) return;
                const key = data.barrioOrg || "unknown";
                getMwStats(key).totalConverts++;
            });

            for (const [barrioOrg, s] of mwStatsByBarrioOrg.entries()) {
                const mwEligible = getEligibleUsers(allUsers, "missionaryWork", barrioOrg);
                if (mwEligible.inAppUserIds.length === 0 && mwEligible.pushUserIds.length === 0) continue;

                const bodyParts: string[] = [];
                if (s.pendingAssignments > 0) bodyParts.push(`${s.pendingAssignments} asignación${s.pendingAssignments !== 1 ? "es" : ""} misional${s.pendingAssignments !== 1 ? "es" : ""} pendiente${s.pendingAssignments !== 1 ? "s" : ""}`);
                if (s.activeInvestigators > 0) bodyParts.push(`${s.activeInvestigators} investigador${s.activeInvestigators !== 1 ? "es" : ""} activo${s.activeInvestigators !== 1 ? "s" : ""}`);
                if (s.totalConverts > 0) bodyParts.push(`${s.totalConverts} nuevo${s.totalConverts !== 1 ? "s" : ""} converso${s.totalConverts !== 1 ? "s" : ""} registrado${s.totalConverts !== 1 ? "s" : ""}`);

                if (bodyParts.length > 0) {
                    await notificationDispatcher.broadcastToUsers(
                        mwEligible.inAppUserIds,
                        {
                            title: "Resumen Semanal – Obra Misional",
                            body: bodyParts.join(", ") + ".",
                            url: "/missionary-work",
                            tag: `weekly-missionary-work-${weekDateTag}-${barrioOrg}`,
                            barrioOrg: barrioOrg || null,
                            context: { contextType: "missionary_assignment", actionUrl: "/missionary-work", actionType: "navigate" },
                        },
                        mwEligible.pushUserIds,
                        missionaryWorkTrace
                    );
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
export const councilNotifications = functions
    .runWith({ maxInstances: MAX_INSTANCES_SCHEDULED })
    .pubsub
    .schedule("0 18 * * 2,3")
    .timeZone(ECUADOR_TZ)
    .onRun(async () => {
        functions.logger.log("councilNotifications: running...", {
            scheduledTimeZone: ECUADOR_TZ,
            scheduledLocalTime: getEcuadorNowLabel(),
        });
        const allUsers = await getAllUsersNotificationData();
        const activeBarrioOrgs = getActiveBarrioOrgs(allUsers);
        const councilTrace = buildNotificationTrace("councilNotifications", "council");

        const [membersSnap, ministeringSnap] = await Promise.all([
            getCollectionDocsForBarrios("c_miembros", activeBarrioOrgs),
            getCollectionDocsForBarrios("c_ministracion", activeBarrioOrgs),
        ]);

        // Group council stats by barrioOrg
        interface CouncilStats {
            urgentMembers: number;
            lessActiveMembers: number;
            inCouncil: number;
            urgentFamiliesMinistering: number;
        }
        const councilStatsByBarrioOrg = new Map<string, CouncilStats>();
        const getCouncilStats = (key: string): CouncilStats => {
            if (!councilStatsByBarrioOrg.has(key)) {
                councilStatsByBarrioOrg.set(key, {
                    urgentMembers: 0, lessActiveMembers: 0,
                    inCouncil: 0, urgentFamiliesMinistering: 0,
                });
            }
            return councilStatsByBarrioOrg.get(key)!;
        };

        membersSnap.forEach((doc) => {
            const m = doc.data() as { isUrgent?: boolean; status?: string; isInCouncil?: boolean; barrioOrg?: string };
            const key = m.barrioOrg || "unknown";
            const s = getCouncilStats(key);
            if (m.isUrgent) s.urgentMembers++;
            if (m.status === "less_active" || m.status === "inactive") s.lessActiveMembers++;
            if (m.isInCouncil) s.inCouncil++;
        });

        ministeringSnap.forEach((doc) => {
            const c = doc.data() as Companionship & { barrioOrg?: string };
            const key = c.barrioOrg || "unknown";
            const s = getCouncilStats(key);
            (c.families ?? []).forEach((f) => { if (f.isUrgent) s.urgentFamiliesMinistering++; });
        });

        const today = getEcuadorToday();
        const dateParts = getDatePartsInTimeZone(today, ECUADOR_TZ);
        const dateTag = `${dateParts.year}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;

        for (const [barrioOrg, s] of councilStatsByBarrioOrg.entries()) {
            const councilEligible = getEligibleUsers(allUsers, "council", barrioOrg);
            if (councilEligible.inAppUserIds.length === 0 && councilEligible.pushUserIds.length === 0) continue;

            const bodyParts: string[] = [];
            if (s.urgentMembers > 0) bodyParts.push(`${s.urgentMembers} necesidad${s.urgentMembers !== 1 ? "es" : ""} urgente${s.urgentMembers !== 1 ? "s" : ""} de miembros`);
            if (s.urgentFamiliesMinistering > 0) bodyParts.push(`${s.urgentFamiliesMinistering} necesidad${s.urgentFamiliesMinistering !== 1 ? "es" : ""} urgente${s.urgentFamiliesMinistering !== 1 ? "s" : ""} de ministración`);
            if (s.lessActiveMembers > 0) bodyParts.push(`${s.lessActiveMembers} miembro${s.lessActiveMembers !== 1 ? "s" : ""} menos activo${s.lessActiveMembers !== 1 ? "s" : ""}`);
            if (s.inCouncil > 0) bodyParts.push(`${s.inCouncil} en seguimiento de consejo`);

            if (bodyParts.length > 0) {
                await notificationDispatcher.broadcastToUsers(
                    councilEligible.inAppUserIds,
                    {
                        title: "Recordatorio – Consejo de Cuórum",
                        body: bodyParts.join(", ") + ".",
                        url: "/council",
                        tag: `council-reminder-${dateTag}-${barrioOrg}`,
                        barrioOrg: barrioOrg || null,
                        context: { contextType: "council", actionUrl: "/council", actionType: "navigate" },
                    },
                    councilEligible.pushUserIds,
                    councilTrace
                );
            }
        }

        functions.logger.log("councilNotifications: done.");
        return null;
    });

// ─────────────────────────────────────────────────────────────────────────────
// Data sync: DB write → Cloud Function → c_sync_signals (+ silent FCM)
// Clients auto-refresh. Manual refresh button = fallback only.
// ─────────────────────────────────────────────────────────────────────────────

const makeDataSyncFn = (collectionName: string, docPath: string) =>
    functions
        .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
        .firestore
        .document(docPath)
        .onWrite(createCollectionSyncHandler(firestore, messaging, functions.logger, collectionName));

export const syncOnMembersWrite = makeDataSyncFn("c_miembros", "c_miembros/{docId}");
export const syncOnAnnotationsWrite = makeDataSyncFn("c_anotaciones", "c_anotaciones/{docId}");
export const syncOnMinisteringWrite = makeDataSyncFn("c_ministracion", "c_ministracion/{docId}");
export const syncOnMinisteringDistrictsWrite = makeDataSyncFn(
    "c_ministracion_distritos",
    "c_ministracion_distritos/{docId}"
);
export const syncOnActivitiesWrite = makeDataSyncFn("c_actividades", "c_actividades/{docId}");
export const syncOnServicesWrite = makeDataSyncFn("c_servicios", "c_servicios/{docId}");
export const syncOnMissionaryAssignmentsWrite = makeDataSyncFn(
    "c_obra_misional_asignaciones",
    "c_obra_misional_asignaciones/{docId}"
);
export const syncOnInvestigatorsWrite = makeDataSyncFn(
    "c_obra_misional_investigadores",
    "c_obra_misional_investigadores/{docId}"
);
export const syncOnNewConvertFriendsWrite = makeDataSyncFn(
    "c_obra_misional_amigos_conversos",
    "c_obra_misional_amigos_conversos/{docId}"
);
export const syncOnHealthConcernsWrite = makeDataSyncFn(
    "c_observaciones_salud",
    "c_observaciones_salud/{docId}"
);
export const syncOnBirthdaysWrite = makeDataSyncFn("c_cumpleanos", "c_cumpleanos/{docId}");
export const syncOnBaptismsWrite = makeDataSyncFn("c_bautismos", "c_bautismos/{docId}");
export const syncOnFsTrainingsWrite = makeDataSyncFn(
    "c_fs_capacitaciones",
    "c_fs_capacitaciones/{docId}"
);
export const syncOnFsAnnotationsWrite = makeDataSyncFn(
    "c_fs_anotaciones",
    "c_fs_anotaciones/{docId}"
);
export const syncOnConvertsWrite = makeDataSyncFn("c_conversos", "c_conversos/{docId}");
export const syncOnFutureMembersWrite = makeDataSyncFn(
    "c_futuros_miembros",
    "c_futuros_miembros/{docId}"
);
export const syncOnUsersWrite = makeDataSyncFn("c_users", "c_users/{docId}");

/** Callable: re-broadcast a sync signal (rare; header refresh is the client fallback). */
export const requestDataSyncSignal = functions
    .runWith({ maxInstances: MAX_INSTANCES_DEFAULT })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Auth required");
    }

    // Resolve real barrioOrg from c_users — never trust client alone, never default to a ward
    const userDoc = await firestore.collection("c_users").doc(context.auth.uid).get();
    if (!userDoc.exists) {
        throw new functions.https.HttpsError("failed-precondition", "Usuario sin barrio asignado.");
    }
    const userData = userDoc.data() || {};
    let callerBarrioOrg = "";
    if (typeof userData.barrioOrg === "string") {
        const explicit = userData.barrioOrg.trim();
        if (explicit.includes("|") && !explicit.startsWith("|") && !explicit.endsWith("|")) {
            callerBarrioOrg = explicit;
        }
    }
    if (!callerBarrioOrg) {
        const barrio = typeof userData.barrio === "string" ? userData.barrio.trim() : "";
        const organizacion = typeof userData.organizacion === "string" ? userData.organizacion.trim() : "";
        if (!barrio || !organizacion) {
            throw new functions.https.HttpsError("failed-precondition", "Usuario sin barrio asignado.");
        }
        callerBarrioOrg = `${barrio}|${organizacion}`;
    }

    const requestedBarrioOrg = typeof data?.barrioOrg === "string" ? data.barrioOrg.trim() : "";
    if (!requestedBarrioOrg) {
        throw new functions.https.HttpsError("invalid-argument", "barrioOrg required");
    }
    if (requestedBarrioOrg !== callerBarrioOrg) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "No puedes disparar señales de sync para otro barrio."
        );
    }

    await publishSyncSignal(firestore, messaging, functions.logger, {
        barrioOrg: callerBarrioOrg,
        collection: typeof data?.collection === "string" ? data.collection : "manual",
        docId: typeof data?.docId === "string" ? data.docId : "manual",
        changeType: "write",
        notifyDevices: true,
    });
    return { ok: true };
});
