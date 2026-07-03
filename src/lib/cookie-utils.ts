"use client";

/**
 * Utility functions for handling browser cookies with expiration
 */

interface CookieOptions {
  expires?: Date;
  maxAge?: number; // in seconds
  path?: string;
  domain?: string;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

/**
 * Set a cookie with optional expiration
 */
export function setCookie(name: string, value: string, options: CookieOptions = {}): void {
  if (typeof document === 'undefined') return;

  let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.expires) {
    cookieString += `; expires=${options.expires.toUTCString()}`;
  }

  if (options.maxAge) {
    cookieString += `; max-age=${options.maxAge}`;
  }

  if (options.path) {
    cookieString += `; path=${options.path}`;
  }

  if (options.domain) {
    cookieString += `; domain=${options.domain}`;
  }

  if (options.secure) {
    cookieString += '; secure';
  }

  if (options.sameSite) {
    cookieString += `; samesite=${options.sameSite}`;
  }

  document.cookie = cookieString;
}

/**
 * Get a cookie value by name
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const nameEQ = encodeURIComponent(name) + '=';
  const cookies = document.cookie.split(';');

  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i];
    while (cookie.charAt(0) === ' ') {
      cookie = cookie.substring(1, cookie.length);
    }
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length));
    }
  }

  return null;
}

/**
 * Delete a cookie by name
 */
export function deleteCookie(name: string, path: string = '/'): void {
  if (typeof document === 'undefined') return;
  
  document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
}

/**
 * Check if a cookie exists
 */
export function hasCookie(name: string): boolean {
  return getCookie(name) !== null;
}

/**
 * Set a cookie that expires after a certain number of minutes
 */
export function setCookieWithMinutes(name: string, value: string, minutes: number): void {
  const date = new Date();
  date.setTime(date.getTime() + (minutes * 60 * 1000));
  setCookie(name, value, { expires: date, path: '/' });
}