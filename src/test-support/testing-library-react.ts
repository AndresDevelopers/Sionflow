import type { ReactElement } from 'react';

type WaitForCallback<T> = () => T | Promise<T>;

type ActCallback = () => void | Promise<void>;

export function render(_ui: ReactElement) {
  return {
    unmount() {
      // noop stub for type-checking purposes
    },
  };
}

export async function waitFor<T>(_callback: WaitForCallback<T>): Promise<void> {
  // noop stub for type-checking purposes
}

export async function act(_callback: ActCallback): Promise<void> {
  // noop stub for type-checking purposes
}
