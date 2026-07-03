import { getEcuadorDateParts, getTodayInEcuador } from '@/lib/date-utils';
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

function normalizeToDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildOverviewItem(birthday: Birthday, today: Date): BirthdayOverviewItem | null {
  const birthParts = getEcuadorDateParts(birthday.birthDate);
  if (!birthParts) return null;

  const todayOnly = normalizeToDateOnly(today);

  const candidate = new Date(todayOnly.getFullYear(), birthParts.month - 1, birthParts.day);
  if (candidate < todayOnly) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }

  const daysUntil = Math.round((candidate.getTime() - todayOnly.getTime()) / MS_PER_DAY);
  const turnsAge = Number.isFinite(birthParts.year) ? candidate.getFullYear() - birthParts.year : null;

  return {
    ...birthday,
    nextBirthday: candidate,
    turnsAge,
    daysUntil,
  };
}

export function getBirthdaysOverview(
  birthdays: Birthday[],
  options: GetBirthdaysOverviewOptions = {}
): BirthdaysOverview {
  const today = options.today ? normalizeToDateOnly(options.today) : getTodayInEcuador();
  const daysAhead = options.daysAhead ?? 14;

  const items = birthdays
    .map((birthday) => buildOverviewItem(birthday, today))
    .filter((item): item is BirthdayOverviewItem => item !== null)
    .sort((a, b) => a.nextBirthday.getTime() - b.nextBirthday.getTime());

  return {
    today: items.filter((item) => item.daysUntil === 0),
    upcoming: items.filter((item) => item.daysUntil > 0 && item.daysUntil <= daysAhead),
  };
}

