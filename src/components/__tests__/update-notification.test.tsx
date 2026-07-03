import { renderHook, waitFor, act } from '@testing-library/react';
import { useUpdateCheck } from '../update-notification';
import { setCookieWithMinutes, getCookie, deleteCookie } from '@/lib/cookie-utils';

// Mock fetch for version checking
const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

// Mock cookie utilities
jest.mock('@/lib/cookie-utils', () => {
  let cookieStore: Record<string, string> = {};

  return {
    setCookieWithMinutes: jest.fn((name: string, value: string, minutes: number) => {
      const expiration = new Date();
      expiration.setTime(expiration.getTime() + minutes * 60 * 1000);
      cookieStore[name] = `${value};expires=${expiration.toUTCString()}`;
    }),
    getCookie: jest.fn((name: string) => {
      const cookie = cookieStore[name];
      if (!cookie) return null;

      // Check if cookie is expired
      const [value, expires] = cookie.split(';expires=');
      if (expires && new Date(expires) < new Date()) {
        delete cookieStore[name];
        return null;
      }
      return value;
    }),
    deleteCookie: jest.fn((name: string) => {
      delete cookieStore[name];
    }),
  };
});

describe('useUpdateCheck Hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset cookies
    const { deleteCookie } = require('@/lib/cookie-utils');
    deleteCookie('update_dismissed');

    // Setup fetch mock
    mockFetch.mockResolvedValue({
      json: async () => ({ version: '1.0.3', date: '2025-08-10' }),
    });
  });

  describe('Version checking', () => {
    it('should check for updates when hook mounts', async () => {
      renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/version.json');
      });
    });

    it('should set hasUpdate to true when new version is available', async () => {
      // First call returns current version, second call returns latest
      mockFetch
        .mockResolvedValueOnce({ json: async () => ({ version: '1.0.2' }) })
        .mockResolvedValueOnce({ json: async () => ({ version: '1.0.3' }) });

      const { result } = renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(result.current.hasUpdate).toBe(true);
      });
    });

    it('should not set hasUpdate when versions match', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ version: '1.0.2' }),
      });

      const { result } = renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      expect(result.current.hasUpdate).toBe(false);
    });
  });

  describe('Cookie handling', () => {
    it('should not set hasUpdate if cookie exists and not expired', async () => {
      const { getCookie } = require('@/lib/cookie-utils');
      (getCookie as jest.Mock).mockReturnValue('true');

      const { result } = renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      expect(result.current.hasUpdate).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      expect(result.current.hasUpdate).toBe(false);
    });

    it('should handle invalid version.json format', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ invalid: 'format' }),
      });

      const { result } = renderHook(() => useUpdateCheck());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      expect(result.current.hasUpdate).toBe(false);
    });
  });
});
