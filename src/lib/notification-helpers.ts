import { addDoc, Timestamp, getDocs } from "firebase/firestore";
import { notificationsCollection, usersCollection } from "./collections";
import type { AppNotification } from "./types";

/**
 * Helper function to create notifications with navigation context
 * This ensures consistent notification creation across the app
 */
export interface CreateNotificationParams {
  userId: string;
  title: string;
  body: string;
  contextType?: AppNotification['contextType'];
  contextId?: string;
  actionUrl?: string;
  actionType?: 'navigate' | 'external';
  /** If true, sends only in-app notification without push */
  inAppOnly?: boolean;
  /** If true, sends only push notification without saving to in-app */
  pushOnly?: boolean;
}

/**
 * Creates a new notification with optional navigation context
 * @param params - Notification parameters including navigation context
 * @returns Promise<string> - The ID of the created notification
 */
export async function createNotification(params: CreateNotificationParams): Promise<string> {
  const {
    userId,
    title,
    body,
    contextType,
    contextId,
    actionUrl,
    actionType = 'navigate',
    inAppOnly = false,
    pushOnly = false
  } = params;

  // Create in-app notification if not push-only
  if (!pushOnly) {
    const notification: Omit<AppNotification, 'id'> = {
      userId,
      title,
      body,
      createdAt: Timestamp.now(),
      isRead: false,
      ...(contextType && { contextType }),
      ...(contextId && { contextId }),
      ...(actionUrl && { actionUrl }),
      ...(actionUrl && { actionType })
    };

    const docRef = await addDoc(notificationsCollection, notification);

    // Send push notification if not in-app-only
    if (!inAppOnly) {
      await sendPushNotification({
        userId,
        title,
        body,
        url: actionUrl
      });
    }

    return docRef.id;
  } else {
    // Push-only notification (no in-app saved)
    await sendPushNotification({
      userId,
      title,
      body,
      url: actionUrl
    });
    return '';
  }
}

/**
 * Send push notification to a user's device
 * @param params - Push notification parameters
 */
