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
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeBarrioOrgDocId = encodeBarrioOrgDocId;
exports.extractBarrioOrg = extractBarrioOrg;
exports.publishSyncSignal = publishSyncSignal;
exports.isNotificationBookkeepingOnlyChange = isNotificationBookkeepingOnlyChange;
exports.createCollectionSyncHandler = createCollectionSyncHandler;
/**
 * Publishes a per-barrioOrg "sync signal" when domain data changes.
 * Client apps listen (onSnapshot) and pull fresh data automatically.
 * Manual refresh in the app remains a fallback if this pipeline fails.
 */
const admin = __importStar(require("firebase-admin"));
const SYNC_COLLECTION = "c_sync_signals";
/** Min interval between FCM data-sync multicasts per barrio (ms) */
const FCM_THROTTLE_MS = 15_000;
function encodeBarrioOrgDocId(barrioOrg) {
    return encodeURIComponent(barrioOrg.trim()).replace(/%/g, "_");
}
/**
 * Resolve barrio|organización scope for a document.
 * Never broadcasts globally — only the ward/org that owns the change.
 */
function extractBarrioOrg(data) {
    if (!data)
        return null;
    const raw = data.barrioOrg;
    if (typeof raw === "string") {
        const explicit = raw.trim();
        // Canonical multi-tenant key must be barrio|org (no leading/trailing pipe)
        if (explicit.includes("|") &&
            !explicit.startsWith("|") &&
            !explicit.endsWith("|")) {
            return explicit;
        }
    }
    // Legacy docs may store barrio + organizacion separately
    const barrio = typeof data.barrio === "string" ? data.barrio.trim() : "";
    const organizacion = typeof data.organizacion === "string" ? data.organizacion.trim() : "";
    if (barrio && organizacion)
        return `${barrio}|${organizacion}`;
    return null;
}
/**
 * Write/merge signal document so only clients of THIS barrioOrg refresh.
 * FCM is limited to users with the same barrioOrg (never whole project).
 */
async function publishSyncSignal(db, messaging, logger, params) {
    const barrioOrg = params.barrioOrg.trim();
    if (!barrioOrg || !barrioOrg.includes("|")) {
        // Require barrio|org form so we never fan-out without a real scope
        logger.warn("publishSyncSignal: refused — barrioOrg missing or invalid", {
            barrioOrg,
            collection: params.collection,
        });
        return;
    }
    const version = Date.now();
    const signalId = encodeBarrioOrgDocId(barrioOrg);
    const ref = db.collection(SYNC_COLLECTION).doc(signalId);
    let shouldSendFcm = params.notifyDevices !== false;
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const prev = snap.data();
            const lastFcm = typeof prev?.lastFcmAtMs === "number" ? prev.lastFcmAtMs : 0;
            if (version - lastFcm < FCM_THROTTLE_MS) {
                shouldSendFcm = false;
            }
            tx.set(ref, {
                barrioOrg,
                version,
                lastCollection: params.collection,
                lastDocId: params.docId,
                lastChangeType: params.changeType,
                collections: admin.firestore.FieldValue.arrayUnion(params.collection),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAtMs: version,
                ...(shouldSendFcm && params.notifyDevices !== false
                    ? { lastFcmAtMs: version }
                    : {}),
            }, { merge: true });
        });
    }
    catch (error) {
        logger.error("publishSyncSignal: failed to write signal", {
            error,
            barrioOrg,
            collection: params.collection,
        });
        return;
    }
    logger.log("publishSyncSignal: signal written", {
        barrioOrg,
        collection: params.collection,
        docId: params.docId,
        version,
        fcm: shouldSendFcm,
    });
    if (!shouldSendFcm || params.notifyDevices === false) {
        return;
    }
    try {
        await sendDataSyncFcm(db, messaging, logger, barrioOrg, {
            version: String(version),
            collection: params.collection,
            docId: params.docId,
            changeType: params.changeType,
        });
    }
    catch (error) {
        logger.warn("publishSyncSignal: FCM data-sync failed (signal doc still written)", {
            error,
            barrioOrg,
        });
    }
}
async function sendDataSyncFcm(db, messaging, logger, barrioOrg, data) {
    const usersSnap = await db
        .collection("c_users")
        .where("barrioOrg", "==", barrioOrg)
        .get();
    const userIds = usersSnap.docs.map((d) => d.id);
    if (userIds.length === 0)
        return;
    const tokens = [];
    for (let i = 0; i < userIds.length; i += 30) {
        const batch = userIds.slice(i, i + 30);
        const subSnap = await db
            .collection("c_push_subscriptions")
            .where("userId", "in", batch)
            .get();
        subSnap.forEach((docSnap) => {
            const data = docSnap.data();
            const t = data.fcmToken;
            // Silent data-sync only to devices that still have an active push subscription
            if (typeof t === "string" && t.length > 0 && data.enabled !== false) {
                tokens.push(t);
            }
        });
    }
    const unique = [...new Set(tokens)];
    if (unique.length === 0)
        return;
    const payloadData = {
        type: "data-sync",
        barrioOrg,
        version: data.version,
        collection: data.collection,
        docId: data.docId,
        changeType: data.changeType,
    };
    let success = 0;
    let failure = 0;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const response = await messaging.sendEachForMulticast({
            tokens: chunk,
            data: payloadData,
            android: { priority: "high" },
            webpush: {
                headers: { Urgency: "high" },
            },
            apns: {
                headers: {
                    "apns-priority": "5",
                    "apns-push-type": "background",
                },
                payload: {
                    aps: {
                        "content-available": 1,
                    },
                },
            },
        });
        success += response.successCount;
        failure += response.failureCount;
    }
    logger.log("publishSyncSignal: FCM data-sync sent", {
        barrioOrg,
        tokens: unique.length,
        success,
        failure,
    });
}
/**
 * Fields written only for notification delivery bookkeeping / derived flags.
 * Changes that touch ONLY these keys must NOT publish a data-sync signal:
 * the notification Cloud Function already carries that payload and writes
 * c_notifications / c_push_subscriptions itself.
 *
 * Domain content changes (title, families, status, …) still sync as usual.
 */
