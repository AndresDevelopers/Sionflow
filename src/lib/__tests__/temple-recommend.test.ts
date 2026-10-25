import { Timestamp } from 'firebase/firestore';
import {
  getTempleRecommendDaysLeft,
  getTempleRecommendStatus,
  TEMPLE_RECOMMEND_WARNING_DAYS,
} from '@/lib/temple-recommend';

// Calendar day in Ecuador (UTC-5), regardless of the host timezone.
const ecuadorNoon = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day, 17));

const recommendExpiration = (year: number, month: number, day: number) =>
  Timestamp.fromDate(ecuadorNoon(year, month, day));

// Apr 25 2026, 10:00 in Ecuador
const today = new Date('2026-04-25T15:00:00.000Z');

describe('getTempleRecommendDaysLeft', () => {
  it('counts calendar days until expiration using Ecuador time', () => {
    expect(
      getTempleRecommendDaysLeft(recommendExpiration(2026, 5, 25), today)
    ).toBe(30);
    expect(
      getTempleRecommendDaysLeft(recommendExpiration(2026, 4, 30), today)
    ).toBe(5);
  });

  it('returns negative days for an expired recommend', () => {
    expect(
      getTempleRecommendDaysLeft(recommendExpiration(2026, 4, 20), today)
    ).toBe(-5);
  });

  it('returns null when there is no expiration date', () => {
    expect(getTempleRecommendDaysLeft(null, today)).toBeNull();
    expect(getTempleRecommendDaysLeft(undefined, today)).toBeNull();
  });
});

describe('getTempleRecommendStatus', () => {
  const base = { hasTempleRecommend: true, templeRecommendExpirationDate: null };

  it('is none when the member has no recommend', () => {
    expect(getTempleRecommendStatus({ ...base, hasTempleRecommend: false }, today)).toBe('none');
  });

  it('is active when the recommend expires beyond the warning window', () => {
    expect(
      getTempleRecommendStatus(
        { ...base, templeRecommendExpirationDate: recommendExpiration(2026, 6, 1) },
        today
      )
    ).toBe('active');
  });

  it('warns when the recommend expires within 30 days', () => {
    expect(
      getTempleRecommendStatus(
        { ...base, templeRecommendExpirationDate: recommendExpiration(2026, 5, 25) },
        today
      )
    ).toBe('expiring_soon');
    expect(TEMPLE_RECOMMEND_WARNING_DAYS).toBe(30);
  });

  it('flags an expired recommend', () => {
    expect(
      getTempleRecommendStatus(
        { ...base, templeRecommendExpirationDate: recommendExpiration(2026, 4, 1) },
        today
      )
    ).toBe('expired');
  });

  it('stays active when marked with no expiration date on record', () => {
    expect(getTempleRecommendStatus(base, today)).toBe('active');
  });
});
