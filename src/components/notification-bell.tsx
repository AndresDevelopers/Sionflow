"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Mail, ExternalLink, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useI18n } from "@/contexts/i18n-context";
import { useRouter } from "next/navigation";
import {
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { getDocs } from "@/lib/firestore-query";
import { notificationsCollection } from "@/lib/collections";
import { firestore } from "@/lib/firebase";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppNotification } from "@/lib/types";
import { formatRelative } from "date-fns";
import { getDateFnsLocale } from "@/lib/i18n-date";
import { sanitizeNotificationActionUrl } from "@/lib/url-safety";
import { Skeleton } from "./ui/skeleton";
import { useOnManualRefresh } from "@/contexts/refresh-context";

const BATCH_LIMIT = 450;

function deduplicateNotifications(items: AppNotification[]): AppNotification[] {
  const grouped = new Map<string, AppNotification>();
  for (const notification of items) {
    const key = notification.notificationTag
      ? `tag:${notification.notificationTag}`
      : `doc:${notification.id}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, notification);
      continue;
    }

    const currentTime = notification.createdAt?.toDate?.().getTime() ?? 0;
    const existingTime = existing.createdAt?.toDate?.().getTime() ?? 0;
    if (currentTime > existingTime) {
      grouped.set(key, notification);
    }
  }

  return [...grouped.values()].sort(
    (a, b) => (b.createdAt?.toDate?.().getTime() ?? 0) - (a.createdAt?.toDate?.().getTime() ?? 0)
  );
}

export function NotificationBell() {
  const { user, barrio, organizacion, barrioOrg } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const [isActing, setIsActing] = useState(false);

  const resolveBarrioOrgKey = useCallback(() => {
    // Prefer canonical barrioOrg from profile; fall back to barrio|org composition.
    // Using only barrio+organizacion hid all notifs when those fields were empty
    // but barrioOrg was present (common after multi-tenant migration).
    return (
      (typeof barrioOrg === "string" && barrioOrg.includes("|")
        ? barrioOrg.trim()
        : "") ||
      (barrio && organizacion ? `${barrio}|${organizacion}` : "")
    );
  }, [barrio, organizacion, barrioOrg]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const barrioOrgKey = resolveBarrioOrgKey();

      // Query by user only (rules: owner read). Filter client-side by barrioOrg.
      // Fail closed: hide unscoped legacy notifications (could be cross-tenant).
      // Offline: getDocs uses cache with timeout (never hangs the refresh spinner).
      const q = query(
        notificationsCollection,
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(50)
      );
      const snapshot = await getDocs(q);
      const userNotifications = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as AppNotification))
        .filter((notification) => {
          // Soft-dismissed stay in Firestore so CF idempotent creates do not reappear
          if (notification.isDismissed) return false;
          if (!barrioOrgKey) return false;
          return (
            Boolean(notification.barrioOrg) &&
            notification.barrioOrg === barrioOrgKey
          );
        })
        .slice(0, 30);

      const deduplicated = deduplicateNotifications(userNotifications);
      setNotifications(deduplicated);

      // Query ligera separada: no leídas del usuario, filtradas por scope en cliente
      const unreadQuery = query(
        notificationsCollection,
        where("userId", "==", user.uid),
        where("isRead", "==", false)
      );
      const unreadSnapshot = await getDocs(unreadQuery);
      const unreadCount = unreadSnapshot.docs.filter((d) => {
        const data = d.data() as AppNotification;
        if (data.isDismissed) return false;
        if (!barrioOrgKey) return false;
        return Boolean(data.barrioOrg) && data.barrioOrg === barrioOrgKey;
      }).length;
      setHasUnread(unreadCount > 0);
    } catch (error) {
      // Offline / timeout: keep previous notifications visible
      console.warn(
        "Error fetching notifications (cache may be empty offline):",
        error
      );
    } finally {
      setLoading(false);
    }
  }, [user, resolveBarrioOrgKey]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchNotifications();
    });
  }, [fetchNotifications]);

  useOnManualRefresh(fetchNotifications);

  const runBatchedWrites = async (
    ids: string[],
    apply: (batch: ReturnType<typeof writeBatch>, id: string) => void
  ) => {
    if (!firestore || ids.length === 0) return;
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(firestore);
      chunk.forEach((id) => apply(batch, id));
      await batch.commit();
    }
  };

  const handleMarkAsRead = async () => {
    if (!user || !hasUnread || !firestore || isActing) return;

    const unreadInList = notifications.filter((n) => !n.isRead).map((n) => n.id);
    // Also include any scoped unread not currently in the visible list
    let unreadIds = unreadInList;
    try {
      const barrioOrgKey = resolveBarrioOrgKey();
      const unreadQuery = query(
        notificationsCollection,
        where("userId", "==", user.uid),
        where("isRead", "==", false)
      );
      const unreadSnapshot = await getDocs(unreadQuery);
      unreadIds = unreadSnapshot.docs
        .filter((d) => {
          const data = d.data() as AppNotification;
          if (data.isDismissed) return false;
          if (!barrioOrgKey) return false;
          return Boolean(data.barrioOrg) && data.barrioOrg === barrioOrgKey;
        })
        .map((d) => d.id);
    } catch {
      // fall back to list-only ids
    }

    if (unreadIds.length === 0) {
      setHasUnread(false);
      return;
    }

    setIsActing(true);
    try {
      await runBatchedWrites(unreadIds, (batch, id) => {
        batch.update(doc(notificationsCollection, id), { isRead: true });
      });
      setHasUnread(false);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (error) {
      console.error("Error marking notifications as read:", error);
    } finally {
      setIsActing(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!user || notifications.length === 0 || !firestore || isActing) return;

    const confirmed = window.confirm(
      t("notifications.deleteAllConfirm") ||
        "¿Quitar todas las notificaciones de la campana? No volverán a mostrarse (solo podrían aparecer de nuevo otro día o por un evento nuevo)."
    );
    if (!confirmed) return;

    setIsActing(true);
    try {
      // Soft-dismiss (do not hard-delete): scheduled CF/API use deterministic
      // doc IDs + create(). If the doc is gone, they recreate the same notif.
      // Keeping the doc with isDismissed=true preserves idempotency.
      const barrioOrgKey = resolveBarrioOrgKey();
      let idsToDismiss = notifications.map((n) => n.id);
      try {
        const allQuery = query(
          notificationsCollection,
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(200)
        );
        const snap = await getDocs(allQuery);
        idsToDismiss = snap.docs
          .filter((d) => {
            const data = d.data() as AppNotification;
            if (data.isDismissed) return false;
            if (!barrioOrgKey) return false;
            return Boolean(data.barrioOrg) && data.barrioOrg === barrioOrgKey;
          })
          .map((d) => d.id);
      } catch {
        // fall back to visible list
      }

      if (idsToDismiss.length === 0) {
        setNotifications([]);
        setHasUnread(false);
        return;
      }

      await runBatchedWrites(idsToDismiss, (batch, id) => {
        batch.update(doc(notificationsCollection, id), {
          isDismissed: true,
          isRead: true,
        });
      });
      setNotifications([]);
      setHasUnread(false);
    } catch (error) {
      console.error("Error dismissing notifications:", error);
    } finally {
      setIsActing(false);
    }
  };

  // Generate navigation URL based on notification context (safe paths only)
  const getNavigationUrl = (notification: AppNotification): string | null => {
    // Explicit actionUrl — sanitize (block javascript:, open redirects, random hosts)
    if (notification.actionUrl) {
      return sanitizeNotificationActionUrl(
        notification.actionUrl,
        notification.actionType
      );
    }

    // Generate URL based on contextType and contextId (always relative)
    if (!notification.contextType) {
      return null;
    }

    switch (notification.contextType) {
      case 'convert':
        // Conversos se editan en el miembro (id canónico: member_${id} o memberId)
        if (!notification.contextId) return '/converts';
        if (notification.contextId.startsWith('member_')) {
          return `/members/${notification.contextId.slice('member_'.length)}`;
        }
        return `/members/${notification.contextId}`;
      case 'activity':
        return '/reports/activities';
      case 'service':
        return notification.contextId ? `/services/${notification.contextId}` : null;
      case 'member':
        return notification.contextId ? `/members/${notification.contextId}` : null;
      case 'council':
        return `/council`;
      case 'baptism':
        return notification.contextId ? `/baptisms/${notification.contextId}` : null;
      case 'birthday':
        return `/birthdays`;
      case 'investigator':
        return notification.contextId ? `/investigators/${notification.contextId}` : null;
      case 'urgent_family':
        return '/ministering/urgent';
      case 'missionary_assignment':
        return '/missionary-work';
      case 'admin_user':
        return '/admin/users';
      case 'ministering_interview':
        return '/ministering';
      default:
        return null;
    }
  };

  const handleNotificationClick = async (notification: AppNotification) => {
    const url = getNavigationUrl(notification);

    if (url) {
      // Mark notification as read when clicked
      if (!notification.isRead) {
        try {
          const docRef = doc(notificationsCollection, notification.id);
          // Only touch isRead so Lectura users pass the owner-update rule
          await updateDoc(docRef, { isRead: true });

          // Update local state
          setNotifications(prev =>
            prev.map(n => n.id === notification.id ? {...n, isRead: true} : n)
          );

          // Update unread status
          const stillHasUnread = notifications.some(n => n.id !== notification.id && !n.isRead);
          setHasUnread(stillHasUnread);
        } catch (error) {
          console.error("Error marking notification as read:", error);
        }
      }

      // External only for sanitized https allowlist; otherwise in-app navigation
      if (
        notification.actionType === 'external' &&
        url.startsWith('https://')
      ) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else if (url.startsWith('/')) {
        router.push(url);
      }
    }
  };

  const showIndicator = hasUnread;

  return (
    <Popover onOpenChange={(isOpen) => { if (isOpen) fetchNotifications(); else handleMarkAsRead(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle notifications"
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {showIndicator && <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
          </span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[85vh] flex flex-col" align="end">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">
            {t("Notifications") || "Notificaciones"}
          </h4>
          <TooltipProvider delayDuration={300}>
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!hasUnread || isActing || loading}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleMarkAsRead();
                    }}
                    aria-label={
                      t("notifications.markAllRead") ||
                      "Marcar todas como leídas"
                    }
                  >
                    <CheckCheck className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {t("notifications.markAllRead") ||
                      "Marcar todas como leídas"}
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={
                      notifications.length === 0 || isActing || loading
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleDeleteAll();
                    }}
                    aria-label={
                      t("notifications.deleteAll") ||
                      "Borrar todas las notificaciones"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>
                    {t("notifications.deleteAll") ||
                      "Borrar todas las notificaciones"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
        <div className="max-h-[min(60vh,24rem)] flex-1 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : notifications.length > 0 ? (
            notifications.map((notif) => {
              const url = getNavigationUrl(notif);
              const isClickable = !!url;

              return (
                <div
                  key={notif.id}
                  className={`relative rounded-md p-2 text-sm transition-colors ${
                    isClickable
                      ? "cursor-pointer border border-transparent hover:border-border hover:bg-muted"
                      : "hover:bg-muted/50"
                  } ${!notif.isRead ? "border-primary/20 bg-primary/5" : ""}`}
                  onClick={() =>
                    isClickable && handleNotificationClick(notif)
                  }
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p
                        className={`font-semibold ${
                          !notif.isRead ? "text-primary" : ""
                        }`}
                      >
                        {notif.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {notif.body}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {notif.createdAt &&
                        typeof notif.createdAt.toDate === "function"
                          ? formatRelative(
                              notif.createdAt.toDate(),
                              new Date(),
                              { locale: getDateFnsLocale() }
                            )
                          : ""}
                      </p>
                    </div>
                    {isClickable && (
                      <div className="ml-2 flex-shrink-0">
                        {notif.actionType === "external" ? (
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <div className="h-3 w-3 rounded-full bg-primary/20" />
                        )}
                      </div>
                    )}
                  </div>
                  {!notif.isRead && (
                    <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
              <Mail className="mb-2 h-8 w-8" />
              <p className="text-sm">
                {t("notifications.empty") || "No tienes notificaciones"}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