const SYNC_NOISE_FIELDS = new Set([
    // Written after the notification CF / helpers already created c_notifications + FCM.
    // Not displayed as shared domain content; only throttles re-sending.
    "urgentNotifiedAt",
    // Derived account flag from per-device push opt-in (not shared domain data)
    "pushNotificationsEnabled",
    // Push delivery diagnostics (never require a barrio-wide data pull)
    "lastPushAttemptAt",
    "lastPushAttemptMode",
    "lastPushResult",
    "lastPushErrorCode",
    "lastNotificationTag",
    // Server-side stamps that often accompany bookkeeping-only writes
    "updatedAt",
    "updatedAtMs",
    // Note: councilNotified IS shared UI state on /council — still publishes sync.
]);
function serializeForCompare(value) {
    if (value == null)
        return String(value);
    if (typeof value === "object") {
        // Firestore Timestamp / Date → stable ms
        if (typeof value.toMillis === "function") {
            return `ts:${value.toMillis()}`;
        }
        if (typeof value.toDate === "function") {
            return `ts:${value.toDate().getTime()}`;
        }
        if (value instanceof Date) {
            return `ts:${value.getTime()}`;
        }
        if (Array.isArray(value)) {
            return `[${value.map(serializeForCompare).join(",")}]`;
        }
        const obj = value;
        const keys = Object.keys(obj).sort();
        return `{${keys.map((k) => `${k}:${serializeForCompare(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
/**
 * True when the only differing keys (or values) are notification bookkeeping
 * noise — i.e. the notification pipeline already handled the user-facing side
 * and there is no domain data other clients need to pull.
 */
function isNotificationBookkeepingOnlyChange(beforeData, afterData) {
    if (!beforeData || !afterData)
        return false;
    const keys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
    let anyNoiseChange = false;
    for (const key of keys) {
        const beforeVal = serializeForCompare(beforeData[key]);
        const afterVal = serializeForCompare(afterData[key]);
        if (beforeVal === afterVal)
            continue;
        if (!SYNC_NOISE_FIELDS.has(key)) {
            return false;
        }
        anyNoiseChange = true;
    }
    return anyNoiseChange;
}
/**
 * Handler factory for functions.firestore.document(...).onWrite(...)
 *
 * Does NOT listen to c_notifications / c_push_subscriptions — those are owned
 * by the notification dispatcher CF and must never fan out a data-sync refresh.
 */
function createCollectionSyncHandler(db, messaging, logger, collectionName) {
    return async (change, context) => {
        // Notification pipeline collections must never publish data-sync signals
        if (collectionName === "c_notifications" ||
            collectionName === "c_push_subscriptions") {
            logger.log("sync handler: skip notification-owned collection", {
                collection: collectionName,
            });
            return;
        }
        const afterExists = Boolean(change?.after?.exists);
        const beforeExists = Boolean(change?.before?.exists);
        const afterData = afterExists ? change.after.data() : undefined;
        const beforeData = beforeExists ? change.before.data() : undefined;
        const resolvedBarrio = extractBarrioOrg(afterData) || extractBarrioOrg(beforeData);
        if (!resolvedBarrio) {
            logger.warn("sync handler: missing barrioOrg", {
                collection: collectionName,
                docId: context?.params?.docId || change?.after?.id || change?.before?.id,
            });
            return;
        }
        let changeType;
        if (!beforeExists && afterExists) {
            changeType = "create";
        }
        else if (beforeExists && !afterExists) {
            changeType = "delete";
        }
        else {
            changeType = "update";
        }
        const docId = context?.params?.docId || change?.after?.id || change?.before?.id || "unknown";
        // Notification CF / client notif helpers write throttle flags (e.g. urgentNotifiedAt)
        // AFTER they already wrote c_notifications and sent FCM.
        // Those writes must not re-activate the data-sync CF — the other CF already
        // carried and persisted the user-facing notification payload.
        if (changeType === "update" &&
            isNotificationBookkeepingOnlyChange(beforeData, afterData)) {
            logger.log("sync handler: skip notification bookkeeping-only update", {
                collection: collectionName,
                docId,
                barrioOrg: resolvedBarrio,
            });
            return;
        }
        await publishSyncSignal(db, messaging, logger, {
            barrioOrg: resolvedBarrio,
            collection: collectionName,
            docId,
            changeType,
            notifyDevices: true,
        });
    };
}
//# sourceMappingURL=data-sync-publisher.js.map