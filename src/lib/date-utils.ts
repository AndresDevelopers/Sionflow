/**
 * Utility functions for handling dates and Firebase Timestamps safely
 */

const ECUADOR_TIME_ZONE = 'America/Guayaquil';
const ECUADOR_NOON_UTC_HOUR = 17;

interface DateParts {
    year: number;
    month: number;
    day: number;
}

function parseDateParts(
    date: Date,
    timeZone: string = ECUADOR_TIME_ZONE
): DateParts {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);

    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    return { year, month, day };
}

/**
 * Safely converts a Firebase Timestamp, Date, string, or number to a Date object
 * @param timestamp - The timestamp to convert
 * @returns Date object or null if conversion fails
 */
export function safeGetDate(timestamp: any): Date | null {
    if (!timestamp) return null;

    try {
        // If it has toDate method (Firebase Timestamp)
        if (typeof timestamp.toDate === 'function') {
            return timestamp.toDate();
        }

        // If it's already a Date object
        if (timestamp instanceof Date) {
            return timestamp;
        }

        // If it's a string, try to parse it
        if (typeof timestamp === 'string') {
            const parsed = new Date(timestamp);
            return isNaN(parsed.getTime()) ? null : parsed;
        }

        // If it's a number (milliseconds)
        if (typeof timestamp === 'number') {
            return new Date(timestamp);
        }

        // Firestore Timestamp-like after JSON (localStorage / API)
        // { seconds, nanoseconds } or admin-style { _seconds, _nanoseconds }
        if (typeof timestamp === 'object') {
            const seconds =
                typeof timestamp.seconds === 'number'
                    ? timestamp.seconds
                    : typeof timestamp._seconds === 'number'
                      ? timestamp._seconds
                      : null;
            if (seconds != null) {
                const nanos =
                    typeof timestamp.nanoseconds === 'number'
                        ? timestamp.nanoseconds
                        : typeof timestamp._nanoseconds === 'number'
                          ? timestamp._nanoseconds
                          : 0;
                return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
            }
        }

        return null;
    } catch (error) {
        console.warn('Error parsing date:', error);
        return null;
    }
}

/**
 * Safely formats a timestamp using date-fns format
 * @param timestamp - The timestamp to format
 * @param formatStr - The format string for date-fns
 * @param options - Additional options for date-fns format
 * @returns Formatted date string or fallback text
 */
export function safeFormatDate(
    timestamp: any,
    formatStr: string,
    options?: any,
    fallback: string = 'No especificada'
): string {
    const date = safeGetDate(timestamp);
    if (!date) return fallback;

    try {
        const { format } = require('date-fns');
        return format(date, formatStr, options);
    } catch (error) {
        console.warn('Error formatting date:', error);
        return fallback;
    }
}

/**
 * Checks if a timestamp represents a future date
 * @param timestamp - The timestamp to check
 * @returns true if the date is in the future, false otherwise
 */
export function isFutureDate(timestamp: any): boolean {
    const date = safeGetDate(timestamp);
    return date ? date > new Date() : false;
}

/**
 * Checks if a timestamp represents a past date
 * @param timestamp - The timestamp to check
 * @returns true if the date is in the past, false otherwise
 */
export function isPastDate(timestamp: any): boolean {
    const date = safeGetDate(timestamp);
    return date ? date < new Date() : false;
}

/**
 * Gets the age in years from a birth date timestamp
 * @param birthTimestamp - The birth date timestamp
 * @returns Age in years or null if invalid
 */
export function getAge(birthTimestamp: unknown): number | null {
    const birthDate = safeGetDate(birthTimestamp);
    if (!birthDate) return null;

    const birth = getEcuadorDateParts(birthDate);
    const today = getEcuadorDateParts(new Date());
    if (!birth || !today) return null;

    let age = today.year - birth.year;
    if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) {
        age--;
    }

    return age;
}

/**
 * Stores date-only values at noon in Ecuador so month/day stay stable.
 */
export function normalizeDateForEcuadorStorage(date: Date): Date {
    return new Date(
        Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            ECUADOR_NOON_UTC_HOUR,
            0,
            0,
            0
        )
    );
}

/**
 * Reads a date using Ecuador's civil calendar day.
 */
export function getEcuadorDateParts(timestamp: unknown): DateParts | null {
    const date = safeGetDate(timestamp);
    if (!date) return null;

    return parseDateParts(date, ECUADOR_TIME_ZONE);
}

/**
 * Returns today's date using Ecuador local time.
 */
export function getTodayInEcuador(): Date {
    const today = parseDateParts(new Date(), ECUADOR_TIME_ZONE);
    return createEcuadorCalendarDate(today.year, today.month, today.day);
}

/**
 * Represents an Ecuador calendar day at noon in mainland Ecuador (17:00 UTC).
 * This Date has the same Ecuador day regardless of the server/browser timezone.
 */
export function createEcuadorCalendarDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, ECUADOR_NOON_UTC_HOUR));
}

/**
 * For formatting Ecuador calendar dates with local-time formatters (e.g. date-fns).
 * Calculations must use getEcuadorDateParts instead.
 */
export function getEcuadorDateForDisplay(date: Date): Date {
    const { year, month, day } = parseDateParts(date, ECUADOR_TIME_ZONE);
    return new Date(year, month - 1, day, 12);
}