async function sendPushNotification(params: {
  userId?: string;
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  try {
    const response = await fetch('/api/send-fcm-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      console.error('Failed to send push notification:', await response.text());
    }
  } catch (error) {
    console.error('Error sending push notification:', error);
    // No lanzar error para no interrumpir el flujo principal
  }
}

/**
 * Pre-configured notification creators for common use cases
 */
export const NotificationCreators = {
  /**
   * Create notification for new convert
   */
  newConvert: (userId: string, convertName: string, convertId: string) =>
    createNotification({
      userId,
      title: "Nuevo Converso Registrado",
      body: `${convertName} ha sido registrado como nuevo converso`,
      contextType: 'convert',
      contextId: convertId
    }),

  /**
   * Create notification for new activity
   */
  newActivity: (userId: string, activityTitle: string, activityId: string) =>
    createNotification({
      userId,
      title: "Nueva Actividad Programada",
      body: `Se ha programado la actividad: ${activityTitle}`,
      contextType: 'activity',
      contextId: activityId,
      actionUrl: '/reports/activities'
    }),

  /**
   * Create notification for new service opportunity
   */
  newService: (userId: string, serviceTitle: string, serviceId: string) =>
    createNotification({
      userId,
      title: "Nueva Oportunidad de Servicio",
      body: `Se ha registrado un nuevo servicio: ${serviceTitle}`,
      contextType: 'service',
      contextId: serviceId
    }),

  /**
   * Create notification for updated activity
   */
  updatedActivity: (userId: string, activityTitle: string, activityId: string) =>
    createNotification({
      userId,
      title: "Actividad Actualizada",
      body: `La actividad "${activityTitle}" ha sido actualizada`,
      contextType: 'activity',
      contextId: activityId,
      actionUrl: '/reports/activities'
    }),

  /**
   * Create notification for deleted activity
   */
  deletedActivity: (userId: string, activityTitle: string) =>
    createNotification({
      userId,
      title: "Actividad Eliminada",
      body: `La actividad "${activityTitle}" ha sido eliminada`,
      contextType: 'activity'
    }),

  /**
   * Create notification for updated service
   */
  updatedService: (userId: string, serviceTitle: string, serviceId: string) =>
    createNotification({
      userId,
      title: "Servicio Actualizado",
      body: `El servicio "${serviceTitle}" ha sido actualizado`,
      contextType: 'service',
      contextId: serviceId,
      actionUrl: '/service'
    }),

  /**
   * Create notification for deleted service
   */
  deletedService: (userId: string, serviceTitle: string) =>
    createNotification({
      userId,
      title: "Servicio Eliminado",
      body: `El servicio "${serviceTitle}" ha sido eliminado`,
      contextType: 'service'
    }),

  /**
   * Create notification for council meeting
   */
  councilMeeting: (userId: string, date: string) =>
    createNotification({
      userId,
      title: "Reunión de Consejo Programada",
      body: `Reunión de consejo programada para ${date}`,
      contextType: 'council'
    }),

  /**
   * Create notification for baptism
   */
  newBaptism: (userId: string, memberName: string, baptismId: string) =>
    createNotification({
      userId,
      title: "Nuevo Bautismo Registrado",
      body: `${memberName} ha sido bautizado`,
      contextType: 'baptism',
      contextId: baptismId
    }),

  /**
   * Create notification for birthday reminder
   */
  birthdayReminder: (userId: string, memberName: string, date: string) =>
    createNotification({
      userId,
      title: "Recordatorio de Cumpleaños",
      body: `${memberName} cumple años el ${date}`,
      contextType: 'birthday'
    }),

  /**
   * Create notification for new investigator
   */
  newInvestigator: (userId: string, investigatorName: string, investigatorId: string) =>
    createNotification({
      userId,
      title: "Nuevo Investigador",
      body: `${investigatorName} ha sido registrado como investigador`,
      contextType: 'investigator',
      contextId: investigatorId
    }),

  /**
   * Create notification for member marked as urgent
   */
  memberMarkedUrgent: (userId: string, memberName: string, memberId: string) =>
    createNotification({
      userId,
      title: "⚠️ Miembro Marcado como Urgente",
      body: `${memberName} ha sido marcado como urgente y requiere atención prioritaria`,
      contextType: 'member',
      contextId: memberId,
      actionUrl: '/members'
    }),

  /**
   * Create custom notification with external link
   */
  externalLink: (userId: string, title: string, body: string, url: string) =>
    createNotification({
      userId,
      title,
      body,
      actionUrl: url,
      actionType: 'external'
    }),

  /**
   * Create notification for urgent family need
   */
  urgentFamilyNeed: (userId: string, familyName: string, observation: string) =>
    createNotification({
      userId,
      title: "Necesidad Urgente de Familia",
      body: `La familia ${familyName} tiene una necesidad urgente: ${observation}`,
      contextType: 'urgent_family',
      actionUrl: '/ministering/urgent'
    }),

  /**
   * Create notification for missionary assignment
   */
  missionaryAssignment: (userId: string, assignmentDescription: string, assignmentId: string) =>
    createNotification({
      userId,
      title: "Nueva Asignación Misional",
      body: assignmentDescription,
      contextType: 'missionary_assignment',
      contextId: assignmentId,
      actionUrl: '/missionary-work'
    })
};

/**
 * Get all user IDs from the system
 * @returns Promise<string[]> - Array of all user IDs
 */
export async function getAllUserIds(): Promise<string[]> {
  try {
    const usersSnapshot = await getDocs(usersCollection);
    return usersSnapshot.docs.map(doc => doc.id);
  } catch (error) {
    console.error('Error fetching all user IDs:', error);
    return [];
  }
}

/**
 * Bulk create notifications for multiple users
 * @param userIds - Array of user IDs to send notification to
 * @param notificationParams - Notification parameters (excluding userId)
 * @returns Promise<string[]> - Array of created notification IDs
 */
export async function createBulkNotifications(
  userIds: string[],
  notificationParams: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const promises = userIds.map(userId =>
    createNotification({ ...notificationParams, userId })
  );

  return Promise.all(promises);
}

/**
 * Create notifications for all users in the system who have notifications enabled
 * @param notificationParams - Notification parameters (excluding userId)
 * @returns Promise<string[]> - Array of created notification IDs
 */
export async function createNotificationsForAll(
  notificationParams: Omit<CreateNotificationParams, 'userId'>
): Promise<string[]> {
  const userIds = await getAllUserIds();

  // Filter users to only include those with notifications enabled
  const usersWithNotificationsEnabled: string[] = [];

  // Batch query in chunks of 30 (Firestore 'in' limit)
  const chunkSize = 30;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);

    try {
      const firestore = await import('firebase/firestore');
      const q = firestore.query(usersCollection, firestore.where(firestore.documentId(), 'in', chunk));
      const snapshot = await firestore.getDocs(q);

      const userDocsMap = new Map();
      snapshot.forEach(doc => {
        userDocsMap.set(doc.id, doc.data());
      });

      for (const userId of chunk) {
        const userData = userDocsMap.get(userId);
        if (userData) {
          // Por defecto las notificaciones in-app están activas (inAppNotificationsEnabled !== false)
          if (userData.inAppNotificationsEnabled !== false) {
            usersWithNotificationsEnabled.push(userId);
          }
        } else {
          // Usuario nuevo sin preferencias, incluir por defecto
          usersWithNotificationsEnabled.push(userId);
        }
      }
    } catch (error) {
      console.error(`Error checking notification preference for user chunk starting at index ${i}:`, error);
      // En caso de error, incluir a los usuarios por defecto
      usersWithNotificationsEnabled.push(...chunk);
    }
  }

  return createBulkNotifications(usersWithNotificationsEnabled, notificationParams);
}

