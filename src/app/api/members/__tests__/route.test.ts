import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const docs: Array<{ id: string; data: Record<string, unknown> }> = [];
  const query: any = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({
      forEach: (
        cb: (doc: { id: string; data: () => Record<string, unknown> }) => void,
      ) => docs.forEach((doc) => cb({ id: doc.id, data: () => doc.data })),
    }),
  };
  return { docs, query };
});

vi.mock('@/lib/api-auth', () => ({
  requireUidAndBarrioOrg: vi.fn(async () => ({
    uid: 'user-1',
    barrioOrg: 'Barrio|Organizacion',
    email: null,
  })),
  getErrorStatus: (error: unknown, fallback = 500) =>
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : fallback,
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => null),
}));

vi.mock('@/lib/firebase-admin', () => ({
  firestoreAdmin: {
    collection: () => h.query,
  },
}));

// Faithful stand-in for Next's data cache: same key + revalidate window
// returns the first result, which is what made new members invisible.
vi.mock('next/cache', () => {
  const cache = new Map<string, unknown>();
  return {
    revalidateTag: vi.fn(() => cache.clear()),
    unstable_cache:
      (fn: () => unknown, keyParts: string[]) =>
      async () => {
        const key = keyParts.join('|');
        if (!cache.has(key)) cache.set(key, await fn());
        return cache.get(key);
      },
  };
});

describe('GET /api/members', () => {
  beforeEach(() => {
    h.docs.length = 0;
    // Exercise the production code path (the only one that used the data cache)
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns members created after a previous request (no stale list cache)', async () => {
    const { GET } = await import('../route');
    const makeRequest = () =>
      new Request('http://localhost/api/members', {
        headers: { authorization: 'Bearer test-token' },
      });

    h.docs.push({
      id: 'existing-member',
      data: {
        firstName: 'Ana',
        lastName: 'Lopez',
        status: 'active',
        barrioOrg: 'Barrio|Organizacion',
      },
    });

    const firstResponse = await GET(makeRequest());
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toHaveLength(1);

    // Simulates a member created right after the page loaded
    h.docs.push({
      id: 'new-member',
      data: {
        firstName: 'Bruno',
        lastName: 'Zavala',
        status: 'active',
        barrioOrg: 'Barrio|Organizacion',
      },
    });

    const secondResponse = await GET(makeRequest());
    expect(secondResponse.status).toBe(200);
    const members = (await secondResponse.json()) as Array<{ id: string }>;
    expect(members.map((m) => m.id)).toContain('new-member');
  });
});
