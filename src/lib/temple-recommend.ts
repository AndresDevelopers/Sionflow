/**
 * Recomendación para el templo: estado y días restantes.
 * Las notificaciones (in-app + push) avisan 30 y 5 días antes del vencimiento
 * desde la Cloud Function diaria; aquí se reutiliza el mismo umbral para la UI.
 */

import type { Member } from '@/lib/types';
import { getEcuadorDateParts, safeGetDate } from '@/lib/date-utils';

/** Días antes del vencimiento en que se avisa por primera vez. */
export const TEMPLE_RECOMMEND_WARNING_DAYS = 30;
/** Días antes del vencimiento para el aviso urgente. */
export const TEMPLE_RECOMMEND_URGENT_DAYS = 5;

export type TempleRecommendStatus = 'none' | 'active' | 'expiring_soon' | 'expired';

/**
 * Días de calendario (Ecuador) hasta el vencimiento.
 * Negativo si ya venció; null si no hay fecha válida.
 */
export function getTempleRecommendDaysLeft(
  expiration: unknown,
  now: Date = new Date()
): number | null {
  const expiry = safeGetDate(expiration);
  if (!expiry) return null;

  const expiryParts = getEcuadorDateParts(expiry);
  const todayParts = getEcuadorDateParts(now);
  if (!expiryParts || !todayParts) return null;

  const expiryUtc = Date.UTC(expiryParts.year, expiryParts.month - 1, expiryParts.day);
  const todayUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);

  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}

export function getTempleRecommendStatus(
  member: Pick<Member, 'hasTempleRecommend' | 'templeRecommendExpirationDate'>,
  now: Date = new Date()
): TempleRecommendStatus {
  if (member.hasTempleRecommend !== true) return 'none';

  const daysLeft = getTempleRecommendDaysLeft(member.templeRecommendExpirationDate, now);
  if (daysLeft === null) return 'active';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= TEMPLE_RECOMMEND_WARNING_DAYS) return 'expiring_soon';

  return 'active';
}
