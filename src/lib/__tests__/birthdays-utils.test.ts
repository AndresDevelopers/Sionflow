import { getBirthdaysOverview } from '@/lib/birthdays-utils';
import { getEcuadorDateParts, getAge, getTodayInEcuador } from '@/lib/date-utils';
import { Timestamp } from 'firebase/firestore';
import { vi } from 'vitest';

// A calendar day in Ecuador, regardless of the computer running the tests.
const ecuadorNoon = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day, 17));

const birthday = (year: number, month: number, day: number) =>
  Timestamp.fromDate(ecuadorNoon(year, month, day));

describe('getBirthdaysOverview (America/Guayaquil)', () => {
  it('returns birthdays for today with correct turning age', () => {
    const result = getBirthdaysOverview(
      [{ id: 'a', name: 'Ana', birthDate: birthday(2000, 4, 25) }],
      { today: ecuadorNoon(2026, 4, 25), daysAhead: 14 }
    );

    expect(result.today).toHaveLength(1);
    expect(result.today[0].name).toBe('Ana');
    expect(result.today[0].turnsAge).toBe(26);
  });

  it('returns upcoming birthdays within 14 days sorted by date', () => {
    const result = getBirthdaysOverview(
      [
        { id: 'a', name: 'Ana', birthDate: birthday(2000, 5, 5) },
        { id: 'b', name: 'Beto', birthDate: birthday(1990, 4, 27) },
      ],
      { today: ecuadorNoon(2026, 4, 25), daysAhead: 14 }
    );

    expect(result.today).toHaveLength(0);
    expect(result.upcoming).toHaveLength(2);
    expect(result.upcoming[0].name).toBe('Beto');
    expect(result.upcoming[1].name).toBe('Ana');
    expect(result.upcoming[0].turnsAge).toBe(36);
  });

  it('rolls birthdays already passed this year to the next year', () => {
    const result = getBirthdaysOverview(
      [{ id: 'a', name: 'Ana', birthDate: birthday(2000, 1, 1) }],
      { today: ecuadorNoon(2026, 12, 31), daysAhead: 14 }
    );

    expect(result.upcoming).toHaveLength(1);
    expect(getEcuadorDateParts(result.upcoming[0].nextBirthday)).toEqual({
      year: 2027, month: 1, day: 1,
    });
    expect(result.upcoming[0].turnsAge).toBe(27);
    expect(result.upcoming[0].daysUntil).toBe(1);
  });

  it('uses Ecuador today even when UTC is already on the next day', () => {
    const result = getBirthdaysOverview(
      [{ id: 'a', name: 'Ana', birthDate: birthday(2000, 4, 25) }],
      { today: new Date('2026-04-26T03:30:00.000Z') } // Apr 25 22:30 Ecuador
    );

    expect(result.today).toHaveLength(1);
    expect(result.today[0].turnsAge).toBe(26);
  });

  it('changes day only at midnight in Ecuador, not midnight UTC', () => {
    const result = getBirthdaysOverview(
      [{ id: 'a', name: 'Ana', birthDate: birthday(2000, 4, 26) }],
      { today: new Date('2026-04-26T05:00:00.000Z') } // Apr 26 00:00 Ecuador
    );

    expect(result.today).toHaveLength(1);
    expect(result.upcoming).toHaveLength(0);
  });

  it('calculates across the end of a month using Ecuador calendar days', () => {
    const result = getBirthdaysOverview(
      [{ id: 'a', name: 'Ana', birthDate: birthday(2000, 5, 1) }],
      { today: ecuadorNoon(2026, 4, 30) }
    );

    expect(result.upcoming[0].daysUntil).toBe(1);
  });
});

describe('Ecuador date helpers', () => {
  it('gets today and age using the Ecuador day rather than the host day', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-26T03:30:00.000Z')); // April 25 in Ecuador
      expect(getEcuadorDateParts(getTodayInEcuador())).toEqual({ year: 2026, month: 4, day: 25 });
      expect(getAge(birthday(2000, 4, 26))).toBe(25);
      expect(getAge(birthday(2000, 4, 25))).toBe(26);
    } finally {
      vi.useRealTimers();
    }
  });
});
