import { addDoc, Timestamp, serverTimestamp } from "firebase/firestore";
import { adminAuditCollection } from "./collections";
import logger from "./logger";

export type AuditAction =
  | "user.role_changed"
  | "user.visibility_changed"
  | "user.permission_changed"
  | "user.bulk_permission_changed"
  | "member.status_changed"
  | "member.deleted"
  | "user.bulk_role_changed";

export interface AuditEntry {
  action: AuditAction;
  actorUid: string;
  actorName?: string;
  targetId: string;
  targetName?: string;
  details?: Record<string, unknown>;
  barrioOrg: string;
  createdAt: Timestamp;
}

export async function logAdminAction(
  entry: Omit<AuditEntry, "createdAt">
): Promise<void> {
  try {
    await addDoc(adminAuditCollection, {
      ...entry,
      createdAt: serverTimestamp() as Timestamp,
    });
  } catch (err) {
    logger.error({
      error: err,
      message: "Failed to write admin audit log",
      action: entry.action,
    });
  }
}
