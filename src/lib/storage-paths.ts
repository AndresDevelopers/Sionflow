/**
 * Canonical Storage object paths scoped to the uploading user.
 * Format: users/{userId}/{category}/{uniqueFileName}
 *
 * Aligns with storage.rules so clients can only write under their own uid.
 */

function sanitizeFileName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._\-]+|[._\-]+$/g, '');
  return cleaned.slice(0, 80) || fallback;
}

/** Allow nested categories like profile_pictures/users while blocking path traversal */
function sanitizeCategory(value: string): string {
  return value
    .split('/')
    .map((part) => sanitizeFileName(part, 'images'))
    .filter(Boolean)
    .join('/')
    .slice(0, 120) || 'images';
}

/**
 * Build a user-scoped storage path for a new upload.
 */
export function userScopedStoragePath(
  userId: string,
  category: string,
  fileName: string
): string {
  if (!userId?.trim()) {
    throw new Error('userId is required for storage paths');
  }
  const safeCategory = sanitizeCategory(category);
  const safeName = sanitizeFileName(fileName, 'image.jpg');
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `users/${userId.trim()}/${safeCategory}/${unique}_${safeName}`;
}
