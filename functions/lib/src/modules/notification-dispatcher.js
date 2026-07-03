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
exports.NotificationDispatcher = void 0;
const admin = __importStar(require("firebase-admin"));
const crypto_1 = require("crypto");
class UserRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async getAllUserIds() {
        const snapshot = await this.db.collection("c_users").select().get();
        return snapshot.docs.map((doc) => doc.id);
    }
}
class NotificationRepository {
    db;
    collection;
    constructor(db) {
        this.db = db;
        this.collection = this.db.collection("c_notifications");
    }
    async saveMany(records) {
        if (records.length === 0) {
            return;
        }
        await Promise.all(records.map(async (record) => {
            const tag = typeof record.notificationTag === "string" ? record.notificationTag : null;
            if (!tag) {
                await this.collection.add(record);
                return;
            }
            const docId = buildDeterministicNotificationDocId(record.userId, tag);
            try {
                await this.collection.doc(docId).create(record);
            }
            catch (error) {
                const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
                if (code === 6) {
                    return;
                }
                throw error;
            }
        }));
    }
}
function buildDeterministicNotificationDocId(userId, tag) {
    const safeUser = sanitizeDocIdPart(userId);
    const safeTag = sanitizeDocIdPart(tag);
    const raw = `${safeUser}__${safeTag}`;
    if (raw.length <= 1400) {
        return raw;
    }
    const hash = (0, crypto_1.createHash)("sha256").update(raw).digest("hex");
    return `${safeUser}__${hash}`;
}
function sanitizeDocIdPart(input) {
    return input.replace(/\//g, "_").trim();
}
class FcmRepository {
    db;
    messaging;
    logger;
    collection;
    constructor(db, messaging, logger) {
        this.db = db;
        this.messaging = messaging;
        this.logger = logger;
        this.collection = this.db.collection("c_push_subscriptions");
    }
    async getActiveTokens() {
        const snapshot = await this.collection.get();
        const tokens = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            const fcmToken = data.fcmToken;
            if (fcmToken) {
                tokens.push({
                    docId: doc.id,
                    userId: data.userId,
                    deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
                    fcmToken,
                });
            }
        });
        return tokens;
    }
    async getTokensForUsers(userIds) {
        if (userIds.length === 0)
            return [];
        // Firestore 'in' query supports max 30 elements; batch if needed
        const batches = [];
        for (let i = 0; i < userIds.length; i += 30) {
            const batch = userIds.slice(i, i + 30);
            batches.push(this.collection
                .where("userId", "in", batch)
                .get()
                .then((snap) => {
                const results = [];
                snap.forEach((doc) => {
                    const data = doc.data();
                    if (data.fcmToken) {
                        results.push({
                            docId: doc.id,
                            userId: data.userId,
                            deviceId: typeof data.deviceId === "string" ? data.deviceId : undefined,
                            fcmToken: data.fcmToken,
                        });
                    }
                });
                return results;
            }));
        }
        const results = await Promise.all(batches);
        return results.flat();
    }
    async sendToTokens(tokens, payload, mode = "live") {
        if (tokens.length === 0) {
            this.logger.log("No FCM tokens to notify.");
            return {
                successCount: 0,
                failureCount: 0,
                invalidatedCount: 0,
                outcomes: [],
                pushTokensResolved: 0,
            };
        }
        const tokenMap = new Map();
        for (const tokenRecord of tokens) {
            const existing = tokenMap.get(tokenRecord.fcmToken);
            if (existing) {
                existing.push(tokenRecord);
            }
            else {
                tokenMap.set(tokenRecord.fcmToken, [tokenRecord]);
            }
        }
        const rawTokens = [...tokenMap.keys()];
        const outcomes = [];
        let totalSuccess = 0;
        let totalFailure = 0;
        let totalInvalidated = 0;
        // FCM sendEachForMulticast supports up to 500 tokens per request
        const chunkSize = 500;
        for (let i = 0; i < rawTokens.length; i += chunkSize) {
            const chunk = rawTokens.slice(i, i + chunkSize);
            try {
                const response = await this.messaging.sendEachForMulticast({
                    tokens: chunk,
                    notification: {
                        title: payload.title,
                        body: payload.body,
                    },
                    // ── Android ──────────────────────────────────────────────────────
                    android: {
                        priority: "high",
                        notification: {
                            title: payload.title,
                            body: payload.body,
                            tag: payload.tag,
                            defaultVibrateTimings: true,
                            defaultSound: true,
                        },
                        data: {
                            url: payload.url ?? "/",
                            tag: payload.tag ?? "",
                        },
                    },
                    // ── iOS (APNs) ────────────────────────────────────────────────────
                    apns: {
                        payload: {
                            aps: {
                                alert: {
                                    title: payload.title,
                                    body: payload.body,
                                },
                                badge: 1,
                                sound: "default",
                            },
                        },
                        fcmOptions: {
                            analyticsLabel: payload.tag ?? "quorumflow",
                        },
                    },
                    // ── Web (PWA) ─────────────────────────────────────────────────────
                    webpush: {
                        headers: {
                            Urgency: "high",
                        },
                        notification: {
                            title: payload.title,
                            body: payload.body,
                            tag: payload.tag,
                            icon: "/logo.svg",
                            badge: "/logo.svg",
                        },
                        fcmOptions: {
                            link: payload.url ?? "/",
                        },
                    },
                    // ── Data payload (available on all platforms) ─────────────────────
                    data: {
                        url: payload.url ?? "/",
                        tag: payload.tag ?? "",
                        title: payload.title,
                        body: payload.body,
                    },
                }, mode === "dry-run");
                const failedTokens = [];
                const attemptUpdates = [];
                totalSuccess += response.successCount;
                totalFailure += response.failureCount;
                response.responses.forEach((resp, idx) => {
                    const token = chunk[idx];
                    const tokenRecords = tokenMap.get(token) ?? [];
                    const errorCode = resp.error?.code ?? null;
                    const errorMessage = resp.error?.message ?? null;
                    outcomes.push({
                        token,
                        success: resp.success,
                        errorCode,
                        errorMessage,
                        affectedSubscriptions: tokenRecords.length,
                    });
                    if (!resp.success) {
                        if (errorCode === "messaging/registration-token-not-registered" ||
                            errorCode === "messaging/invalid-registration-token") {
                            failedTokens.push(token);
                            this.logger.warn(`Invalid FCM token removed: ${token}`);
                        }
                        else {
                            this.logger.error(`FCM send error for token ${token}: ${errorMessage}`);
                        }
                    }
                    attemptUpdates.push(this.updatePushAttemptMetadata(tokenRecords, {
                        mode,
                        result: resp.success
                            ? "success"
                            : failedTokens.includes(token)
                                ? "invalid-token"
                                : "failure",
                        errorCode,
                        notificationTag: payload.tag ?? null,
                        invalidateToken: failedTokens.includes(token),
                    }));
                });
                totalInvalidated += failedTokens.length;
                await Promise.all(attemptUpdates);
            }
            catch (error) {
                this.logger.error(`Error sending FCM multicast: ${error}`);
                const batchErrorMessage = error instanceof Error ? error.message : String(error);
                const batchUpdates = [];
                for (const token of chunk) {
                    const tokenRecords = tokenMap.get(token) ?? [];
                    outcomes.push({
                        token,
                        success: false,
                        errorCode: "messaging/unknown-error",
                        errorMessage: batchErrorMessage,
                        affectedSubscriptions: tokenRecords.length,
                    });
                    totalFailure += 1;
                    batchUpdates.push(this.updatePushAttemptMetadata(tokenRecords, {
                        mode,
                        result: "failure",
                        errorCode: "messaging/unknown-error",
                        notificationTag: payload.tag ?? null,
                        invalidateToken: false,
                    }));
                }
                await Promise.all(batchUpdates);
            }
        }
        return {
            successCount: totalSuccess,
            failureCount: totalFailure,
            invalidatedCount: totalInvalidated,
            outcomes,
            pushTokensResolved: rawTokens.length,
        };
    }
    async updatePushAttemptMetadata(subscriptions, params) {
        if (subscriptions.length === 0) {
            return;
        }
        try {
            const batch = this.db.batch();
            for (const subscription of subscriptions) {
                const docRef = this.collection.doc(subscription.docId);
                batch.set(docRef, {
                    lastPushAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastPushAttemptMode: params.mode,
                    lastPushResult: params.result,
                    lastPushErrorCode: params.errorCode,
                    lastNotificationTag: params.notificationTag,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    ...(params.invalidateToken
                        ? {
                            fcmToken: null,
                            unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }
                        : {}),
                }, { merge: true });
            }
            await batch.commit();
        }
        catch (error) {
            this.logger.error(`Error updating push attempt metadata: ${error}`);
        }
    }
}
class NotificationRecordFactory {
    create(userId, request) {
        const { context } = request;
        const actionUrl = context?.actionUrl ?? request.url;
        const actionType = context?.actionType ?? (actionUrl ? "navigate" : undefined);
        return {
            userId,
            title: request.title,
            body: request.body,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,
            ...(actionUrl ? { actionUrl } : {}),
            ...(actionType ? { actionType } : {}),
            ...(context?.contextType ? { contextType: context.contextType } : {}),
            ...(context?.contextId ? { contextId: context.contextId } : {}),
            notificationTag: request.tag ?? null,
        };
    }
}
class NotificationDispatcher {
    logger;
    userRepository;
    notificationRepository;
    fcmRepository;
    recordFactory;
    constructor(db, messaging, logger) {
        this.logger = logger;
        this.userRepository = new UserRepository(db);
        this.notificationRepository = new NotificationRepository(db);
        this.fcmRepository = new FcmRepository(db, messaging, logger);
        this.recordFactory = new NotificationRecordFactory();
    }
    async broadcast(request) {
        this.logger.log(`Broadcasting notification: ${request.title}`);
        const [userIds, fcmTokens] = await Promise.all([
            this.userRepository.getAllUserIds(),
            this.fcmRepository.getActiveTokens(),
        ]);
        if (userIds.length === 0) {
            this.logger.warn("No users registered in the system to notify.");
        }
        const records = userIds.map((userId) => this.recordFactory.create(userId, request));
        const [, pushSummary] = await Promise.all([
            this.notificationRepository.saveMany(records),
            this.fcmRepository.sendToTokens(fcmTokens, {
                title: request.title,
                body: request.body,
                url: request.url ?? request.context?.actionUrl,
                tag: request.tag,
            }),
        ]);
        this.logDispatchSummary({
            label: request.tag ?? request.title,
            category: request.context?.contextType ?? request.tag ?? request.title,
            source: "broadcast",
            inAppRecipients: records.length,
            pushRecipients: userIds.length,
            pushTokensResolved: pushSummary.pushTokensResolved,
            successCount: pushSummary.successCount,
            failureCount: pushSummary.failureCount,
            invalidatedCount: pushSummary.invalidatedCount,
            attemptedAt: new Date().toISOString(),
            outcomes: pushSummary.outcomes,
        });
    }
    /**
     * Broadcast to specific users only (filtered by userId list).
     * Used by scheduled functions that already determine eligible users.
     */
    async broadcastToUsers(userIds, request, pushUserIds, trace) {
        if (userIds.length === 0 && (!pushUserIds || pushUserIds.length === 0)) {
            const emptySummary = {
                label: request.tag ?? request.title,
                category: trace?.category ?? request.context?.contextType ?? request.tag ?? request.title,
                source: trace?.source ?? "broadcastToUsers",
                inAppRecipients: 0,
                pushRecipients: 0,
                pushTokensResolved: 0,
                successCount: 0,
                failureCount: 0,
                invalidatedCount: 0,
                attemptedAt: new Date().toISOString(),
                scheduledTimeZone: trace?.scheduledTimeZone,
                scheduledLocalTime: trace?.scheduledLocalTime,
                outcomes: [],
            };
            this.logDispatchSummary(emptySummary);
            return emptySummary;
        }
        const inAppUserIds = userIds;
        const fcmTargetUserIds = pushUserIds ?? userIds;
        const [records, fcmTokens] = await Promise.all([
            Promise.resolve(inAppUserIds.map((uid) => this.recordFactory.create(uid, request))),
            this.fcmRepository.getTokensForUsers(fcmTargetUserIds),
        ]);
        const [, pushSummary] = await Promise.all([
            this.notificationRepository.saveMany(records),
            this.fcmRepository.sendToTokens(fcmTokens, {
                title: request.title,
                body: request.body,
                url: request.url ?? request.context?.actionUrl,
                tag: request.tag,
            }),
        ]);
        const summary = {
            label: request.tag ?? request.title,
            category: trace?.category ?? request.context?.contextType ?? request.tag ?? request.title,
            source: trace?.source ?? "broadcastToUsers",
            inAppRecipients: inAppUserIds.length,
            pushRecipients: fcmTargetUserIds.length,
            pushTokensResolved: pushSummary.pushTokensResolved,
            successCount: pushSummary.successCount,
            failureCount: pushSummary.failureCount,
            invalidatedCount: pushSummary.invalidatedCount,
            attemptedAt: new Date().toISOString(),
            scheduledTimeZone: trace?.scheduledTimeZone,
            scheduledLocalTime: trace?.scheduledLocalTime,
            outcomes: pushSummary.outcomes,
        };
        this.logDispatchSummary(summary);
        return summary;
    }
    async runDryCheckForUsers(userIds, request, trace) {
        const fcmTokens = await this.fcmRepository.getTokensForUsers(userIds);
        const pushSummary = await this.fcmRepository.sendToTokens(fcmTokens, {
            title: request.title,
            body: request.body,
            url: request.url,
            tag: request.tag,
        }, "dry-run");
        const summary = {
            label: request.tag ?? request.title,
            category: trace?.category ?? request.tag ?? request.title,
            source: trace?.source ?? "dry-run",
            inAppRecipients: 0,
            pushRecipients: userIds.length,
            pushTokensResolved: pushSummary.pushTokensResolved,
            successCount: pushSummary.successCount,
            failureCount: pushSummary.failureCount,
            invalidatedCount: pushSummary.invalidatedCount,
            attemptedAt: new Date().toISOString(),
            scheduledTimeZone: trace?.scheduledTimeZone,
            scheduledLocalTime: trace?.scheduledLocalTime,
            outcomes: pushSummary.outcomes,
        };
        this.logDispatchSummary(summary);
        return summary;
    }
    logDispatchSummary(summary) {
        this.logger.log("push-dispatch-summary");
        this.logger.log(summary);
    }
}
exports.NotificationDispatcher = NotificationDispatcher;
//# sourceMappingURL=notification-dispatcher.js.map