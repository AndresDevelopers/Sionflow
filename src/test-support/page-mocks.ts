/**
 * Shared vi.mock declarations for page smoke tests.
 * Import this module first in page test files (side-effect mocks).
 */
import React from 'react';
import { vi } from 'vitest';
import { createMockAuthState } from '@/test-support/mocks/auth';

export const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  pathname: '/',
};

export const mockAuthState = createMockAuthState();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockRouter.pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: function MockImage({
    src,
    alt,
    ...rest
  }: {
    src?: string | { src?: string };
    alt?: string;
    [key: string]: any;
  }) {
    const {
      priority: _p,
      fill: _f,
      loader: _l,
      quality: _q,
      placeholder: _ph,
      blurDataURL: _b,
      unoptimized: _u,
      sizes: _s,
      ...imgProps
    } = rest;
    const resolved =
      typeof src === 'string' ? src : src && typeof src === 'object' ? src.src ?? '' : '';
    return React.createElement('img', {
      src: resolved || '',
      alt: alt ?? '',
      ...imgProps,
    });
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => mockAuthState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/refresh-context', () => ({
  useOnManualRefresh: () => {},
  useRefresh: () => ({ triggerRefresh: vi.fn(), refreshKey: 0 }),
  RefreshProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/members-context', () => ({
  useMembers: () => ({
    members: [],
    loading: false,
    error: null,
    refreshMembers: vi.fn(),
    memberMap: new Map(),
  }),
  MembersProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    dismiss: vi.fn(),
    toasts: [],
  }),
}));

const emptySnapshot = {
  docs: [] as unknown[],
  empty: true,
  size: 0,
  forEach: () => {},
};

const missingDoc = {
  exists: () => false,
  data: () => undefined,
  id: '',
  get: () => undefined,
};

vi.mock('@/lib/firestore-query', () => ({
  getDocs: vi.fn(async () => emptySnapshot),
  getDoc: vi.fn(async () => missingDoc),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: vi.fn(() => ({ id: 'mock-collection', path: 'mock' })),
    doc: vi.fn(() => ({ id: 'mock-doc', path: 'mock/doc' })),
    query: vi.fn((...args: unknown[]) => args[0]),
    where: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    startAfter: vi.fn(() => ({})),
    onSnapshot: vi.fn(() => vi.fn()),
    addDoc: vi.fn(async () => ({ id: 'new-id' })),
    updateDoc: vi.fn(async () => {}),
    deleteDoc: vi.fn(async () => {}),
    setDoc: vi.fn(async () => {}),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(async () => {}),
    })),
    serverTimestamp: vi.fn(() => actual.Timestamp.now()),
    arrayUnion: vi.fn((...items: unknown[]) => items),
    arrayRemove: vi.fn((...items: unknown[]) => items),
    increment: vi.fn((n: number) => n),
    getCountFromServer: vi.fn(async () => ({
      data: () => ({ count: 0 }),
    })),
    getAggregateFromServer: vi.fn(async () => ({
      data: () => ({ count: 0 }),
    })),
  };
});

vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({ fullPath: 'mock' })),
  deleteObject: vi.fn(async () => {}),
  uploadBytes: vi.fn(async () => ({})),
  getDownloadURL: vi.fn(async () => 'https://example.com/file.png'),
}));

// Data loaders used by several main pages
vi.mock('@/lib/dashboard-data', () => ({
  getDashboardData: vi.fn(async () => ({
    convertsCount: 0,
    futureMembersCount: 0,
    councilActionsCount: 0,
    membersByStatus: {
      total: 0,
      active: 0,
      lessActive: 0,
      inactive: 0,
    },
    deceasedMembers: [],
  })),
  getActivityOverviewData: vi.fn(async () => ({
    totalThisYear: 0,
    upcomingCount: 0,
    nextActivity: null,
    lastActivity: null,
  })),
}));

vi.mock('@/lib/members-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/members-data')>();
  const empty = vi.fn(async () => []);
  return {
    ...actual,
    getMembers: empty,
    getDeceasedMembers: empty,
    getMembersByStatus: empty,
    getMembersForSelector: empty,
    getLessActiveMembers: empty,
    getActiveMembers: empty,
    getInactiveMembers: empty,
  };
});

vi.mock('@/lib/birthdays-data', () => ({
  fetchBirthdays: vi.fn(async () => []),
}));
