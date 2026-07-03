import { addDays, endOfDay, startOfDay } from 'date-fns';

export interface ActivitySummaryItem {
  title: string;
  date: Date;
}

export interface ActivityOverviewData {
  totalThisYear: number;
  upcomingCount: number;
  nextActivity: ActivitySummaryItem | null;
  lastActivity: ActivitySummaryItem | null;
}

export function buildActivityOverview(
  activities: readonly ActivitySummaryItem[],
  referenceDate: Date = new Date()
): ActivityOverviewData {
  const currentYear = referenceDate.getFullYear();
  const today = startOfDay(referenceDate);
  const upcomingLimit = endOfDay(addDays(today, 14));

  let totalThisYear = 0;
  let upcomingCount = 0;
  let nextActivity: ActivitySummaryItem | null = null;
  let lastActivity: ActivitySummaryItem | null = null;

  for (const activity of activities) {
    const activityDate = activity.date;

    if (activityDate.getFullYear() === currentYear) {
      totalThisYear += 1;
    }

    if (activityDate >= today && activityDate <= upcomingLimit) {
      upcomingCount += 1;

      if (!nextActivity || activityDate < nextActivity.date) {
        nextActivity = activity;
      }
    }

    if (activityDate < today && (!lastActivity || activityDate > lastActivity.date)) {
      lastActivity = activity;
    }
  }

  return {
    totalThisYear,
    upcomingCount,
    nextActivity,
    lastActivity,
  };
}
