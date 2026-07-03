import { buildActivityOverview } from '@/lib/activity-overview';

describe('buildActivityOverview', () => {
  const referenceDate = new Date('2026-04-03T10:00:00.000Z');

  it('summarizes yearly, upcoming, next and last activity data', () => {
    const result = buildActivityOverview(
      [
        { title: 'Actividad pasada', date: new Date('2026-03-20T18:00:00.000Z') },
        { title: 'Actividad de hoy', date: new Date('2026-04-03T18:00:00.000Z') },
        { title: 'Actividad próxima', date: new Date('2026-04-10T18:00:00.000Z') },
        { title: 'Actividad futura lejana', date: new Date('2026-05-20T18:00:00.000Z') },
        { title: 'Actividad año anterior', date: new Date('2025-11-12T18:00:00.000Z') },
      ],
      referenceDate
    );

    expect(result.totalThisYear).toBe(4);
    expect(result.upcomingCount).toBe(2);
    expect(result.nextActivity?.title).toBe('Actividad de hoy');
    expect(result.lastActivity?.title).toBe('Actividad pasada');
  });

  it('returns empty summary when there are no activities', () => {
    const result = buildActivityOverview([], referenceDate);

    expect(result.totalThisYear).toBe(0);
    expect(result.upcomingCount).toBe(0);
    expect(result.nextActivity).toBe(null);
    expect(result.lastActivity).toBe(null);
  });
});
