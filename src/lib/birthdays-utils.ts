import { createEcuadorCalendarDate, getEcuadorDateParts } from '@/lib/date-utils';
import type { Birthday } from '@/lib/types';

export type BirthdayOverviewItem = Birthday & {
  nextBirthday: Date;
  turnsAge: number | null;
  daysUntil: number;
};

export type BirthdaysOverview = {
  today: BirthdayOverviewItem[];
  upcoming: BirthdayOverviewItem[];
};

type GetBirthdaysOverviewOptions = {
  today?: Date;
  daysAhead?: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getBirthdaysOverview(
  birthdays: Birthday[],
  options: GetBirthdaysOverviewOptions = {}
): BirthdaysOverview {
  // All calendar comparisons use Ecuador's civil day, never the host's timezone.
  const todayParts = getEcuadorDateParts(options.today ?? new Date());
  if (!todayParts) return { today: [], upcoming: [] };

  const daysAhead = options.daysAhead ?? 14;
  const todayUtcDay = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);

  const items = birthdays
    .map((birthday): BirthdayOverviewItem | null => {
      const birth = getEcuadorDateParts(birthday.birthDate);
      if (!birth) return null;

      let nextBirthday = createEcuadorCalendarDate(todayParts.year, birth.month, birth.day);
      let nextUtcDay = Date.UTC(
        nextBirthday.getUTCFullYear(),
        nextBirthday.getUTCMonth(),
        nextBirthday.getUTCDate()
      );

      if (nextUtcDay < todayUtcDay) {
        nextBirthday = createEcuadorCalendarDate(todayParts.year + 1, birth.month, birth.day);
        nextUtcDay = Date.UTC(
          nextBirthday.getUTCFullYear(),
          nextBirthday.getUTCMonth(),
          nextBirthday.getUTCDate()
        );
      }

      return {
        ...birthday,
        nextBirthday,
        turnsAge: nextBirthday.getUTCFullYear() - birth.year,
        daysUntil: Math.round((nextUtcDay - todayUtcDay) / MS_PER_DAY),
      };
    })
    .filter((item): item is BirthdayOverviewItem => item !== null)
    .sort((a, b) => a.nextBirthday.getTime() - b.nextBirthday.getTime());

  return {
    today: items.filter((item) => item.daysUntil === 0),
    upcoming: items.filter((item) => item.daysUntil > 0 && item.daysUntil <= daysAhead),
  };
}
