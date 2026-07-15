/**
 * Publishes a per-barrioOrg "sync signal" when domain data changes.
 * Client apps listen (onSnapshot) and pull fresh data automatically.
 * Manual refresh in the app remains a fallback if this pipeline fails.
 */
import * as admin from "firebase-admin";
export type SyncChangeType = "create" | "update" | "delete" | "write";
type SimpleLogger = {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
export declare function encodeBarrioOrgDocId(barrioOrg: string): string;
/**
 * Resolve barrio|organización scope for a document.
 * Never broadcasts globally — only the ward/org that owns the change.
 */
export declare function extractBarrioOrg(data: FirebaseFirestore.DocumentData | undefined | null): string | null;
export interface PublishSyncSignalParams {
    barrioOrg: string;
    collection: string;
    docId: string;
    changeType: SyncChangeType;
    /** Send silent FCM data message so background tabs can refresh */
    notifyDevices?: boolean;
}
/**
 * Write/merge signal document so only clients of THIS barrioOrg refresh.
 * FCM is limited to users with the same barrioOrg (never whole project).
 */
export declare function publishSyncSignal(db: admin.firestore.Firestore, messaging: admin.messaging.Messaging, logger: SimpleLogger, params: PublishSyncSignalParams): Promise<void>;
/**
 * True when the only differing keys (or values) are notification bookkeeping
 * noise — i.e. the notification pipeline already handled the user-facing side
 * and there is no domain data other clients need to pull.
 */
export declare function isNotificationBookkeepingOnlyChange(beforeData: FirebaseFirestore.DocumentData | undefined | null, afterData: FirebaseFirestore.DocumentData | undefined | null): boolean;
/**
 * Handler factory for functions.firestore.document(...).onWrite(...)
 *
 * Does NOT listen to c_notifications / c_push_subscriptions — those are owned
 * by the notification dispatcher CF and must never fan out a data-sync refresh.
 */
export declare function createCollectionSyncHandler(db: admin.firestore.Firestore, messaging: admin.messaging.Messaging, logger: SimpleLogger, collectionName: string): (change: any, context: any) => Promise<void>;
export {};
//# sourceMappingURL=data-sync-publisher.d.ts.map