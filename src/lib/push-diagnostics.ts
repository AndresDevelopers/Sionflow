import { z } from 'zod';

export const pushDiagnosticsRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  runDryCheck: z.boolean().optional().default(false),
});

export type PushDiagnosticsRequest = z.infer<typeof pushDiagnosticsRequestSchema>;

export interface PushSubscriptionDiagnostic {
  docId: string;
  userId: string;
  deviceId: string | null;
  hasToken: boolean;
  updatedAt: string | null;
  subscribedAt: string | null;
  unsubscribedAt: string | null;
  lastPushAttemptAt: string | null;
  lastPushAttemptMode: 'live' | 'dry-run' | null;
  lastPushResult: 'success' | 'failure' | 'invalid-token' | 'not-attempted' | null;
  lastPushErrorCode: string | null;
  lastNotificationTag: string | null;
  userAgent: string | null;
  platform: string | null;
  dryRunStatus?: 'success' | 'failure' | 'skipped';
  dryRunErrorCode?: string | null;
  dryRunErrorMessage?: string | null;
}

export interface PushDryRunSummary {
  tokensChecked: number;
  successCount: number;
  failureCount: number;
}

export interface PushDiagnosticsResponse {
  viewerUserId: string;
  viewerRole: string;
  targetUserId: string;
  pushNotificationsEnabled: boolean;
  inAppNotificationsEnabled: boolean;
  serverTimeUtc: string;
  serverTimeEcuador: string;
  subscriptions: PushSubscriptionDiagnostic[];
  dryRunSummary?: PushDryRunSummary;
}

export interface BrowserPushDiagnostics {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  deviceId: string | null;
  serviceWorkerScriptUrl: string | null;
  serviceWorkerState: string | null;
}