// ============================================================================
// NEW CONVERT NOTIFICATIONS FROM COUNCIL (In-App Only)
// ============================================================================

/**
 * Check if a member is a "new convert" (baptized within the last 2 years)
 * @param member - The member to check
 * @returns boolean - True if the member is a new convert
 */
export function isNewConvert(member: { baptismDate?: { toDate: () => Date } | null }): boolean {
  if (!member.baptismDate || !member.baptismDate.toDate) {
    return false;
  }

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  const baptismDate = member.baptismDate.toDate();
  return baptismDate > twoYearsAgo;
}

/**
 * Create in-app notification only for new convert updates from council
 * This is used when the council page modifies a new convert's information
 * @param userId - User ID to send notification to
 * @param convertName - Name of the convert
 * @param convertId - ID of the convert
 * @param action - The action that was performed (e.g., "actualizado", "completado")
 * @returns Promise<string> - The ID of the created notification
 */
export async function createNewConvertCouncilNotification(
  userId: string,
  convertName: string,
  convertId: string,
  action: string = 'actualizado'
): Promise<string> {
  return createNotification({
    userId,
    title: "📋 Actualización de Nuevo Converso",
    body: `${convertName} ha sido ${action} desde el Consejo`,
    contextType: 'convert',
    contextId: convertId,
    actionUrl: '/consejo',
    inAppOnly: true // Only in-app, no push for council updates
  });
}

/**
 * Create in-app notifications for all users about new convert updates from council
 * @param convertName - Name of the convert
 * @param convertId - ID of the convert
 * @param action - The action that was performed
 * @returns Promise<string[]> - Array of created notification IDs
 */
export async function createNewConvertCouncilNotificationsForAll(
  convertName: string,
  convertId: string,
  action: string = 'actualizado'
): Promise<string[]> {
  const userIds = await getAllUserIds();

  // Filter users to only include those with in-app notifications enabled
  const usersWithInAppEnabled: string[] = [];

  // Batch query in chunks of 30
  const chunkSize = 30;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);

    try {
      const firestore = await import('firebase/firestore');
      const q = firestore.query(usersCollection, firestore.where(firestore.documentId(), 'in', chunk));
      const snapshot = await firestore.getDocs(q);

      const userDocsMap = new Map();
      snapshot.forEach(doc => {
        userDocsMap.set(doc.id, doc.data());
      });

      for (const userId of chunk) {
        const userData = userDocsMap.get(userId);
        if (userData) {
          // Check in-app notifications preference
          if (userData.inAppNotificationsEnabled !== false) {
            usersWithInAppEnabled.push(userId);
          }
        } else {
          usersWithInAppEnabled.push(userId);
        }
      }
    } catch (error) {
      console.error(`Error checking notification preference for convert council notification chunk:`, error);
      usersWithInAppEnabled.push(...chunk);
    }
  }

  const notificationPromises = usersWithInAppEnabled.map(userId =>
    createNewConvertCouncilNotification(userId, convertName, convertId, action)
  );

  return Promise.all(notificationPromises);
}

