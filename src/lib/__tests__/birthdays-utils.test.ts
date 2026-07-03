import { getBirthdaysOverview } from '@/lib/birthdays-utils';
import { Timestamp } from 'firebase/firestore';

describe('getBirthdaysOverview', () => {
  it('returns birthdays for today with correct turning age', () => {
    const today = new Date(2026, 3, 25);

    const result = getBirthdaysOverview(
      [
        {
          id: 'a',
          name: 'Ana',
          birthDate: Timestamp.fromDate(new Date(2000, 3, 25)),
        },
      ],
      { today, daysAhead: 14 }
    );

    expect(result.today.length).toBe(1);
    expect(result.today[0].name).toBe('Ana');
    expect(result.today[0].turnsAge).toBe(26);
  });

  it('returns upcoming birthdays within 14 days sorted by date', () => {
    const today = new Date(2026, 3, 25);

    const result = getBirthdaysOverview(
      [
        {
          id: 'a',
          name: 'Ana',
          birthDate: Timestamp.fromDate(new Date(2000, 4, 5)),
        },
        {
          id: 'b',
          name: 'Beto',
          birthDate: Timestamp.fromDate(new Date(1990, 3, 27)),
        },
      ],
      { today, daysAhead: 14 }
    );

    expect(result.today.length).toBe(0);
    expect(result.upcoming.length).toBe(2);
    expect(result.upcoming[0].name).toBe('Beto');
    expect(result.upcoming[1].name).toBe('Ana');
    expect(result.upcoming[0].turnsAge).toBe(36);
  });

  it('rolls birthdays that already passed this year to next year', () => {
    const today = new Date(2026, 11, 31);

    const result = getBirthdaysOverview(
      [
        {
          id: 'a',
          name: 'Ana',
          birthDate: Timestamp.fromDate(new Date(2000, 0, 1)),
        },
      ],
      { today, daysAhead: 14 }
    );

    expect(result.upcoming.length).toBe(1);
    expect(result.upcoming[0].nextBirthday.getFullYear()).toBe(2027);
    expect(result.upcoming[0].turnsAge).toBe(27);
  });
});
