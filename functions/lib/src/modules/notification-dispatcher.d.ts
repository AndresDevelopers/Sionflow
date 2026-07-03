import type { firestore as FirestoreNamespace } from "firebase-admin";
import * as admin from "firebase-admin";
export type NotificationContextType = "convert" | "activity" | "service" | "member" | "council" | "baptism" | "birthday" | "investigator" | "urgent_family" | "missionary_assignment" | "observations" | "family_search" | "future_member";
export interface NotificationContext {
    contextType?: NotificationContextType;
    contextId?: string;
    actionUrl?: string;
    actionType?: "navigate" | "external";
}
export interface NotificationAction {
    action: string;
    title: string;
    icon?: string;
    url?: string;
}
export interface BroadcastNotificationRequest {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    actions?: NotificationAction[];
    context?: NotificationContext;
}
export interface NotificationDispatchTrace {
    category?: string;
    source?: string;
    scheduledTimeZone?: string;
    scheduledLocalTime?: string;
}
export interface PushDeliveryOutcome {
    token: string;
    success: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    affectedSubscriptions: number;
}
export interface NotificationDispatchSummary {
    label: string;
    category: string;
    source: string;
    inAppRecipients: number;
    pushRecipients: number;
    pushTokensResolved: number;
    successCount: number;
    failureCount: number;
    invalidatedCount: number;
    attemptedAt: string;
    scheduledTimeZone?: string;
    scheduledLocalTime?: string;
    outcomes: PushDeliveryOutcome[];
}
interface LoggerPort {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
export declare class NotificationDispatcher {
    private readonly logger;
    private readonly userRepository;
    private readonly notificationRepository;
    private readonly fcmRepository;
    private readonly recordFactory;
    constructor(db: FirestoreNamespace.Firestore, messaging: admin.messaging.Messaging, logger: LoggerPort);
    broadcast(request: BroadcastNotificationRequest): Promise<void>;
    /**
     * Broadcast to specific users only (filtered by userId list).
     * Used by scheduled functions that already determine eligible users.
     */
    broadcastToUsers(userIds: string[], request: BroadcastNotificationRequest, pushUserIds?: string[], trace?: NotificationDispatchTrace): Promise<NotificationDispatchSummary>;
    runDryCheckForUsers(userIds: string[], request: Pick<BroadcastNotificationRequest, "title" | "body" | "url" | "tag">, trace?: NotificationDispatchTrace): Promise<NotificationDispatchSummary>;
    private logDispatchSummary;
}
export {};
//# sourceMappingURL=notification-dispatcher.d.ts.map