import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Prevent real Firebase client init in jsdom (invalid API keys crash module load).
// firestore/storage must be falsy so collections.ts `coll()` skips collection().
const authStub = {
  currentUser: null,
  onAuthStateChanged: (cb: (user: null) => void) => {
    queueMicrotask(() => cb(null));
    return () => {};
  },
  onIdTokenChanged: (cb: (user: null) => void) => {
    queueMicrotask(() => cb(null));
    return () => {};
  },
};

vi.mock('@/lib/firebase', () => ({
  app: null,
  auth: authStub,
  firestore: null,
  storage: null,
  functions: null,
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => authStub),
  initializeAuth: vi.fn(() => authStub),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  onAuthStateChanged: (
    _auth: unknown,
    cb: (user: null) => void,
  ) => {
    queueMicrotask(() => cb(null));
    return () => {};
  },
  onIdTokenChanged: (
    _auth: unknown,
    cb: (user: null) => void,
  ) => {
    queueMicrotask(() => cb(null));
    return () => {};
  },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  reauthenticateWithCredential: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

// Browser APIs used by Radix / layout components / i18n in jsdom
if (typeof window !== 'undefined') {
  const memoryStore = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return memoryStore.size;
    },
    clear() {
      memoryStore.clear();
    },
    getItem(key: string) {
      return memoryStore.has(key) ? memoryStore.get(key)! : null;
    },
    key(index: number) {
      return Array.from(memoryStore.keys())[index] ?? null;
    },
    removeItem(key: string) {
      memoryStore.delete(key);
    },
    setItem(key: string, value: string) {
      memoryStore.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  // JSDOM provides a scrollTo stub that throws "Not implemented" when called.
  // Replace it unconditionally so page tests do not emit unhandled async errors.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}