// ============================================================================
// DECEASED MEMBERS ORDINANCES PUSH NOTIFICATIONS (Weekly on Mondays)
// ============================================================================

// All possible temple ordinances for deceased members
const ALL_TEMPLE_ORDINANCES = [
  'baptism',
  'confirmation',
  'initiatory',
  'endowment',
  'sealed_to_father',
  'sealed_to_mother',
  'sealed_to_spouse'
] as const;

/**
 * Check if a deceased member has all temple ordinances completed
 * @param member - The member to check
 * @returns boolean - True if all ordinances are completed
 */
export function hasAllTempleOrdinances(member: { templeOrdinances?: string[] }): boolean {
  const memberOrdinances = member.templeOrdinances || [];
  return ALL_TEMPLE_ORDINANCES.every(ord => memberOrdinances.includes(ord));
}

/**
 * Get missing temple ordinances for a deceased member
 * @param member - The member to check
 * @returns string[] - Array of missing ordinance names
 */
export function getMissingTempleOrdinances(member: { templeOrdinances?: string[] }): string[] {
  const memberOrdinances = member.templeOrdinances || [];
  return ALL_TEMPLE_ORDINANCES.filter(ord => !memberOrdinances.includes(ord));
}

/**
 * Send push-only notification for deceased members with missing ordinances
 * This should be called on Mondays
 * @param members - Array of deceased members to check
 * @returns Promise<{ sent: number; skipped: number }> - Count of sent and skipped notifications
 */
export async function sendDeceasedMembersOrdinanceNotifications(
  members: Array<{
    id: string;
    firstName: string;
    lastName: string;
    templeOrdinances?: string[];
    templeWorkCompletedAt?: unknown;
  }>
): Promise<{ sent: number; skipped: number; membersNotified: string[] }> {
  const userIds = await getAllUserIds();

  // Filter users to only include those with push notifications enabled
  const usersWithPushEnabled: string[] = [];

  // Batch query in chunks of 30
  const chunkSize = 30;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);

    try {
      const firestore = await import('firebase/firestore');
      const q = firestore.query(usersCollection, firestore.where(firestore.documentId(), 'in', chunk));
      const snapshot = await firestore.getDocs(q);

      const userDocsMap = new Map();
      snapshot.forEach(doc => {
        userDocsMap.set(doc.id, doc.data());
      });

      for (const userId of chunk) {
        const userData = userDocsMap.get(userId);
        if (userData) {
          // Check push notifications preference
          if (userData.notificationsEnabled !== false) {
            usersWithPushEnabled.push(userId);
          }
        }
        // Nota: El código original NO incluía a los usuarios por defecto en caso de no existir o de error
        // para las notificaciones push.
      }
    } catch (error) {
      console.error(`Error checking push preference for user chunk:`, error);
    }
  }

  // Find deceased members with missing ordinances
  const membersNeedingOrdinances = members.filter(member => {
    // Skip if all ordinances are completed
    if (hasAllTempleOrdinances(member)) {
      return false;
    }
    return true;
  });

  if (membersNeedingOrdinances.length === 0) {
    return { sent: 0, skipped: 0, membersNotified: [] };
  }

  const missingCount = membersNeedingOrdinances.length;
  const memberNames = membersNeedingOrdinances.map(m => `${m.firstName} ${m.lastName}`).join(', ');

  const title = "⚰️ Miembros Fallecidos Sin Ordenanzas Completas";
  const body = missingCount === 1
    ? `Hay ${missingCount} miembro fallecido que necesita ordenanzas del templo: ${memberNames}`
    : `Hay ${missingCount} miembros fallecidos que necesitan ordenanzas del templo: ${memberNames}`;

  let sentCount = 0;
  const membersNotified: string[] = [];

  for (const userId of usersWithPushEnabled) {
    try {
      await createNotification({
        userId,
        title,
        body,
        contextType: 'member',
        actionUrl: '/council',
        pushOnly: true // Only push, no in-app
      });
      sentCount++;
      membersNotified.push(userId);
    } catch (error) {
      console.error(`Error sending deceased member notification to ${userId}:`, error);
    }
  }

  return {
    sent: sentCount,
    skipped: usersWithPushEnabled.length - sentCount,
    membersNotified
  };
}
