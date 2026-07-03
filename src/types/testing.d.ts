import type { ReactElement } from 'react';

type AnyFn = (...args: any[]) => any;

declare global {
  namespace jest {
    interface Mock<T extends AnyFn = AnyFn> {
      (...args: Parameters<T>): ReturnType<T>;
      mock: {
        calls: any[][];
        results: any[];
        clear(): void;
      };
      mockResolvedValue(value: unknown): jest.Mock<T>;
      mockResolvedValueOnce(value: unknown): jest.Mock<T>;
      mockRejectedValue(value: unknown): jest.Mock<T>;
      mockReturnValue(value: unknown): jest.Mock<T>;
      mockClear(): void;
    }
  }

  const jest: {
    fn<T extends AnyFn>(implementation?: T): jest.Mock<T>;
    mock<T>(moduleName: string, factory: () => T): void;
    spyOn<T, M extends keyof T>(object: T, method: M): { mockRestore(): void };
    useFakeTimers(): void;
    useRealTimers(): void;
    clearAllMocks(): void;
    advanceTimersByTime(ms: number): void;
  };

  function describe(name: string, fn: () => void): void;
  function it(name: string, fn: () => Promise<void> | void): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function afterEach(fn: () => void | Promise<void>): void;

  interface ExpectMatchers {
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: any[]): void;
    toHaveBeenCalledTimes(count: number): void;
    toEqual(expected: any): void;
    toBe(expected: any): void;
    not: {
      toHaveBeenCalled(): void;
    };
  }

  function expect(actual: any): ExpectMatchers;

  namespace expect {
    function objectContaining(partial: any): any;
  }
}

declare module '@testing-library/react' {
  interface RenderResult {
    unmount(): void;
  }

  export function render(ui: ReactElement): RenderResult;
  export function renderHook<Result>(callback: () => Result): { result: { current: Result } };
  export function waitFor<T>(callback: () => T | Promise<T>): Promise<void>;
  export function act(callback: () => void | Promise<void>): Promise<void>;
}

export {};
